package main

import (
	"go/format"
	"strings"
	"testing"
)

// golden is one row of Task 9's table: a case, its function, and the one chunk built into testdata/want.
type golden struct {
	name, fn, recv, helper string
	from, to               int
}

var goldens = []golden{
	{"basic", "Report", "", "collectItems", 11, 14},
	{"onboarding", "Plan", "", "queryRows", 38, 46},
	{"deferrecover", "F", "", "advance", 14, 17},
	{"buildercopy", "F", "", "writeWords", 15, 18},
	{"valuepath", "F", "", "setFields", 22, 24},
	{"multireturn", "F", "", "early", 16, 18},
	{"tail", "F", "", "finish", 9, 12},
	{"tailvoid", "G", "", "finishG", 10, 13},
	{"breakswitch", "F", "", "pickOne", 9, 13},
	{"ptrselector", "F", "", "setP", 14, 15},
	{"rangearrayptr", "F", "", "sumAll", 11, 14},
	{"addrderef", "F", "", "bump", 10, 11},
	{"methodset", "Run", "S", "addRows", 22, 23},
	{"rawstring", "F", "", "buildQuery", 12, 20},
	{"deadwrite", "F", "", "addSecond", 14, 15},
	{"loopout", "F", "", "step", 10, 11},
	{"names", "F", "", "double", 13, 13},
	{"typestr", "F", "", "check", 19, 22},
}

// goldenRow is the row of a case.
func goldenRow(t *testing.T, name string) golden {
	t.Helper()
	for _, g := range goldens {
		if g.name == name {
			return g
		}
	}
	t.Fatalf("no golden %s", name)
	return golden{}
}

// checkGolden builds a golden row, applies tamper to the built file and checks the result against the case.
func checkGolden(t *testing.T, g golden, tamper func(string) string) []string {
	t.Helper()
	res, out := buildOne(t, target(t, g.name, g.fn, g.recv), g.helper, g.from, g.to)
	if len(res.Problems) > 0 {
		t.Fatal(res.Problems)
	}
	after := string(out)
	if tamper != nil {
		if after = tamper(after); after == string(out) {
			t.Fatal("the tamper changed nothing")
		}
	}
	list, pkg := listCase(t, g.name)
	return Check(list, pkg, caseFile(t, g.name), g.fn, g.recv, readCase(t, g.name), []byte(after), res)
}

// replace is a tamper replacing the first old with new.
func replace(old, new string) func(string) string {
	return func(s string) string { return strings.Replace(s, old, new, 1) }
}

// wantProblem wants a problem starting with prefix among problems.
func wantProblem(t *testing.T, problems []string, prefix string) {
	t.Helper()
	for _, p := range problems {
		if strings.HasPrefix(p, prefix) {
			return
		}
	}
	t.Fatalf("no problem starting %q in %q", prefix, problems)
}

func TestCheckPassesGoldens(t *testing.T) {
	for _, g := range goldens {
		t.Run(g.name, func(t *testing.T) {
			if problems := checkGolden(t, g, nil); len(problems) > 0 {
				t.Fatal(problems)
			}
		})
	}
}

func TestCheckOutsideChanged(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "basic"), replace("if upper {", "if !upper {"))
	wantProblem(t, problems, "Outside the chunks, a.go changed near line 13: expected upper, found !.")
}

func TestCheckNotFormatted(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "basic"), replace("out := collectItems(items)", "out :=  collectItems(items)"))
	if strings.Join(problems, "\n") != "gofmt would change a.go." {
		t.Fatalf("%q", problems)
	}
}

func TestCheckExtraDeclaration(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "basic"), func(s string) string { return s + "\nvar extra = 1\n" })
	wantProblem(t, problems, "Outside the chunks, a.go changed near line 28: expected the end, found var.")
}

func TestCheckTypeErrors(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "basic"), replace("func collectItems(items []string) []string {", "func collectItems(items []string) []int {"))
	if len(problems) != 1 || !strings.HasPrefix(problems[0], "the package does not type-check: ") {
		t.Fatalf("%q", problems)
	}
}

func TestCheckHelperPlacement(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "onboarding"), func(s string) string {
		start := strings.Index(s, "\n// queryRows is part of Plan")
		helper := s[start:]
		s = s[:start] + "\n"
		at := strings.Index(s, "// Plan builds a plan.")
		out, err := format.Source([]byte(s[:at] + strings.TrimPrefix(helper, "\n") + "\n" + s[at:]))
		if err != nil {
			t.Fatal(err)
		}
		return string(out)
	})
	if strings.Join(problems, "\n") != "queryRows is not right after Plan in chunk order." {
		t.Fatalf("%q", problems)
	}
}
