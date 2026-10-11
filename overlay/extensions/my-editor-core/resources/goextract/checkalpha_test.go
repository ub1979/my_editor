package main

import "testing"

func TestCheckRefusesSwappedOutputs(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "loopout"), replace("prev, sum = step(x, sum)", "sum, prev = step(x, sum)"))
	wantProblem(t, problems, "the call to step assigns result 1 (prev) to sum.")
}

func TestCheckRefusesRebinding(t *testing.T) {
	wantProblem(t, checkGolden(t, goldenRow(t, "names"), namesTamper), "double: n at line 19 resolves to the package's n, not the parameter for F's n.")
}

func TestCheckGoldensStillPass(t *testing.T) {
	TestCheckPassesGoldens(t)
}
