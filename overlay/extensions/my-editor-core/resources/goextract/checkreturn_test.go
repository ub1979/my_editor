package main

import "testing"

func TestCheckRefusesJumpOut(t *testing.T) {
	g := golden{"breakswitch", "F", "", "pickOne", 9, 13}
	res, out := buildOne(t, target(t, g.name, g.fn, g.recv), g.helper, g.from, g.to)
	list, pkg := listCase(t, g.name)
	// A plan of 9–12 ends before the case does, so its break leaves the chunk; the builder refuses it, and the
	// checker reads the same file the same way when told that 9–12 is the chunk.
	res.Helpers[0].To = 12
	problems := Check(list, pkg, caseFile(t, g.name), g.fn, g.recv, readCase(t, g.name), out, res)
	wantProblem(t, problems, "pickOne: break at line 11 leaves the chunk.")
}

func TestCheckReadsTemporaryNames(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "multireturn"), func(s string) string {
		s = replace("r0, r1 := f(m)", "a0, a1 := f(m)")(s)
		return replace("return true, r0, r1", "return true, a0, a1")(s)
	})
	if len(problems) > 0 {
		t.Fatal(problems)
	}
}
