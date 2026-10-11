package main

import "testing"

// jumps runs Jumps on a chunk with its Shared set.
func jumps(t *testing.T, tg *Target, from, to int) (int, []string) {
	t.Helper()
	c := chunk(t, tg, from, to)
	natural, problems := Jumps(tg, c, Shared(tg, c))
	return len(natural), problems
}

// wantJumpProblem wants exactly one problem and no natural-end jump.
func wantJumpProblem(t *testing.T, tg *Target, from, to int, want string) {
	t.Helper()
	if n, problems := jumps(t, tg, from, to); n != 0 || len(problems) != 1 || problems[0] != want {
		t.Fatalf("%d-%d: %d natural, %q", from, to, n, problems)
	}
}

// basicWith is the basic case with extra declarations appended (they start at line 22).
func basicWith(t *testing.T, fn, recv, extra string) *Target {
	t.Helper()
	tg, err := FindFunc(loadCase(t, "basic", append(readCase(t, "basic"), "\n"+extra...)), caseFile(t, "basic"), fn, recv)
	if err != nil {
		t.Fatal(err)
	}
	return tg
}

func TestJumpsBreakAtClauseEnd(t *testing.T) {
	tg := target(t, "breakswitch", "F", "")
	c := chunk(t, tg, 9, 13)
	natural, problems := Jumps(tg, c, Shared(tg, c))
	if len(natural) != 1 || tg.Line(natural[0].Pos()) != 11 || len(problems) != 0 {
		t.Fatal(natural, problems)
	}
	wantJumpProblem(t, tg, 9, 12, "break at line 11 leaves the switch, but the chunk ends before its case does (line 13).")
}

func TestJumpsContinueAtLoopEnd(t *testing.T) {
	tg := basicWith(t, "L", "", `func a() {}
func b() {}

func L(xs []int, c bool) {
	for range xs {
		a()
		if c {
			continue
		}
		b()
	}
}
`)
	if n, problems := jumps(t, tg, 27, 31); n != 1 || len(problems) != 0 {
		t.Fatal(n, problems)
	}
	wantJumpProblem(t, tg, 27, 30, "continue at line 29 skips the rest of the loop body, which the chunk does not end.")
}

func TestJumpsGotoOverCall(t *testing.T) {
	wantJumpProblem(t, target(t, "gotoover", "F", ""), 10, 11, "goto done at line 8 would jump over the call at line 10.")
}

func TestJumpsLabels(t *testing.T) {
	tg := basicWith(t, "M", "", `func M(n int) int {
	if n > 0 {
		goto out
	}
	n++
out:
	return n
}

func P(n int) int {
again:
	n++
	if n < 3 {
		goto again
	}
	return n
}
`)
	wantJumpProblem(t, tg, 23, 26, "goto out at line 24 leaves the chunk.")
	p, err := FindFunc(tg.L, tg.Path, "P", "")
	if err != nil {
		t.Fatal(err)
	}
	wantJumpProblem(t, p, 32, 33, "the label again (line 32) is used from outside the chunk (line 35).")
}

func TestJumpsRefusedStatements(t *testing.T) {
	wantJumpProblem(t, target(t, "deferrecover", "F", ""), 8, 12, "defer at line 8.")
	tg := basicWith(t, "Q", "S", `type S struct{ n int }

func work(int) {}

func (s *S) Q(x int) {
	_ = recover()
	go work(x)
	s = &S{}
	s.n = x
	go func() { work(x) }()
}
`)
	wantJumpProblem(t, tg, 27, 27, "recover() at line 27.")
	wantJumpProblem(t, tg, 28, 28, "go statement at line 28 uses x.")
	wantJumpProblem(t, tg, 29, 29, "assigns the receiver s at line 29.")
	wantJumpProblem(t, tg, 31, 31, "go statement at line 31 uses x.")
	if n, problems := jumps(t, tg, 30, 30); n != 0 || len(problems) != 0 {
		t.Fatal(problems)
	}
	wantJumpProblem(t, target(t, "ptrdefine", "F", ""), 15, 16, "err is passed by pointer but assigned with := at line 15.")
}

func TestJumpsFuncLitsIgnored(t *testing.T) {
	tg := basicWith(t, "R", "", `func work(int) {}

func R() {
	func() { defer work(1); _ = recover(); return }()
}
`)
	if n, problems := jumps(t, tg, 25, 25); n != 0 || len(problems) != 0 {
		t.Fatal(problems)
	}
}
