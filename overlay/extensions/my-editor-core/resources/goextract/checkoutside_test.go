package main

import (
	"go/format"
	"strings"
	"testing"
)

func TestCheckOutsideChanged(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "basic"), replace("if upper {", "if !upper {"))
	wantProblem(t, problems, "Outside the chunks, a.go changed near line 13: expected upper, found !.")
}

func TestCheckExtraDeclaration(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "basic"), func(s string) string { return s + "\nvar extra = 1\n" })
	wantProblem(t, problems, "Outside the chunks, a.go changed near line 28: expected the end, found var.")
}

func TestCheckHelperPlacement(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "onboarding"), func(s string) string {
		start := strings.Index(s, "\n// queryRows is part of Plan")
		helper := s[start:]
		s = s[:start] + "\n"
		at := strings.Index(s, "// Plan builds a plan.")
		out, err := format.Source([]byte(s[:at] + strings.TrimPrefix(helper, "\n") + "\n" + s[at:]))
		if err != nil {
			t.Fatal(err)
		}
		return string(out)
	})
	if strings.Join(problems, "\n") != "queryRows is not right after Plan in chunk order." {
		t.Fatalf("%q", problems)
	}
}
