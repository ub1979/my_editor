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
