package main

import "testing"

func TestCheckCallBlockDeclaresAnew(t *testing.T) {
	// `prev, sum := step(…)` in the loop body would declare new variables and leave F's untouched.
	problems := checkGolden(t, goldenRow(t, "loopout"), replace("prev, sum = step(x, sum)", "prev, sum := step(x, sum)\n\t\t_, _ = prev, sum"))
	wantProblem(t, problems, "the call to step declares prev anew; it must assign F's prev.")
}

func TestCheckSwappedArguments(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "loopout"), replace("prev, sum = step(x, sum)", "prev, sum = step(sum, x)"))
	wantProblem(t, problems, "the call to step passes sum for parameter x, not x.")
}

func TestCheckDoneIfWithElse(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "multireturn"), replace("\t\treturn r0, r1\n", "\t\treturn r0, r1\n\t} else if done {\n\t\treturn 0, nil\n"))
	wantProblem(t, problems, "the call to early at line 16 is in an if that does not test done.")
}
