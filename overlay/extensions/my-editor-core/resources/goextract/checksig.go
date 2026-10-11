package main

import (
	"fmt"
	"go/ast"
	"go/types"
)

// sigParam is one parameter of a helper as written, and the local of the function it stands for.
type sigParam struct {
	Name    string
	Obj     types.Object // the helper's parameter (after-load)
	Local   types.Object // the function's local (before-load)
	Pointer bool
}

// sigOutput is one value the call block assigns, and the local of the function it stands for.
type sigOutput struct {
	Name  string
	Local types.Object // before-load; nil when the name is no local
	Chunk bool         // declared at the top of the chunk
}

// helperSig is a helper's interface as the file shows it: its signature and its call block.
type helperSig struct {
	Recv     types.Object // the helper's receiver (after-load), or nil
	Params   []sigParam
	Outputs  []sigOutput
	Returns  bool // the results are outputs, done and the function's results
	Tail     bool // the call ends the function
	Results  []*types.Var
	Named    map[string]bool               // the helper's named results
	Stands   map[types.Object]types.Object // a named result standing for its output slot's local (before-load)
	Problems []string
}

// readSig reads helper i's signature and call block. A parameter stands for the outer local of the same name
// visible at the chunk's start; when there is none, the call's argument says which local it is passed, so that
// the other checks can go on.
func (ck *checker) readSig(i int) helperSig {
	d, c, site := ck.decls[i], ck.chunks[i], ck.sites[i]
	h, fn := d.Name.Name, ck.bt.Func.Name.Name
	sig := helperSig{Named: map[string]bool{}, Stands: map[types.Object]types.Object{}}
	problem := func(format string, args ...any) {
		sig.Problems = append(sig.Problems, h+": "+fmt.Sprintf(format, args...))
	}
	info := ck.at.L.Info
	if d.Recv != nil {
		sig.Recv = info.Defs[d.Recv.List[0].Names[0]]
		frecv := ck.receiver()
		if frecv == nil || frecv.Name() != sig.Recv.Name() || typeKey(frecv.Type()) != typeKey(sig.Recv.Type()) {
			problem("its receiver is not %s's receiver.", fn)
		}
	}
	j := 0
	for _, field := range d.Type.Params.List {
		for _, id := range field.Names {
			p := sigParam{Name: id.Name, Obj: info.Defs[id]}
			p.Local = ck.lookupLocal(c, id.Name)
			if p.Local == nil {
				problem("parameter %s stands for no local of %s at line %d.", id.Name, fn, c.From)
				p.Local, p.Pointer = ck.argLocal(c, site, j)
			} else if typ := p.Obj.Type(); typeKey(typ) == typeKey(types.NewPointer(p.Local.Type())) {
				p.Pointer = true
			} else if typeKey(typ) != typeKey(p.Local.Type()) {
				problem("parameter %s stands for no local of %s at line %d.", id.Name, fn, c.From)
			}
			sig.Params = append(sig.Params, p)
			j++
		}
	}
	ck.readResults(i, &sig, problem)
	return sig
}

// readResults reads the results and the call block's shape: tail, returns, and the outputs before the plumbing.
func (ck *checker) readResults(i int, sig *helperSig, problem func(string, ...any)) {
	d, c, site := ck.decls[i], ck.chunks[i], ck.sites[i]
	if d.Type.Results != nil {
		for _, field := range d.Type.Results.List {
			for _, id := range field.Names {
				if id.Name != "_" {
					sig.Named[id.Name] = true
				}
			}
		}
	}
	fsig := ck.at.L.Info.Defs[d.Name].Type().(*types.Signature)
	for k := 0; k < fsig.Results().Len(); k++ {
		sig.Results = append(sig.Results, fsig.Results().At(k))
	}
	_, isExpr := site.Stmt.(*ast.ExprStmt)
	sig.Tail = site.Last && (site.Return || isExpr)
	fn := ck.bt.Func.Name.Name
	if site.Return && !site.Last {
		problem("its call returns in the middle of %s.", fn)
	}
	if tail := c.Block.Owner == ast.Node(ck.bt.Func.Body) && c.Last == len(c.Block.List)-1; sig.Tail && !tail {
		problem("its call ends %s, but its chunk does not.", fn)
	}
	lhs := site.Lhs
	if site.Done >= 0 {
		sig.Returns, lhs = true, lhs[:site.Done]
	}
	for _, l := range lhs {
		id, ok := l.(*ast.Ident)
		if !ok || id.Name == "_" {
			problem("the call assigns %s, which is not a local.", nodeText(ck.at, l))
			continue
		}
		local, chunk := ck.outputLocal(c, id.Name)
		sig.Outputs = append(sig.Outputs, sigOutput{Name: id.Name, Local: local, Chunk: chunk})
	}
	ck.namedStands(i, sig, problem)
	ck.resultTypes(sig, site.Return, problem)
}

// resultTypes: the helper's results are, in order and by type, its outputs' locals; then done and the function's
// results when it returns; or just the function's results when its call is `return h(…)`.
func (ck *checker) resultTypes(sig *helperSig, ret bool, problem func(string, ...any)) {
	fn := ck.bt.Func.Name.Name
	fres := funcResults(ck.at)
	want := len(sig.Outputs)
	switch {
	case sig.Tail && ret:
		want = len(fres)
	case sig.Returns:
		want += 1 + len(fres)
	}
	if len(sig.Results) != want {
		problem("its results are not what its call block assigns.")
		return
	}
	is := func(k int, typ types.Type, what string) {
		if got := typeKey(sig.Results[k].Type()); got != typeKey(typ) {
			problem("its result %d has the type %s, but %s has the type %s.", k+1, got, what, typeKey(typ))
		}
	}
	for k, o := range sig.Outputs {
		if o.Local != nil {
			is(k, o.Local.Type(), fmt.Sprintf("%s's %s", fn, o.Name))
		}
	}
	at := 0
	if sig.Returns {
		at = len(sig.Outputs) + 1
		is(at-1, types.Typ[types.Bool], "done")
	}
	if sig.Returns || (sig.Tail && ret) {
		for k, r := range fres {
			is(at+k, r, fmt.Sprintf("%s's result %d", fn, k+1))
		}
	}
}

// namedStands: a named result stands for an outer local only in output slot k of that local, which the call
// assigns from it; any other named result named like an outer local would read zero where the chunk read the local.
func (ck *checker) namedStands(i int, sig *helperSig, problem func(string, ...any)) {
	c, fn := ck.chunks[i], ck.bt.Func.Name.Name
	for k, r := range sig.Results {
		local := ck.lookupLocal(c, r.Name())
		if !sig.Named[r.Name()] || local == nil {
			continue
		}
		if k < len(sig.Outputs) && sig.Outputs[k].Name == r.Name() && !sig.Outputs[k].Chunk && sig.Outputs[k].Local == local {
			sig.Stands[r] = local
			continue
		}
		problem("its result %s is named like %s's %s, but the call does not assign it to %s.", r.Name(), fn, r.Name(), r.Name())
	}
}

// receiver is the function's receiver variable in the original, or nil.
func (ck *checker) receiver() types.Object {
	r := ck.bt.Func.Recv
	if r == nil || len(r.List) != 1 || len(r.List[0].Names) != 1 {
		return nil
	}
	return ck.bt.L.Info.Defs[r.List[0].Names[0]]
}

// funcResults are the result types of a load's function: ck.bt's or ck.at's.
func funcResults(t *Target) []types.Type {
	var out []types.Type
	sig := t.L.Info.Defs[t.Func.Name].Type().(*types.Signature)
	for k := 0; k < sig.Results().Len(); k++ {
		out = append(out, sig.Results().At(k).Type())
	}
	return out
}

// lookupLocal is the variable of the function named name visible at the chunk's start in the original, or nil.
func (ck *checker) lookupLocal(c Chunk, name string) types.Object {
	scope := ck.bt.L.Pkg.Scope().Innermost(c.FirstPos())
	if scope == nil {
		return nil
	}
	_, obj := scope.LookupParent(name, c.FirstPos())
	if !ck.funcLocal(obj) {
		return nil
	}
	return obj
}

// funcLocal reports a variable of the original function, not a field: its receiver, a parameter or result, or a
// variable declared in its body.
func (ck *checker) funcLocal(obj types.Object) bool {
	v, ok := obj.(*types.Var)
	return ok && !v.IsField() && ck.bt.Func.Pos() <= v.Pos() && v.Pos() < ck.bt.Func.End()
}

// outputLocal is the local an output name stands for: the chunk's top-level declaration of that name, else the outer
// local visible at the chunk's start.
func (ck *checker) outputLocal(c Chunk, name string) (types.Object, bool) {
	for _, s := range c.Stmts() {
		var found types.Object
		ast.Inspect(s, func(n ast.Node) bool {
			if _, ok := n.(*ast.FuncLit); ok || found != nil {
				return false
			}
			if id, ok := n.(*ast.Ident); ok && id.Name == name {
				if obj := ck.bt.L.Info.Defs[id]; obj != nil && obj.Parent() == ck.blockScope(c) {
					found = obj
				}
			}
			return true
		})
		if found != nil {
			return found, true
		}
	}
	return ck.lookupLocal(c, name), false
}

// blockScope is the scope of the chunk's block in the original.
func (ck *checker) blockScope(c Chunk) *types.Scope {
	if c.Block.Owner == ast.Node(ck.bt.Func.Body) {
		return ck.bt.L.Info.Scopes[ck.bt.Func.Type]
	}
	return ck.bt.L.Info.Scopes[c.Block.Owner]
}

// argLocal is the local of the original that the call passes as argument j, and whether it passes its address.
func (ck *checker) argLocal(c Chunk, site CallSite, j int) (types.Object, bool) {
	if j >= len(site.Call.Args) {
		return nil, false
	}
	arg, pointer := site.Call.Args[j], false
	if u, ok := arg.(*ast.UnaryExpr); ok && u.Op.String() == "&" {
		arg, pointer = u.X, true
	}
	id, ok := arg.(*ast.Ident)
	if !ok {
		return nil, false
	}
	return ck.lookupLocal(c, id.Name), pointer
}

// typeKey writes a type with packages by path, so that types of the two loads compare.
func typeKey(t types.Type) string {
	return types.TypeString(t, func(p *types.Package) string { return p.Path() })
}

// nodeText is the source text of a node of a target's file.
func nodeText(t *Target, n ast.Node) string {
	return string(t.Src[t.Offset(n.Pos()):t.Offset(n.End())])
}
