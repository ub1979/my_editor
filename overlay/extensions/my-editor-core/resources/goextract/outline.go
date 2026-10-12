package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"sort"
)

// FuncFacts locates the long function.
type FuncFacts struct {
	Name      string `json:"name"`
	Receiver  string `json:"receiver"`
	StartLine int    `json:"startLine"` // the doc comment's first line, else the func line
	EndLine   int    `json:"endLine"`
	Lines     int    `json:"lines"`
	Budget    int    `json:"budget"` // the most lines it may keep, so that a split can give it a file of its own
}

// StmtFacts is one statement of a block.
type StmtFacts struct {
	From int `json:"from"`
	To   int `json:"to"`
	// assign, define, var, const, type, if, for, range, switch, typeswitch, select,
	// return, expr, incdec, send, go, defer, block, label, branch, empty
	Kind     string   `json:"kind"`
	Declares []string `json:"declares"`
	Refused  string   `json:"refused,omitempty"` // defer, recover, goto, label NAME, go
}

// BlockFacts is one statement list of the function.
type BlockFacts struct {
	Line       int         `json:"line"`
	Depth      int         `json:"depth"`
	Statements []StmtFacts `json:"statements"`
	Live       [][]string  `json:"live"` // per boundary 0..len(statements): outer locals read at or after it, sorted
}

// Outline is what the model plans from: the function, its blocks and statements, and the live names at boundaries.
type Outline struct {
	Function FuncFacts    `json:"function"`
	Refused  string       `json:"refused,omitempty"`
	Blocks   []BlockFacts `json:"blocks"`
}

// MakeOutline outlines the target function; a function out of scope is refused with no blocks.
func MakeOutline(t *Target) Outline {
	o := Outline{Function: funcFacts(t), Blocks: []BlockFacts{}}
	if o.Refused = ScopeProblem(t); o.Refused != "" {
		return o
	}
	for _, b := range t.Blocks() {
		bf := BlockFacts{Line: t.Line(b.Owner.Pos()), Depth: b.Depth, Statements: []StmtFacts{}, Live: [][]string{}}
		for i, s := range b.List {
			bf.Statements = append(bf.Statements, stmtFacts(t, b, i, s))
		}
		for k := 0; k <= len(b.List); k++ {
			bf.Live = append(bf.Live, liveAt(t, b, k))
		}
		o.Blocks = append(o.Blocks, bf)
	}
	return o
}

// ScopeProblem says why a function is out of scope (generic, or with a //go: line), or "".
func ScopeProblem(t *Target) string {
	name := t.Func.Name.Name
	if t.Generic() {
		return name + " is generic."
	}
	if d := t.Directive(); d != "" {
		return fmt.Sprintf("%s has a %s line.", name, d)
	}
	return ""
}

func funcFacts(t *Target) FuncFacts {
	start := t.Func.Pos()
	if t.Func.Doc != nil {
		start = t.Func.Doc.Pos()
	}
	f := FuncFacts{Name: t.Func.Name.Name, StartLine: t.Line(start), EndLine: t.Line(t.Func.End())}
	f.Lines = f.EndLine - f.StartLine + 1
	f.Budget = FunctionBudget(t.L.Fset, t.File)
	if t.Func.Recv != nil && len(t.Func.Recv.List) == 1 {
		typ := t.Func.Recv.List[0].Type
		f.Receiver = string(t.Src[t.Offset(typ.Pos()):t.Offset(typ.End())])
	}
	return f
}

func stmtFacts(t *Target, b Block, i int, s ast.Stmt) StmtFacts {
	f := StmtFacts{From: t.Line(s.Pos()), To: t.Line(s.End()), Kind: stmtKind(s), Declares: []string{}, Refused: refusal(t, s)}
	top, _ := t.ChunkDeclared(Chunk{Block: b, First: i, Last: i})
	for _, obj := range top {
		f.Declares = append(f.Declares, obj.Name())
	}
	return f
}

func stmtKind(s ast.Stmt) string {
	switch s := s.(type) {
	case *ast.AssignStmt:
		if s.Tok == token.DEFINE {
			return "define"
		}
		return "assign"
	case *ast.DeclStmt:
		if g, ok := s.Decl.(*ast.GenDecl); ok {
			return g.Tok.String()
		}
	case *ast.IfStmt:
		return "if"
	case *ast.ForStmt:
		return "for"
	case *ast.RangeStmt:
		return "range"
	case *ast.SwitchStmt:
		return "switch"
	case *ast.TypeSwitchStmt:
		return "typeswitch"
	case *ast.SelectStmt:
		return "select"
	case *ast.ReturnStmt:
		return "return"
	case *ast.ExprStmt:
		return "expr"
	case *ast.IncDecStmt:
		return "incdec"
	case *ast.SendStmt:
		return "send"
	case *ast.GoStmt:
		return "go"
	case *ast.DeferStmt:
		return "defer"
	case *ast.BlockStmt:
		return "block"
	case *ast.LabeledStmt:
		return "label"
	case *ast.BranchStmt:
		return "branch"
	}
	return "empty"
}

// refusal is the first thing in a statement, outside function literals, that keeps it out of any chunk: defer,
// recover(), a go statement, a goto to a label outside it, a label used from outside it.
func refusal(t *Target, s ast.Stmt) string {
	within := func(n ast.Node) bool { return n != nil && s.Pos() <= n.Pos() && n.End() <= s.End() }
	found := ""
	ast.Inspect(s, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.FuncLit:
			return false
		case *ast.DeferStmt:
			found = "defer"
		case *ast.GoStmt:
			found = "go"
		case *ast.CallExpr:
			if isBuiltin(t.L.Info, n.Fun, "recover") {
				found = "recover"
			}
		case *ast.BranchStmt:
			if n.Tok == token.GOTO && !within(BranchTarget(t, n)) {
				found = "goto"
			}
		case *ast.LabeledStmt:
			if labelUsedOutside(t, n, within) {
				found = "label " + n.Label.Name
			}
		}
		return found == ""
	})
	return found
}

// labelUsedOutside reports a jump to the label from outside the statement being outlined.
func labelUsedOutside(t *Target, ls *ast.LabeledStmt, within func(ast.Node) bool) bool {
	obj := t.L.Info.Defs[ls.Label]
	used := false
	ast.Inspect(t.Func.Body, func(n ast.Node) bool {
		if b, ok := n.(*ast.BranchStmt); ok && b.Label != nil && t.L.Info.Uses[b.Label] == obj && !within(b) {
			used = true
		}
		return !used
	})
	return used
}

// liveAt lists the outer locals at boundary k of a block (declared before it, in this block or an enclosing one)
// that are read at or after it, or anywhere in a loop around the block.
func liveAt(t *Target, b Block, k int) []string {
	var cut token.Pos
	switch {
	case k < len(b.List):
		cut = b.List[k].Pos()
	case len(b.List) > 0:
		cut = b.List[len(b.List)-1].End()
	default:
		cut = b.Owner.End()
	}
	read := ReadFrom(t, cut, loopsAround(t, b.Owner))
	scope := t.BlockScope(b)
	visible := func(obj types.Object) bool {
		for s := scope; s != nil; s = s.Parent() {
			if s == obj.Parent() {
				return true
			}
		}
		return false
	}
	names := []string{}
	for obj := range read {
		if t.IsLocal(obj) && obj.Pos() < cut && visible(obj) {
			names = append(names, obj.Name())
		}
	}
	sort.Strings(names)
	return names
}

// loopsAround are the function's for and range statements that contain n, outside function literals.
func loopsAround(t *Target, n ast.Node) []ast.Stmt {
	var out []ast.Stmt
	ast.Inspect(t.Func.Body, func(m ast.Node) bool {
		switch m := m.(type) {
		case *ast.FuncLit:
			return false
		case *ast.ForStmt, *ast.RangeStmt:
			if m.Pos() < n.Pos() && n.End() <= m.End() {
				out = append(out, m.(ast.Stmt))
			}
		}
		return true
	})
	return out
}
