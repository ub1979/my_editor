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
	{"doneout", "F", "", "thenStep", 24, 27},
	{"pfound", "F", "", "scan", 7, 11},
	{"pvar", "F", "", "addAll", 6, 8},
	{"promoname", "Run", "S", "grow", 24, 25},
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

func TestCheckRefusesOverlap(t *testing.T) {
	// b would run line 8 a second time.
	after := "package poverlap\n\nvar log []string\n\n// F logs.\nfunc F() {\n\ta()\n\tb()\n}\n\n// a is part of F, extracted by my_editor.\nfunc a() {\n" +
		"\tlog = append(log, \"1\")\n\tlog = append(log, \"2\")\n}\n\n// b is part of F, extracted by my_editor.\nfunc b() {\n\tlog = append(log, \"2\")\n" +
		"\tlog = append(log, \"3\")\n}\n"
	wantProblem(t, checkAfter(t, "poverlap", "F", "", after, fact("b", 8, 9), fact("a", 7, 8)), "a (lines 7–8) overlaps b (lines 8–9).")
	g := goldenRow(t, "breakswitch")
	_, out := buildOne(t, target(t, g.name, g.fn, g.recv), g.helper, g.from, g.to)
	wantProblem(t, checkAfter(t, g.name, g.fn, "", string(out), fact(g.helper, 9, 13), fact("inner", 10, 12)),
		"pickOne (lines 9–13) overlaps inner (lines 10–12).")
	wantProblem(t, checkAfter(t, "poverlap", "F", "", after, fact("a", 7, 7), fact("a", 9, 9)), "a is named twice.")
}

func TestCheckTwoHelpers(t *testing.T) {
	for _, plan := range [][]PlanChunk{{{"collectItems", 11, 14}, {"upperIt", 16, 18}}, {{"upperIt", 16, 18}, {"collectItems", 11, 14}}} {
		res, out := Build(target(t, "basic", "Report", ""), plan)
		if len(res.Problems) > 0 {
			t.Fatal(res.Problems)
		}
		list, pkg := listCase(t, "basic")
		if problems := Check(list, pkg, caseFile(t, "basic"), "Report", "", readCase(t, "basic"), out, res); len(problems) > 0 {
			t.Fatalf("%v: %q\n%s", plan, problems, out)
		}
	}
}

func TestCheckRefusesOutOfScope(t *testing.T) {
	sum := readCase(t, "generic")
	list, pkg := listCase(t, "generic")
	problems := Check(list, pkg, caseFile(t, "generic"), "Sum", "", sum, sum, BuildResult{Helpers: []HelperFact{fact("h", 6, 6)}})
	if strings.Join(problems, "\n") != "Sum is generic." {
		t.Fatalf("%q", problems)
	}
	before := append(readCase(t, "basic"), "\n//go:noinline\nfunc N() int {\n\tn := 1\n\treturn n\n}\n"...)
	list, pkg = listCase(t, "basic")
	problems = Check(list, pkg, caseFile(t, "basic"), "N", "", before, before, BuildResult{Helpers: []HelperFact{fact("h", 24, 24)}})
	if strings.Join(problems, "\n") != "N has a //go:noinline line." {
		t.Fatalf("%q", problems)
	}
}

func TestCheckRefusesBuildWithProblems(t *testing.T) {
	src := readCase(t, "basic")
	list, pkg := listCase(t, "basic")
	for built, want := range map[*BuildResult]string{
		{Problems: []string{"x: refused."}}: "The build reported problems, so there is nothing to check: x: refused.",
		{}:                                  "The build reported no helpers, so there is nothing to check.",
	} {
		if problems := Check(list, pkg, caseFile(t, "basic"), "Report", "", src, src, *built); strings.Join(problems, "\n") != want {
			t.Fatalf("%q", problems)
		}
	}
}

// checkAfter checks a hand-written new file of a case against its original, the build having reported helpers.
func checkAfter(t *testing.T, name, fn, recv, after string, helpers ...HelperFact) []string {
	t.Helper()
	list, pkg := listCase(t, name)
	return Check(list, pkg, caseFile(t, name), fn, recv, readCase(t, name), []byte(after), BuildResult{Helpers: helpers})
}

// fact is a helper the build reported: its name and the lines of its chunk.
func fact(name string, from, to int) HelperFact { return HelperFact{Name: name, From: from, To: to} }

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
