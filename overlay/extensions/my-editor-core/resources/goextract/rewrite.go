package main

import (
	"go/ast"
	"go/token"
	"go/types"
	"sort"
	"strconv"
	"strings"
)

// Iface is a helper's interface as the builder decided it.
type Iface struct {
	Name    string
	Method  bool // a method on the function's pointer receiver (the chunk uses the receiver)
	Params  []Param
	Outputs []Output
	Returns bool // carries done and the function's results
	Tail    bool // the chunk ends the function body
	Named   bool // results are named (see Decisions)
}

// Param is one helper parameter; a pointer one is passed as &x and used as (*x).
type Param struct {
	Obj     types.Object
	Name    string
	Type    string
	Pointer bool
}

// Output is one value the helper returns to the call block. Named marks an outer output that is a named result of
// the helper (neither a parameter nor first written by a top-level `:=` of the chunk).
type Output struct {
	Obj           types.Object
	Name          string
	Type          string
	ChunkDeclared bool
	Named         bool
}

// edit replaces the file's bytes start..end with text.
type edit struct {
	start, end int
	text       string
}

// rewriter collects the edits of one helper body.
type rewriter struct {
	t       *Target
	c       Chunk
	f       Iface
	fresh   func(string) string
	edits   []edit
	ptr     map[types.Object]bool
	results []types.Type
	named   []types.Object
}

// Body is the helper's body for chunk c, dedented to depth 1, and its number of (*x) sites. The chunk's bytes are
// copied with four mechanical rewrites: (*x) for pointer parameters, the function's returns, natural-end jumps and
// the natural end, then the re-indent outside raw strings.
func Body(t *Target, c Chunk, f Iface, natural []*ast.BranchStmt, fresh func(string) string) (string, int, error) {
	edits, sites := pointerEdits(t, c, f)
	r := &rewriter{t: t, c: c, f: f, fresh: fresh, edits: edits, ptr: pointerParams(f)}
	r.signature()
	if err := r.returns(); err != nil {
		return "", 0, err
	}
	for _, b := range natural {
		text, err := r.naturalReturn(b.Pos())
		if err != nil {
			return "", 0, err
		}
		r.edits = append(r.edits, edit{t.Offset(b.Pos()), t.Offset(b.End()), text})
	}
	text := render(t.Src, r.edits, c.Start, c.End)
	if !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	if r.needsNaturalEnd(natural) {
		end, err := r.naturalReturn(c.EndPos())
		if err != nil {
			return "", 0, err
		}
		text += strings.Repeat("\t", c.Block.Depth) + end + "\n"
	}
	return Dedent(text, c.Block.Depth-1), sites, nil
}

func pointerParams(f Iface) map[types.Object]bool {
	out := map[types.Object]bool{}
	for _, p := range f.Params {
		if p.Pointer {
			out[p.Obj] = true
		}
	}
	return out
}

// pointerEdits writes (*x) at every use of a pointer parameter in the chunk, function literals included, except a
// field selector's operand when the variable's type is a struct, a method selector's operand when it is a named
// non-pointer, non-interface type, and `&x`, which becomes x. It returns the edits and the number of (*x) sites.
func pointerEdits(t *Target, c Chunk, f Iface) ([]edit, int) {
	ptr := pointerParams(f)
	info := t.L.Info
	done := map[*ast.Ident]bool{}
	var out []edit
	sites := 0
	for _, s := range c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.UnaryExpr:
				if id, ok := ast.Unparen(n.X).(*ast.Ident); ok && n.Op == token.AND && ptr[info.Uses[id]] {
					out = append(out, edit{t.Offset(n.Pos()), t.Offset(n.End()), id.Name})
					done[id] = true
				}
			case *ast.Ident:
				obj := info.Uses[n]
				if !ptr[obj] || done[n] {
					break
				}
				if sel, ok := t.Parent(n).(*ast.SelectorExpr); ok && sel.X == n && autoDeref(info, sel, obj) {
					break
				}
				out = append(out, edit{t.Offset(n.Pos()), t.Offset(n.End()), "(*" + n.Name + ")"})
				sites++
			}
			return true
		})
	}
	return out, sites
}

// autoDeref reports a selector whose operand may stay a pointer: a field of a struct-typed variable, or a method of
// a variable of a named non-pointer, non-interface type.
func autoDeref(info *types.Info, sel *ast.SelectorExpr, obj types.Object) bool {
	s := info.Selections[sel]
	if s == nil {
		return false
	}
	typ := obj.Type()
	switch s.Kind() {
	case types.FieldVal:
		_, ok := typ.Underlying().(*types.Struct)
		return ok
	case types.MethodVal:
		if _, ok := types.Unalias(typ).(*types.Named); !ok {
			return false
		}
		switch typ.Underlying().(type) {
		case *types.Pointer, *types.Interface:
			return false
		}
		return true
	}
	return false
}

// signature reads the function's result types and named results.
func (r *rewriter) signature() {
	if r.t.Func.Type.Results == nil {
		return
	}
	for _, field := range r.t.Func.Type.Results.List {
		typ := r.t.L.Info.TypeOf(field.Type)
		if len(field.Names) == 0 {
			r.results = append(r.results, typ)
		}
		for _, id := range field.Names {
			r.results = append(r.results, typ)
			r.named = append(r.named, r.t.L.Info.Defs[id])
		}
	}
}

// returns rewrites each return of the function in the chunk (not of function literals).
func (r *rewriter) returns() error {
	var err error
	for _, s := range r.c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.FuncLit:
				return false
			case *ast.ReturnStmt:
				if err == nil {
					err = r.ret(n)
				}
			}
			return err == nil
		})
	}
	return err
}

// ret rewrites one return: a tail chunk keeps it (a bare one names the results); otherwise the outputs and done
// come first, and a single multi-value call is first assigned to fresh names on a line of its own.
func (r *rewriter) ret(s *ast.ReturnStmt) error {
	bare := len(s.Results) == 0 && len(r.named) > 0
	if r.f.Tail && !bare {
		return nil
	}
	var vals []string
	prefix := ""
	switch {
	case bare:
		for _, obj := range r.named {
			vals = append(vals, r.valueText(obj))
		}
	case len(s.Results) == 1 && len(r.results) > 1:
		for i := range r.results {
			vals = append(vals, r.fresh("r"+strconv.Itoa(i)))
		}
		call := render(r.t.Src, r.edits, r.t.Offset(s.Results[0].Pos()), r.t.Offset(s.Results[0].End()))
		prefix = strings.Join(vals, ", ") + " := " + call + "\n" + r.indent(s.Pos())
	default:
		for _, e := range s.Results {
			vals = append(vals, render(r.t.Src, r.edits, r.t.Offset(e.Pos()), r.t.Offset(e.End())))
		}
	}
	var parts []string
	if !r.f.Tail {
		outs, err := r.outputs(s.Pos())
		if err != nil {
			return err
		}
		parts = outs
		if r.f.Returns {
			parts = append(parts, "true")
		}
	}
	text := prefix + returnText(append(parts, vals...))
	r.edits = append(r.edits, edit{r.t.Offset(s.Pos()), r.t.Offset(s.End()), text})
	return nil
}

// naturalReturn is the return that ends the helper at its natural end, written at position at.
func (r *rewriter) naturalReturn(at token.Pos) (string, error) {
	parts, err := r.outputs(at)
	if err != nil {
		return "", err
	}
	if r.f.Returns {
		parts = append(parts, "false")
		for _, typ := range r.results {
			zero, err := r.t.ZeroText(typ, at)
			if err != nil {
				return "", err
			}
			parts = append(parts, zero)
		}
	}
	return returnText(parts), nil
}

// needsNaturalEnd: not when the chunk ends in a terminating statement, nor when the helper returns nothing.
func (r *rewriter) needsNaturalEnd(natural []*ast.BranchStmt) bool {
	if len(r.f.Outputs) == 0 && !r.f.Returns {
		return false
	}
	nat := map[*ast.BranchStmt]bool{}
	for _, b := range natural {
		nat[b] = true
	}
	return !Terminating(r.t, r.c.Block.List[r.c.Last], nat)
}

// outputs are the output slots of a return at position at: each output's name, or its zero value when the helper
// has not declared it yet there. A name that means another variable at that position is an error.
func (r *rewriter) outputs(at token.Pos) ([]string, error) {
	var out []string
	for _, o := range r.f.Outputs {
		if r.declaredAfter(o, at) {
			zero, err := r.t.ZeroText(o.Obj.Type(), at)
			if err != nil {
				return nil, err
			}
			out = append(out, zero)
			continue
		}
		if err := r.t.resolves(o.Name, o.Obj, at); err != nil {
			return nil, err
		}
		out = append(out, o.Name)
	}
	return out, nil
}

// declaredAfter reports an output the helper declares in its body after position at: a chunk-declared variable, or
// an outer one that is neither a parameter nor a named result (so a top-level `:=` of the chunk declares it).
func (r *rewriter) declaredAfter(o Output, at token.Pos) bool {
	if o.ChunkDeclared {
		return o.Obj.Pos() > at
	}
	if o.Named {
		return false
	}
	for _, p := range r.f.Params {
		if p.Obj == o.Obj {
			return false
		}
	}
	for _, ref := range r.t.Refs(r.c) {
		if ref.Obj == o.Obj {
			return ref.Id.Pos() > at
		}
	}
	return false
}

// valueText is a parameter's value in the helper: (*x) for a pointer one.
func (r *rewriter) valueText(obj types.Object) string {
	if r.ptr[obj] {
		return "(*" + obj.Name() + ")"
	}
	return obj.Name()
}

// indent is the leading blanks of the line holding p.
func (r *rewriter) indent(p token.Pos) string {
	off := r.t.Offset(p)
	start := strings.LastIndexByte(string(r.t.Src[:off]), '\n') + 1
	line := string(r.t.Src[start:off])
	return line[:len(line)-len(strings.TrimLeft(line, " \t"))]
}

func returnText(parts []string) string {
	if len(parts) == 0 {
		return "return"
	}
	return "return " + strings.Join(parts, ", ")
}

// render is src[from:to] with the edits inside it applied; an edit nested in an earlier one is left to that one.
func render(src []byte, edits []edit, from, to int) string {
	sorted := append([]edit{}, edits...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].start != sorted[j].start {
			return sorted[i].start < sorted[j].start
		}
		return sorted[i].end > sorted[j].end
	})
	var b strings.Builder
	cur := from
	for _, e := range sorted {
		if e.start < cur || e.end > to {
			continue
		}
		b.Write(src[cur:e.start])
		b.WriteString(e.text)
		cur = e.end
	}
	b.Write(src[cur:to])
	return b.String()
}
