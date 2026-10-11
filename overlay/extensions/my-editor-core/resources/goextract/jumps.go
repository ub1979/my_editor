package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
)

// Jumps applies rule 5 and the "refused besides" list to a chunk. Natural are the break and continue statements
// allowed to become the helper's natural-end return: a break to the switch or select owning the chunk's clause, or a
// continue of the loop whose body is the chunk's block, when the chunk runs to the end of that body. Every other
// jump out of the chunk is refused, as are labels used from outside, a goto over the call, defer, recover(), a go
// statement using an outer local, assigning a pointer receiver, and a shared variable on the left of `:=`.
// Function literals are not entered, except for the go rule.
func Jumps(t *Target, c Chunk, shared map[types.Object]string) (natural []*ast.BranchStmt, problems []string) {
	inside := func(n ast.Node) bool { return n != nil && c.FirstPos() <= n.Pos() && n.End() <= c.EndPos() }
	for _, s := range c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.FuncLit:
				return false
			case *ast.BranchStmt:
				if target := BranchTarget(t, n); !inside(target) {
					ok, problem := naturalEnd(t, c, n, target)
					if ok {
						natural = append(natural, n)
					} else {
						problems = append(problems, problem)
					}
				}
			case *ast.DeferStmt:
				problems = append(problems, fmt.Sprintf("defer at line %d.", t.Line(n.Pos())))
			case *ast.CallExpr:
				if isBuiltin(t.L.Info, n.Fun, "recover") {
					problems = append(problems, fmt.Sprintf("recover() at line %d.", t.Line(n.Pos())))
				}
			case *ast.GoStmt:
				if obj := firstOuter(t, c, n.Call); obj != nil {
					problems = append(problems, fmt.Sprintf("go statement at line %d uses %s.", t.Line(n.Pos()), obj.Name()))
				}
				return false
			case *ast.AssignStmt:
				problems = append(problems, assignProblems(t, n, shared)...)
			}
			return true
		})
	}
	return natural, append(problems, labelProblems(t, c, inside)...)
}

// naturalEnd decides a jump that leaves the chunk: allowed to the natural end, or the problem.
func naturalEnd(t *Target, c Chunk, b *ast.BranchStmt, target ast.Node) (bool, string) {
	line := t.Line(b.Pos())
	word := b.Tok.String()
	if b.Label != nil {
		word += " " + b.Label.Name
	}
	endsBody := c.Last == len(c.Block.List)-1
	bodyEnd := t.Line(c.Block.List[len(c.Block.List)-1].End())
	if b.Tok == token.BREAK && target != nil && t.Parent(t.Parent(c.Block.Owner)) == target {
		kind := "switch"
		if _, ok := target.(*ast.SelectStmt); ok {
			kind = "select"
		}
		if endsBody {
			return true, ""
		}
		return false, fmt.Sprintf("%s at line %d leaves the %s, but the chunk ends before its case does (line %d).", word, line, kind, bodyEnd)
	}
	if b.Tok == token.CONTINUE && target != nil && loopBody(target) == c.Block.Owner {
		if endsBody {
			return true, ""
		}
		return false, fmt.Sprintf("%s at line %d skips the rest of the loop body, which the chunk does not end.", word, line)
	}
	return false, fmt.Sprintf("%s at line %d leaves the chunk.", word, line)
}

// loopBody is a for or range statement's body, or nil.
func loopBody(n ast.Node) ast.Node {
	switch l := n.(type) {
	case *ast.ForStmt:
		return l.Body
	case *ast.RangeStmt:
		return l.Body
	}
	return nil
}

// isBuiltin reports a call target that is the predeclared function name.
func isBuiltin(info *types.Info, fun ast.Expr, name string) bool {
	id, ok := ast.Unparen(fun).(*ast.Ident)
	if !ok {
		return false
	}
	b, ok := info.Uses[id].(*types.Builtin)
	return ok && b.Name() == name
}

// firstOuter is the first outer local of the chunk referenced in n, function literals included, or nil.
func firstOuter(t *Target, c Chunk, n ast.Node) types.Object {
	var found types.Object
	ast.Inspect(n, func(m ast.Node) bool {
		if id, ok := m.(*ast.Ident); ok && found == nil {
			if obj := t.L.Info.Uses[id]; obj != nil && t.Outer(c, obj) {
				found = obj
			}
		}
		return found == nil
	})
	return found
}

// assignProblems refuses assigning a pointer receiver itself and a shared variable on the left of `:=`.
func assignProblems(t *Target, as *ast.AssignStmt, shared map[types.Object]string) []string {
	var recv types.Object
	if t.Func.Recv != nil && len(t.Func.Recv.List[0].Names) == 1 {
		recv = t.L.Info.Defs[t.Func.Recv.List[0].Names[0]]
	}
	var out []string
	for _, l := range as.Lhs {
		id, ok := ast.Unparen(l).(*ast.Ident)
		if !ok {
			continue
		}
		obj := t.L.Info.ObjectOf(id)
		if obj == nil {
			continue
		}
		if _, isPtr := obj.Type().Underlying().(*types.Pointer); obj == recv && isPtr {
			out = append(out, fmt.Sprintf("assigns the receiver %s at line %d.", id.Name, t.Line(id.Pos())))
		}
		if as.Tok == token.DEFINE && shared[obj] != "" {
			out = append(out, fmt.Sprintf("%s is passed by pointer but assigned with := at line %d.", id.Name, t.Line(id.Pos())))
		}
	}
	return out
}

// labelProblems refuses labels inside the chunk used from outside it, and a goto across the chunk either way.
func labelProblems(t *Target, c Chunk, inside func(ast.Node) bool) []string {
	var out []string
	ast.Inspect(t.Func.Body, func(n ast.Node) bool {
		b, ok := n.(*ast.BranchStmt)
		if !ok || b.Label == nil || inside(b) {
			return true
		}
		target := BranchTarget(t, b)
		if target == nil {
			return true
		}
		label := target
		if b.Tok != token.GOTO {
			label = t.Parent(target)
		}
		switch {
		case inside(label):
			out = append(out, fmt.Sprintf("the label %s (line %d) is used from outside the chunk (line %d).",
				b.Label.Name, t.Line(label.Pos()), t.Line(b.Pos())))
		case b.Tok == token.GOTO:
			if problem := gotoOver(t, c, b, label); problem != "" {
				out = append(out, problem)
			}
		}
		return true
	})
	return out
}

// gotoOver says why a goto outside the chunk jumps across it, or "": forward from before it to a label after it
// (over the call block's declarations), or back from after it to a label before it (a loop around the chunk that
// liveness and sharing do not see).
func gotoOver(t *Target, c Chunk, b *ast.BranchStmt, label ast.Node) string {
	switch {
	case b.Pos() < c.FirstPos() && label.Pos() >= c.EndPos():
		return fmt.Sprintf("goto %s at line %d would jump over the call at line %d.", b.Label.Name, t.Line(b.Pos()), c.From)
	case b.Pos() >= c.EndPos() && label.Pos() < c.FirstPos():
		return fmt.Sprintf("goto %s at line %d would jump back over the call at line %d.", b.Label.Name, t.Line(b.Pos()), c.From)
	}
	return ""
}
