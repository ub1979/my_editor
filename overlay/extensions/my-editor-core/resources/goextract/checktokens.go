package main

import (
	"go/scanner"
	"go/token"
	"strings"
)

// Tok is one token as the extract check compares it: its kind and text, and where it was in its file. A comment's
// text has each line's leading blanks trimmed; a marker stands for a chunk or a call block.
type Tok struct {
	Kind token.Token
	Text string
	Off  int
	Line int
}

// Cut replaces the tokens that start in bytes Start..End of a file with one marker, or drops them when Marker is "".
type Cut struct {
	Start, End int
	Marker     string
}

// marker is the kind of a marker token.
const marker = token.Token(-1)

// ScanTokens lists a Go file's tokens, comments included, with each cut applied.
func ScanTokens(src []byte, cuts []Cut) []Tok {
	fset := token.NewFileSet()
	file := fset.AddFile("", -1, len(src))
	var s scanner.Scanner
	s.Init(file, src, nil, scanner.ScanComments)
	var out []Tok
	placed := map[int]bool{}
	for {
		pos, kind, lit := s.Scan()
		if kind == token.EOF {
			return out
		}
		off := file.Offset(pos)
		if i := cutAt(cuts, off); i >= 0 {
			if cuts[i].Marker != "" && !placed[i] {
				placed[i] = true
				out = append(out, Tok{Kind: marker, Text: cuts[i].Marker, Off: off, Line: file.Line(pos)})
			}
			continue
		}
		text := lit
		switch {
		case kind == token.COMMENT:
			text = trimComment(lit)
		case lit == "":
			text = kind.String()
		}
		out = append(out, Tok{Kind: kind, Text: text, Off: off, Line: file.Line(pos)})
	}
}

func cutAt(cuts []Cut, off int) int {
	for i, c := range cuts {
		if c.Start <= off && off < c.End {
			return i
		}
	}
	return -1
}

// trimComment trims the leading blanks of every line of a comment.
func trimComment(text string) string {
	lines := strings.Split(text, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimLeft(l, " \t")
	}
	return strings.Join(lines, "\n")
}

// FirstDiff is the index of the first token where a and b differ, or -1 when they are equal.
func FirstDiff(a, b []Tok) int {
	for i := 0; i < len(a) || i < len(b); i++ {
		if i >= len(a) || i >= len(b) || a[i].Kind != b[i].Kind || a[i].Text != b[i].Text {
			return i
		}
	}
	return -1
}

// TokAt describes token i of a list for a message, "the end" past its last.
func TokAt(toks []Tok, i int) string {
	if i >= len(toks) {
		return "the end"
	}
	if toks[i].Text == "\n" {
		return "a line break"
	}
	return toks[i].Text
}

// LineAt is the line of token i of a list, or of its last token past the end.
func LineAt(toks []Tok, i int) int {
	switch {
	case i < len(toks):
		return toks[i].Line
	case len(toks) > 0:
		return toks[len(toks)-1].Line
	}
	return 1
}

// WholeLines widens bytes start..end of src to whole lines: from the start of start's line to just after the
// newline that ends end's line.
func WholeLines(src []byte, start, end int) (int, int) {
	start = strings.LastIndexByte(string(src[:start]), '\n') + 1
	if nl := strings.IndexByte(string(src[end:]), '\n'); nl >= 0 {
		end += nl + 1
	} else {
		end = len(src)
	}
	return start, end
}
