package main

import (
	"strings"
	"testing"
)

// decide runs Decide on lines from..to and fails on a problem.
func decide(t *testing.T, tg *Target, from, to int) Iface {
	t.Helper()
	f, _, problems := Decide(tg, chunk(t, tg, from, to), "h")
	if len(problems) > 0 {
		t.Fatal(problems)
	}
	return f
}

// signature lists an interface as "params | outputs", pointers starred.
func signature(f Iface) string {
	var ps, os []string
	for _, p := range f.Params {
		ps = append(ps, p.Name+" "+p.Type)
	}
	for _, o := range f.Outputs {
		os = append(os, o.Name+" "+o.Type)
	}
	return strings.Join(ps, ", ") + " | " + strings.Join(os, ", ")
}

func TestDecideOrderAndTypes(t *testing.T) {
	cases := []struct {
		name     string
		from, to int
		want     string
	}{
		{"onboarding", 38, 46, "ctx context.Context, staleAfter time.Duration, tx Tx, req Request, imageRef string | rows Rows, err error"},
		{"deadwrite", 14, 15, "n int, err error | n int"},
		{"deferrecover", 14, 17, "n *int, bad bool | "},
		{"loopout", 10, 11, "x int, sum int | prev int, sum int"},
		{"typestr", 19, 22, "id ID, d tm.Duration | "},
	}
	for _, c := range cases {
		fn := "F"
		if c.name == "onboarding" {
			fn = "Plan"
		}
		if got := signature(decide(t, target(t, c.name, fn, ""), c.from, c.to)); got != c.want {
			t.Errorf("%s: %s", c.name, got)
		}
	}
}

func TestDecideKinds(t *testing.T) {
	if f := decide(t, target(t, "loopout", "F", ""), 10, 11); !f.Named || !f.Outputs[0].Named || f.Outputs[1].Named {
		t.Fatalf("loopout: %+v", f)
	}
	if f := decide(t, target(t, "onboarding", "Plan", ""), 38, 46); f.Named || !f.Outputs[0].ChunkDeclared || f.Returns || f.Tail {
		t.Fatalf("onboarding: %+v", f)
	}
	if f := decide(t, target(t, "methodset", "Run", "S"), 22, 23); !f.Method || signature(f) != "total int | total int" {
		t.Fatalf("methodset: %+v", f)
	}
	if f := decide(t, target(t, "multireturn", "F", ""), 16, 18); !f.Returns || f.Tail {
		t.Fatalf("multireturn: %+v", f)
	}
	if f := decide(t, target(t, "tail", "F", ""), 9, 12); f.Returns || !f.Tail {
		t.Fatalf("tail: %+v", f)
	}
}

func TestDecideLimits(t *testing.T) {
	tg := target(t, "valuepath", "F", "")
	_, _, problems := Decide(tg, chunk(t, tg, 22, 25), "setFields")
	if len(problems) != 1 || problems[0] != "4 outputs (cfg, arr, x, err); at most 3." {
		t.Fatal(problems)
	}
}
