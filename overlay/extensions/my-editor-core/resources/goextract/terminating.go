package main

import (
	"go/ast"
	"go/token"
)

// Terminating reports a terminating statement as the Go spec defines it. A natural-end jump counts as one, since the
// helper writes it as a return.
func Terminating(t *Target, s ast.Stmt, natural map[*ast.BranchStmt]bool) bool {
	switch s := s.(type) {
	case *ast.ReturnStmt:
		return true
	case *ast.BranchStmt:
		return s.Tok == token.GOTO || natural[s]
	case *ast.ExprStmt:
		call, ok := s.X.(*ast.CallExpr)
		return ok && isBuiltin(t.L.Info, call.Fun, "panic")
	case *ast.BlockStmt:
		return endsTerminating(t, s.List, natural)
	case *ast.IfStmt:
		return s.Else != nil && endsTerminating(t, s.Body.List, natural) && Terminating(t, s.Else, natural)
	case *ast.ForStmt:
		return s.Cond == nil && !breaksTo(t, s)
	case *ast.LabeledStmt:
		return Terminating(t, s.Stmt, natural)
	case *ast.SwitchStmt:
		return clausesTerminate(t, s, s.Body, natural)
	case *ast.TypeSwitchStmt:
		return clausesTerminate(t, s, s.Body, natural)
	case *ast.SelectStmt:
		return clausesTerminate(t, s, s.Body, natural)
	}
	return false
}

// endsTerminating reports a statement list whose last non-empty statement is terminating.
func endsTerminating(t *Target, list []ast.Stmt, natural map[*ast.BranchStmt]bool) bool {
	for i := len(list) - 1; i >= 0; i-- {
		if _, empty := list[i].(*ast.EmptyStmt); !empty {
			return Terminating(t, list[i], natural)
		}
	}
	return false
}

// clausesTerminate: no break to the statement, a default (always, for a select), and every clause ending in a
// terminating statement or a fallthrough.
func clausesTerminate(t *Target, owner ast.Stmt, body *ast.BlockStmt, natural map[*ast.BranchStmt]bool) bool {
	if breaksTo(t, owner) {
		return false
	}
	_, isSelect := owner.(*ast.SelectStmt)
	hasDefault := isSelect
	for _, cl := range body.List {
		var list []ast.Stmt
		switch cl := cl.(type) {
		case *ast.CaseClause:
			hasDefault = hasDefault || cl.List == nil
			list = cl.Body
		case *ast.CommClause:
			list = cl.Body
		}
		if n := len(list); n > 0 {
			if b, ok := list[n-1].(*ast.BranchStmt); ok && b.Tok == token.FALLTHROUGH {
				continue
			}
		}
		if !endsTerminating(t, list, natural) {
			return false
		}
	}
	return hasDefault
}

// breaksTo reports a break, outside function literals, whose target is s.
func breaksTo(t *Target, s ast.Stmt) bool {
	found := false
	ast.Inspect(s, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.FuncLit:
			return false
		case *ast.BranchStmt:
			if n.Tok == token.BREAK && BranchTarget(t, n) == ast.Node(s) {
				found = true
			}
		}
		return !found
	})
	return found
}
