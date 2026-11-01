package main

import (
	"go/ast"
	"go/token"
	"go/types"
)

// pointerReceiver is the function's named pointer receiver, or nil.
func pointerReceiver(t *Target) types.Object {
	if t.Func.Recv == nil || len(t.Func.Recv.List) == 0 || len(t.Func.Recv.List[0].Names) == 0 {
		return nil
	}
	obj := t.L.Info.Defs[t.Func.Recv.List[0].Names[0]]
	if obj == nil {
		return nil
	}
	if _, ok := obj.Type().Underlying().(*types.Pointer); !ok {
		return nil
	}
	return obj
}

func isContext(typ types.Type) bool {
	n, ok := types.Unalias(typ).(*types.Named)
	return ok && n.Obj().Pkg() != nil && n.Obj().Pkg().Path() == "context" && n.Obj().Name() == "Context"
}

// hasReturn and hasBareReturn look for returns of the function in the chunk, not of its function literals.
func hasReturn(c Chunk) bool { return findReturn(c, func(*ast.ReturnStmt) bool { return true }) }

func hasBareReturn(c Chunk) bool {
	return findReturn(c, func(r *ast.ReturnStmt) bool { return len(r.Results) == 0 })
}

func findReturn(c Chunk, match func(*ast.ReturnStmt) bool) bool {
	found := false
	for _, s := range c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.FuncLit:
				return false
			case *ast.ReturnStmt:
				found = found || match(n)
			}
			return !found
		})
	}
	return found
}

// ResultTexts are the function's result types as written, one per result.
func ResultTexts(t *Target) []string {
	var out []string
	if t.Func.Type.Results == nil {
		return out
	}
	for _, field := range t.Func.Type.Results.List {
		text := string(t.Src[t.Offset(field.Type.Pos()):t.Offset(field.Type.End())])
		for n := max(1, len(field.Names)); n > 0; n-- {
			out = append(out, text)
		}
	}
	return out
}

// writtenFirst reports an outer local that a top-level assignment of the chunk writes whole before any other
// reference to it in the chunk and before any jump out of the chunk.
func writtenFirst(t *Target, c Chunk, obj types.Object) bool {
	var first *ast.AssignStmt
	var lhs *ast.Ident
	for _, s := range c.Stmts() {
		if as, ok := s.(*ast.AssignStmt); ok && first == nil && (as.Tok == token.ASSIGN || as.Tok == token.DEFINE) {
			for _, l := range as.Lhs {
				if id, ok := l.(*ast.Ident); ok && t.L.Info.Uses[id] == obj {
					first, lhs = as, id
				}
			}
		}
	}
	if first == nil {
		return false
	}
	for _, r := range append(t.Refs(c), t.LitRefs(c)...) {
		if r.Obj == obj && r.Id != lhs && r.Id.Pos() < first.End() {
			return false
		}
	}
	ok := true
	for _, s := range c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			if b, isJump := n.(*ast.BranchStmt); isJump && b.Pos() < first.End() {
				if target := BranchTarget(t, b); target == nil || !c.Contains(target) {
					ok = false
				}
			}
			return ok
		})
	}
	return ok
}
