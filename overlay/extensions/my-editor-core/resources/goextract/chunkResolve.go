package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"sort"
	"strings"
)

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
