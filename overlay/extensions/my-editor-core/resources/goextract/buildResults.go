package main

import (
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"strings"
)

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
	if budget := FunctionBudget(fset, file); res.FunctionLines > budget {
		res.Problems = append(res.Problems, fmt.Sprintf("%s would still be %d lines; it must end at %d or fewer, so that with this file's package "+
			"and imports it fits in a file of its own.", t.Func.Name.Name, res.FunctionLines, budget))
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
		if fact.Lines > maxLines {
			res.Problems = append(res.Problems, fmt.Sprintf("%s would be %d lines; at most %d.", h.f.Name, fact.Lines, maxLines))
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
