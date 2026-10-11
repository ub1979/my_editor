package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"sort"
)

// Analyze walks a chunk for rules 1, 2 and 6: its inputs, what it assigns, its outputs, and the problems of the
// variables it declares. Shared variables (passed by pointer) are never value inputs or outputs.
func Analyze(t *Target, c Chunk, shared map[types.Object]string) (Flow, []string) {
	w := &walker{t: t, c: c, info: t.L.Info, inputs: map[types.Object]bool{}, assigned: map[types.Object]bool{},
		breaks: map[ast.Node][]dset{}, gotos: gotoLabels(t, c)}
	end := w.list(c.Stmts(), dset{m: map[types.Object]bool{}})
	for _, e := range w.ends {
		end = meet(end, e)
	}
	f := Flow{FirstUse: firstUses(t, c), Declared: map[types.Object]bool{}, End: map[types.Object]bool{}}
	after := readAfter(t, c)
	var outputs []types.Object
	for obj := range w.assigned {
		f.End[obj] = end.has(obj)
		if after[obj] && shared[obj] == "" {
			outputs = append(outputs, obj)
			if !end.has(obj) {
				w.inputs[obj] = true
			}
		}
	}
	top, _ := t.ChunkDeclared(c)
	for _, obj := range top {
		if _, ok := obj.(*types.Var); ok && after[obj] {
			outputs = append(outputs, obj)
		}
	}
	for obj := range w.inputs {
		if shared[obj] == "" {
			f.Inputs = append(f.Inputs, obj)
		}
	}
	for obj := range w.assigned {
		f.Assigned = append(f.Assigned, obj)
	}
	f.Outputs = outputs
	for _, list := range [][]types.Object{f.Inputs, f.Assigned, f.Outputs} {
		sort.Slice(list, func(i, j int) bool { return f.FirstUse[list[i]] < f.FirstUse[list[j]] })
	}
	f.Declared = declaredByDefine(t, c, f)
	return f, declProblems(t, c, f, top, after, shared)
}

// firstUses is each object's first identifier in the chunk, function literals included.
func firstUses(t *Target, c Chunk) map[types.Object]token.Pos {
	out := map[types.Object]token.Pos{}
	for _, r := range append(t.Refs(c), t.LitRefs(c)...) {
		if p, ok := out[r.Obj]; !ok || r.Id.Pos() < p {
			out[r.Obj] = r.Id.Pos()
		}
	}
	return out
}

// readAfter marks every object used after the chunk anywhere in the function (function literals included) or
// anywhere in a loop that encloses the chunk. A bare return of the function there reads every named result.
func readAfter(t *Target, c Chunk) map[types.Object]bool {
	loops := EnclosingLoops(t, c)
	isAfter := func(p token.Pos) bool {
		if p >= c.EndPos() {
			return true
		}
		for _, l := range loops {
			if l.Pos() <= p && p < l.End() {
				return true
			}
		}
		return false
	}
	out := map[types.Object]bool{}
	ast.Inspect(t.Func.Body, func(n ast.Node) bool {
		if id, ok := n.(*ast.Ident); ok {
			if obj := t.L.Info.Uses[id]; obj != nil && isAfter(id.Pos()) {
				out[obj] = true
			}
		}
		return true
	})
	ast.Inspect(t.Func.Body, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.FuncLit:
			return false
		case *ast.ReturnStmt:
			if len(n.Results) == 0 && isAfter(n.Pos()) {
				for obj := range namedResults(t) {
					out[obj] = true
				}
			}
		}
		return true
	})
	return out
}

// declaredByDefine marks outer outputs whose first reference in the chunk is on the left of a top-level `:=`.
func declaredByDefine(t *Target, c Chunk, f Flow) map[types.Object]bool {
	outer := map[types.Object]bool{}
	for _, obj := range f.Outputs {
		if t.Outer(c, obj) {
			outer[obj] = true
		}
	}
	out := map[types.Object]bool{}
	for _, s := range c.Stmts() {
		as, ok := s.(*ast.AssignStmt)
		if !ok || as.Tok != token.DEFINE {
			continue
		}
		for _, l := range as.Lhs {
			if id, ok := l.(*ast.Ident); ok {
				if obj := t.L.Info.Uses[id]; outer[obj] && f.FirstUse[obj] == id.Pos() {
					out[obj] = true
				}
			}
		}
	}
	return out
}

// declProblems are rule 6's refusals for the chunk's top-level declarations. A name clash counts every name the
// helper's signature will carry: inputs, outputs, shared variables, the receiver, and assigned outer locals that are
// not outputs (they become parameters).
func declProblems(t *Target, c Chunk, f Flow, top []types.Object, after map[types.Object]bool, shared map[types.Object]string) []string {
	inChunk := func(ps []token.Pos) int {
		for _, p := range ps {
			if c.ContainsPos(p) {
				return t.Line(p)
			}
		}
		return 0
	}
	used := firstUses(t, c)
	names := map[string]string{}
	for obj := range shared {
		if _, ok := used[obj]; ok {
			names[obj.Name()] = "a variable passed by pointer"
		}
	}
	for _, obj := range f.Assigned {
		if shared[obj] == "" {
			names[obj.Name()] = "a parameter"
		}
	}
	for _, obj := range f.Outputs {
		if t.Outer(c, obj) {
			names[obj.Name()] = "an output"
		}
	}
	for _, obj := range f.Inputs {
		names[obj.Name()] = "an input"
	}
	if t.Func.Recv != nil {
		for _, id := range t.Func.Recv.List[0].Names {
			names[id.Name] = "the receiver"
		}
	}
	var out []string
	for _, obj := range top {
		line := t.Line(obj.Pos())
		switch obj.(type) {
		case *types.Var:
			if !after[obj] {
				break
			}
			if at := inChunk(CapturedAt(t, obj)); at > 0 {
				out = append(out, fmt.Sprintf("%s is declared in the chunk (line %d), used after it, and captured by a function literal (line %d).",
					obj.Name(), line, at))
			} else if at := inChunk(AddressTaken(t, obj)); at > 0 {
				out = append(out, fmt.Sprintf("%s is declared in the chunk (line %d), used after it, and address-taken (line %d).", obj.Name(), line, at))
			}
		case *types.Const, *types.TypeName:
			if usedAfterEnd(t, c, obj) {
				kind := "const"
				if _, ok := obj.(*types.TypeName); ok {
					kind = "type"
				}
				out = append(out, fmt.Sprintf("the %s %s is declared in the chunk (line %d) and used after it.", kind, obj.Name(), line))
			}
		}
		if what := names[obj.Name()]; what != "" {
			out = append(out, fmt.Sprintf("%s is declared in the chunk (line %d) and also names %s.", obj.Name(), line, what))
		}
	}
	return out
}

// usedAfterEnd reports a use of obj after the chunk's last statement.
func usedAfterEnd(t *Target, c Chunk, obj types.Object) bool {
	for id, o := range t.L.Info.Uses {
		if o == obj && id.Pos() >= c.EndPos() {
			return true
		}
	}
	return false
}
