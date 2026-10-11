package main

import (
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"sort"
	"strings"
)

// PlanChunk is one helper the model asked for: its name and the lines of its chunk.
type PlanChunk struct {
	Name string `json:"name"`
	From int    `json:"from"`
	To   int    `json:"to"`
}

// ParamFact is a helper parameter as written.
type ParamFact struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Pointer bool   `json:"pointer"`
}

// OutputFact is a helper output as written.
type OutputFact struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// HelperFact describes one built helper.
type HelperFact struct {
	Name         string       `json:"name"`
	From         int          `json:"from"`
	To           int          `json:"to"`
	Params       []ParamFact  `json:"params"`
	Outputs      []OutputFact `json:"outputs"`
	Returns      bool         `json:"returns"`
	Tail         bool         `json:"tail"`
	Lines        int          `json:"lines"`
	PointerSites int          `json:"pointerSites"`
}

// BuildResult is what `build` reports: the plan's problems, or the helpers and the function's new length.
type BuildResult struct {
	Problems      []string     `json:"problems"`
	Helpers       []HelperFact `json:"helpers,omitempty"`
	FunctionLines int          `json:"functionLines,omitempty"`
}

// planned is one chunk of the plan with its interface.
type planned struct {
	c       Chunk
	f       Iface
	natural []*ast.BranchStmt
	sites   int
}

// Build applies the plan to the target's file; the new file is returned only when there are no problems.
func Build(t *Target, plan []PlanChunk) (BuildResult, []byte) {
	res := BuildResult{Problems: []string{}}
	if problem := ScopeProblem(t); problem != "" {
		res.Problems = append(res.Problems, problem)
		return res, nil
	}
	if len(plan) == 0 {
		res.Problems = append(res.Problems, "The plan names no chunks.")
		return res, nil
	}
	var names []string
	for _, pc := range plan {
		names = append(names, pc.Name)
	}
	nameProblems := NameProblemsEach(t, names)
	var chunks []Chunk
	var helpers []planned
	for i, pc := range plan {
		c, problem := t.ResolveChunk(pc.Name, pc.From, pc.To)
		if problem != "" {
			res.Problems = append(res.Problems, pc.Name+": "+problem)
			for _, p := range nameProblems[i] {
				res.Problems = append(res.Problems, pc.Name+": "+p)
			}
			continue
		}
		chunks = append(chunks, c)
		f, natural, problems := Decide(t, c, pc.Name)
		_, sites := pointerEdits(t, c, f)
		for _, p := range append(problems, nameProblems[i]...) {
			if sites > 0 {
				p += fmt.Sprintf(" It would need %d (*x) sites.", sites)
			}
			res.Problems = append(res.Problems, pc.Name+": "+p)
		}
		helpers = append(helpers, planned{c, f, natural, sites})
	}
	res.Problems = append(res.Problems, OverlapProblems(chunks)...)
	if len(res.Problems) > 0 {
		return res, nil
	}
	// Helpers go after the function in chunk order (rule 11), whatever the plan's order.
	sort.SliceStable(helpers, func(a, b int) bool { return helpers[a].c.Start < helpers[b].c.Start })
	src, problems := splice(t, helpers, names)
	if len(problems) > 0 {
		res.Problems = problems
		return res, nil
	}
	res, out := measure(t, helpers, src)
	if out != nil {
		if problem := selfCheck(t, out); problem != "" {
			return BuildResult{Problems: []string{problem}}, nil
		}
	}
	return res, out
}

// selfCheck type-checks the package with the built file in place of the original, so that a file that does not
// compile is never written; it says why, or "".
func selfCheck(t *Target, out []byte) string {
	overlay := map[string][]byte{}
	for path, src := range t.L.Src {
		overlay[path] = src
	}
	overlay[t.Path] = out
	if _, err := Load(t.L.ListFile, t.L.Listed.ImportPath, overlay); err != nil {
		return "the built file " + strings.TrimPrefix(err.Error(), "the package ")
	}
	return ""
}

// splice writes each chunk's call block in its place and the helpers after the function.
func splice(t *Target, helpers []planned, names []string) (string, []string) {
	taken := map[string]bool{}
	for _, name := range names {
		taken[name] = true
	}
	for _, h := range helpers {
		top, nested := t.ChunkDeclared(h.c)
		for _, obj := range append(top, nested...) {
			taken[obj.Name()] = true
		}
		for _, p := range h.f.Params {
			taken[p.Name] = true
		}
	}
	var problems []string
	calls := make([]string, len(helpers))
	var funcs strings.Builder
	for i, h := range helpers {
		var used []string
		fresh := func(want string) string {
			name := Plumbing(t, taken, want)
			used = append(used, name)
			return name
		}
		body, _, err := Body(t, h.c, h.f, h.natural, fresh)
		if err == nil {
			calls[i], err = CallBlock(t, h.c, h.f, fresh)
		}
		if err != nil {
			problems = append(problems, h.f.Name+": "+err.Error())
			continue
		}
		for _, name := range used {
			taken[name] = true
		}
		funcs.WriteString(helperText(t, h.f, body))
	}
	if len(problems) > 0 {
		return "", problems
	}
	src := string(t.Src)
	end := t.Offset(t.Func.End())
	out := src[:end] + funcs.String() + src[end:]
	order := make([]int, len(helpers))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return helpers[order[a]].c.Start > helpers[order[b]].c.Start })
	for _, i := range order {
		c := helpers[i].c
		out = out[:c.Start] + calls[i] + out[c.End:]
	}
	return out, nil
}

// helperText is one helper declaration with its doc line, preceded by a blank line.
func helperText(t *Target, f Iface, body string) string {
	recv := ""
	if f.Method {
		r := t.Func.Recv
		recv = string(t.Src[t.Offset(r.Opening):t.Offset(r.Closing)+1]) + " "
	}
	var params []string
	for _, p := range f.Params {
		params = append(params, p.Name+" "+p.Type)
	}
	results := resultsText(t, f)
	if results != "" {
		results = " " + results
	}
	return fmt.Sprintf("\n\n// %s is part of %s, extracted by my_editor.\nfunc %s%s(%s)%s {\n%s}",
		f.Name, t.Func.Name.Name, recv, f.Name, strings.Join(params, ", "), results, body)
}

// resultsText is the helper's result list: the function's results for a tail chunk; else the outputs, then done
// and the function's results when it returns; named (`_` for unnamed slots) when an output is a named result.
func resultsText(t *Target, f Iface) string {
	var types, names []string
	if f.Tail {
		types = ResultTexts(t)
	} else {
		for _, o := range f.Outputs {
			types = append(types, o.Type)
			name := "_"
			if o.Named {
				name = o.Name
			}
			names = append(names, name)
		}
		if f.Returns {
			for _, r := range append([]string{"bool"}, ResultTexts(t)...) {
				types = append(types, r)
				names = append(names, "_")
			}
		}
	}
	switch {
	case len(types) == 0:
		return ""
	case f.Named:
		for i := range types {
			types[i] = names[i] + " " + types[i]
		}
	case len(types) == 1:
		return types[0]
	}
	return "(" + strings.Join(types, ", ") + ")"
}

// measure formats the file, counts the function's and each helper's lines (doc comments included) and checks them.
func measure(t *Target, helpers []planned, src string) (BuildResult, []byte) {
	res := BuildResult{Problems: []string{}}
	out, err := format.Source([]byte(src))
	if err != nil {
		res.Problems = append(res.Problems, fmt.Sprintf("the built file does not format: %v", err))
		return res, nil
	}
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, t.Path, out, parser.ParseComments|parser.SkipObjectResolution)
	if err != nil {
		res.Problems = append(res.Problems, fmt.Sprintf("the built file does not parse: %v", err))
		return res, nil
	}
	lines := map[string]int{}
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok {
			start := fn.Pos()
			if fn.Doc != nil {
				start = fn.Doc.Pos()
			}
			lines[funcKey(fn)] = fset.Position(fn.End()).Line - fset.Position(start).Line + 1
		}
	}
	res.FunctionLines = lines[funcKey(t.Func)]
	if res.FunctionLines > 400 {
		res.Problems = append(res.Problems, fmt.Sprintf("%s would still be %d lines; it must end at 400 or fewer.", t.Func.Name.Name, res.FunctionLines))
	}
	for _, h := range helpers {
		key := h.f.Name
		if h.f.Method {
			key = recvBase(t.Func.Recv.List[0].Type) + "." + key
		}
		fact := HelperFact{Name: h.f.Name, From: h.c.From, To: h.c.To, Params: []ParamFact{}, Outputs: []OutputFact{},
			Returns: h.f.Returns, Tail: h.f.Tail, Lines: lines[key], PointerSites: h.sites}
		for _, p := range h.f.Params {
			fact.Params = append(fact.Params, ParamFact{p.Name, p.Type, p.Pointer})
		}
		for _, o := range h.f.Outputs {
			fact.Outputs = append(fact.Outputs, OutputFact{o.Name, o.Type})
		}
		if fact.Lines > 400 {
			res.Problems = append(res.Problems, fmt.Sprintf("%s would be %d lines; at most 400.", h.f.Name, fact.Lines))
		}
		res.Helpers = append(res.Helpers, fact)
	}
	if len(res.Problems) > 0 {
		return BuildResult{Problems: res.Problems}, nil
	}
	return res, out
}

// funcKey names a declaration: its name, or Recv.name for a method.
func funcKey(fn *ast.FuncDecl) string {
	if fn.Recv != nil && len(fn.Recv.List) == 1 {
		return recvBase(fn.Recv.List[0].Type) + "." + fn.Name.Name
	}
	return fn.Name.Name
}
