package main

import (
	"go/ast"
	"go/token"
	"go/types"
	"sort"
	"strings"
)

// naturalReturn is the return that ends the helper at its natural end, written at position at.
func (r *rewriter) naturalReturn(at token.Pos) (string, error) {
	parts, err := r.outputs(at)
	if err != nil {
		return "", err
	}
	if r.f.Returns {
		parts = append(parts, "false")
		for _, typ := range r.results {
			zero, err := r.t.ZeroText(typ, at)
			if err != nil {
				return "", err
			}
			parts = append(parts, zero)
		}
	}
	return returnText(parts), nil
}

// needsNaturalEnd: not when the chunk ends in a terminating statement, nor when the helper returns nothing.
func (r *rewriter) needsNaturalEnd(natural []*ast.BranchStmt) bool {
	if len(r.f.Outputs) == 0 && !r.f.Returns {
		return false
	}
	nat := map[*ast.BranchStmt]bool{}
	for _, b := range natural {
		nat[b] = true
	}
	return !Terminating(r.t, r.c.Block.List[r.c.Last], nat)
}

// outputs are the output slots of a return at position at: each output's name, or its zero value when the helper
// has not declared it yet there. A name that means another variable at that position is an error.
func (r *rewriter) outputs(at token.Pos) ([]string, error) {
	var out []string
	for _, o := range r.f.Outputs {
		if r.declaredAfter(o, at) {
			zero, err := r.t.ZeroText(o.Obj.Type(), at)
			if err != nil {
				return nil, err
			}
			out = append(out, zero)
			continue
		}
		if err := r.t.resolves(o.Name, o.Obj, at); err != nil {
			return nil, err
		}
		out = append(out, o.Name)
	}
	return out, nil
}

// declaredAfter reports an output the helper declares in its body after position at: a chunk-declared variable, or
// an outer one that is neither a parameter nor a named result (so a top-level `:=` of the chunk declares it).
func (r *rewriter) declaredAfter(o Output, at token.Pos) bool {
	if o.ChunkDeclared {
		return o.Obj.Pos() > at
	}
	if o.Named {
		return false
	}
	for _, p := range r.f.Params {
		if p.Obj == o.Obj {
			return false
		}
	}
	for _, ref := range r.t.Refs(r.c) {
		if ref.Obj == o.Obj {
			return ref.Id.Pos() > at
		}
	}
	return false
}

// valueText is a parameter's value in the helper: (*x) for a pointer one.
func (r *rewriter) valueText(obj types.Object) string {
	if r.ptr[obj] {
		return "(*" + obj.Name() + ")"
	}
	return obj.Name()
}

// indent is the leading blanks of the line holding p.
func (r *rewriter) indent(p token.Pos) string {
	off := r.t.Offset(p)
	start := strings.LastIndexByte(string(r.t.Src[:off]), '\n') + 1
	line := string(r.t.Src[start:off])
	return line[:len(line)-len(strings.TrimLeft(line, " \t"))]
}

func returnText(parts []string) string {
	if len(parts) == 0 {
		return "return"
	}
	return "return " + strings.Join(parts, ", ")
}

// render is src[from:to] with the edits inside it applied; an edit nested in an earlier one is left to that one.
func render(src []byte, edits []edit, from, to int) string {
	sorted := append([]edit{}, edits...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].start != sorted[j].start {
			return sorted[i].start < sorted[j].start
		}
		return sorted[i].end > sorted[j].end
	})
	var b strings.Builder
	cur := from
	for _, e := range sorted {
		if e.start < cur || e.end > to {
			continue
		}
		b.Write(src[cur:e.start])
		b.WriteString(e.text)
		cur = e.end
	}
	b.Write(src[cur:to])
	return b.String()
}
