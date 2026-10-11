package main

import (
	"fmt"
	"go/ast"
	"strings"
	"testing"
)

// sitesOf builds a golden row and finds the call sites in the built file.
func sitesOf(t *testing.T, name string, extra ...PlanChunk) ([]CallSite, []string, *Target) {
	t.Helper()
	g := goldenRow(t, name)
	res, out := Build(target(t, g.name, g.fn, g.recv), append([]PlanChunk{{g.helper, g.from, g.to}}, extra...))
	if len(res.Problems) > 0 {
		t.Fatal(res.Problems)
	}
	at, err := FindFunc(loadCase(t, g.name, out), caseFile(t, g.name), g.fn, g.recv)
	if err != nil {
		t.Fatal(err)
	}
	var decls []*ast.FuncDecl
	for _, h := range res.Helpers {
		for _, d := range at.File.Decls {
			if fd, ok := d.(*ast.FuncDecl); ok && fd.Name.Name == h.Name {
				decls = append(decls, fd)
			}
		}
	}
	sites, problems := FindCallSites(at, decls)
	return sites, problems, at
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
	res, out := Build(tg, []PlanChunk{{"h", 25, 29}})
	if len(res.Problems) > 0 {
		t.Fatal(res.Problems)
	}
	at, err := FindFunc(loadCase(t, "basic", out), caseFile(t, "basic"), "V", "")
	if err != nil {
		t.Fatal(err)
	}
	var decl *ast.FuncDecl
	for _, d := range at.File.Decls {
		if fd, ok := d.(*ast.FuncDecl); ok && fd.Name.Name == "h" {
			decl = fd
		}
	}
	sites, problems := FindCallSites(at, []*ast.FuncDecl{decl})
	if len(problems) > 0 || len(sites) != 1 {
		t.Fatal(problems, string(out))
	}
	if got := siteText(at, sites[0]); !strings.Contains(got, "lhs=4 done=1 vars=3 ") || sites[0].DoneIf == nil {
		t.Fatalf("%s\n%s", got, out)
	}
}

func TestFindCallSitesCalledTwice(t *testing.T) {
	g := goldenRow(t, "basic")
	_, out := buildOne(t, target(t, g.name, g.fn, g.recv), g.helper, g.from, g.to)
	out = []byte(strings.Replace(string(out), "\treturn fmt.Sprintf(\"[%s]\", text)", "\t_ = collectItems(nil)\n\treturn fmt.Sprintf(\"[%s]\", text)", 1))
	at, err := FindFunc(loadCase(t, "basic", out), caseFile(t, "basic"), "Report", "")
	if err != nil {
		t.Fatal(err)
	}
	var decl *ast.FuncDecl
	for _, d := range at.File.Decls {
		if fd, ok := d.(*ast.FuncDecl); ok && fd.Name.Name == "collectItems" {
			decl = fd
		}
	}
	if _, problems := FindCallSites(at, []*ast.FuncDecl{decl}); strings.Join(problems, "") != "Report uses collectItems 2 times; its call block uses it once." {
		t.Fatalf("%q", problems)
	}
}
