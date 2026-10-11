package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
)

// flowCheck: the call block carries back what the chunk assigns. An outer local the chunk assigns, other than through
// a pointer parameter, that the function reads after the chunk (or anywhere in a loop around it) is an output. An
// output the helper keeps in a variable of its own (no parameter stands for it) is assigned by a top-level statement
// of the chunk before any read of it and before any jump to the natural end.
func (ck *checker) flowCheck(i int, sig helperSig) []string {
	h, fn := ck.decls[i].Name.Name, ck.bt.Func.Name.Name
	carried := map[types.Object]bool{}
	params := map[string]bool{}
	for _, p := range sig.Params {
		params[p.Name] = true
		if p.Pointer {
			carried[p.Local] = true
		}
	}
	for _, o := range sig.Outputs {
		carried[o.Local] = true
	}
	var problems []string
	for _, w := range ck.writes(i) {
		if obj := w.obj; !carried[obj] && ck.readAfter(i, obj) {
			carried[obj] = true
			problems = append(problems, fmt.Sprintf("%s: the chunk assigns %s (line %d), which %s reads after it, but the call does not assign it back.",
				h, obj.Name(), ck.bt.Line(w.pos), fn))
		}
	}
	for _, o := range sig.Outputs {
		if !o.Chunk && o.Local != nil && !params[o.Name] && !ck.assignedFirst(i, o.Local) {
			problems = append(problems, fmt.Sprintf("%s: %s goes back to %s's %s, but the chunk may leave it unassigned.", h, o.Name, fn, o.Name))
		}
	}
	return problems
}

type write struct {
	obj types.Object
	pos token.Pos
}

// writes lists the outer locals the chunk assigns, directly or through a field or array path, in order.
func (ck *checker) writes(i int) []write {
	var out []write
	seen := map[types.Object]bool{}
	add := func(e ast.Expr) {
		if obj := ck.root(e); obj != nil && ck.funcLocal(obj) && !ck.declaredInChunk(i, obj) && !seen[obj] {
			seen[obj] = true
			out = append(out, write{obj, e.Pos()})
		}
	}
	for _, s := range ck.chunks[i].Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.AssignStmt:
				for _, l := range n.Lhs {
					add(l)
				}
			case *ast.IncDecStmt:
				add(n.X)
			case *ast.RangeStmt:
				if n.Tok == token.ASSIGN {
					for _, e := range []ast.Expr{n.Key, n.Value} {
						if e != nil {
							add(e)
						}
					}
				}
			}
			return true
		})
	}
	return out
}

// readAfter reports a use of obj after the chunk or anywhere in a loop around it, and for a named result a bare
// return there or a defer in the function.
func (ck *checker) readAfter(i int, obj types.Object) bool {
	c := ck.chunks[i]
	loops := ck.loopsAround(c)
	after := func(p token.Pos) bool {
		for _, l := range loops {
			if l.Pos() <= p && p < l.End() {
				return true
			}
		}
		return p >= c.EndPos()
	}
	found := ck.namedResult(obj) && ck.defers()
	ast.Inspect(ck.bt.Func.Body, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.Ident:
			found = found || (ck.bt.L.Info.Uses[n] == obj && after(n.Pos()))
		case *ast.ReturnStmt:
			found = found || (len(n.Results) == 0 && ck.namedResult(obj) && after(n.Pos()))
		}
		return !found
	})
	return found
}

// assignedFirst reports an outer local that a top-level assignment of the chunk assigns whole before any other use
// of it in the chunk and before any jump that leaves the chunk.
func (ck *checker) assignedFirst(i int, obj types.Object) bool {
	c := ck.chunks[i]
	info := ck.bt.L.Info
	var first *ast.AssignStmt
	var lhs *ast.Ident
	for _, s := range c.Stmts() {
		if as, ok := s.(*ast.AssignStmt); ok && first == nil && (as.Tok == token.ASSIGN || as.Tok == token.DEFINE) {
			for _, l := range as.Lhs {
				if id, ok := l.(*ast.Ident); ok && info.ObjectOf(id) == obj {
					first, lhs = as, id
				}
			}
		}
	}
	if first == nil {
		return false
	}
	ok := true
	for _, s := range c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.Ident:
				ok = ok && (n == lhs || info.Uses[n] != obj || n.Pos() >= first.End())
			case *ast.BranchStmt:
				if target := ck.branchTarget(n); !c.Contains(target) {
					ok = ok && n.Pos() >= first.End()
				}
			}
			return ok
		})
	}
	return ok
}
