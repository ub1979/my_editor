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

// varLinesFunc builds into a call block with var lines (n is V's, done and the temporaries the block's); it starts at
// line 22 of the basic case.
const varLinesFunc = "func V(c bool) (int, error) {\n\tn := 0\n\tif c {\n\t\tm := 2\n\t\tif m > n {\n\t\t\treturn m, nil\n\t\t}\n" +
	"\t\tn = m\n\t}\n\treturn n, nil\n}\n"

// checkVarLines builds V's chunk 25–29, applies tamper and checks the result.
func checkVarLines(t *testing.T, tamper func(string) string) []string {
	t.Helper()
	res, out := Build(basicWith(t, "V", "", varLinesFunc), []PlanChunk{{"h", 25, 29}})
	if len(res.Problems) > 0 {
		t.Fatal(res.Problems)
	}
	list, pkg := listCase(t, "basic")
	return Check(list, pkg, caseFile(t, "basic"), "V", "", append(readCase(t, "basic"), "\n"+varLinesFunc...), []byte(tamper(string(out))), res)
}

func TestCheckCallBlockVarLines(t *testing.T) {
	if problems := checkVarLines(t, func(s string) string { return s }); len(problems) > 0 {
		t.Fatal(problems)
	}
	// error and interface{ Error() string } assign both ways, but are not the same type.
	wantProblem(t, checkVarLines(t, replace("\t\tvar r1 error\n", "\t\tvar r1 interface{ Error() string }\n")),
		"the call to h declares r1 with a type that is not its result's.")
	// done declared before the chunk is V's own: the if after the call is not the block's.
	wantProblem(t, checkVarLines(t, tampers(t, "\t\tvar done bool\n", "", "\tn := 0\n", "\tn := 0\n\tvar done bool\n")),
		"the call to h assigns done, which is no local of V at line 25.")
	wantProblem(t, checkVarLines(t, func(s string) string { return replace("\t\tvar r0 int\n", "")(s) + "\nvar r0 int\n" }),
		"the call to h assigns r0, which it does not declare.")
	wantProblem(t, checkVarLines(t, replace("\t\t\treturn r0, r1\n", "\t\t\tr0++\n\t\t\treturn r0, r1\n")),
		"the call to h does not return its results when done.")
}

func TestCheckPlumbingUsedOutside(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "doneout"), replace("\tif err != nil {\n\t\treturn 0, err", "\tif err != nil || done {\n\t\treturn 0, err"))
	wantProblem(t, problems, "the call to thenStep declares done, which F uses outside the call block.")
}

func TestCheckDoneIfWithElse(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "multireturn"), replace("\t\treturn r0, r1\n", "\t\treturn r0, r1\n\t} else if done {\n\t\treturn 0, nil\n"))
	wantProblem(t, problems, "the call to early at line 16 is in an if that does not test done.")
}
