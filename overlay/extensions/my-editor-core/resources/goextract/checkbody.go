package main

import (
	"fmt"
	"go/ast"
	"go/format"
	"go/scanner"
	"go/token"
	"go/types"
	"sort"
	"strings"
)

// origin is where an identifier of the expected helper comes from: a chunk identifier, a name written for a local
// of the original (an output slot, a named result), a fresh temporary, or a name of the zero values and constants
// the check writes, which must be global.
type origin struct {
	kind int
	id   *ast.Ident   // fromChunk: the chunk's identifier
	obj  types.Object // standsFor: the original's local
}

const (
	inSignature = iota
	fromChunk
	standsFor
	freshName
	globalName
)

// piece is a run of the expected body: bytes copied from the original at src, or generated text (src < 0) with
// the origins of the identifiers it writes, by offset in text.
type piece struct {
	text string
	src  int
	ids  map[int]origin
}

func gen(text string) piece { return piece{text: text, src: -1} }

func genIdent(name string, o origin) piece {
	return piece{text: name, src: -1, ids: map[int]origin{0: o}}
}

// cedit replaces bytes start..end of the original with the pieces make writes.
type cedit struct {
	start, end int
	make       func() []piece
}

// aligned pairs an identifier of the written helper with the origin of its expected counterpart.
type aligned struct {
	id *ast.Ident
	o  origin
}

// bodyCheck writes the expected helper i from its chunk and its signature as written, and compares it with the
// helper by tokens (check 2). When they match it returns each identifier of the helper's body with its origin.
func (ck *checker) bodyCheck(i int, sig helperSig) ([]aligned, []string) {
	w := &bodyWriter{ck: ck, c: ck.chunks[i], d: ck.decls[i], sig: sig, ptr: map[types.Object]bool{}}
	for _, p := range sig.Params {
		if p.Pointer && p.Local != nil {
			w.ptr[p.Local] = true
		}
	}
	w.pointerEdits()
	w.returnEdits()
	if len(w.problems) > 0 {
		return nil, w.problems
	}
	body := w.render(w.c.Start, w.c.End)
	natural := w.naturalReturn(w.c.EndPos())
	var best []string
	bestAt := -1
	for _, end := range [][]piece{nil, append([]piece{gen("\n")}, natural...)} {
		al, at, problem := w.compare(append(append([]piece{}, body...), end...))
		if problem == "" {
			return al, nil
		}
		if at > bestAt {
			best, bestAt = []string{problem}, at
		}
	}
	return nil, best
}

// bodyWriter holds the edits of one expected helper body.
type bodyWriter struct {
	ck       *checker
	c        Chunk
	d        *ast.FuncDecl
	sig      helperSig
	ptr      map[types.Object]bool
	edits    []cedit
	problems []string
}

// pointerEdits: (*x) at every use of a local passed by pointer, function literals included, except a field
// selector's operand when the local's type is a struct, a method selector's operand when it is a named non-pointer,
// non-interface type, and &x, which becomes x.
func (w *bodyWriter) pointerEdits() {
	info, bt := w.ck.bt.L.Info, w.ck.bt
	done := map[*ast.Ident]bool{}
	for _, s := range w.c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.UnaryExpr:
				if id, ok := ast.Unparen(n.X).(*ast.Ident); ok && n.Op == token.AND && w.ptr[info.Uses[id]] {
					w.edit(n, func() []piece { return []piece{w.copied(id)} })
					done[id] = true
				}
			case *ast.Ident:
				obj := info.Uses[n]
				if !w.ptr[obj] || done[n] {
					break
				}
				if sel, ok := bt.Parent(n).(*ast.SelectorExpr); ok && sel.X == n && keepsPointer(info.Selections[sel], obj.Type()) {
					break
				}
				w.edit(n, func() []piece { return []piece{gen("(*"), w.copied(n), gen(")")} })
			}
			return true
		})
	}
}

// keepsPointer reports a selection whose operand may stay a pointer: a field of a struct-typed local, or a method of
// a local of a named non-pointer, non-interface type.
func keepsPointer(s *types.Selection, typ types.Type) bool {
	if s == nil {
		return false
	}
	switch s.Kind() {
	case types.FieldVal:
		_, ok := typ.Underlying().(*types.Struct)
		return ok
	case types.MethodVal:
		_, named := types.Unalias(typ).(*types.Named)
		switch typ.Underlying().(type) {
		case *types.Pointer, *types.Interface:
			return false
		}
		return named
	}
	return false
}

func (w *bodyWriter) edit(n ast.Node, make func() []piece) {
	w.edits = append(w.edits, cedit{w.ck.bt.Offset(n.Pos()), w.ck.bt.Offset(n.End()), make})
}

// copied is a node's bytes in the original.
func (w *bodyWriter) copied(n ast.Node) piece {
	start := w.ck.bt.Offset(n.Pos())
	return piece{text: string(w.ck.bt.Src[start:w.ck.bt.Offset(n.End())]), src: start}
}

// render is the original's bytes from..to with the edits inside applied; an edit nested in another is the outer
// one's to apply.
func (w *bodyWriter) render(from, to int) []piece {
	sorted := append([]cedit{}, w.edits...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].start != sorted[j].start {
			return sorted[i].start < sorted[j].start
		}
		return sorted[i].end > sorted[j].end
	})
	var out []piece
	cur := from
	for _, e := range sorted {
		if e.start < cur || e.end > to {
			continue
		}
		out = append(out, piece{text: string(w.ck.bt.Src[cur:e.start]), src: cur})
		out = append(out, e.make()...)
		cur = e.end
	}
	return append(out, piece{text: string(w.ck.bt.Src[cur:to]), src: cur})
}

// compare formats the expected declaration and compares it with the helper as written: the problem and how far
// the two agree, or the helper's body identifiers with their origins.
func (w *bodyWriter) compare(body []piece) ([]aligned, int, string) {
	at, d := w.ck.at, w.d
	header := string(at.Src[at.Offset(d.Pos()):at.Offset(d.Body.Lbrace)])
	pieces := append([]piece{{text: header + "{\n", src: -2}}, body...)
	pieces = append(pieces, gen("\n}\n"))
	var b strings.Builder
	for _, p := range pieces {
		b.WriteString(p.text)
	}
	h := d.Name.Name
	formatted, err := format.Source([]byte(b.String()))
	if err != nil {
		return nil, 0, fmt.Sprintf("%s: its expected body does not format: %v", h, err)
	}
	want := ScanTokens(formatted, nil)
	start := at.Offset(d.Pos())
	got := ScanTokens(at.Src[start:at.Offset(d.End())], nil)
	if i := FirstDiff(want, got); i >= 0 {
		line := LineAt(got, i) + at.Line(d.Pos()) - 1
		return nil, i, fmt.Sprintf("%s differs from its chunk near line %d: expected %s, found %s.", h, line, TokAt(want, i), TokAt(got, i))
	}
	origins := w.origins(pieces, b.String())
	idents := map[int]*ast.Ident{}
	ast.Inspect(d, func(n ast.Node) bool {
		if id, ok := n.(*ast.Ident); ok {
			idents[at.Offset(id.Pos())] = id
		}
		return true
	})
	var out []aligned
	k := 0
	for _, tk := range got {
		if tk.Kind != token.IDENT {
			continue
		}
		if k < len(origins) && origins[k].kind != inSignature {
			out = append(out, aligned{idents[start+tk.Off], origins[k]})
		}
		k++
	}
	return out, 0, ""
}

// origins lists the origin of every identifier of the unformatted expected declaration, in order.
func (w *bodyWriter) origins(pieces []piece, text string) []origin {
	chunkIdents := map[int]*ast.Ident{}
	for _, s := range w.c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			if id, ok := n.(*ast.Ident); ok {
				chunkIdents[w.ck.bt.Offset(id.Pos())] = id
			}
			return true
		})
	}
	starts := make([]int, len(pieces))
	off := 0
	for i, p := range pieces {
		starts[i], off = off, off+len(p.text)
	}
	fset := token.NewFileSet()
	file := fset.AddFile("", -1, len(text))
	var s scanner.Scanner
	s.Init(file, []byte(text), nil, 0)
	var out []origin
	for {
		pos, tok, _ := s.Scan()
		if tok == token.EOF {
			return out
		}
		if tok != token.IDENT {
			continue
		}
		o := file.Offset(pos)
		i := sort.Search(len(starts), func(i int) bool { return starts[i] > o }) - 1
		p, rel := pieces[i], o-starts[i]
		switch {
		case p.src == -2:
			out = append(out, origin{kind: inSignature})
		case p.src >= 0:
			out = append(out, origin{kind: fromChunk, id: chunkIdents[p.src+rel]})
		case p.ids != nil && p.ids[rel].kind != inSignature:
			out = append(out, p.ids[rel])
		default:
			out = append(out, origin{kind: globalName})
		}
	}
}
