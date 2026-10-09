// Command goast prints JSON facts about one Go file for my_editor's AI-ready splits.
// It uses only the standard library and never changes the file.
//
// Spans are UTF-8 byte offsets. A span starts at the beginning of its first line and ends at the newline that ends
// its last line (the newline itself is not part of the span), or at the end of the file.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/build/constraint"
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"strings"
)

// File is the helper's output.
type File struct {
	Package         string      `json:"package"`
	PackageSpan     [2]int      `json:"packageSpan"`
	BuildConstraint bool        `json:"buildConstraint"`
	Cgo             bool        `json:"cgo"`
	Generated       bool        `json:"generated"`
	BOM             bool        `json:"bom"`
	CRLF            bool        `json:"crlf"`
	Imports         []Import    `json:"imports"`
	ImportDecls     [][2]int    `json:"importDecls"`
	Decls           []Decl      `json:"decls"`
	Directives      []Directive `json:"directives"`
}

// Import is one import spec. Run groups specs that are adjacent in one import declaration.
type Import struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Start int    `json:"start"`
	End   int    `json:"end"`
	Own   bool   `json:"own"`
	Decl  int    `json:"decl"`
	Run   int    `json:"run"`
	Blank bool   `json:"blank"`
	Dot   bool   `json:"dot"`
}

// Decl is one top-level declaration other than an import. ID is its index among them.
type Decl struct {
	ID         int      `json:"id"`
	Kind       string   `json:"kind"`
	Grouped    bool     `json:"grouped"`
	Names      []string `json:"names"`
	Receiver   string   `json:"receiver"`
	Start      int      `json:"start"`
	End        int      `json:"end"`
	Lines      int      `json:"lines"`
	Doc        string   `json:"doc"`
	DocText    string   `json:"docText"`
	IsInit     bool     `json:"isInit"`
	HasInit    bool     `json:"hasInit"`
	Embed      bool     `json:"embed"`
	Generate   bool     `json:"generate"`
	Own        bool     `json:"own"`
	Qualifiers []string `json:"qualifiers"`
}

// Directive is a `//go:` or `//line` comment.
type Directive struct {
	Line   int    `json:"line"`
	Offset int    `json:"offset"`
	Text   string `json:"text"`
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: goast <file.go>")
		os.Exit(2)
	}
	src, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	out, err := Inspect(os.Args[1], src)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// Inspect parses src and collects the facts my_editor needs.
func Inspect(name string, src []byte) (*File, error) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, name, src, parser.ParseComments)
	if err != nil {
		return nil, err
	}
	off := func(p token.Pos) int { return fset.Position(p).Offset }
	line := func(p token.Pos) int { return fset.Position(p).Line }
	out := &File{
		Package:     f.Name.Name,
		PackageSpan: [2]int{lineStart(src, off(f.Package)), lineEnd(src, off(f.Name.End()))},
		Generated:   ast.IsGenerated(f),
		BOM:         bytes.HasPrefix(src, []byte{0xEF, 0xBB, 0xBF}),
		CRLF:        bytes.Contains(src, []byte("\r\n")),
		Imports:     []Import{},
		ImportDecls: [][2]int{},
		Decls:       []Decl{},
		Directives:  []Directive{},
	}
	for _, group := range f.Comments {
		for _, c := range group.List {
			if c.Pos() < f.Package && (constraint.IsGoBuild(c.Text) || constraint.IsPlusBuild(c.Text)) {
				out.BuildConstraint = true
			}
			if strings.HasPrefix(c.Text, "//go:") || strings.HasPrefix(c.Text, "//line ") || strings.HasPrefix(c.Text, "/*line ") {
				// Directive text is not truncated: the host looks for $GOFILE anywhere in a //go:generate line.
				out.Directives = append(out.Directives, Directive{Line: line(c.Pos()), Offset: off(c.Pos()), Text: wholeFirstLine(c.Text)})
			}
		}
	}
	trailingEnd := func(end token.Pos) int {
		last := line(end)
		for _, group := range f.Comments {
			if line(group.Pos()) == last && group.Pos() >= end && line(group.End()) > last {
				last = line(group.End())
			}
		}
		return lineEnd(src, off(fset.File(end).LineStart(last)))
	}
	run := -1
	prevEnd := -1
	for _, decl := range f.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.IMPORT {
			continue
		}
		start, end := spanStart(src, off, gen.Doc, gen.Pos()), trailingEnd(gen.End())
		out.ImportDecls = append(out.ImportDecls, [2]int{start, end})
		prevEnd = -1
		for _, s := range gen.Specs {
			spec := s.(*ast.ImportSpec)
			path, _ := strconv.Unquote(spec.Path.Value)
			name := ""
			if spec.Name != nil {
				name = spec.Name.Name
			}
			if path == "C" {
				out.Cgo = true
			}
			sStart, sEnd := spanStart(src, off, spec.Doc, spec.Pos()), trailingEnd(spec.End())
			if prevEnd < 0 || hasBlankLine(src, prevEnd, sStart) {
				run++
			}
			prevEnd = sEnd
			own := gen.Lparen.IsValid() && ownLines(src, sStart, sEnd, firstPos(off, spec.Doc, spec.Pos()), off(spec.End()))
			out.Imports = append(out.Imports, Import{
				Name: name, Path: path, Start: sStart, End: sEnd, Own: own,
				Decl: len(out.ImportDecls) - 1, Run: run, Blank: name == "_", Dot: name == ".",
			})
		}
	}
	for _, decl := range f.Decls {
		if gen, ok := decl.(*ast.GenDecl); ok && gen.Tok == token.IMPORT {
			continue
		}
		d := describe(decl)
		d.ID = len(out.Decls)
		var doc *ast.CommentGroup
		switch x := decl.(type) {
		case *ast.FuncDecl:
			doc = x.Doc
		case *ast.GenDecl:
			doc = x.Doc
		}
		d.Start, d.End = spanStart(src, off, doc, decl.Pos()), trailingEnd(decl.End())
		d.Lines = bytes.Count(src[d.Start:d.End], []byte("\n")) + 1
		d.Own = ownLines(src, d.Start, d.End, firstPos(off, doc, decl.Pos()), off(decl.End()))
		if doc != nil {
			d.Doc = firstLine(strings.TrimSpace(doc.Text()))
			d.DocText = string(src[off(doc.Pos()):off(doc.End())])
		}
		d.Qualifiers = qualifiers(decl)
		out.Decls = append(out.Decls, d)
	}
	markDirectives(out)
	return out, nil
}

// describe fills a declaration's kind, names, receiver and initializer facts.
func describe(decl ast.Decl) Decl {
	d := Decl{Names: []string{}}
	switch x := decl.(type) {
	case *ast.FuncDecl:
		d.Kind = "func"
		d.Names = append(d.Names, x.Name.Name)
		if x.Recv != nil && len(x.Recv.List) > 0 {
			d.Kind = "method"
			d.Receiver = receiverName(x.Recv.List[0].Type)
		}
		d.IsInit = x.Recv == nil && x.Name.Name == "init"
	case *ast.GenDecl:
		d.Kind = x.Tok.String()
		d.Grouped = x.Lparen.IsValid()
		for _, s := range x.Specs {
			switch spec := s.(type) {
			case *ast.TypeSpec:
				d.Names = append(d.Names, spec.Name.Name)
			case *ast.ValueSpec:
				for _, n := range spec.Names {
					d.Names = append(d.Names, n.Name)
				}
				if x.Tok == token.VAR && len(spec.Values) > 0 {
					d.HasInit = true
				}
			}
		}
	}
	return d
}

// markDirectives flags declarations that a `//go:embed` precedes or a `//go:generate` sits inside.
func markDirectives(out *File) {
	for _, dir := range out.Directives {
		embed := strings.HasPrefix(dir.Text, "//go:embed")
		generate := strings.HasPrefix(dir.Text, "//go:generate")
		for i := range out.Decls {
			d := &out.Decls[i]
			inside := dir.Offset >= d.Start && dir.Offset < d.End
			if generate && inside {
				d.Generate = true
			}
			if embed && (inside || dir.Offset < d.Start) {
				d.Embed = true
				break
			}
		}
	}
}

// receiverName is the receiver's base type name, without pointer or type parameters.
func receiverName(expr ast.Expr) string {
	for {
		switch x := expr.(type) {
		case *ast.StarExpr:
			expr = x.X
		case *ast.ParenExpr:
			expr = x.X
		case *ast.IndexExpr:
			expr = x.X
		case *ast.IndexListExpr:
			expr = x.X
		case *ast.Ident:
			return x.Name
		default:
			return ""
		}
	}
}

// qualifiers lists X for every selector X.Sel whose X the parser could not resolve in this file: import names,
// or names declared in other files of the package. A local variable named like an import resolves and is skipped.
func qualifiers(decl ast.Decl) []string {
	seen := map[string]bool{}
	list := []string{}
	ast.Inspect(decl, func(n ast.Node) bool {
		if sel, ok := n.(*ast.SelectorExpr); ok {
			// Obj is deprecated in favour of go/types, but the parser's own file-level resolution is what is wanted here.
			if id, ok := sel.X.(*ast.Ident); ok && id.Obj == nil && !seen[id.Name] {
				seen[id.Name] = true
				list = append(list, id.Name)
			}
		}
		return true
	})
	return list
}

// firstPos is the offset of the doc comment, or else of the node.
func firstPos(off func(token.Pos) int, doc *ast.CommentGroup, pos token.Pos) int {
	if doc != nil {
		pos = doc.Pos()
	}
	return off(pos)
}

// spanStart is the start of the line where the doc comment, or else the node, begins.
func spanStart(src []byte, off func(token.Pos) int, doc *ast.CommentGroup, pos token.Pos) int {
	if doc != nil {
		pos = doc.Pos()
	}
	return lineStart(src, off(pos))
}

func lineStart(src []byte, i int) int {
	return bytes.LastIndexByte(src[:i], '\n') + 1
}

func lineEnd(src []byte, i int) int {
	if j := bytes.IndexByte(src[i:], '\n'); j >= 0 {
		return i + j
	}
	return len(src)
}

// ownLines reports whether the node has its lines to itself: only indentation before it, and only whitespace or a
// trailing comment after it.
func ownLines(src []byte, start, end, first, nodeEnd int) bool {
	if strings.TrimSpace(string(src[start:first])) != "" {
		return false
	}
	rest := strings.TrimSpace(string(src[nodeEnd:end]))
	return rest == "" || strings.HasPrefix(rest, "//") && !strings.Contains(rest, "\n") || strings.HasPrefix(rest, "/*") && strings.HasSuffix(rest, "*/")
}

// hasBlankLine reports whether a blank line lies between the line ending at from and the line starting at to.
func hasBlankLine(src []byte, from, to int) bool {
	if from+1 >= to {
		return false
	}
	lines := strings.Split(string(src[from+1:to]), "\n")
	for _, l := range lines[:len(lines)-1] {
		if strings.TrimSpace(l) == "" {
			return true
		}
	}
	return false
}

func wholeFirstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return s
}

// firstLine is the first line, at most 160 bytes, for the model.
func firstLine(s string) string {
	s = wholeFirstLine(s)
	if len(s) > 160 {
		s = s[:160]
	}
	return s
}
