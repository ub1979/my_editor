package main

import (
	"fmt"
	"testing"
)

// sigOf reads the signature of a golden row's helper as built.
func sigOf(t *testing.T, name string) helperSig {
	t.Helper()
	g := goldenRow(t, name)
	res, out := buildOne(t, target(t, g.name, g.fn, g.recv), g.helper, g.from, g.to)
	list, pkg := listCase(t, g.name)
	ck := &checker{bt: target(t, g.name, g.fn, g.recv)}
	al, err := Load(list, pkg, map[string][]byte{caseFile(t, g.name): out})
	if err != nil {
		t.Fatal(err)
	}
	if ck.at, err = FindFunc(al, caseFile(t, g.name), g.fn, g.recv); err != nil {
		t.Fatal(err)
	}
	if problems := ck.locate(res); len(problems) > 0 {
		t.Fatal(problems)
	}
	return ck.readSig(0)
}

func sigText(s helperSig) string {
	var params, outs []string
	for _, p := range s.Params {
		params = append(params, fmt.Sprintf("%s:%s:%v", p.Name, p.Local.Name(), p.Pointer))
	}
	for _, o := range s.Outputs {
		outs = append(outs, fmt.Sprintf("%s:%v", o.Name, o.Chunk))
	}
	return fmt.Sprintf("%v %v returns=%v tail=%v results=%d named=%v recv=%v %q", params, outs, s.Returns, s.Tail, len(s.Results), len(s.Named),
		s.Recv != nil, s.Problems)
}

func TestCheckNamedResultIsNoInput(t *testing.T) {
	// m would start at zero in early: a named result stands for a local only in that local's output slot.
	problems := checkGolden(t, goldenRow(t, "multireturn"), tampers(t, "func early(m int) (bool, int, error) {", "func early() (_ bool, m int, _ error) {",
		"early(m); done", "early(); done"))
	wantProblem(t, problems, "early: its result m is named like F's m, but the call does not assign it to m.")
	after := "package ptailin\n\nimport \"errors\"\n\n// F doubles.\nfunc F(n int) (int, error) {\n\tn *= 2\n\treturn finish()\n}\n\n" +
		"// finish is part of F, extracted by my_editor.\nfunc finish() (n int, _ error) {\n\tif n > 100 {\n\t\treturn 0, errors.New(\"big\")\n\t}\n" +
		"\treturn n + 1, nil\n}\n"
	wantProblem(t, checkAfter(t, "ptailin", "F", "", after, fact("finish", 8, 11)), "finish: its result n is named like F's n, but the call does not assign it to n.")
}

func TestCheckTailOnlyAtTheEnd(t *testing.T) {
	// `return early(m)` in the middle of F would skip the rest of F.
	problems := checkGolden(t, goldenRow(t, "multireturn"), tampers(t, "if done, r0, r1 := early(m); done {\n\t\treturn r0, r1\n\t}\n", "return early(m)\n",
		"func early(m int) (bool, int, error) {\n\tif m > 10 {\n\t\tr0, r1 := f(m)\n\t\treturn true, r0, r1\n\t}\n\treturn false, 0, nil\n}",
		"func early(m int) (r0 int, r1 error) {\n\tif m > 10 {\n\t\treturn f(m)\n\t}\n\treturn\n}"))
	wantProblem(t, problems, "early: its call returns in the middle of F.")
	g := goldenRow(t, "tailvoid")
	_, out := buildOne(t, target(t, g.name, g.fn, g.recv), g.helper, g.from, g.to)
	after := tampers(t, "\t*out = append(*out, \"small\")\n", "")(string(out))
	wantProblem(t, checkAfter(t, g.name, g.fn, "", after, fact(g.helper, 10, 12)), "finishG: its call ends G, but its chunk does not.")
}

func TestCheckResultTypes(t *testing.T) {
	// A nil *E returned as error or any is a non-nil interface: e != nil would hold where it did not.
	nilerr := func(typ string) string {
		return "package pnilerr\n\n// E is an error.\ntype E struct{}\n\nfunc (*E) Error() string { return \"e\" }\n\nfunc find(n int) *E {\n" +
			"\tif n > 0 {\n\t\treturn &E{}\n\t}\n\treturn nil\n}\n\n// F finds.\nfunc F(n int) string {\n\tn++\n\te := h(n)\n\tif e != nil {\n" +
			"\t\treturn \"err\"\n\t}\n\treturn \"ok\"\n}\n\n// h is part of F, extracted by my_editor.\nfunc h(n int) " + typ + " {\n\te := find(n)\n\treturn e\n}\n"
	}
	if problems := checkAfter(t, "pnilerr", "F", "", nilerr("*E"), fact("h", 18, 18)); len(problems) > 0 {
		t.Fatal(problems)
	}
	for _, typ := range []string{"error", "any"} {
		wantProblem(t, checkAfter(t, "pnilerr", "F", "", nilerr(typ), fact("h", 18, 18)),
			"h: its result 1 has the type "+typ+", but F's e has the type *cases/pnilerr.E.")
	}
	after := "package ptailerr\n\n// E is an error.\ntype E struct{}\n\nfunc (*E) Error() string { return \"e\" }\n\n// F checks.\nfunc F(n int) error {\n" +
		"\tn++\n\treturn h(n)\n}\n\n// h is part of F, extracted by my_editor.\nfunc h(n int) *E {\n\tif n > 5 {\n\t\treturn &E{}\n\t}\n\treturn nil\n}\n"
	wantProblem(t, checkAfter(t, "ptailerr", "F", "", after, fact("h", 11, 14)), "h: its result 1 has the type *cases/ptailerr.E, but F's result 1 has the type error.")
}

func TestReadSig(t *testing.T) {
	cases := map[string]string{
		"names":       `[n:n:true] [] returns=false tail=false results=0 named=0 recv=false []`,
		"loopout":     `[x:x:false sum:sum:false] [prev:false sum:false] returns=false tail=false results=2 named=1 recv=false []`,
		"basic":       `[items:items:false] [out:true] returns=false tail=false results=1 named=0 recv=false []`,
		"multireturn": `[m:m:false] [] returns=true tail=false results=3 named=0 recv=false []`,
		"tail":        `[n:n:false] [] returns=false tail=true results=2 named=0 recv=false []`,
		"methodset":   `[total:total:false] [total:false] returns=false tail=false results=1 named=0 recv=true []`,
	}
	for name, want := range cases {
		if got := sigText(sigOf(t, name)); got != want {
			t.Errorf("%s:\ngot  %s\nwant %s", name, got, want)
		}
	}
}
