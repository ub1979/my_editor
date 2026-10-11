package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"path/filepath"
	"sort"
	"strings"
)

// Target is the long function in its file.
type Target struct {
	L       *Loaded
	File    *ast.File
	Path    string
	Src     []byte
	Func    *ast.FuncDecl
	parents map[ast.Node]ast.Node
}

// FindFunc finds a function, or with recv the method on that receiver base type (`Store` for `func (s *Store)`).
func FindFunc(l *Loaded, path, name, recv string) (*Target, error) {
	path = filepath.Clean(path)
	file := l.File(path)
	if file == nil {
		return nil, fmt.Errorf("the package has no file %s", path)
	}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Name.Name != name || fn.Body == nil {
			continue
		}
		if (fn.Recv == nil && recv == "") || (fn.Recv != nil && len(fn.Recv.List) == 1 && recvBase(fn.Recv.List[0].Type) == recv) {
			return &Target{L: l, File: file, Path: path, Src: l.Src[path], Func: fn}, nil
		}
	}
	if recv != "" {
		return nil, fmt.Errorf("no method %s on %s in %s", name, recv, path)
	}
	return nil, fmt.Errorf("no function %s in %s", name, path)
}

// recvBase is a receiver type's base name: stars, parentheses and type arguments dropped.
func recvBase(e ast.Expr) string {
	for {
		switch x := e.(type) {
		case *ast.StarExpr:
			e = x.X
		case *ast.ParenExpr:
			e = x.X
		case *ast.IndexExpr:
			e = x.X
		case *ast.IndexListExpr:
			e = x.X
		case *ast.Ident:
			return x.Name
		default:
			return ""
		}
	}
}

// Line is the line of a position in the target's file.
func (t *Target) Line(p token.Pos) int { return t.L.Fset.Position(p).Line }

// Offset is the byte offset of a position in the target's file.
func (t *Target) Offset(p token.Pos) int { return t.L.Fset.Position(p).Offset }

// Generic reports type parameters on the function or on its receiver's type.
func (t *Target) Generic() bool {
	if t.Func.Type.TypeParams != nil && len(t.Func.Type.TypeParams.List) > 0 {
		return true
	}
	if t.Func.Recv == nil || len(t.Func.Recv.List) == 0 {
		return false
	}
	e := t.Func.Recv.List[0].Type
	if star, ok := e.(*ast.StarExpr); ok {
		e = star.X
	}
	switch e.(type) {
	case *ast.IndexExpr, *ast.IndexListExpr:
		return true
	}
	return false
}

// Directive is the first `//go:` line of the function's doc comment, or "".
func (t *Target) Directive() string {
	if t.Func.Doc == nil {
		return ""
	}
	for _, c := range t.Func.Doc.List {
		if strings.HasPrefix(c.Text, "//go:") {
			return c.Text
		}
	}
	return ""
}

// Parent is the node that directly contains n in the function (nil for the declaration itself).
func (t *Target) Parent(n ast.Node) ast.Node {
	if t.parents == nil {
		t.parents = map[ast.Node]ast.Node{}
		var stack []ast.Node
		ast.Inspect(t.Func, func(n ast.Node) bool {
			if n == nil {
				stack = stack[:len(stack)-1]
				return false
			}
			if len(stack) > 0 {
				t.parents[n] = stack[len(stack)-1]
			}
			stack = append(stack, n)
			return true
		})
	}
	return t.parents[n]
}

// Block is a statement list of the function itself: its body, a nested block, or a case or select clause body.
type Block struct {
	Owner ast.Node
	List  []ast.Stmt
	Depth int
}

// Blocks lists the function's statement lists in source order, never inside function literals.
// Depth is 1 for the body and one more per nested list, as gofmt indents them.
func (t *Target) Blocks() []Block {
	var out []Block
	t.collect(t.Func.Body, t.Func.Body.List, 1, &out)
	return out
}

func (t *Target) collect(owner ast.Node, list []ast.Stmt, depth int, out *[]Block) {
	*out = append(*out, Block{Owner: owner, List: list, Depth: depth})
	clauses := map[*ast.BlockStmt]bool{}
	for _, s := range list {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.FuncLit:
				return false
			case *ast.SwitchStmt:
				clauses[n.Body] = true
			case *ast.TypeSwitchStmt:
				clauses[n.Body] = true
			case *ast.SelectStmt:
				clauses[n.Body] = true
			case *ast.BlockStmt:
				if clauses[n] {
					return true
				}
				t.collect(n, n.List, depth+1, out)
				return false
			case *ast.CaseClause:
				t.collect(n, n.Body, depth+1, out)
				return false
			case *ast.CommClause:
				t.collect(n, n.Body, depth+1, out)
				return false
			}
			return true
		})
	}
}

// Chunk is a run of consecutive statements of one block, named by the plan. Start and End are byte offsets of
// whole lines: the start of line From and just after line To's newline.
type Chunk struct {
	Name        string
	From, To    int
	Block       Block
	First, Last int
	Start, End  int
}

// FirstPos and EndPos are the positions of the chunk's first statement and the end of its last.
func (c Chunk) FirstPos() token.Pos { return c.Block.List[c.First].Pos() }

// EndPos is the end of the chunk's last statement.
func (c Chunk) EndPos() token.Pos { return c.Block.List[c.Last].End() }

// Contains reports a node that lies within the chunk's statements.
func (c Chunk) Contains(n ast.Node) bool {
	return n != nil && c.FirstPos() <= n.Pos() && n.End() <= c.EndPos()
}

// ContainsPos reports a position within the chunk's statements.
func (c Chunk) ContainsPos(p token.Pos) bool { return c.FirstPos() <= p && p < c.EndPos() }

// Stmts are the chunk's statements.
func (c Chunk) Stmts() []ast.Stmt { return c.Block.List[c.First : c.Last+1] }

// ResolveChunk finds the statements of one block that lines from..to hold whole, or says why they don't.
func (t *Target) ResolveChunk(name string, from, to int) (Chunk, string) {
	var first string
	for _, b := range t.Blocks() {
		for i, s := range b.List {
			if t.Line(s.Pos()) != from {
				continue
			}
			c, problem := t.resolveIn(name, b, i, from, to)
			if problem == "" {
				return c, ""
			}
			if first == "" {
				first = problem
			}
		}
	}
	if first == "" {
		first = t.startProblem(from)
	}
	return Chunk{}, fmt.Sprintf("Lines %d–%d are not whole statements of one block of %s: %s.", from, to, t.Func.Name.Name, first)
}

// startProblem says why no statement of the function's blocks starts at a line.
func (t *Target) startProblem(line int) string {
	inLit := false
	ast.Inspect(t.Func.Body, func(n ast.Node) bool {
		if lit, ok := n.(*ast.FuncLit); ok && line > t.Line(lit.Body.Lbrace) && line <= t.Line(lit.Body.Rbrace) {
			inLit = true
		}
		return !inLit
	})
	if inLit {
		return fmt.Sprintf("line %d is inside a function literal", line)
	}
	var inside ast.Stmt
	for _, b := range t.Blocks() {
		for _, s := range b.List {
			if t.Line(s.Pos()) < line && line <= t.Line(s.End()) {
				inside = s
			}
		}
	}
	if inside != nil {
		return fmt.Sprintf("line %d is inside the statement at lines %d–%d", line, t.Line(inside.Pos()), t.Line(inside.End()))
	}
	return fmt.Sprintf("no statement of %s starts at line %d", t.Func.Name.Name, line)
}

// resolveIn tries the run of block b that starts at statement i and ends on line to.
func (t *Target) resolveIn(name string, b Block, i, from, to int) (Chunk, string) {
	if to < from {
		return Chunk{}, fmt.Sprintf("line %d is before line %d", to, from)
	}
	last := -1
	for j := i; j < len(b.List); j++ {
		if t.Line(b.List[j].End()) == to {
			last = j
		}
	}
	if last < 0 {
		end := b.List[len(b.List)-1]
		if to > t.Line(end.End()) {
			return Chunk{}, fmt.Sprintf("line %d is beyond the last statement of the block that line %d starts in", to, from)
		}
		for _, s := range b.List[i:] {
			if t.Line(s.Pos()) <= to && to < t.Line(s.End()) {
				return Chunk{}, fmt.Sprintf("line %d is inside the statement at lines %d–%d", to, t.Line(s.Pos()), t.Line(s.End()))
			}
		}
		return Chunk{}, fmt.Sprintf("no statement of %s ends at line %d", t.Func.Name.Name, to)
	}
	if line := t.sharedLine(b, i, last, from, to); line > 0 {
		return Chunk{}, fmt.Sprintf("line %d shares a line with other code", line)
	}
	tf := t.L.Fset.File(t.Func.Pos())
	end := len(t.Src)
	if to < tf.LineCount() {
		end = tf.Offset(tf.LineStart(to + 1))
	}
	c := Chunk{Name: name, From: from, To: to, Block: b, First: i, Last: last, Start: tf.Offset(tf.LineStart(from)), End: end}
	return c, ""
}

// sharedLine is from or to when code outside statements i..last of b shares that line, else 0.
func (t *Target) sharedLine(b Block, i, last, from, to int) int {
	tf := t.L.Fset.File(t.Func.Pos())
	before := t.Src[tf.Offset(tf.LineStart(from)):t.Offset(b.List[i].Pos())]
	if strings.TrimLeft(string(before), " \t") != "" || (i > 0 && t.Line(b.List[i-1].End()) >= from) {
		return from
	}
	rest := t.Src[t.Offset(b.List[last].End()):]
	if nl := strings.IndexByte(string(rest), '\n'); nl >= 0 {
		rest = rest[:nl]
	}
	after := strings.TrimLeft(string(rest), " \t")
	if (after != "" && !strings.HasPrefix(after, "//")) || (last+1 < len(b.List) && t.Line(b.List[last+1].Pos()) <= to) {
		return to
	}
	var open, close token.Pos
	switch o := b.Owner.(type) {
	case *ast.BlockStmt:
		open, close = o.Lbrace, o.Rbrace
	case *ast.CaseClause:
		open = o.Colon
	case *ast.CommClause:
		open = o.Colon
	}
	if t.Line(open) >= from {
		return from
	}
	if close.IsValid() && t.Line(close) <= to {
		return to
	}
	return 0
}

// OverlapProblems says which chunks overlap; chunks are sorted by From first.
func OverlapProblems(chunks []Chunk) []string {
	sorted := append([]Chunk{}, chunks...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].From < sorted[j].From })
	var out []string
	for i, a := range sorted {
		for _, b := range sorted[i+1:] {
			if b.From <= a.To {
				out = append(out, fmt.Sprintf("%s (%d–%d) overlaps %s (%d–%d).", a.Name, a.From, a.To, b.Name, b.From, b.To))
			}
		}
	}
	return out
}
