package main

import (
	"fmt"
	"go/ast"
	"strings"
	"testing"
)

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

func TestCheckReturnWithoutDone(t *testing.T) {
	// F's early return would only end h: F would go on to append "b".
	after := "package pvoid\n\nvar out []string\n\n// F records.\nfunc F(n int) {\n\tout = append(out, \"a\")\n\th(n)\n\tout = append(out, \"b\")\n}\n\n" +
		"// h is part of F, extracted by my_editor.\nfunc h(n int) {\n\tif n > 0 {\n\t\treturn\n\t}\n}\n"
	wantProblem(t, checkAfter(t, "pvoid", "F", "", after, fact("h", 8, 10)), "h: the chunk returns from F at line 9, but its call block does not return.")
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

// buildAndCheck builds a one-chunk plan of bt, a function of case name whose file is before, and checks the result.
func buildAndCheck(t *testing.T, name string, bt *Target, before []byte, from, to int) ([]byte, []string) {
	t.Helper()
	res, out := Build(bt, []PlanChunk{{"h", from, to}})
	if len(res.Problems) > 0 {
		t.Fatal(res.Problems)
	}
	list, pkg := listCase(t, name)
	return out, Check(list, pkg, caseFile(t, name), bt.Func.Name.Name, "", before, out, res)
}

func TestCheckBareReturns(t *testing.T) {
	// A bare return inside the chunk returns the named results: n by value, or (*n) when the function defers.
	for _, lines := range [][2]int{{12, 17}, {13, 15}} {
		if _, problems := buildAndCheck(t, "barereturn", target(t, "barereturn", "G", ""), readCase(t, "barereturn"), lines[0], lines[1]); len(problems) > 0 {
			t.Fatal(lines, problems)
		}
	}
	extra := "func D(c bool) (n int) {\n\tdefer func() { n++ }()\n\tn = 1\n\tif c {\n\t\treturn\n\t}\n\tn = 2\n\treturn\n}\n"
	out, problems := buildAndCheck(t, "basic", basicWith(t, "D", "", extra), append(readCase(t, "basic"), "\n"+extra...), 24, 28)
	if len(problems) > 0 || !strings.Contains(string(out), "\t\treturn true, (*n)\n") {
		t.Fatalf("%q\n%s", problems, out)
	}
}

// jumpsFunc has a jump of every kind; it starts at line 22 of the basic case.
const jumpsFunc = "func J(n int, c chan int) int {\n\tt := 0\nloop:\n\tfor i := 0; i < n; i++ {\n\t\tswitch i {\n\t\tcase 0:\n\t\t\tfallthrough\n" +
	"\t\tcase 1:\n\t\t\tcontinue loop\n\t\tcase 2:\n\t\t\tbreak\n\t\tcase 3:\n\t\t\tcontinue\n\t\tcase 4:\n\t\t\tgoto end\n\t\t}\n\t\tselect {\n" +
	"\t\tcase <-c:\n\t\t\tbreak\n\t\tdefault:\n\t\t}\n\t\tt += i\n\t}\nend:\n\treturn t\n}\n"

// jumpAt is the jump of J at a line.
func jumpAt(t *testing.T, bt *Target, line int) *ast.BranchStmt {
	t.Helper()
	var found *ast.BranchStmt
	ast.Inspect(bt.Func, func(n ast.Node) bool {
		if b, ok := n.(*ast.BranchStmt); ok && bt.Line(b.Pos()) == line {
			found = b
		}
		return found == nil
	})
	if found == nil {
		t.Fatalf("no jump at line %d", line)
	}
	return found
}

func TestBranchTarget(t *testing.T) {
	ck := &checker{bt: basicWith(t, "J", "", jumpsFunc)}
	want := map[int]string{28: "*ast.CaseClause 27", 30: "*ast.ForStmt 25", 32: "*ast.SwitchStmt 26", 34: "*ast.ForStmt 25",
		36: "*ast.LabeledStmt 45", 40: "*ast.SelectStmt 38"}
	for line, w := range want {
		target := ck.branchTarget(jumpAt(t, ck.bt, line))
		if got := fmt.Sprintf("%T %d", target, ck.bt.Line(target.Pos())); got != w {
			t.Errorf("line %d: got %s, want %s", line, got, w)
		}
	}
}

func TestNaturalJump(t *testing.T) {
	bt := basicWith(t, "J", "", jumpsFunc)
	ck := &checker{bt: bt}
	cases := []struct {
		from, to, jump int
		want           bool
	}{
		{32, 32, 32, true},  // a break ending its case
		{40, 40, 40, true},  // a break ending its select case
		{26, 43, 34, true},  // a continue in a chunk that ends the loop body
		{30, 30, 30, false}, // a labeled continue from a case is not the loop body's end
		{26, 37, 34, false}, // the chunk does not end the loop body
		{38, 43, 40, false}, // a break of a select inside the chunk
	}
	for _, c := range cases {
		w := &bodyWriter{ck: ck, c: chunk(t, bt, c.from, c.to)}
		b := jumpAt(t, bt, c.jump)
		if got := w.naturalJump(b, ck.branchTarget(b)); got != c.want {
			t.Errorf("%d–%d, jump at %d: got %v", c.from, c.to, c.jump, got)
		}
	}
}
