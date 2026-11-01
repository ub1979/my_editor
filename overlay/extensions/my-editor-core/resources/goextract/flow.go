package main

import (
	"go/ast"
	"go/token"
	"go/types"
)

// Flow is what a chunk does with the function's variables. Inputs, Assigned and Outputs are in FirstUse order.
// End holds the outer locals definitely assigned whenever the chunk reaches its natural end. Declared marks outer
// outputs whose first reference in the chunk is on the left of a top-level `:=`.
type Flow struct {
	Inputs, Assigned, Outputs []types.Object
	FirstUse                  map[types.Object]token.Pos
	Declared                  map[types.Object]bool
	End                       map[types.Object]bool
}

// dset is the set of outer locals definitely assigned so far; top once every path has ended (the identity of meet).
type dset struct {
	top bool
	m   map[types.Object]bool
}

func (d dset) has(o types.Object) bool { return d.top || d.m[o] }

func (d dset) with(o types.Object) dset {
	if d.top {
		return d
	}
	m := map[types.Object]bool{o: true}
	for k := range d.m {
		m[k] = true
	}
	return dset{m: m}
}

func meet(a, b dset) dset {
	if a.top {
		return b
	}
	if b.top {
		return a
	}
	m := map[types.Object]bool{}
	for k := range a.m {
		if b.m[k] {
			m[k] = true
		}
	}
	return dset{m: m}
}

var ended = dset{top: true}

// walker walks a chunk once in source order. It is conservative: a branch is "may", a loop body may run zero or
// many times, and an unmodelled statement leaves the set unchanged.
type walker struct {
	t        *Target
	c        Chunk
	info     *types.Info
	inputs   map[types.Object]bool
	assigned map[types.Object]bool
	ends     []dset
	breaks   map[ast.Node][]dset
	gotos    map[types.Object]bool
}

func (w *walker) tracked(obj types.Object) bool { return obj != nil && w.t.Outer(w.c, obj) }

// read records every outer local read in e while not definitely assigned; function literals count as reads.
func (w *walker) read(e ast.Node, d dset) {
	if e == nil {
		return
	}
	ast.Inspect(e, func(n ast.Node) bool {
		if id, ok := n.(*ast.Ident); ok {
			if obj := w.info.Uses[id]; w.tracked(obj) && !d.has(obj) {
				w.inputs[obj] = true
			}
		}
		return true
	})
}

// lhs records a write to a left side; it returns the outer local written whole, or nil.
func (w *walker) lhs(l ast.Expr, d dset) types.Object {
	if id, ok := ast.Unparen(l).(*ast.Ident); ok {
		if obj := w.info.ObjectOf(id); w.tracked(obj) {
			w.assigned[obj] = true
			return obj
		}
		return nil
	}
	w.read(l, d)
	if root := ValueRoot(w.info, l); root != nil {
		if obj := w.info.ObjectOf(root); w.tracked(obj) {
			w.assigned[obj] = true
		}
	}
	return nil
}

func (w *walker) list(stmts []ast.Stmt, d dset) dset {
	for _, s := range stmts {
		d = w.stmt(s, d)
	}
	return d
}

func (w *walker) stmt(s ast.Stmt, d dset) dset {
	switch s := s.(type) {
	case *ast.AssignStmt:
		return w.assign(s.Lhs, s.Rhs, s.Tok, d)
	case *ast.IncDecStmt:
		w.read(s.X, d)
		if obj := w.lhs(s.X, d); obj != nil {
			return d.with(obj)
		}
	case *ast.DeclStmt:
		if gd, ok := s.Decl.(*ast.GenDecl); ok && gd.Tok == token.VAR {
			for _, spec := range gd.Specs {
				for _, v := range spec.(*ast.ValueSpec).Values {
					w.read(v, d)
				}
			}
		}
	case *ast.ExprStmt:
		w.read(s.X, d)
		if w.isPanic(s.X) {
			return ended
		}
	case *ast.SendStmt:
		w.read(s.Chan, d)
		w.read(s.Value, d)
	case *ast.GoStmt:
		w.read(s.Call, d)
	case *ast.DeferStmt:
		w.read(s.Call, d)
	case *ast.ReturnStmt:
		return w.ret(s, d)
	case *ast.BranchStmt:
		return w.branch(s, d)
	case *ast.BlockStmt:
		return w.list(s.List, d)
	case *ast.LabeledStmt:
		if obj := w.info.Defs[s.Label]; obj != nil && w.gotos[obj] {
			d = dset{m: map[types.Object]bool{}}
		}
		return w.stmt(s.Stmt, d)
	case *ast.IfStmt:
		d = w.optional(s.Init, d)
		w.read(s.Cond, d)
		a := w.list(s.Body.List, d)
		b := d
		if s.Else != nil {
			b = w.stmt(s.Else, d)
		}
		return meet(a, b)
	case *ast.ForStmt:
		d = w.optional(s.Init, d)
		w.read(s.Cond, d)
		w.list(s.Body.List, d)
		w.optional(s.Post, d)
		return d
	case *ast.RangeStmt:
		return w.rangeStmt(s, d)
	case *ast.SwitchStmt:
		d = w.optional(s.Init, d)
		w.read(s.Tag, d)
		return w.clauses(s, s.Body, d)
	case *ast.TypeSwitchStmt:
		d = w.optional(s.Init, d)
		w.read(s.Assign, d)
		return w.clauses(s, s.Body, d)
	case *ast.SelectStmt:
		return w.clauses(s, s.Body, d)
	}
	return d
}

func (w *walker) optional(s ast.Stmt, d dset) dset {
	if s == nil {
		return d
	}
	return w.stmt(s, d)
}

// assign reads the right side first, then the left side's own operands; whole writes join the set.
func (w *walker) assign(lhs, rhs []ast.Expr, tok token.Token, d dset) dset {
	for _, r := range rhs {
		w.read(r, d)
	}
	if tok != token.ASSIGN && tok != token.DEFINE {
		for _, l := range lhs {
			w.read(l, d)
		}
	}
	var whole []types.Object
	for _, l := range lhs {
		if obj := w.lhs(l, d); obj != nil {
			whole = append(whole, obj)
		}
	}
	for _, obj := range whole {
		d = d.with(obj)
	}
	return d
}
