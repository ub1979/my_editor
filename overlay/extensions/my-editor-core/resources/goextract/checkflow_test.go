package main

import "testing"

func TestCheckRefusesDroppedOutput(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "rangearrayptr"), tampers(t,
		"\tsum = sumAll(&arr, sum)\n", "\tsumAll(&arr, sum)\n",
		"func sumAll(arr *[3]int, sum int) int {", "func sumAll(arr *[3]int, sum int) {",
		"\t}\n\treturn sum\n}\n", "\t}\n}\n"))
	wantProblem(t, problems, "sumAll: the chunk assigns sum (line 13), which F reads after it, but the call does not assign it back.")
}

func TestCheckRefusesUnassignedOutput(t *testing.T) {
	extra := "func W(c bool) int {\n\tx := 5\n\tif c {\n\t\tx = 1\n\t}\n\treturn x\n}\n"
	before := append(readCase(t, "basic"), "\n"+extra...)
	res, out := Build(basicWith(t, "W", "", extra), []PlanChunk{{"h", 24, 26}})
	if len(res.Problems) > 0 {
		t.Fatal(res.Problems)
	}
	after := tampers(t, "\tx = h(c, x)\n", "\tx = h(c)\n", "func h(c bool, x int) int {", "func h(c bool) (x int) {")(string(out))
	list, pkg := listCase(t, "basic")
	problems := Check(list, pkg, caseFile(t, "basic"), "W", "", before, []byte(after), res)
	wantProblem(t, problems, "h: x goes back to W's x, but the chunk may leave it unassigned.")
}
