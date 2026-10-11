package main

import (
	"strings"
	"testing"
)

// tampers applies replacements in order, failing when one finds nothing.
func tampers(t *testing.T, pairs ...string) func(string) string {
	return func(s string) string {
		for i := 0; i < len(pairs); i += 2 {
			if !strings.Contains(s, pairs[i]) {
				t.Fatalf("no %q in\n%s", pairs[i], s)
			}
			s = strings.Replace(s, pairs[i], pairs[i+1], 1)
		}
		return s
	}
}

func TestCheckRefusesValueBuilder(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "buildercopy"), tampers(t,
		"\twriteWords(words, &a)\n", "\ta = writeWords(words, a)\n",
		"func writeWords(words []string, a *acc) {", "func writeWords(words []string, a acc) acc {",
		"\t\ta.n++\n\t}\n}\n", "\t\ta.n++\n\t}\n\treturn a\n}\n"))
	wantProblem(t, problems, "writeWords: a goes by value, but F address-takes it at line 14.")
}

func TestCheckRefusesValueCaptured(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "addrderef"), tampers(t,
		"\tbump(&x)\n", "\tx = bump(x)\n",
		"func bump(x *int) {\n\tuse(x)\n\t(*x)++\n}", "func bump(x int) int {\n\tuse(&x)\n\tx++\n\treturn x\n}"))
	wantProblem(t, problems, "bump: x goes by value, but a function literal captures it (line 9).")
}

func TestCheckRefusesValueNamedResultWithDefer(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "deferrecover"), tampers(t,
		"\tadvance(&n, bad)\n", "\tn = advance(n, bad)\n",
		"func advance(n *int, bad bool) {\n\t(*n) = 2\n", "func advance(n int, bad bool) int {\n\tn = 2\n",
		"\t\tpanic(\"boom\")\n\t}\n}\n", "\t\tpanic(\"boom\")\n\t}\n\treturn n\n}\n"))
	wantProblem(t, problems, "advance: n goes by value, but it is a named result of F, which defers.")
}

func TestCheckPointerUses(t *testing.T) {
	problems := checkGolden(t, goldenRow(t, "rangearrayptr"), replace("(*arr)[2] = 10", "arr[2] = 10"))
	wantProblem(t, problems, "sumAll: arr is passed by pointer but used without (*arr) at line 18.")
}
