package main

import (
	"strconv"
	"strings"
)

// CallBlock is the text that replaces a chunk (rule 10), indented like the chunk's first line. A tail chunk becomes
// `return h(…)`, or `h(…)` when the function has no results. Without outputs: `if done, r0, r1 := h(…); done
// { return r0, r1 }`, or `h(…)` when the helper does not return. With outputs, the new names are the chunk-declared
// outputs and the plumbing: none → `a, b = h(…)`; some, with every other output declared in the call's own block →
// `:=`; else one `var` line per new name, then `=`; then `if done { … }`.
func CallBlock(t *Target, c Chunk, f Iface, fresh func(string) string) (string, error) {
	call := callText(t, f)
	results := ResultTexts(t)
	var lines []string
	switch {
	case f.Tail && len(results) > 0:
		lines = []string{"return " + call}
	case !f.Returns && len(f.Outputs) == 0:
		lines = []string{call}
	case len(f.Outputs) == 0:
		done, rs := plumbing(fresh, len(results))
		lines = []string{"if " + strings.Join(append([]string{done}, rs...), ", ") + " := " + call + "; " + done + " {",
			"\t" + returnText(rs), "}"}
	default:
		var err error
		if lines, err = assignCall(t, c, f, call, fresh); err != nil {
			return "", err
		}
	}
	src := string(t.Src)
	indent := src[c.Start:t.Offset(c.FirstPos())]
	var b strings.Builder
	for _, line := range lines {
		b.WriteString(indent + line + "\n")
	}
	return b.String(), nil
}

// assignCall is the call assigned to the outputs (and the plumbing), with var lines when := cannot be used.
func assignCall(t *Target, c Chunk, f Iface, call string, fresh func(string) string) ([]string, error) {
	var lhs, newNames, vars []string
	sameBlock := true
	scope := t.BlockScope(c.Block)
	for _, o := range f.Outputs {
		lhs = append(lhs, o.Name)
		if o.ChunkDeclared {
			newNames = append(newNames, o.Name)
			vars = append(vars, "var "+o.Name+" "+o.Type)
		} else if o.Obj.Parent() != scope {
			sameBlock = false
		}
	}
	var done string
	var rs []string
	if f.Returns {
		done, rs = plumbing(fresh, len(ResultTexts(t)))
		lhs = append(append(lhs, done), rs...)
		newNames = append(append(newNames, done), rs...)
		vars = append(vars, "var "+done+" bool")
		if t.Func.Type.Results != nil {
			for _, field := range t.Func.Type.Results.List {
				if err := t.checkTypeExpr(field.Type, c.FirstPos()); err != nil {
					return nil, err
				}
			}
		}
		for i, text := range ResultTexts(t) {
			vars = append(vars, "var "+rs[i]+" "+text)
		}
	}
	var lines []string
	switch {
	case len(newNames) == 0:
		lines = []string{strings.Join(lhs, ", ") + " = " + call}
	case sameBlock:
		lines = []string{strings.Join(lhs, ", ") + " := " + call}
	default:
		lines = append(vars, strings.Join(lhs, ", ")+" = "+call)
	}
	if f.Returns {
		lines = append(lines, "if "+done+" {", "\t"+returnText(rs), "}")
	}
	return lines, nil
}

// plumbing names done and one r per function result.
func plumbing(fresh func(string) string, n int) (string, []string) {
	var rs []string
	for i := 0; i < n; i++ {
		rs = append(rs, fresh("r"+strconv.Itoa(i)))
	}
	return fresh("done"), rs
}

// callText is the helper's call: the parameters in order, &x for pointer ones, on the receiver for a method.
func callText(t *Target, f Iface) string {
	var args []string
	for _, p := range f.Params {
		if p.Pointer {
			args = append(args, "&"+p.Name)
		} else {
			args = append(args, p.Name)
		}
	}
	call := f.Name + "(" + strings.Join(args, ", ") + ")"
	if f.Method {
		call = t.Func.Recv.List[0].Names[0].Name + "." + call
	}
	return call
}
