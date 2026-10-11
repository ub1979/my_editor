package main

import (
	"go/ast"
	"go/types"
	"strings"
	"testing"
)

// sharedReason is the reason Shared gives for the variable called name, or "".
func sharedReason(shared map[types.Object]string, name string) string {
	for obj, why := range shared {
		if obj.Name() == name {
			return why
		}
	}
	return ""
}

// overlayTarget loads a case with a.go replaced and finds F's or Report's function.
func overlayTarget(t *testing.T, name, fn, src string) *Target {
	t.Helper()
	tg, err := FindFunc(loadCase(t, name, []byte(src)), caseFile(t, name), fn, "")
	if err != nil {
		t.Fatal(err)
	}
	return tg
}

func TestSharedCaptured(t *testing.T) {
	tg := target(t, "addrderef", "F", "")
	if got := sharedReason(Shared(tg, chunk(t, tg, 10, 11)), "x"); got != "captured by the function literal at line 9" {
		t.Fatal(got)
	}
	tg = target(t, "deferrecover", "F", "")
	shared := Shared(tg, chunk(t, tg, 14, 17))
	for _, name := range []string{"n", "err"} {
		if got := sharedReason(shared, name); got != "a named result of F, which defers" {
			t.Fatal(name, got)
		}
	}
	if got := sharedReason(shared, "bad"); got != "" {
		t.Fatal(got)
	}
}

func TestSharedImplicitAddress(t *testing.T) {
	tg := target(t, "buildercopy", "F", "")
	if got := sharedReason(Shared(tg, chunk(t, tg, 15, 18)), "a"); got != "address-taken at line 14 (a.b.WriteString has a pointer receiver)" {
		t.Fatal(got)
	}
}

func TestSharedExplicitAddress(t *testing.T) {
	tg := target(t, "ptrselector", "F", "")
	if got := sharedReason(Shared(tg, chunk(t, tg, 14, 15)), "p"); got != "address-taken at line 13" {
		t.Fatal(got)
	}
	tg = target(t, "rangearrayptr", "F", "")
	if got := sharedReason(Shared(tg, chunk(t, tg, 11, 14)), "arr"); got != "address-taken at line 9" {
		t.Fatal(got)
	}
	tg = target(t, "onboarding", "Plan", "")
	if shared := Shared(tg, chunk(t, tg, 38, 46)); len(shared) != 0 {
		t.Fatal(shared)
	}
	if got := AddressTaken(tg, tg.L.Info.Defs[tg.Func.Type.Params.List[0].Names[0]]); len(got) != 0 {
		t.Fatal(got)
	}
}

func TestSharedOnlyBeforeOrInLoop(t *testing.T) {
	src := string(readCase(t, "basic")) + "\nfunc use(*bool) {}\n"
	after := strings.Replace(src, "\t\ttext = strings.ToUpper(text)\n\t}\n", "\t\ttext = strings.ToUpper(text)\n\t}\n\tuse(&upper)\n", 1)
	tg := overlayTarget(t, "basic", "Report", after)
	if got := sharedReason(Shared(tg, chunk(t, tg, 16, 18)), "upper"); got != "" {
		t.Fatal(got)
	}
	inLoop := strings.Replace(src, "\t\tout = append(out, it)\n", "\t\tout = append(out, it)\n\t\tuse(&upper)\n", 1)
	tg = overlayTarget(t, "basic", "Report", inLoop)
	if got := sharedReason(Shared(tg, chunk(t, tg, 13, 13)), "upper"); got != "address-taken at line 14" {
		t.Fatal(got)
	}
}

func TestSharedLocksSlicesMethodValues(t *testing.T) {
	src := `package basic

import (
	"fmt"
	"strings"
	"sync"
)

type val struct{ n int }

func (v *val) ptrMethod() int { return v.n }

// Report joins and prints.
func Report(items []string, upper bool) string {
	var mu sync.Mutex
	var arr [3]int
	var v val
	s := arr[:]
	f := v.ptrMethod
	mu.Lock()
	_ = fmt.Sprint(s, f(), upper, items)
	mu.Unlock()
	return strings.ToUpper("x")
}
`
	tg := overlayTarget(t, "basic", "Report", src)
	shared := Shared(tg, chunk(t, tg, 21, 21))
	want := map[string]string{
		"mu": "its type holds a lock", "arr": "sliced at line 18", "v": "address-taken at line 19 (method value)",
		"s": "", "f": "", "items": "", "upper": "",
	}
	for name, why := range want {
		if got := sharedReason(shared, name); got != why {
			t.Errorf("%s: %q", name, got)
		}
	}
	if !HoldsLock(types.NewArray(tg.L.Info.Defs[exprOf(t, tg, "mu").(*ast.Ident)].Type(), 2)) || HoldsLock(types.Typ[types.Int]) {
		t.Error("HoldsLock")
	}
}

func TestSharedTypeSwitchVariable(t *testing.T) {
	tg := target(t, "typeswitch", "F", "")
	if why := sharedReason(Shared(tg, chunk(t, tg, 9, 9)), "t"); why != "address-taken at line 8" {
		t.Fatalf("t: %q", why)
	}
}

func TestSharedNamedLock(t *testing.T) {
	tg := target(t, "namedlock", "F", "")
	if why := sharedReason(Shared(tg, chunk(t, tg, 14, 14)), "mu"); why != "its type holds a lock" {
		t.Fatalf("mu: %q", why)
	}
}
