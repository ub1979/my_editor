package main

import (
	"strings"
	"testing"
)

func TestCheckRefusesPredeclaredName(t *testing.T) {
	// G's max(c, a) would call the helper.
	after := "package pmax\n\n// G picks.\nfunc G(c, a int) int { return max(c, a) }\n\n// F doubles.\nfunc F(c, a int) int {\n\tc = max(c, a)\n" +
		"\treturn c + a\n}\n\n// max is part of F, extracted by my_editor.\nfunc max(c int, a int) int {\n\tc *= 2\n\treturn c\n}\n"
	problems := checkAfter(t, "pmax", "F", "", after, fact("max", 8, 8))
	wantProblem(t, problems, "max is not a fresh name: it is predeclared.")
	wantProblem(t, problems, "max at line 4 of a.go now names the helper; only its call may.")
}

// renamed builds a golden-like row with helper name built, then renames the helper to name in the file and the facts.
func renamed(t *testing.T, g golden, name string) []string {
	t.Helper()
	res, out := buildOne(t, target(t, g.name, g.fn, g.recv), g.helper, g.from, g.to)
	if len(res.Problems) > 0 {
		t.Fatal(res.Problems)
	}
	res.Helpers[0].Name = name
	list, pkg := listCase(t, g.name)
	after := strings.ReplaceAll(string(out), g.helper, name)
	return Check(list, pkg, caseFile(t, g.name), g.fn, g.recv, readCase(t, g.name), []byte(after), res)
}

func TestCheckRefusesInterfaceMethodName(t *testing.T) {
	// *S would satisfy Saver, and the anonymous interface{ count() } of Asserts.
	wantProblem(t, renamed(t, goldenRow(t, "methodset"), "saveAll"),
		"saveAll is not a fresh name: it is a method of an interface of the package (a.go line 11).")
	promo := golden{"promoname", "Run", "S", "grow", 24, 25}
	if problems := renamed(t, promo, "grow"); len(problems) > 0 {
		t.Fatal(problems)
	}
	wantProblem(t, renamed(t, promo, "count"), "count is not a fresh name: it is a method of an interface of the package (a.go line 32).")
}

func TestCheckRefusesTestAndExportedNames(t *testing.T) {
	promo := golden{"promoname", "Run", "S", "grow", 24, 25}
	wantProblem(t, renamed(t, promo, "probed"), "probed is not a fresh name: a test file of the package uses it.")
	wantProblem(t, renamed(t, promo, "Grow"), "Grow must start with a lower-case letter.")
}
