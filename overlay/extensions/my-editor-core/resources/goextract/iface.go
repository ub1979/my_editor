package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"math"
	"sort"
	"strings"
)

// Decide works out a chunk's helper interface (rules 1–7): shared variables the chunk uses become pointer
// parameters; inputs, and outer locals it assigns that are not outputs, value parameters; a pointer receiver it uses
// makes the helper a method. It returns the natural-end jumps and the chunk's problems, unprefixed.
func Decide(t *Target, c Chunk, name string) (Iface, []*ast.BranchStmt, []string) {
	shared := Shared(t, c)
	natural, problems := Jumps(t, c, shared)
	flow, more := Analyze(t, c, shared)
	problems = append(problems, more...)
	f := Iface{Name: name, Tail: c.Block.Owner == ast.Node(t.Func.Body) && c.Last == len(c.Block.List)-1}
	f.Returns = !f.Tail && hasReturn(c)
	used := usedIn(t, c, flow)
	recv := pointerReceiver(t)
	f.Method = recv != nil && used[recv]
	outputs := map[types.Object]bool{}
	for _, obj := range flow.Outputs {
		outputs[obj] = true
	}
	seen := map[types.Object]bool{}
	add := func(obj types.Object, pointer bool) {
		if seen[obj] || (f.Method && obj == recv) {
			return
		}
		seen[obj] = true
		f.Params = append(f.Params, Param{Obj: obj, Name: obj.Name(), Pointer: pointer})
	}
	for _, obj := range t.OuterLocals(c) {
		if shared[obj] != "" && used[obj] {
			add(obj, true)
		}
	}
	for _, obj := range flow.Inputs {
		add(obj, false)
	}
	for _, obj := range flow.Assigned {
		if shared[obj] == "" && !outputs[obj] {
			add(obj, false)
		}
	}
	isParam := map[types.Object]bool{}
	for _, p := range f.Params {
		isParam[p.Obj] = true
	}
	for _, obj := range flow.Outputs {
		outer := t.Outer(c, obj)
		named := outer && !isParam[obj] && !flow.Declared[obj]
		f.Outputs = append(f.Outputs, Output{Obj: obj, Name: obj.Name(), ChunkDeclared: !outer, Named: named})
		f.Named = f.Named || named
	}
	order(f.Params, func(p Param) (types.Object, bool) { return p.Obj, isContext(p.Obj.Type()) }, flow.FirstUse)
	order(f.Outputs, func(o Output) (types.Object, bool) { return o.Obj, false }, flow.FirstUse)
	problems = append(problems, writeTypes(t, c, &f)...)
	return f, natural, append(problems, limits(f)...)
}

// usedIn marks what the chunk uses: every object it references, and the named results a bare return in it reads.
func usedIn(t *Target, c Chunk, flow Flow) map[types.Object]bool {
	used := map[types.Object]bool{}
	for obj := range flow.FirstUse {
		used[obj] = true
	}
	for obj := range namedResults(t) {
		if hasBareReturn(c) {
			used[obj] = true
		}
	}
	return used
}

// order sorts by kind (context.Context first, err last, by name), then by first use in the chunk, then by
// declaration, so that variables the chunk reaches only through a bare return keep a stable order.
func order[T any](list []T, at func(T) (types.Object, bool), first map[types.Object]token.Pos) {
	key := func(e T) (int, token.Pos) {
		obj, ctx := at(e)
		kind := 1
		if ctx {
			kind = 0
		} else if obj.Name() == "err" {
			kind = 2
		}
		pos, ok := first[obj]
		if !ok {
			pos = math.MaxInt
		}
		return kind, pos
	}
	sort.SliceStable(list, func(i, j int) bool {
		ki, pi := key(list[i])
		kj, pj := key(list[j])
		if ki != kj || pi != pj {
			return ki < kj || (ki == kj && pi < pj)
		}
		oi, _ := at(list[i])
		oj, _ := at(list[j])
		return oi.Pos() < oj.Pos()
	})
}

// writeTypes writes each parameter's and output's type at the chunk's start.
func writeTypes(t *Target, c Chunk, f *Iface) []string {
	var problems []string
	for i := range f.Params {
		p := &f.Params[i]
		text, err := t.TypeText(p.Obj, c.FirstPos())
		if err != nil {
			problems = append(problems, err.Error())
			continue
		}
		if p.Pointer {
			text = "*" + text
		}
		p.Type = text
	}
	for i := range f.Outputs {
		o := &f.Outputs[i]
		text, err := t.TypeText(o.Obj, c.FirstPos())
		if err != nil {
			problems = append(problems, err.Error())
			continue
		}
		o.Type = text
	}
	return problems
}

// limits: at most 6 parameters (the receiver not counted) and 3 outputs.
func limits(f Iface) []string {
	var out []string
	if len(f.Params) > 6 {
		var names []string
		for _, p := range f.Params {
			names = append(names, p.Name)
		}
		out = append(out, fmt.Sprintf("%d parameters (%s); at most 6.", len(names), strings.Join(names, ", ")))
	}
	if len(f.Outputs) > 3 {
		var names []string
		for _, o := range f.Outputs {
			names = append(names, o.Name)
		}
		out = append(out, fmt.Sprintf("%d outputs (%s); at most 3.", len(names), strings.Join(names, ", ")))
	}
	return out
}

// pointerReceiver is the function's named pointer receiver, or nil.
func pointerReceiver(t *Target) types.Object {
	if t.Func.Recv == nil || len(t.Func.Recv.List) == 0 || len(t.Func.Recv.List[0].Names) == 0 {
		return nil
	}
	obj := t.L.Info.Defs[t.Func.Recv.List[0].Names[0]]
	if obj == nil {
		return nil
	}
	if _, ok := obj.Type().Underlying().(*types.Pointer); !ok {
		return nil
	}
	return obj
}

func isContext(typ types.Type) bool {
	n, ok := types.Unalias(typ).(*types.Named)
	return ok && n.Obj().Pkg() != nil && n.Obj().Pkg().Path() == "context" && n.Obj().Name() == "Context"
}

// hasReturn and hasBareReturn look for returns of the function in the chunk, not of its function literals.
func hasReturn(c Chunk) bool { return findReturn(c, func(*ast.ReturnStmt) bool { return true }) }

func hasBareReturn(c Chunk) bool {
	return findReturn(c, func(r *ast.ReturnStmt) bool { return len(r.Results) == 0 })
}

func findReturn(c Chunk, match func(*ast.ReturnStmt) bool) bool {
	found := false
	for _, s := range c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.FuncLit:
				return false
			case *ast.ReturnStmt:
				found = found || match(n)
			}
			return !found
		})
	}
	return found
}

// ResultTexts are the function's result types as written, one per result.
func ResultTexts(t *Target) []string {
	var out []string
	if t.Func.Type.Results == nil {
		return out
	}
	for _, field := range t.Func.Type.Results.List {
		text := string(t.Src[t.Offset(field.Type.Pos()):t.Offset(field.Type.End())])
		for n := max(1, len(field.Names)); n > 0; n-- {
			out = append(out, text)
		}
	}
	return out
}
