package main

import (
	"go/ast"
	"testing"
)

const terminatingCases = `func T1(c bool) int {
	if c {
		return 1
	} else {
		panic("no")
	}
}

func T2(k int) int {
	switch k {
	case 1:
		fallthrough
	default:
		return 2
	}
}

func T3(k int) int {
	for {
		if k > 0 {
			break
		}
	}
	switch k {
	case 1:
		return 1
	}
	for {
	}
}
`

func TestTerminating(t *testing.T) {
	tg := basicWith(t, "T1", "", terminatingCases)
	want := map[string][]bool{"T1": {true}, "T2": {true}, "T3": {false, false, true}}
	for name, wants := range want {
		fn, err := FindFunc(tg.L, tg.Path, name, "")
		if err != nil {
			t.Fatal(err)
		}
		for i, w := range wants {
			if got := Terminating(fn, fn.Func.Body.List[i], nil); got != w {
				t.Errorf("%s statement %d: %v", name, i, got)
			}
		}
	}
}

func TestTerminatingNaturalJump(t *testing.T) {
	tg := target(t, "breakswitch", "F", "")
	c := chunk(t, tg, 10, 12)
	ifs := c.Stmts()[0].(*ast.IfStmt)
	b := ifs.Body.List[0].(*ast.BranchStmt)
	if Terminating(tg, b, nil) || !Terminating(tg, b, map[*ast.BranchStmt]bool{b: true}) {
		t.Fatal("a natural-end break terminates only when it is natural")
	}
}
