package main

import (
	"go/ast"
	"go/token"
	"go/types"
)

func (w *walker) rangeStmt(s *ast.RangeStmt, d dset) dset {
	w.read(s.X, d)
	body := d
	if s.Tok == token.ASSIGN {
		for _, l := range []ast.Expr{s.Key, s.Value} {
			if l == nil {
				continue
			}
			if obj := w.lhs(l, d); obj != nil {
				body = body.with(obj)
			}
		}
	}
	w.list(s.Body.List, body)
	return d
}

// clauses walks each clause of a switch, type switch or select from d. With a default (or for a select) the set
// after is the meet of every clause end and every break to the statement; otherwise it is d.
func (w *walker) clauses(owner ast.Stmt, body *ast.BlockStmt, d dset) dset {
	w.breaks[owner] = nil
	out := ended
	exhaustive := false
	for _, cl := range body.List {
		switch cl := cl.(type) {
		case *ast.CaseClause:
			for _, e := range cl.List {
				w.read(e, d)
			}
			exhaustive = exhaustive || cl.List == nil
			out = meet(out, w.list(cl.Body, d))
		case *ast.CommClause:
			start := w.optional(cl.Comm, d)
			out = meet(out, w.list(cl.Body, start))
			exhaustive = true
		}
	}
	for _, b := range w.breaks[owner] {
		out = meet(out, b)
	}
	if !exhaustive {
		return d
	}
	return out
}

func (w *walker) ret(s *ast.ReturnStmt, d dset) dset {
	for _, r := range s.Results {
		w.read(r, d)
	}
	if len(s.Results) == 0 && w.t.Func.Type.Results != nil {
		for _, f := range w.t.Func.Type.Results.List {
			for _, id := range f.Names {
				if obj := w.info.Defs[id]; w.tracked(obj) && !d.has(obj) {
					w.inputs[obj] = true
				}
			}
		}
	}
	return ended
}

// branch ends the path. A jump out of the chunk records the set for the natural end (jumps.go refuses the ones
// that are not allowed); a break to a switch or select inside the chunk joins that statement's set.
func (w *walker) branch(s *ast.BranchStmt, d dset) dset {
	target := BranchTarget(w.t, s)
	if !w.c.Contains(target) {
		w.ends = append(w.ends, d)
		return ended
	}
	if s.Tok == token.BREAK {
		if _, ok := w.breaks[target]; ok {
			w.breaks[target] = append(w.breaks[target], d)
		}
	}
	return ended
}

func (w *walker) isPanic(e ast.Expr) bool {
	call, ok := ast.Unparen(e).(*ast.CallExpr)
	if !ok {
		return false
	}
	id, ok := ast.Unparen(call.Fun).(*ast.Ident)
	if !ok {
		return false
	}
	b, ok := w.info.Uses[id].(*types.Builtin)
	return ok && b.Name() == "panic"
}

// gotoLabels are the labels inside the chunk that a goto inside it jumps to.
func gotoLabels(t *Target, c Chunk) map[types.Object]bool {
	out := map[types.Object]bool{}
	for _, s := range c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.FuncLit:
				return false
			case *ast.BranchStmt:
				if n.Tok == token.GOTO && c.Contains(BranchTarget(t, n)) {
					out[t.L.Info.Uses[n.Label]] = true
				}
			}
			return true
		})
	}
	return out
}
