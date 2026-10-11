package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// buildOne runs Build with a one-chunk plan.
func buildOne(t *testing.T, tg *Target, name string, from, to int) (BuildResult, []byte) {
	t.Helper()
	return Build(tg, []PlanChunk{{Name: name, From: from, To: to}})
}

func TestBuildGoldens(t *testing.T) {
	cases := []struct {
		name, fn, recv, helper string
		from, to               int
	}{
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
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			want, err := os.ReadFile(filepath.Join("testdata", "want", c.name+".go.txt"))
			if err != nil {
				t.Fatal(err)
			}
			res, got := buildOne(t, target(t, c.name, c.fn, c.recv), c.helper, c.from, c.to)
			if len(res.Problems) > 0 {
				t.Fatal(res.Problems)
			}
			if string(got) != string(want) {
				t.Fatalf("got:\n%s\nwant:\n%s", got, want)
			}
			loadCase(t, c.name, got)
		})
	}
}

func TestBuildFacts(t *testing.T) {
	res, _ := buildOne(t, target(t, "onboarding", "Plan", ""), "queryRows", 38, 46)
	h := res.Helpers[0]
	got := fmt.Sprintf("%s %d-%d %v %v %v %v %d %d %d", h.Name, h.From, h.To, h.Params, h.Outputs, h.Returns, h.Tail, h.Lines, h.PointerSites,
		res.FunctionLines)
	want := "queryRows 38-46 [{ctx context.Context false} {staleAfter time.Duration false} {tx Tx false} {req Request false} " +
		"{imageRef string false}] [{rows Rows} {err error}] false false 13 0 21"
	if len(res.Helpers) != 1 || got != want {
		t.Fatalf("\ngot  %s\nwant %s", got, want)
	}
	res, _ = buildOne(t, target(t, "deferrecover", "F", ""), "advance", 14, 17)
	h = res.Helpers[0]
	got = fmt.Sprintf("%v %v %d %d %d", h.Params, h.Outputs, h.PointerSites, h.Lines, res.FunctionLines)
	if got != "[{n *int true} {bad bool false}] [] 1 7 12" {
		t.Fatal(got)
	}
	res, _ = buildOne(t, target(t, "multireturn", "F", ""), "early", 16, 18)
	if h = res.Helpers[0]; !h.Returns || h.Lines != 8 {
		t.Fatalf("%+v", h)
	}
	res, _ = buildOne(t, target(t, "tail", "F", ""), "finish", 9, 12)
	if h = res.Helpers[0]; !h.Tail {
		t.Fatalf("%+v", h)
	}
}

// wantBuildProblems wants Build's problems for a one-chunk plan to be exactly want.
func wantBuildProblems(t *testing.T, tg *Target, name string, from, to int, want ...string) {
	t.Helper()
	res, out := buildOne(t, tg, name, from, to)
	if strings.Join(res.Problems, "\n") != strings.Join(want, "\n") || out != nil {
		t.Fatalf("%s:\ngot  %q\nwant %q", name, res.Problems, want)
	}
}

func TestBuildProblems(t *testing.T) {
	wantBuildProblems(t, target(t, "valuepath", "F", ""), "setFields", 22, 25, "setFields: 4 outputs (cfg, arr, x, err); at most 3.")
	seven := basicWith(t, "P7", "", "func P7(a, b, c, d, e, f, g int) int {\n\tn := a + b + c + d + e + f + g\n\treturn n\n}\n")
	wantBuildProblems(t, seven, "h", 23, 23, "h: 7 parameters (a, b, c, d, e, f, g); at most 6.")
	long := "func Long() int {\n\tx := 0\n" + strings.Repeat("\tx++\n", 416) + "\treturn x\n}\n"
	lines := strings.Count(long, "\n")
	wantBuildProblems(t, basicWith(t, "Long", "", long), "h", 24, 28, fmt.Sprintf("Long would still be %d lines; it must end at 400 or fewer.", lines-4))
	wantBuildProblems(t, target(t, "rangearrayptr", "F", ""), "len", 11, 14, "len: len is not a fresh name: it is predeclared. It would need 2 (*x) sites.")
	wantBuildProblems(t, target(t, "methodset", "Run", "S"), "loadRows", 22, 23,
		"loadRows: loadRows is not a fresh name: S has a method loadRows (promoted from Base).")
	wantBuildProblems(t, target(t, "capturedecl", "F", ""), "count", 7, 9,
		"count: v is declared in the chunk (line 7), used after it, and captured by a function literal (line 8).")
	wantBuildProblems(t, target(t, "ptrdefine", "F", ""), "fetch", 15, 16,
		"fetch: err is passed by pointer but assigned with := at line 15. It would need 2 (*x) sites.")
	wantBuildProblems(t, target(t, "gotoover", "F", ""), "bump", 10, 11, "bump: goto done at line 8 would jump over the call at line 10.")
	wantBuildProblems(t, target(t, "localconst", "F", ""), "clamp", 16, 19,
		"clamp: the chunk uses the const limit, which F declares outside it (line 13).",
		"clamp: the chunk uses the type item, which F declares outside it (line 14).")
	wantBuildProblems(t, target(t, "shadowerr", "F", ""), "inspect", 14, 20, "inspect: err is declared in the chunk (line 17) and also names an input.")
}

func TestBuildPlanProblems(t *testing.T) {
	tg := target(t, "basic", "Report", "")
	res, out := Build(tg, []PlanChunk{{"a", 11, 14}, {"a", 13, 13}, {"b", 30, 31}})
	want := []string{
		"a: a is named twice.",
		"b: Lines 30–31 are not whole statements of one block of Report: no statement of Report starts at line 30.",
		"a (11–14) overlaps a (13–13).",
	}
	if strings.Join(res.Problems, "\n") != strings.Join(want, "\n") || out != nil {
		t.Fatalf("%q", res.Problems)
	}
}

func TestBuildTwoChunks(t *testing.T) {
	tg := target(t, "basic", "Report", "")
	res, out := Build(tg, []PlanChunk{{"collectItems", 11, 14}, {"shout", 16, 18}})
	if len(res.Problems) > 0 {
		t.Fatal(res.Problems)
	}
	for _, s := range []string{"\tout := collectItems(items)\n", "\ttext = shout(upper, text)\n", "func shout(upper bool, text string) string {"} {
		if !strings.Contains(string(out), s) {
			t.Fatalf("no %q in\n%s", s, out)
		}
	}
	loadCase(t, "basic", out)
}
