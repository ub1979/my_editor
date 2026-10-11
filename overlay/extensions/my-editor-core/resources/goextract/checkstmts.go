package main

import (
	"fmt"
	"go/ast"
	"go/types"
)

// stmtCheck refuses what a helper cannot do for its chunk, read from the original's statements outside function
// literals: a defer would run when the helper returns, not the function; recover() would no longer be called by the
// deferred function; and a goroutine that uses an outer local would share the helper's copy of it, not the local.
func (ck *checker) stmtCheck(i int) []string {
	h, fn := ck.decls[i].Name.Name, ck.bt.Func.Name.Name
	info := ck.bt.L.Info
	var problems []string
	for _, s := range ck.chunks[i].Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.FuncLit:
				return false
			case *ast.DeferStmt:
				problems = append(problems, fmt.Sprintf("%s: the chunk defers at line %d.", h, ck.bt.Line(n.Pos())))
			case *ast.CallExpr:
				if id, ok := ast.Unparen(n.Fun).(*ast.Ident); ok && info.Uses[id] == types.Universe.Lookup("recover") {
					problems = append(problems, fmt.Sprintf("%s: the chunk calls recover at line %d.", h, ck.bt.Line(n.Pos())))
				}
			case *ast.GoStmt:
				if obj := ck.outerUse(i, n.Call); obj != nil {
					problems = append(problems, fmt.Sprintf("%s: the go statement at line %d uses %s's %s.", h, ck.bt.Line(n.Pos()), fn, obj.Name()))
				}
			}
			return true
		})
	}
	return problems
}

// outerUse is the first outer local of chunk i that a node of the original uses, function literals included, or nil.
func (ck *checker) outerUse(i int, n ast.Node) types.Object {
	var found types.Object
	ast.Inspect(n, func(m ast.Node) bool {
		if id, ok := m.(*ast.Ident); ok && found == nil {
			if obj := ck.bt.L.Info.Uses[id]; ck.funcLocal(obj) && !ck.declaredInChunk(i, obj) {
				found = obj
			}
		}
		return found == nil
	})
	return found
}
