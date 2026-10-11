package main

import (
	"strings"
	"testing"
)

// target loads a case and finds one of its functions, failing the test when it cannot.
func target(t *testing.T, name, fn, recv string) *Target {
	t.Helper()
	l := loadCase(t, name, nil)
	tg, err := FindFunc(l, caseFile(t, name), fn, recv)
	if err != nil {
		t.Fatal(err)
	}
	return tg
}

// chunk resolves lines of a target, failing the test on a problem.
func chunk(t *testing.T, tg *Target, from, to int) Chunk {
	t.Helper()
	c, problem := tg.ResolveChunk("h", from, to)
	if problem != "" {
		t.Fatal(problem)
	}
	return c
}

func TestFindFunc(t *testing.T) {
	report := target(t, "basic", "Report", "")
	if report.Func.Name.Name != "Report" || report.Generic() || report.Directive() != "" {
		t.Fatalf("Report: generic %v, directive %q", report.Generic(), report.Directive())
	}
	target(t, "methodset", "Run", "S")
	l := loadCase(t, "methodset", nil)
	file := caseFile(t, "methodset")
	if _, err := FindFunc(l, file, "Run", "T"); err == nil || err.Error() != "no method Run on T in "+file {
		t.Fatal(err)
	}
	if _, err := FindFunc(l, file, "Run", ""); err == nil || err.Error() != "no function Run in "+file {
		t.Fatal(err)
	}
	if !target(t, "generic", "Sum", "").Generic() {
		t.Fatal("Sum is generic")
	}
}

func TestDirective(t *testing.T) {
	src := string(readCase(t, "basic"))
	src = strings.Replace(src, "// Report joins and prints.\n", "// Report joins and prints.\n//\n//go:noinline\n", 1)
	l := loadCase(t, "basic", []byte(src))
	tg, err := FindFunc(l, caseFile(t, "basic"), "Report", "")
	if err != nil || tg.Directive() != "//go:noinline" {
		t.Fatalf("%v %q", err, tg.Directive())
	}
}

func TestBlocksDepth(t *testing.T) {
	blocks := target(t, "rawstring", "F", "").Blocks()
	if len(blocks) != 2 || blocks[0].Depth != 1 || len(blocks[0].List) != 4 || blocks[1].Depth != 2 || len(blocks[1].List) != 6 {
		t.Fatalf("%+v", blocks)
	}
	if blocks := target(t, "names", "F", "").Blocks(); len(blocks) != 1 || len(blocks[0].List) != 4 {
		t.Fatalf("%+v", blocks)
	}
	blocks = target(t, "breakswitch", "F", "").Blocks()
	depths := []int{}
	for _, b := range blocks {
		depths = append(depths, b.Depth)
	}
	if len(blocks) != 4 || depths[1] != 2 || depths[2] != 3 || depths[3] != 2 {
		t.Fatalf("depths %v", depths)
	}
}

func TestResolveChunk(t *testing.T) {
	tg := target(t, "basic", "Report", "")
	file := tg.L.Fset.File(tg.Func.Pos())
	c := chunk(t, tg, 11, 14)
	if c.First != 0 || c.Last != 1 || c.Start != file.Offset(file.LineStart(11)) || c.End != file.Offset(file.LineStart(15)) {
		t.Fatalf("%+v", c)
	}
	if c.Name != "h" || c.From != 11 || c.To != 14 || c.Block.Depth != 1 {
		t.Fatalf("%+v", c)
	}
	if c := chunk(t, target(t, "onboarding", "Plan", ""), 38, 46); c.Last-c.First != 1 {
		t.Fatalf("%+v", c)
	}
	if c := chunk(t, tg, 13, 13); c.Block.Depth != 2 || len(c.Block.List) != 1 {
		t.Fatalf("%+v", c)
	}
	cases := map[[2]int]string{
		{12, 13}: "Lines 12–13 are not whole statements of one block of Report: line 13 is inside the statement at lines 12–14.",
		{17, 18}: "Lines 17–18 are not whole statements of one block of Report: " +
			"line 18 is beyond the last statement of the block that line 17 starts in.",
		{30, 31}: "Lines 30–31 are not whole statements of one block of Report: no statement of Report starts at line 30.",
		{13, 12}: "Lines 13–12 are not whole statements of one block of Report: line 12 is before line 13.",
	}
	for lines, want := range cases {
		if _, got := tg.ResolveChunk("h", lines[0], lines[1]); got != want {
			t.Errorf("%v: got %q", lines, got)
		}
	}
}

func TestResolveChunkGapAndSharedLine(t *testing.T) {
	src := string(readCase(t, "basic"))
	src = strings.Replace(src, "\ttext := strings.Join(out, \",\")\n", "\ttext := strings.Join(out, \",\")\n\n\t// note\n", 1)
	src = strings.Replace(src, "\t}\n\treturn fmt.Sprintf(", "\t}; _ = 1\n\treturn fmt.Sprintf(", 1)
	l := loadCase(t, "basic", []byte(src))
	tg, err := FindFunc(l, caseFile(t, "basic"), "Report", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, got := tg.ResolveChunk("h", 15, 17); got != "Lines 15–17 are not whole statements of one block of Report: no statement of Report ends at line 17." {
		t.Error(got)
	}
	if _, got := tg.ResolveChunk("h", 20, 21); got != "Lines 20–21 are not whole statements of one block of Report: line 20 shares a line with other code." {
		t.Error(got)
	}
}

func TestResolveChunkFuncLit(t *testing.T) {
	tg := target(t, "names", "F", "")
	if _, got := tg.ResolveChunk("h", 9, 9); got != "Lines 9–9 are not whole statements of one block of F: line 9 is inside a function literal." {
		t.Fatal(got)
	}
	chunk(t, tg, 8, 11)
}

func TestOverlapProblems(t *testing.T) {
	a := Chunk{Name: "a", From: 11, To: 14}
	if got := OverlapProblems([]Chunk{a, {Name: "b", From: 13, To: 15}}); len(got) != 1 || got[0] != "a (11–14) overlaps b (13–15)." {
		t.Fatal(got)
	}
	if got := OverlapProblems([]Chunk{a, {Name: "b", From: 15, To: 15}}); len(got) != 0 {
		t.Fatal(got)
	}
}
