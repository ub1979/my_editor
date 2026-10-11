package main

import (
	"strings"
	"testing"
)

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

func TestCheckRefusesLocalConst(t *testing.T) {
	before := string(readCase(t, "localconst"))
	after := strings.Replace(before, "\tif k > limit {\n\t\tk = limit\n\t}\n\tk += len(fmt.Sprint(item{}))\n", "\tk = clamp(k)\n", 1) +
		"\n// clamp is part of F, extracted by my_editor.\nfunc clamp(k int) int {\n\tif k > limit {\n\t\tk = limit\n\t}\n" +
		"\tk += len(fmt.Sprint(item{}))\n\treturn k\n}\n"
	list, pkg := listCase(t, "localconst")
	built := BuildResult{Helpers: []HelperFact{{Name: "clamp", From: 16, To: 19}}}
	problems := Check(list, pkg, caseFile(t, "localconst"), "F", "", []byte(before), []byte(after), built)
	wantProblem(t, problems, "clamp: limit at line 22 resolves to the package's limit, not F's const limit (line 13).")
	wantProblem(t, problems, "clamp: item at line 25 resolves to the package's item, not F's type item (line 14).")
}
