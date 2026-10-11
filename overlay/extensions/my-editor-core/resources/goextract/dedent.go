package main

import (
	"go/scanner"
	"go/token"
	"strings"
)

// Dedent removes up to n leading tabs from every line of Go source text whose first byte is not inside a raw string
// (rule 11). Block comments are dedented like code; gofmt re-indents their continuation lines anyway.
func Dedent(src string, n int) string {
	if n <= 0 {
		return src
	}
	spans := rawStrings(src)
	inside := func(off int) bool {
		for _, s := range spans {
			if s[0] < off && off < s[1] {
				return true
			}
		}
		return false
	}
	var b strings.Builder
	off := 0
	for _, line := range strings.SplitAfter(src, "\n") {
		if !inside(off) {
			trimmed := line
			for i := 0; i < n && strings.HasPrefix(trimmed, "\t"); i++ {
				trimmed = trimmed[1:]
			}
			b.WriteString(trimmed)
		} else {
			b.WriteString(line)
		}
		off += len(line)
	}
	return b.String()
}

// rawStrings are the byte spans of the raw string literals of Go source text, backquotes included.
func rawStrings(src string) [][2]int {
	fset := token.NewFileSet()
	file := fset.AddFile("", -1, len(src))
	var s scanner.Scanner
	s.Init(file, []byte(src), nil, scanner.ScanComments)
	var out [][2]int
	for {
		pos, tok, lit := s.Scan()
		if tok == token.EOF {
			return out
		}
		if tok == token.STRING && strings.HasPrefix(lit, "`") {
			start := file.Offset(pos)
			end := strings.IndexByte(src[start+1:], '`')
			if end < 0 {
				return out
			}
			out = append(out, [2]int{start, start + end + 2})
		}
	}
}
