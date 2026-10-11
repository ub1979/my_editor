package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
)

// safeCheck is check 4 on helper i's signature as written, with the checker's own predicates over the original
// function. A local that goes by value (a value parameter's, or an output's the helper keeps in a variable of its
// own) is never captured by a function literal of the function, never address-taken before or inside the chunk or
// anywhere in a loop around it, and not a named result of a function that defers. A pointer parameter is used only
// as (*x), as the operand of a selector that may stay a pointer, or bare where the chunk had &x.
func (ck *checker) safeCheck(i int, sig helperSig, pairs []aligned) []string {
	h := ck.decls[i].Name.Name
	var problems []string
	seen := map[types.Object]bool{}
	byValue := func(local types.Object) {
		if local == nil || seen[local] {
			return
		}
		seen[local] = true
		if why := ck.sharedWhy(i, local); why != "" {
			problems = append(problems, fmt.Sprintf("%s: %s goes by value, but %s.", h, local.Name(), why))
		}
	}
	for _, p := range sig.Params {
		if p.Pointer {
			problems = append(problems, ck.pointerUses(i, p, pairs)...)
		} else {
			byValue(p.Local)
		}
	}
	for _, o := range sig.Outputs {
		if !o.Chunk {
			byValue(o.Local)
		}
	}
	return append(problems, ck.flowCheck(i, sig)...)
}

// sharedWhy says why a local of the original must not go by value, or "".
func (ck *checker) sharedWhy(i int, local types.Object) string {
	fn := ck.bt.Func.Name.Name
	if ck.namedResult(local) && ck.defers() {
		return fmt.Sprintf("it is a named result of %s, which defers", fn)
	}
	if lit := ck.capturedAt(local); lit.IsValid() {
		return fmt.Sprintf("a function literal captures it (line %d)", ck.bt.Line(lit))
	}
	c := ck.chunks[i]
	loops := ck.loopsAround(c)
	for _, p := range ck.addressTaken(local) {
		inLoop := false
		for _, l := range loops {
			inLoop = inLoop || (l.Pos() <= p && p < l.End())
		}
		if p < c.EndPos() || inLoop {
			return fmt.Sprintf("%s address-takes it at line %d", fn, ck.bt.Line(p))
		}
	}
	return ""
}

// namedResult reports a named result of the original function; defers reports a defer in its body, outside
// function literals.
func (ck *checker) namedResult(obj types.Object) bool {
	if res := ck.bt.Func.Type.Results; res != nil {
		for _, f := range res.List {
			for _, id := range f.Names {
				if ck.bt.L.Info.Defs[id] == obj {
					return true
				}
			}
		}
	}
	return false
}

func (ck *checker) defers() bool {
	found := false
	ast.Inspect(ck.bt.Func.Body, func(n ast.Node) bool {
		switch n.(type) {
		case *ast.FuncLit:
			return false
		case *ast.DeferStmt:
			found = true
		}
		return !found
	})
	return found
}

// capturedAt is the first function literal of the original function that uses obj declared outside it.
func (ck *checker) capturedAt(obj types.Object) token.Pos {
	var at token.Pos
	ast.Inspect(ck.bt.Func.Body, func(n ast.Node) bool {
		lit, ok := n.(*ast.FuncLit)
		if !ok || at.IsValid() || (lit.Pos() <= obj.Pos() && obj.Pos() < lit.End()) {
			return !at.IsValid()
		}
		ast.Inspect(lit.Body, func(m ast.Node) bool {
			if id, ok := m.(*ast.Ident); ok && ck.bt.L.Info.Uses[id] == obj && !at.IsValid() {
				at = lit.Pos()
			}
			return !at.IsValid()
		})
		return !at.IsValid()
	})
	return at
}

// addressTaken lists where the original function takes obj's address: &x on it or on a field or array path from
// it, a pointer-receiver method or method value on such a path, or slicing an array path.
func (ck *checker) addressTaken(obj types.Object) []token.Pos {
	info := ck.bt.L.Info
	var out []token.Pos
	ast.Inspect(ck.bt.Func.Body, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.UnaryExpr:
			if n.Op == token.AND && ck.root(n.X) == obj {
				out = append(out, n.Pos())
			}
		case *ast.SelectorExpr:
			s := info.Selections[n]
			if s == nil || s.Kind() != types.MethodVal || s.Indirect() || ck.root(n.X) != obj {
				break
			}
			_, recvPtr := s.Obj().Type().(*types.Signature).Recv().Type().(*types.Pointer)
			_, xPtr := info.TypeOf(n.X).Underlying().(*types.Pointer)
			if recvPtr && !xPtr {
				out = append(out, n.Pos())
			}
		case *ast.SliceExpr:
			if _, ok := info.TypeOf(n.X).Underlying().(*types.Array); ok && ck.root(n.X) == obj {
				out = append(out, n.Pos())
			}
		}
		return true
	})
	return out
}

// root is the local an operand is a path of, through fields and array indexes without crossing a pointer, or nil.
func (ck *checker) root(e ast.Expr) types.Object {
	info := ck.bt.L.Info
	for {
		switch x := ast.Unparen(e).(type) {
		case *ast.Ident:
			return info.ObjectOf(x)
		case *ast.SelectorExpr:
			s := info.Selections[x]
			if s == nil || s.Kind() != types.FieldVal || s.Indirect() {
				return nil
			}
			e = x.X
		case *ast.IndexExpr:
			if _, ok := info.TypeOf(x.X).Underlying().(*types.Array); !ok {
				return nil
			}
			e = x.X
		default:
			return nil
		}
	}
}

// loopsAround are the original's for and range statements, outside function literals, that contain the chunk.
func (ck *checker) loopsAround(c Chunk) []ast.Stmt {
	var out []ast.Stmt
	ast.Inspect(ck.bt.Func.Body, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.FuncLit:
			return false
		case *ast.ForStmt, *ast.RangeStmt:
			if n.Pos() <= c.FirstPos() && c.EndPos() <= n.End() {
				out = append(out, n.(ast.Stmt))
			}
		}
		return true
	})
	return out
}

// pointerUses: every use of a pointer parameter in the helper as written is (*x), the operand of a selector that may
// stay a pointer, or bare where the chunk had &x (by the body's alignment when it matched, else by count).
func (ck *checker) pointerUses(i int, p sigParam, pairs []aligned) []string {
	d := ck.decls[i]
	info := ck.at.L.Info
	hadAmp := map[*ast.Ident]bool{}
	for _, a := range pairs {
		if a.o.kind == fromChunk && a.o.id != nil {
			u, isUnary := ck.bt.Parent(a.o.id).(*ast.UnaryExpr)
			hadAmp[a.id] = isUnary && u.Op == token.AND
		}
	}
	amps := 0
	for _, s := range ck.chunks[i].Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			if u, ok := n.(*ast.UnaryExpr); ok && u.Op == token.AND && ck.root(u.X) == p.Local {
				if _, isIdent := ast.Unparen(u.X).(*ast.Ident); isIdent {
					amps++
				}
			}
			return true
		})
	}
	elem := p.Obj.Type().(*types.Pointer).Elem()
	problem := ""
	var stack []ast.Node
	ast.Inspect(d.Body, func(n ast.Node) bool {
		if n == nil {
			stack = stack[:len(stack)-1]
			return false
		}
		if id, ok := n.(*ast.Ident); ok && problem == "" && info.Uses[id] == p.Obj {
			up := len(stack) - 1
			for up > 0 {
				if _, paren := stack[up].(*ast.ParenExpr); !paren {
					break
				}
				up--
			}
			switch u := stack[up].(type) {
			case *ast.StarExpr:
				return false
			case *ast.SelectorExpr:
				if u.X == ast.Expr(id) && keepsPointer(info.Selections[u], elem) {
					return false
				}
			}
			if amp, aligned := hadAmp[id]; amp || (!aligned && pairs == nil && amps > 0) {
				amps--
				return false
			}
			problem = fmt.Sprintf("%s: %s is passed by pointer but used without (*%s) at line %d.", d.Name.Name, p.Name, p.Name, ck.at.Line(id.Pos()))
		}
		stack = append(stack, n)
		return true
	})
	if problem == "" {
		return nil
	}
	return []string{problem}
}
