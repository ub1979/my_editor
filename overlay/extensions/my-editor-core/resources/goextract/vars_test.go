package main

import (
	"go/ast"
	"go/types"
	"sort"
	"strings"
	"testing"
)

// exprOf is the first expression of the function whose source text is text.
func exprOf(t *testing.T, tg *Target, text string) ast.Expr {
	t.Helper()
	var found ast.Expr
	ast.Inspect(tg.Func.Body, func(n ast.Node) bool {
		if e, ok := n.(ast.Expr); ok && found == nil && string(tg.Src[tg.Offset(e.Pos()):tg.Offset(e.End())]) == text {
			found = e
		}
		return found == nil
	})
	if found == nil {
		t.Fatalf("no expression %q", text)
	}
	return found
}

// names are objects' names in order.
func names(objs []types.Object) string {
	var out []string
	for _, o := range objs {
		out = append(out, o.Name())
	}
	return strings.Join(out, " ")
}

// sortedNames are objects' names sorted.
func sortedNames(objs []types.Object) string {
	out := strings.Fields(names(objs))
	sort.Strings(out)
	return strings.Join(out, " ")
}

func TestValueRoot(t *testing.T) {
	tg := target(t, "valuepath", "F", "")
	for text, want := range map[string]string{"cfg.Timeout": "cfg", "arr[i]": "arr", "x.f": "x"} {
		if root := ValueRoot(tg.L.Info, exprOf(t, tg, text)); root == nil || root.Name != want {
			t.Errorf("%s: %v", text, root)
		}
	}
	ptr := target(t, "ptrselector", "F", "")
	if root := ValueRoot(ptr.L.Info, exprOf(t, ptr, "p.f")); root != nil {
		t.Errorf("p.f goes through a pointer: %v", root)
	}
	ob := target(t, "onboarding", "Plan", "")
	if root := ValueRoot(ob.L.Info, exprOf(t, ob, "req.TenantID")); root == nil || root.Name != "req" {
		t.Errorf("req.TenantID: %v", root)
	}
}

func TestOuterAndChunkDeclared(t *testing.T) {
	tg := target(t, "onboarding", "Plan", "")
	c := chunk(t, tg, 38, 46)
	seen := map[types.Object]bool{}
	var outer []types.Object
	for _, r := range tg.Refs(c) {
		if tg.Outer(c, r.Obj) && !seen[r.Obj] {
			seen[r.Obj] = true
			outer = append(outer, r.Obj)
		}
	}
	if got := sortedNames(outer); got != "ctx err imageRef req staleAfter tx" {
		t.Fatal(got)
	}
	if top, nested := tg.ChunkDeclared(c); names(top) != "interval rows" || len(nested) != 0 {
		t.Fatal(names(top), names(nested))
	}
	sh := target(t, "shadowerr", "F", "")
	c = chunk(t, sh, 14, 20)
	top, _ := sh.ChunkDeclared(c)
	if names(top) != "err" || sh.Line(top[0].Pos()) != 17 {
		t.Fatal(names(top))
	}
	for _, r := range sh.Refs(c) {
		if r.Id.Name == "err" && sh.Line(r.Id.Pos()) == 14 && (r.Obj == top[0] || sh.Line(r.Obj.Pos()) != 11 || !sh.Outer(c, r.Obj)) {
			t.Fatal("the err read at line 14 is the outer one")
		}
	}
}

func TestOuterLocalsInScope(t *testing.T) {
	tg := target(t, "deferrecover", "F", "")
	if got := names(tg.OuterLocals(chunk(t, tg, 14, 17))); got != "bad n err" {
		t.Fatal(got)
	}
	lit := target(t, "names", "F", "")
	if got := names(lit.OuterLocals(chunk(t, lit, 13, 13))); got != "n inner" {
		t.Fatal(got)
	}
	var inLit []string
	for _, r := range lit.LitRefs(chunk(t, lit, 8, 11)) {
		inLit = append(inLit, r.Id.Name)
	}
	if strings.Join(inLit, " ") != "int innerOnly n innerOnly" || len(lit.Refs(chunk(t, lit, 8, 11))) != 1 {
		t.Fatal(inLit)
	}
}
