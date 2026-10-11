package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"strconv"
)

// returnEdits rewrites, from the helper's signature as written, each return of the function in the chunk (not of
// its function literals) and each break or continue that leaves the chunk to its natural end. Any other jump out
// of the chunk is a problem. The temporaries of a multi-value `return f()` are named as the helper names them.
func (w *bodyWriter) returnEdits() {
	actual := returnsOf(w.d.Body)
	site := 0
	h := w.d.Name.Name
	for _, s := range w.c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.FuncLit:
				return false
			case *ast.ReturnStmt:
				var temps *ast.ReturnStmt
				if site < len(actual) {
					temps = actual[site]
				}
				site++
				if r := n; !w.sig.Tail || (len(r.Results) == 0 && len(w.namedResults()) > 0) {
					w.edit(r, func() []piece { return w.ret(r, temps) })
				}
			case *ast.BranchStmt:
				target := w.ck.branchTarget(n)
				if target != nil && w.c.Contains(target) {
					break
				}
				if !w.naturalJump(n, target) {
					word := n.Tok.String()
					if n.Label != nil {
						word += " " + n.Label.Name
					}
					w.problems = append(w.problems, fmt.Sprintf("%s: %s at line %d leaves the chunk.", h, word, w.ck.bt.Line(n.Pos())))
					break
				}
				site++
				b := n
				w.edit(b, func() []piece { return w.naturalReturn(b.Pos()) })
			}
			return true
		})
	}
}

// returnsOf lists a body's returns outside function literals, in order.
func returnsOf(body *ast.BlockStmt) []*ast.ReturnStmt {
	var out []*ast.ReturnStmt
	ast.Inspect(body, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.FuncLit:
			return false
		case *ast.ReturnStmt:
			out = append(out, n)
		}
		return true
	})
	return out
}

// naturalJump: a break to the switch or select owning the chunk's clause, or a continue of the loop whose body is
// the chunk's block, when the chunk ends that clause or body.
func (w *bodyWriter) naturalJump(b *ast.BranchStmt, target ast.Node) bool {
	if target == nil || w.c.Last != len(w.c.Block.List)-1 {
		return false
	}
	bt := w.ck.bt
	switch b.Tok {
	case token.BREAK:
		switch w.c.Block.Owner.(type) {
		case *ast.CaseClause, *ast.CommClause:
			return bt.Parent(bt.Parent(w.c.Block.Owner)) == target
		}
	case token.CONTINUE:
		switch l := target.(type) {
		case *ast.ForStmt:
			return ast.Node(l.Body) == w.c.Block.Owner
		case *ast.RangeStmt:
			return ast.Node(l.Body) == w.c.Block.Owner
		}
	}
	return false
}

// branchTarget is the statement a jump of the original leaves to (a goto's labeled statement, a fallthrough's
// clause), or nil.
func (ck *checker) branchTarget(s *ast.BranchStmt) ast.Node {
	bt := ck.bt
	if s.Tok == token.FALLTHROUGH {
		return bt.Parent(s)
	}
	if s.Label != nil {
		obj := bt.L.Info.Uses[s.Label]
		var found *ast.LabeledStmt
		ast.Inspect(bt.Func.Body, func(n ast.Node) bool {
			if ls, ok := n.(*ast.LabeledStmt); ok && bt.L.Info.Defs[ls.Label] == obj {
				found = ls
			}
			return found == nil
		})
		if found == nil || s.Tok == token.GOTO {
			return found
		}
		return found.Stmt
	}
	for n := bt.Parent(s); n != nil; n = bt.Parent(n) {
		switch n.(type) {
		case *ast.FuncLit:
			return nil
		case *ast.ForStmt, *ast.RangeStmt:
			return n
		case *ast.SwitchStmt, *ast.TypeSwitchStmt, *ast.SelectStmt:
			if s.Tok == token.BREAK {
				return n
			}
		}
	}
	return nil
}

// ret is one rewritten return: the outputs' zero values and true before the values when the helper returns, the named results
// for a bare return, and a multi-value call first assigned to the helper's temporaries.
func (w *bodyWriter) ret(r *ast.ReturnStmt, actual *ast.ReturnStmt) []piece {
	var vals [][]piece
	var prefix []piece
	named := w.namedResults()
	switch {
	case len(r.Results) == 0 && len(named) > 0:
		for _, obj := range named {
			vals = append(vals, w.valueOf(obj))
		}
	case len(r.Results) == 1 && len(w.funcResults()) > 1:
		n := len(w.funcResults())
		for k := 0; k < n; k++ {
			name := "r" + strconv.Itoa(k)
			if actual != nil && len(actual.Results) >= n {
				if id, ok := actual.Results[len(actual.Results)-n+k].(*ast.Ident); ok {
					name = id.Name
				}
			}
			vals = append(vals, []piece{genIdent(name, origin{kind: freshName})})
			if k > 0 {
				prefix = append(prefix, gen(", "))
			}
			prefix = append(prefix, genIdent(name, origin{kind: freshName}))
		}
		prefix = append(prefix, gen(" := "))
		prefix = append(prefix, w.render(w.ck.bt.Offset(r.Results[0].Pos()), w.ck.bt.Offset(r.Results[0].End()))...)
		prefix = append(prefix, gen("\n"))
	default:
		for _, e := range r.Results {
			vals = append(vals, w.render(w.ck.bt.Offset(e.Pos()), w.ck.bt.Offset(e.End())))
		}
	}
	var parts [][]piece
	if !w.sig.Tail {
		// The caller returns at once: the outputs are dead, so zero values.
		for _, o := range w.sig.Outputs {
			if o.Local == nil {
				parts = append(parts, []piece{genIdent(o.Name, origin{kind: standsFor})})
				continue
			}
			parts = append(parts, []piece{gen(w.zero(o.Local.Type(), r.Pos()))})
		}
		if w.sig.Returns {
			parts = append(parts, []piece{gen("true")})
		}
	}
	return append(prefix, returnPieces(append(parts, vals...))...)
}

// naturalReturn is the return that ends the helper at position at: the outputs, then false and zero values when
// the helper returns.
func (w *bodyWriter) naturalReturn(at token.Pos) []piece {
	parts := w.slots(at)
	if w.sig.Returns {
		parts = append(parts, []piece{gen("false")})
		for _, typ := range w.funcResults() {
			parts = append(parts, []piece{gen(w.zero(typ, at))})
		}
	}
	return returnPieces(parts)
}

// slots are the output slots of a return at position at: each output's name once the helper has it there (a
// parameter, a named result, or past the chunk's top-level declaration of it), else its zero value.
func (w *bodyWriter) slots(at token.Pos) [][]piece {
	var out [][]piece
	for _, o := range w.sig.Outputs {
		if o.Local != nil && w.declaredAfter(o, at) {
			out = append(out, []piece{gen(w.zero(o.Local.Type(), at))})
			continue
		}
		out = append(out, []piece{genIdent(o.Name, origin{kind: standsFor, obj: o.Local})})
	}
	return out
}

func (w *bodyWriter) declaredAfter(o sigOutput, at token.Pos) bool {
	if o.Chunk {
		return o.Local.Pos() > at
	}
	if w.sig.Named[o.Name] {
		return false
	}
	for _, p := range w.sig.Params {
		if p.Name == o.Name {
			return false
		}
	}
	for _, s := range w.c.Stmts() {
		if as, ok := s.(*ast.AssignStmt); ok && as.Tok == token.DEFINE {
			for _, l := range as.Lhs {
				if id, ok := l.(*ast.Ident); ok && id.Name == o.Name {
					return id.Pos() > at
				}
			}
		}
	}
	return false
}

// zero is a type's zero value as the original's file writes it at position at; a problem when it cannot.
func (w *bodyWriter) zero(typ types.Type, at token.Pos) string {
	text, err := w.ck.bt.ZeroText(typ, at)
	if err != nil {
		w.problems = append(w.problems, w.d.Name.Name+": "+err.Error())
	}
	return text
}

// valueOf is a local's value in the helper: (*x) for one passed by pointer.
func (w *bodyWriter) valueOf(obj types.Object) []piece {
	id := genIdent(obj.Name(), origin{kind: standsFor, obj: obj})
	if w.ptr[obj] {
		return []piece{gen("(*"), id, gen(")")}
	}
	return []piece{id}
}

// namedResults are the original function's named results; funcResults its result types.
func (w *bodyWriter) namedResults() []types.Object {
	var out []types.Object
	if res := w.ck.bt.Func.Type.Results; res != nil {
		for _, f := range res.List {
			for _, id := range f.Names {
				out = append(out, w.ck.bt.L.Info.Defs[id])
			}
		}
	}
	return out
}

func (w *bodyWriter) funcResults() []types.Type {
	var out []types.Type
	sig := w.ck.bt.L.Info.Defs[w.ck.bt.Func.Name].Type().(*types.Signature)
	for k := 0; k < sig.Results().Len(); k++ {
		out = append(out, sig.Results().At(k).Type())
	}
	return out
}

func returnPieces(parts [][]piece) []piece {
	out := []piece{gen("return")}
	for k, p := range parts {
		if k == 0 {
			out = append(out, gen(" "))
		} else {
			out = append(out, gen(", "))
		}
		out = append(out, p...)
	}
	return out
}
