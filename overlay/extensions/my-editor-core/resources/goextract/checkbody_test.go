package main

import (
	"strings"
	"testing"
)

func TestCheckRefusesDroppedDeref(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "rangearrayptr"), replace("range *arr", "range arr"))
	wantProblem(t, problems, "sumAll differs from its chunk near line 17: expected *, found arr.")
}

func TestCheckRefusesChangedStatement(t *testing.T) {
	g := goldenRow(t, "basic")
	problems := checkGolden(t, g, func(s string) string {
		at := strings.Index(s, "func collectItems")
		return s[:at] + strings.Replace(s[at:], "out = append(out, it)", "out = append(out, it, it)", 1)
	})
	wantProblem(t, problems, "collectItems differs from its chunk near line 23: expected ), found ,.")
}

// namesTamper renames double's parameter to m and adds a package-level n the body then means.
func namesTamper(s string) string {
	return strings.Replace(s, "func double(n *int) {", "func double(m *int) {", 1) + "\nvar n *int\n"
}

func TestCheckUnknownParameter(t *testing.T) {
	wantProblem(t, checkGolden(t, goldenRow(t, "names"), namesTamper), "double: parameter m stands for no local of F at line 13.")
}
