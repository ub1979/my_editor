package main

import (
	"fmt"
	"strings"
	"testing"
)

// locateBuilt finds the call sites of a build of bt (a function of case name) in the built file, tampered by
// tamper when it is not nil, as Check does.
func locateBuilt(t *testing.T, bt *Target, name string, plan []PlanChunk, tamper func(string) string) ([]CallSite, []string, *Target) {
	t.Helper()
	res, out := Build(bt, plan)
	if len(res.Problems) > 0 {
		t.Fatal(res.Problems)
	}
	if tamper != nil {
		out = []byte(tamper(string(out)))
	}
	recv := ""
	if bt.Func.Recv != nil {
		recv = recvBase(bt.Func.Recv.List[0].Type)
	}
	at, err := FindFunc(loadCase(t, name, out), caseFile(t, name), bt.Func.Name.Name, recv)
	if err != nil {
		t.Fatal(err)
	}
	ck := &checker{bt: bt, at: at}
	problems := ck.locate(res)
	return ck.sites, problems, at
}

// sitesOf builds a golden row and finds the call sites in the built file.
func sitesOf(t *testing.T, name string) ([]CallSite, []string, *Target) {
	t.Helper()
	g := goldenRow(t, name)
	return locateBuilt(t, target(t, g.name, g.fn, g.recv), g.name, []PlanChunk{{g.helper, g.from, g.to}}, nil)
}

// siteText describes a site: its lines, assigned count, done index and flags.
func siteText(at *Target, s CallSite) string {
	src := string(at.Src[s.Start:s.End])
	return fmt.Sprintf("%d-%d lhs=%d done=%d vars=%d return=%v last=%v define=%v", at.Line(at.L.Fset.File(at.Func.Pos()).Pos(s.Start)),
		strings.Count(src, "\n")+at.Line(at.L.Fset.File(at.Func.Pos()).Pos(s.Start))-1, len(s.Lhs), s.Done, len(s.Vars), s.Return, s.Last, s.Define)
}

func TestFindCallSites(t *testing.T) {
	cases := map[string]string{
		"multireturn": "16-18 lhs=3 done=0 vars=0 return=false last=false define=true",
		"tail":        "9-9 lhs=0 done=-1 vars=0 return=true last=true define=false",
		"tailvoid":    "10-10 lhs=0 done=-1 vars=0 return=false last=true define=false",
		"breakswitch": "9-9 lhs=1 done=-1 vars=0 return=false last=false define=false",
		"basic":       "11-11 lhs=1 done=-1 vars=0 return=false last=false define=true",
		"pfound":      "7-7 lhs=1 done=-1 vars=0 return=false last=false define=false",
		"pvar":        "6-6 lhs=1 done=-1 vars=0 return=false last=false define=false",
	}
	for name, want := range cases {
		sites, problems, at := sitesOf(t, name)
		if len(problems) > 0 || len(sites) != 1 {
			t.Fatal(name, problems)
		}
		if got := siteText(at, sites[0]); got != want {
			t.Fatalf("%s:\ngot  %s\nwant %s", name, got, want)
		}
	}
}

func TestFindCallSitesVarLines(t *testing.T) {
	tg := basicWith(t, "V", "", "func V(c bool) (int, error) {\n\tn := 0\n\tif c {\n\t\tm := 2\n\t\tif m > n {\n\t\t\treturn m, nil\n\t\t}\n"+
		"\t\tn = m\n\t}\n\treturn n, nil\n}\n")
	sites, problems, at := locateBuilt(t, tg, "basic", []PlanChunk{{"h", 25, 29}}, nil)
	if len(problems) > 0 || len(sites) != 1 {
		t.Fatal(problems)
	}
	if got := siteText(at, sites[0]); !strings.Contains(got, "lhs=4 done=1 vars=3 ") || sites[0].DoneIf == nil {
		t.Fatalf("%s\n%s", got, at.Src)
	}
}

func TestFindCallSitesUserIf(t *testing.T) {
	// ok := h(xs) declares the chunk's ok; the if after it is K's own, not the block's if done.
	extra := "func K(xs []int) int {\n\tn := 0\n\tok := len(xs) > 0\n\tif ok {\n\t\tn = 1\n\t}\n\treturn n\n}\n"
	sites, problems, at := locateBuilt(t, basicWith(t, "K", "", extra), "basic", []PlanChunk{{"h", 24, 24}}, nil)
	if got := siteText(at, sites[0]); len(problems) > 0 || got != "24-24 lhs=1 done=-1 vars=0 return=false last=false define=true" {
		t.Fatal(got, problems)
	}
	res, out := Build(basicWith(t, "K", "", extra), []PlanChunk{{"h", 24, 24}})
	list, pkg := listCase(t, "basic")
	if problems := Check(list, pkg, caseFile(t, "basic"), "K", "", append(readCase(t, "basic"), "\n"+extra...), out, res); len(problems) > 0 {
		t.Fatal(problems)
	}
}

func TestFindCallSitesCalledTwice(t *testing.T) {
	g := goldenRow(t, "basic")
	_, problems, _ := locateBuilt(t, target(t, g.name, g.fn, g.recv), g.name, []PlanChunk{{g.helper, g.from, g.to}},
		replace("\treturn fmt.Sprintf(\"[%s]\", text)", "\t_ = collectItems(nil)\n\treturn fmt.Sprintf(\"[%s]\", text)"))
	if strings.Join(problems, "") != "Report uses collectItems 2 times; its call block uses it once." {
		t.Fatalf("%q", problems)
	}
}
