package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"sort"
)

// Shared says which outer locals of the chunk a helper must take by pointer, and why. Reasons, first match wins:
// a named result of a function that defers; captured by a function literal anywhere in the function; a type that
// holds a lock; the earliest address-taking or slicing before or inside the chunk or anywhere in an enclosing loop.
func Shared(t *Target, c Chunk) map[types.Object]string {
	out := map[types.Object]string{}
	defers := HasDefer(t.Func)
	results := namedResults(t)
	loops := EnclosingLoops(t, c)
	inWindow := func(p token.Pos) bool {
		if p < c.EndPos() {
			return true
		}
		for _, l := range loops {
			if l.Pos() <= p && p < l.End() {
				return true
			}
		}
		return false
	}
	for _, obj := range t.OuterLocals(c) {
		if defers && results[obj] {
			out[obj] = fmt.Sprintf("a named result of %s, which defers", t.Func.Name.Name)
			continue
		}
		if lits := CapturedAt(t, obj); len(lits) > 0 {
			out[obj] = fmt.Sprintf("captured by the function literal at line %d", t.Line(lits[0]))
			continue
		}
		if HoldsLock(obj.Type()) {
			out[obj] = "its type holds a lock"
			continue
		}
		for _, s := range addressSites(t, obj) {
			if inWindow(s.pos) {
				out[obj] = s.why
				break
			}
		}
	}
	return out
}

// namedResults are the function's named result variables.
func namedResults(t *Target) map[types.Object]bool {
	out := map[types.Object]bool{}
	if t.Func.Type.Results == nil {
		return out
	}
	for _, f := range t.Func.Type.Results.List {
		for _, id := range f.Names {
			if obj := t.L.Info.Defs[id]; obj != nil {
				out[obj] = true
			}
		}
	}
	return out
}

// EnclosingLoops are the function's for and range statements that contain the chunk.
func EnclosingLoops(t *Target, c Chunk) []ast.Stmt {
	var out []ast.Stmt
	ast.Inspect(t.Func.Body, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.FuncLit:
			return false
		case *ast.ForStmt, *ast.RangeStmt:
			s := n.(ast.Stmt)
			if s.Pos() <= c.FirstPos() && c.EndPos() <= s.End() {
				out = append(out, s)
			}
		}
		return true
	})
	return out
}

// HasDefer reports a defer statement in the function's body, outside function literals.
func HasDefer(fn *ast.FuncDecl) bool {
	found := false
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		switch n.(type) {
		case *ast.FuncLit:
			return false
		case *ast.DeferStmt:
			found = true
		}
		return !found
	})
	return found
}

// CapturedAt lists the function literals, anywhere in the function, that use obj declared outside them.
func CapturedAt(t *Target, obj types.Object) []token.Pos {
	var out []token.Pos
	ast.Inspect(t.Func.Body, func(n ast.Node) bool {
		lit, ok := n.(*ast.FuncLit)
		if !ok || (lit.Pos() <= obj.Pos() && obj.Pos() < lit.End()) {
			return true
		}
		uses := false
		ast.Inspect(lit.Body, func(m ast.Node) bool {
			if id, ok := m.(*ast.Ident); ok && t.L.Info.Uses[id] == obj {
				uses = true
			}
			return !uses
		})
		if uses {
			out = append(out, lit.Pos())
		}
		return true
	})
	return out
}

// AddressTaken lists where the function takes obj's address, explicitly or implicitly, or slices it.
func AddressTaken(t *Target, obj types.Object) []token.Pos {
	var out []token.Pos
	for _, s := range addressSites(t, obj) {
		out = append(out, s.pos)
	}
	return out
}

type addressSite struct {
	pos token.Pos
	why string
}

// addressSites finds, in source order, each `&` on obj or a value path from it, each pointer-receiver method called
// or taken as a method value on such a path, and each slicing of an array path.
func addressSites(t *Target, obj types.Object) []addressSite {
	info := t.L.Info
	rootIs := func(e ast.Expr) bool {
		root := ValueRoot(info, e)
		return root != nil && info.ObjectOf(root) == obj
	}
	var out []addressSite
	ast.Inspect(t.Func.Body, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.UnaryExpr:
			if x.Op == token.AND && rootIs(x.X) {
				out = append(out, addressSite{x.Pos(), fmt.Sprintf("address-taken at line %d", t.Line(x.Pos()))})
			}
		case *ast.SliceExpr:
			if tv, ok := info.Types[x.X]; ok && isArray(tv.Type) && rootIs(x.X) {
				out = append(out, addressSite{x.Pos(), fmt.Sprintf("sliced at line %d", t.Line(x.Pos()))})
			}
		case *ast.SelectorExpr:
			if pointerMethodOnValue(info, x) && rootIs(x.X) {
				why := "method value"
				if call, ok := t.Parent(x).(*ast.CallExpr); ok && call.Fun == x {
					why = string(t.Src[t.Offset(x.Pos()):t.Offset(x.End())]) + " has a pointer receiver"
				}
				out = append(out, addressSite{x.Pos(), fmt.Sprintf("address-taken at line %d (%s)", t.Line(x.Pos()), why)})
			}
		}
		return true
	})
	sort.SliceStable(out, func(i, j int) bool { return out[i].pos < out[j].pos })
	return out
}

func isArray(t types.Type) bool {
	_, ok := t.Underlying().(*types.Array)
	return ok
}

// pointerMethodOnValue reports x.m where m has a pointer receiver and x is a value reached without a pointer.
func pointerMethodOnValue(info *types.Info, x *ast.SelectorExpr) bool {
	sel := info.Selections[x]
	if sel == nil || sel.Kind() != types.MethodVal || sel.Indirect() {
		return false
	}
	tv, ok := info.Types[x.X]
	if !ok || types.IsInterface(tv.Type) {
		return false
	}
	if _, isPtr := tv.Type.Underlying().(*types.Pointer); isPtr {
		return false
	}
	sig, ok := sel.Obj().Type().(*types.Signature)
	if !ok || sig.Recv() == nil {
		return false
	}
	_, ptrRecv := sig.Recv().Type().(*types.Pointer)
	return ptrRecv
}

var locker = func() *types.Interface {
	nullary := types.NewSignatureType(nil, nil, nil, nil, nil, false)
	return types.NewInterfaceType([]*types.Func{
		types.NewFunc(token.NoPos, nil, "Lock", nullary),
		types.NewFunc(token.NoPos, nil, "Unlock", nullary),
	}, nil).Complete()
}()

// HoldsLock reports a type that must not be copied, as vet's copylocks decides: a type (a struct, or any other named
// type) whose pointer has Lock and Unlock and whose value does not, found through struct fields and array elements,
// never through pointers.
func HoldsLock(t types.Type) bool {
	for {
		a, ok := t.Underlying().(*types.Array)
		if !ok {
			break
		}
		t = a.Elem()
	}
	if _, isPtr := t.Underlying().(*types.Pointer); !isPtr && types.Implements(types.NewPointer(t), locker) && !types.Implements(t, locker) {
		return true
	}
	st, ok := t.Underlying().(*types.Struct)
	if !ok {
		return false
	}
	for i := 0; i < st.NumFields(); i++ {
		if HoldsLock(st.Field(i).Type()) {
			return true
		}
	}
	return false
}
