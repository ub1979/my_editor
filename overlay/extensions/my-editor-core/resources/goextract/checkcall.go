package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
)

// CallSite is a helper's call block in the new function, as written: the statement holding the call, the `var`
// lines just before it that only declare names it assigns, and the `if done { … }` just after it.
type CallSite struct {
	Call       *ast.CallExpr
	Stmt       ast.Stmt
	Lhs        []ast.Expr // what the call assigns, in order
	Define     bool
	Vars       []*ast.ValueSpec
	DoneIf     *ast.IfStmt // the if testing done; Stmt itself in the `if done, … := h(…); done` form
	Done       int         // the index of done in Lhs, or -1
	Return     bool        // `return h(…)`
	Last       bool        // the call block ends the function body
	Start, End int         // whole lines of the after-file
}

// FindCallSites finds the call block of each helper in the new function t. Each helper must be used exactly once in
// the function, by a call that is a whole statement, an assignment's only value, a return's only result, or the
// init of an if testing done.
func FindCallSites(t *Target, helpers []*ast.FuncDecl) ([]CallSite, []string) {
	objs := map[types.Object]int{}
	for i, d := range helpers {
		objs[t.L.Info.Defs[d.Name]] = i
	}
	uses := make([]int, len(helpers))
	ast.Inspect(t.Func.Body, func(n ast.Node) bool {
		if id, ok := n.(*ast.Ident); ok {
			if i, ok := objs[t.L.Info.Uses[id]]; ok {
				uses[i]++
			}
		}
		return true
	})
	var problems []string
	for i, d := range helpers {
		if uses[i] != 1 {
			problems = append(problems, fmt.Sprintf("%s uses %s %d times; its call block uses it once.", t.Func.Name.Name, d.Name.Name, uses[i]))
		}
	}
	if len(problems) > 0 {
		return nil, problems
	}
	sites := make([]CallSite, len(helpers))
	found := make([]bool, len(helpers))
	for _, b := range t.Blocks() {
		for j, s := range b.List {
			site, ok := callStmt(s)
			if !ok {
				continue
			}
			i, ok := objs[t.L.Info.Uses[calleeIdent(site.Call)]]
			if !ok {
				continue
			}
			if problem := site.widen(t, b, j); problem != "" {
				problems = append(problems, fmt.Sprintf("the call to %s at line %d %s.", helpers[i].Name.Name, t.Line(s.Pos()), problem))
			}
			sites[i], found[i] = site, true
		}
	}
	for i, d := range helpers {
		if !found[i] {
			problems = append(problems, fmt.Sprintf("the call to %s is not a statement of its own in %s.", d.Name.Name, t.Func.Name.Name))
		}
	}
	return sites, problems
}

// callStmt reads the call a statement is made of, with what it assigns.
func callStmt(s ast.Stmt) (CallSite, bool) {
	site := CallSite{Stmt: s, Done: -1}
	var ok bool
	switch s := s.(type) {
	case *ast.ExprStmt:
		site.Call, ok = s.X.(*ast.CallExpr)
	case *ast.ReturnStmt:
		if len(s.Results) == 1 {
			site.Call, ok = s.Results[0].(*ast.CallExpr)
			site.Return = true
		}
	case *ast.AssignStmt:
		site.Call, site.Lhs, site.Define, ok = assignedCall(s)
	case *ast.IfStmt:
		if init, isAssign := s.Init.(*ast.AssignStmt); isAssign {
			site.Call, site.Lhs, site.Define, ok = assignedCall(init)
			site.DoneIf = s
		}
	}
	return site, ok
}

func assignedCall(s *ast.AssignStmt) (*ast.CallExpr, []ast.Expr, bool, bool) {
	if len(s.Rhs) != 1 || (s.Tok != token.ASSIGN && s.Tok != token.DEFINE) {
		return nil, nil, false, false
	}
	call, ok := s.Rhs[0].(*ast.CallExpr)
	return call, s.Lhs, s.Tok == token.DEFINE, ok
}

// calleeIdent is the name a call calls: f in f(…), m in x.m(…).
func calleeIdent(call *ast.CallExpr) *ast.Ident {
	switch f := ast.Unparen(call.Fun).(type) {
	case *ast.Ident:
		return f
	case *ast.SelectorExpr:
		return f.Sel
	}
	return nil
}

// widen extends the site over its var lines and its if done, sets its whole lines, and says what is wrong with it.
func (site *CallSite) widen(t *Target, b Block, j int) string {
	first, last := j, j
	if site.DoneIf == nil && len(site.Lhs) > 0 && j+1 < len(b.List) {
		if next, ok := b.List[j+1].(*ast.IfStmt); ok && next.Init == nil && next.Else == nil && site.lhsIndex(next.Cond) >= 0 {
			site.DoneIf, last = next, j+1
		}
	}
	if site.DoneIf != nil {
		if site.Done = site.lhsIndex(site.DoneIf.Cond); site.Done < 0 || site.DoneIf.Else != nil {
			return "is in an if that does not test done"
		}
	}
	for !site.Define && first > 0 {
		spec := varLine(b.List[first-1])
		if spec == nil || site.lhsIndex(spec.Names[0]) < 0 {
			break
		}
		site.Vars = append([]*ast.ValueSpec{spec}, site.Vars...)
		first--
	}
	site.Last = b.Owner == ast.Node(t.Func.Body) && last == len(b.List)-1
	site.Start, site.End = WholeLines(t.Src, t.Offset(b.List[first].Pos()), t.Offset(b.List[last].End()))
	return ""
}

// lhsIndex is the index of an identifier among the names the call assigns, or -1.
func (site *CallSite) lhsIndex(e ast.Expr) int {
	id, ok := e.(*ast.Ident)
	if !ok {
		return -1
	}
	for i, l := range site.Lhs {
		if lid, ok := l.(*ast.Ident); ok && lid.Name == id.Name {
			return i
		}
	}
	return -1
}

// varLine is the spec of `var name T`, one name, a type and no value, or nil.
func varLine(s ast.Stmt) *ast.ValueSpec {
	d, ok := s.(*ast.DeclStmt)
	if !ok {
		return nil
	}
	g, ok := d.Decl.(*ast.GenDecl)
	if !ok || g.Tok != token.VAR || len(g.Specs) != 1 {
		return nil
	}
	spec, ok := g.Specs[0].(*ast.ValueSpec)
	if !ok || len(spec.Names) != 1 || spec.Type == nil || len(spec.Values) != 0 {
		return nil
	}
	return spec
}
