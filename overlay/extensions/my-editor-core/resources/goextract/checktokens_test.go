package main

import (
	"strings"
	"testing"
)

func texts(toks []Tok) string {
	var out []string
	for _, tk := range toks {
		out = append(out, tk.Text)
	}
	return strings.Join(out, " ")
}

func TestScanTokensCutsAndComments(t *testing.T) {
	src := []byte("package p\n\nfunc F() {\n\tx := 1 // one\n\t/* a\n\t   b */\n\tx++\n}\n")
	start := strings.Index(string(src), "\tx++")
	got := texts(ScanTokens(src, []Cut{{start, start + len("\tx++\n"), "⟨chunk 0⟩"}}))
	want := "package p \n func F ( ) { x := 1 // one \n /* a\nb */ ⟨chunk 0⟩ } \n"
	if got != want {
		t.Fatalf("\ngot  %q\nwant %q", got, want)
	}
	if got := texts(ScanTokens(src, []Cut{{start, start + 5, ""}})); strings.Contains(got, "++") {
		t.Fatal(got)
	}
}

func TestFirstDiff(t *testing.T) {
	a := ScanTokens([]byte("package p\nvar x = 1\n"), nil)
	b := ScanTokens([]byte("package p\n\nvar x  = 1 // c\n"), nil)
	if i := FirstDiff(a, a); i != -1 {
		t.Fatal(i)
	}
	i := FirstDiff(a, b)
	if TokAt(a, i) != "a line break" || TokAt(b, i) != "// c" || LineAt(b, i) != 3 {
		t.Fatal(i, TokAt(a, i), TokAt(b, i))
	}
	if i := FirstDiff(a, a[:3]); TokAt(a[:3], i) != "the end" || LineAt(a[:3], i) != 1 {
		t.Fatal(i)
	}
}

func TestWholeLines(t *testing.T) {
	src := []byte("ab\n\tcd\nef")
	if s, e := WholeLines(src, 4, 5); s != 3 || e != 7 {
		t.Fatal(s, e)
	}
	if s, e := WholeLines(src, 8, 8); s != 7 || e != 9 {
		t.Fatal(s, e)
	}
}
