package main

import (
	"strings"
	"testing"
)

// analyze runs Analyze on a chunk of a target with its Shared set.
func analyze(t *testing.T, tg *Target, from, to int) (Flow, []string) {
	t.Helper()
	c := chunk(t, tg, from, to)
	return Analyze(tg, c, Shared(tg, c))
}

// endHas reports whether the variable called name is definitely assigned at the chunk's end.
func endHas(f Flow, name string) bool {
	for obj, ok := range f.End {
		if ok && obj.Name() == name {
			return true
		}
	}
	return false
}

func TestFlowOnboarding(t *testing.T) {
	f, problems := analyze(t, target(t, "onboarding", "Plan", ""), 38, 46)
	if names(f.Inputs) != "staleAfter tx ctx req imageRef" || names(f.Assigned) != "err" || len(problems) != 0 {
		t.Fatalf("inputs %s, assigned %s, %v", names(f.Inputs), names(f.Assigned), problems)
	}
}

func TestFlowValuePaths(t *testing.T) {
	f, _ := analyze(t, target(t, "valuepath", "F", ""), 22, 25)
	if names(f.Inputs) != "cfg arr i x" || names(f.Assigned) != "cfg arr x err" || !endHas(f, "err") || endHas(f, "cfg") {
		t.Fatalf("inputs %s, assigned %s", names(f.Inputs), names(f.Assigned))
	}
}

func TestFlowBreakPath(t *testing.T) {
	f, _ := analyze(t, target(t, "breakswitch", "F", ""), 9, 13)
	if names(f.Assigned) != "x" || names(f.Inputs) != "c" || !endHas(f, "x") {
		t.Fatalf("inputs %s, assigned %s", names(f.Inputs), names(f.Assigned))
	}
	src := strings.Replace(string(readCase(t, "breakswitch")), "\t\tx = 1\n\t\tif c {\n\t\t\tbreak\n\t\t}\n", "\t\tif c {\n\t\t\tbreak\n\t\t}\n\t\tx = 1\n", 1)
	f, _ = analyze(t, overlayTarget(t, "breakswitch", "F", src), 9, 13)
	if names(f.Inputs) != "c x" || endHas(f, "x") {
		t.Fatalf("inputs %s", names(f.Inputs))
	}
}

func TestFlowReturnEndsPath(t *testing.T) {
	src := string(readCase(t, "basic")) + "\nfunc G(bad bool) int {\n\tv := 1\n\tif bad {\n\t\treturn 0\n\t}\n\tv = 2\n\treturn v\n}\n"
	f, _ := analyze(t, overlayTarget(t, "basic", "G", src), 24, 27)
	if names(f.Assigned) != "v" || !endHas(f, "v") || names(f.Inputs) != "bad" || names(f.Outputs) != "v" {
		t.Fatalf("inputs %s, assigned %s, outputs %s", names(f.Inputs), names(f.Assigned), names(f.Outputs))
	}
}

func TestFlowLoopsAndSelect(t *testing.T) {
	src := string(readCase(t, "basic")) + `
func H(ch chan int, xs []int) int {
	a, b, k := 0, 0, 0
	for k = range xs {
		a = k
	}
	select {
	case b = <-ch:
	default:
		b = 1
	}
	return a + b + k
}
`
	f, _ := analyze(t, overlayTarget(t, "basic", "H", src), 24, 31)
	if names(f.Inputs) != "k xs a ch" || names(f.Assigned) != "k a b" || !endHas(f, "b") || endHas(f, "a") {
		t.Fatalf("inputs %s, assigned %s", names(f.Inputs), names(f.Assigned))
	}
}
