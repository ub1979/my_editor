package main

import (
	"strings"
	"testing"
)

// wantNames wants NameProblems over names to be exactly want.
func wantNames(t *testing.T, tg *Target, names []string, want ...string) {
	t.Helper()
	got := NameProblems(tg, names)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("%v:\ngot  %q\nwant %q", names, got, want)
	}
}

func TestNamesFresh(t *testing.T) {
	tg := target(t, "names", "F", "")
	wantNames(t, tg, []string{"innerOnly"}, "innerOnly is not a fresh name: F declares it (line 9).")
	wantNames(t, tg, []string{"n"}, "n is not a fresh name: F declares it (line 7).")
	wantNames(t, tg, []string{"helperTaken"}, "helperTaken is not a fresh name: the package declares it.")
	wantNames(t, tg, []string{"takenInTests"}, "takenInTests is not a fresh name: a test file of the package declares it.")
	wantNames(t, tg, []string{"len"}, "len is not a fresh name: it is predeclared.")
	wantNames(t, tg, []string{"F"}, "F is not a fresh name: the package declares it.")
	wantNames(t, tg, []string{"double"})
	wantNames(t, tg, []string{"Double"}, `"Double" must start with a lower-case letter.`)
	wantNames(t, tg, []string{"type"}, `"type" is a Go keyword.`)
	wantNames(t, tg, []string{"_"}, `"_" cannot name a helper.`)
	wantNames(t, tg, []string{"init"}, `"init" cannot name a helper.`)
	wantNames(t, tg, []string{"main"}, `"main" cannot name a helper.`)
	wantNames(t, tg, []string{"9x"}, `"9x" is not a Go identifier.`)
	wantNames(t, tg, []string{"double", "double"}, "double is named twice.")
	wantNames(t, tg, []string{"double", "triple", "double", "double"}, "double is named twice.")
}

func TestNamesMethodSet(t *testing.T) {
	tg := target(t, "methodset", "Run", "S")
	wantNames(t, tg, []string{"loadRows"}, "loadRows is not a fresh name: S has a method loadRows (promoted from Base).")
	wantNames(t, tg, []string{"rows"}, "rows is not a fresh name: S has a field rows (promoted from Base).")
	wantNames(t, tg, []string{"count"}, "count is not a fresh name: S has a field count.")
	wantNames(t, tg, []string{"saveAll"}, "saveAll is not a fresh name: it is a method of the interface Saver in this package.")
	wantNames(t, tg, []string{"addRows"})
}

func TestNamesUsedAnywhere(t *testing.T) {
	tg := target(t, "promoname", "Run", "S")
	wantNames(t, tg, []string{"tally"}, "tally is not a fresh name: the package uses it (a.go line 8).")
	wantNames(t, tg, []string{"count"}, "count is not a fresh name: the package uses it (a.go line 32).")
	wantNames(t, tg, []string{"probed"}, "probed is not a fresh name: a test file of the package uses it.")
	wantNames(t, tg, []string{"doubled"})
}

func TestNamesPlumbing(t *testing.T) {
	tg := target(t, "basic", "Report", "")
	if got := Plumbing(tg, nil, "done"); got != "done" {
		t.Fatal(got)
	}
	if got := Plumbing(tg, map[string]bool{"done": true, "done1": true}, "done"); got != "done2" {
		t.Fatal(got)
	}
	if got := Plumbing(tg, map[string]bool{"done": true}, "done"); got != "done1" {
		t.Fatal(got)
	}
	local := basicWith(t, "G", "", "func G() int {\n\tr0 := 1\n\treturn r0\n}\n")
	if got := Plumbing(local, nil, "r0"); got != "r01" {
		t.Fatal(got)
	}
	pkg := basicWith(t, "Report", "", "var done = 1\n")
	if got := Plumbing(pkg, nil, "done"); got != "done1" {
		t.Fatal(got)
	}
}
