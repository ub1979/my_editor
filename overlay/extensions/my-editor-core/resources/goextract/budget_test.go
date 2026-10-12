package main

import (
	"go/parser"
	"go/token"
	"testing"
)

func TestFunctionBudget(t *testing.T) {
	for _, tc := range []struct {
		name, src string
		want      int
	}{
		{"package only", "package p\n\nfunc F() {}\n", 400 - 2 - 1 - 1},
		{"license and imports", "// License.\n\npackage p\n\nimport (\n\t\"fmt\"\n\t\"os\"\n)\n\nimport \"strings\"\n\nfunc F() {}\n", 400 - 2 - 10 - 1},
	} {
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, "a.go", tc.src, parser.ParseComments)
		if err != nil {
			t.Fatal(err)
		}
		if got := FunctionBudget(fset, file); got != tc.want {
			t.Errorf("%s: budget %d, want %d", tc.name, got, tc.want)
		}
	}
}
