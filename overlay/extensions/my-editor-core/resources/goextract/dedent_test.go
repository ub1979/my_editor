package main

import "testing"

func TestDedent(t *testing.T) {
	src := "\t\tq := `a\n\t\tb`\n\t\t/* c\n\t\t   d */\n\tx()\ny()\n"
	want := "\tq := `a\n\t\tb`\n\t/* c\n\t   d */\nx()\ny()\n"
	if got := Dedent(src, 1); got != want {
		t.Fatalf("%q", got)
	}
	if got := Dedent(src, 0); got != src {
		t.Fatalf("%q", got)
	}
	if got := Dedent("\t\t\tx\n", 2); got != "\tx\n" {
		t.Fatalf("%q", got)
	}
}
