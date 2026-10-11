package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
)

// blockCheck verifies helper i's call block as written (check 3's second half): each result goes to the local the
// helper's returns name in that slot; the arguments are the parameters' locals, by address for pointers; a variable
// the chunk declared is declared by the block and an outer one is assigned, never declared anew; var lines have the
// result types; done and the temporaries are fresh, used only by the block, and returned when done.
func (ck *checker) blockCheck(i int, sig helperSig) []string {
	h, site := ck.decls[i].Name.Name, ck.sites[i]
	call := fmt.Sprintf("the call to %s", h)
	problems := ck.resultOrder(i, sig)
	problems = append(problems, ck.arguments(i, sig)...)
	info := ck.at.L.Info
	inBlock := func(n interface{ Pos() token.Pos }) bool {
		off := ck.at.Offset(n.Pos())
		return ck.inFunc(n.Pos()) && site.Start <= off && off < site.End
	}
	declares := func(e ast.Expr) types.Object {
		id, ok := e.(*ast.Ident)
		if !ok {
			return nil
		}
		if obj := info.ObjectOf(id); obj != nil && inBlock(obj) {
			return obj
		}
		return nil
	}
	for k, o := range sig.Outputs {
		switch fresh := declares(site.Lhs[k]) != nil; {
		case o.Local == nil:
			problems = append(problems, fmt.Sprintf("%s assigns %s, which is no local of %s at line %d.", call, o.Name, ck.bt.Func.Name.Name, ck.chunks[i].From))
		case o.Chunk && !fresh:
			problems = append(problems, fmt.Sprintf("%s assigns %s, which the chunk declared; it must declare it.", call, o.Name))
		case !o.Chunk && fresh:
			problems = append(problems, fmt.Sprintf("%s declares %s anew; it must assign %s's %s.", call, o.Name, ck.bt.Func.Name.Name, o.Name))
		}
	}
	for _, spec := range site.Vars {
		k := site.lhsIndex(spec.Names[0])
		if k >= len(sig.Results) || typeKey(info.TypeOf(spec.Type)) != typeKey(sig.Results[k].Type()) {
			problems = append(problems, fmt.Sprintf("%s declares %s with a type that is not its result's.", call, spec.Names[0].Name))
		}
	}
	if site.Done < 0 {
		return problems
	}
	plumbing := site.Lhs[site.Done:]
	for _, e := range plumbing {
		obj := declares(e)
		if obj == nil {
			problems = append(problems, fmt.Sprintf("%s assigns %s, which it does not declare.", call, nodeText(ck.at, e)))
			continue
		}
		for id, used := range info.Uses {
			if used == obj && ck.inFunc(id.Pos()) && !inBlock(id) {
				problems = append(problems, fmt.Sprintf("%s declares %s, which %s uses outside the call block.", call, obj.Name(), ck.bt.Func.Name.Name))
				break
			}
		}
	}
	if !returnsPlumbing(info, site.DoneIf, plumbing[1:]) {
		problems = append(problems, fmt.Sprintf("%s does not return its results when done.", call))
	}
	return problems
}

// returnsPlumbing reports an if whose body is just `return r0, r1, …` of the call block's temporaries.
func returnsPlumbing(info *types.Info, ifs *ast.IfStmt, rs []ast.Expr) bool {
	if len(ifs.Body.List) != 1 {
		return false
	}
	r, ok := ifs.Body.List[0].(*ast.ReturnStmt)
	if !ok || len(r.Results) != len(rs) {
		return false
	}
	for k, e := range r.Results {
		id, ok := e.(*ast.Ident)
		want, _ := rs[k].(*ast.Ident)
		if !ok || want == nil || info.ObjectOf(id) == nil || info.ObjectOf(id) != info.ObjectOf(want) {
			return false
		}
	}
	return true
}

// resultOrder: each return of the helper that names a variable in output slot k names the local the call block
// assigns result k to.
func (ck *checker) resultOrder(i int, sig helperSig) []string {
	var problems []string
	reported := map[int]bool{}
	for _, r := range returnsOf(ck.decls[i].Body) {
		for k, o := range sig.Outputs {
			if k >= len(r.Results) || reported[k] {
				continue
			}
			id, ok := r.Results[k].(*ast.Ident)
			if !ok {
				continue
			}
			if _, isVar := ck.at.L.Info.ObjectOf(id).(*types.Var); isVar && id.Name != o.Name {
				problems = append(problems, fmt.Sprintf("the call to %s assigns result %d (%s) to %s.", ck.decls[i].Name.Name, k+1, id.Name, o.Name))
				reported[k] = true
			}
		}
	}
	return problems
}

// arguments: the call passes each parameter's local, &x for a pointer one, on the function's own receiver for a
// method; never a variable the call block itself declares.
func (ck *checker) arguments(i int, sig helperSig) []string {
	h, site := ck.decls[i].Name.Name, ck.sites[i]
	info := ck.at.L.Info
	if len(site.Call.Args) != len(sig.Params) || site.Call.Ellipsis.IsValid() {
		return []string{fmt.Sprintf("the call to %s passes %d arguments for %d parameters.", h, len(site.Call.Args), len(sig.Params))}
	}
	var problems []string
	for j, p := range sig.Params {
		arg := site.Call.Args[j]
		want := p.Name
		if p.Pointer {
			want = "&" + p.Name
		}
		id, ok := arg.(*ast.Ident)
		if u, isUnary := arg.(*ast.UnaryExpr); isUnary && u.Op == token.AND && p.Pointer {
			id, ok = u.X.(*ast.Ident)
		} else if p.Pointer {
			ok = false
		}
		obj := info.ObjectOf(id)
		if !ok || id.Name != p.Name || obj == nil || !ck.inFunc(obj.Pos()) || ck.at.Offset(obj.Pos()) >= site.Start {
			problems = append(problems, fmt.Sprintf("the call to %s passes %s for parameter %s, not %s.", h, nodeText(ck.at, arg), p.Name, want))
		}
	}
	if sel, ok := ast.Unparen(site.Call.Fun).(*ast.SelectorExpr); ok && sig.Recv != nil {
		x, isIdent := sel.X.(*ast.Ident)
		r := ck.at.Func.Recv
		if !isIdent || r == nil || len(r.List[0].Names) != 1 || info.ObjectOf(x) != info.Defs[r.List[0].Names[0]] {
			problems = append(problems, fmt.Sprintf("the call to %s is not on %s's receiver.", h, ck.at.Func.Name.Name))
		}
	}
	return problems
}

// inFunc reports a position inside the new function.
func (ck *checker) inFunc(p token.Pos) bool { return ck.at.Func.Pos() <= p && p < ck.at.Func.End() }
