// Command goast prints JSON facts about one Go file for my_editor's AI-ready splits.
// It uses only the standard library and never changes the file.
//
// Spans are UTF-8 byte offsets. A span starts at the beginning of its first line and ends at the newline that ends
// its last line (the newline itself is not part of the span), or at the end of the file.
package main

import (
	"bytes"
	"go/ast"
	"go/token"
	"strings"
)

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
