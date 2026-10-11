package main

import (
	"go/token"
	"go/types"
	"strings"
	"testing"
)

// localNamed is the first object called name that the function declares (parameters included).
func localNamed(t *testing.T, tg *Target, name string) types.Object {
	t.Helper()
	var found types.Object
	for id, obj := range tg.L.Info.Defs {
		if obj != nil && id.Name == name && tg.Func.Pos() <= id.Pos() && id.End() <= tg.Func.End() {
			if found == nil || obj.Pos() < found.Pos() {
				found = obj
			}
		}
	}
	if found == nil {
		t.Fatalf("%s declares no %s", tg.Func.Name.Name, name)
	}
	return found
}

// lineStart is the position of the statement that starts on a line.
func lineStart(t *testing.T, tg *Target, line int) token.Pos {
	t.Helper()
	return chunk(t, tg, line, line).FirstPos()
}

// wantType wants TypeText of the local called name, written at line, to be want.
func wantType(t *testing.T, tg *Target, name string, line int, want string) {
	t.Helper()
	got, err := tg.TypeText(localNamed(t, tg, name), lineStart(t, tg, line))
	if err != nil || got != want {
		t.Fatalf("%s: %q, %v; want %q", name, got, err, want)
	}
}

// wantTypeError wants TypeText of the local called name, written at line, to fail with want.
func wantTypeError(t *testing.T, tg *Target, name string, line int, want string) {
	t.Helper()
	got, err := tg.TypeText(localNamed(t, tg, name), lineStart(t, tg, line))
	if err == nil || err.Error() != want {
		t.Fatalf("%s: %q, %v; want error %q", name, got, err, want)
	}
}

func TestTypeSourceText(t *testing.T) {
	tg := target(t, "typestr", "F", "")
	wantType(t, tg, "id", 19, "ID")
	wantType(t, tg, "d", 19, "tm.Duration")
	wantType(t, tg, "parts", 19, "[]string")
	wantType(t, tg, "b", 19, "Builder")
	ob := target(t, "onboarding", "Plan", "")
	wantType(t, ob, "tx", 38, "Tx")
	wantType(t, ob, "staleAfter", 38, "time.Duration")
	wantType(t, ob, "rows", 38, "Rows")
	wantType(t, ob, "err", 38, "error")
}

func TestTypeInferredAlias(t *testing.T) {
	src := string(readCase(t, "typestr")) + "\nfunc newID() ID { return 1 }\n\nfunc G() ID {\n\tx := newID()\n\treturn x\n}\n"
	tg := overlayTarget(t, "typestr", "G", src)
	wantType(t, tg, "x", 32, "ID")
}

func TestTypeShadowedQualifier(t *testing.T) {
	src := strings.Replace(string(readCase(t, "typestr")), "\ttotal := id", "\ttm := 0\n\t_ = tm\n\ttotal := id", 1)
	tg := overlayTarget(t, "typestr", "F", src)
	wantTypeError(t, tg, "d", 21, "tm is shadowed at line 19.")
	wantType(t, tg, "d", 19, "tm.Duration")
}

func TestTypeRefused(t *testing.T) {
	wantTypeError(t, target(t, "typestr", "F", ""), "l", 26, "local is declared inside F.")
	tg := overlayTarget(t, "onboarding", "G", `package onboarding

import "context"

func G() bool {
	dl, ok := context.Background().Deadline()
	_ = dl
	return ok
}
`)
	wantTypeError(t, tg, "dl", 7, "time.Time: this file does not import time.")
}

func TestZeroValues(t *testing.T) {
	tg := target(t, "valuepath", "F", "")
	at := lineStart(t, tg, 22)
	errType := types.Universe.Lookup("error").Type()
	cases := []struct {
		typ  types.Type
		want string
	}{
		{types.Typ[types.Int], "0"},
		{types.Typ[types.Float64], "0"},
		{types.Typ[types.String], `""`},
		{types.Typ[types.Bool], "false"},
		{errType, "nil"},
		{types.NewPointer(types.Typ[types.Int]), "nil"},
		{types.NewSlice(types.Typ[types.Int]), "nil"},
		{types.NewMap(types.Typ[types.String], types.Typ[types.Int]), "nil"},
		{types.NewChan(types.SendRecv, types.Typ[types.Int]), "nil"},
		{types.NewSignatureType(nil, nil, nil, nil, nil, false), "nil"},
		{localNamed(t, tg, "cfg").Type(), "config{}"},
		{localNamed(t, tg, "arr").Type(), "[3]int{}"},
	}
	for _, c := range cases {
		if got, err := tg.ZeroText(c.typ, at); err != nil || got != c.want {
			t.Errorf("%v: %q, %v; want %q", c.typ, got, err, c.want)
		}
	}
}
