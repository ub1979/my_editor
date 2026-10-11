package main

import "testing"

// oneProblem runs Analyze and wants exactly one problem.
func oneProblem(t *testing.T, tg *Target, from, to int, want string) {
	t.Helper()
	if _, problems := analyze(t, tg, from, to); len(problems) != 1 || problems[0] != want {
		t.Fatalf("%q", problems)
	}
}

func TestLiveOutputs(t *testing.T) {
	f, _ := analyze(t, target(t, "onboarding", "Plan", ""), 38, 46)
	declared := false
	for obj, ok := range f.Declared {
		declared = declared || (ok && obj.Name() == "err")
	}
	if names(f.Outputs) != "rows err" || !declared {
		t.Fatalf("outputs %s, declared %v", names(f.Outputs), f.Declared)
	}
	if f, _ := analyze(t, target(t, "basic", "Report", ""), 11, 14); names(f.Outputs) != "out" {
		t.Fatal(names(f.Outputs))
	}
}

func TestLiveEnclosingLoop(t *testing.T) {
	f, _ := analyze(t, target(t, "loopout", "F", ""), 10, 11)
	if names(f.Outputs) != "prev sum" || names(f.Inputs) != "x sum" {
		t.Fatalf("outputs %s, inputs %s", names(f.Outputs), names(f.Inputs))
	}
}

func TestLiveDeadWrite(t *testing.T) {
	f, _ := analyze(t, target(t, "deadwrite", "F", ""), 14, 15)
	if names(f.Assigned) != "err n" || names(f.Outputs) != "n" {
		t.Fatalf("assigned %s, outputs %s", names(f.Assigned), names(f.Outputs))
	}
}

func TestLiveSharedNeverValues(t *testing.T) {
	f, _ := analyze(t, target(t, "addrderef", "F", ""), 10, 11)
	if len(f.Inputs) != 0 || len(f.Outputs) != 0 || names(f.Assigned) != "x" {
		t.Fatalf("inputs %s, outputs %s", names(f.Inputs), names(f.Outputs))
	}
}

func TestFlowCapturedDeclaration(t *testing.T) {
	oneProblem(t, target(t, "capturedecl", "F", ""), 7, 9,
		"v is declared in the chunk (line 7), used after it, and captured by a function literal (line 8).")
}

func TestFlowShadowedInput(t *testing.T) {
	oneProblem(t, target(t, "shadowerr", "F", ""), 14, 20, "err is declared in the chunk (line 17) and also names an input.")
}

func TestFlowAddressTakenDeclaration(t *testing.T) {
	oneProblem(t, target(t, "typestr", "F", ""), 15, 18, "b is declared in the chunk (line 15), used after it, and address-taken (line 17).")
}

func TestFlowTypeUsedAfter(t *testing.T) {
	oneProblem(t, target(t, "typestr", "F", ""), 24, 24, "the type local is declared in the chunk (line 24) and used after it.")
}

func TestLiveBareReturnReadsNamedResults(t *testing.T) {
	if f, _ := analyze(t, target(t, "barereturn", "F", ""), 6, 6); names(f.Outputs) != "n" {
		t.Fatalf("F: outputs %q", names(f.Outputs))
	}
	if f, _ := analyze(t, target(t, "barereturn", "G", ""), 16, 16); names(f.Outputs) != "n" {
		t.Fatalf("G: outputs %q", names(f.Outputs))
	}
}

func TestFlowDeclarationNamesDeadParameter(t *testing.T) {
	oneProblem(t, target(t, "deadname", "F", ""), 15, 17, "err is declared in the chunk (line 16) and also names a parameter.")
}
