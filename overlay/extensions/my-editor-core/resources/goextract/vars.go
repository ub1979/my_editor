package main

import (
	"go/ast"
	"go/types"
	"sort"
)

// Ref is one identifier and the object it denotes; Def is set where the identifier declares it.
type Ref struct {
	Id  *ast.Ident
	Obj types.Object
	Def bool
}

// IsLocal reports a variable of the function, not a field: its receiver, a parameter or result, or declared in its
// body (function literals included).
func (t *Target) IsLocal(obj types.Object) bool {
	v, ok := obj.(*types.Var)
	if !ok || v.IsField() {
		return false
	}
	fs := t.L.Info.Scopes[t.Func.Type]
	for s := v.Parent(); s != nil; s = s.Parent() {
		if s == fs {
			return true
		}
	}
	return false
}

// Outer reports an outer local of the chunk: a local of the function declared before the chunk in a block that
// encloses it (the function's own scope included).
func (t *Target) Outer(c Chunk, obj types.Object) bool {
	if !t.IsLocal(obj) || t.Offset(obj.Pos()) >= c.Start {
		return false
	}
	for s := t.BlockScope(c.Block); s != nil; s = s.Parent() {
		if s == obj.Parent() {
			return true
		}
	}
	return false
}

// OuterLocals lists every outer local of the chunk, referenced or not, in declaration order.
func (t *Target) OuterLocals(c Chunk) []types.Object {
	var out []types.Object
	for id, obj := range t.L.Info.Defs {
		if obj != nil && id.Pos() >= t.Func.Pos() && id.End() <= t.Func.End() && t.Outer(c, obj) {
			out = append(out, obj)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Pos() < out[j].Pos() })
	return out
}

// BlockScope is the scope of a block's statements; the body's is the function's own scope.
func (t *Target) BlockScope(b Block) *types.Scope {
	if b.Owner == ast.Node(t.Func.Body) {
		return t.L.Info.Scopes[t.Func.Type]
	}
	return t.L.Info.Scopes[b.Owner]
}

// ValueRoot is the variable an operand is reached from through parentheses, fields of struct values and indexes of
// array values only, or nil when the path crosses a pointer, a slice, a map or a call.
func ValueRoot(info *types.Info, e ast.Expr) *ast.Ident {
	for {
		switch x := e.(type) {
		case *ast.ParenExpr:
			e = x.X
		case *ast.SelectorExpr:
			sel := info.Selections[x]
			if sel == nil || sel.Kind() != types.FieldVal || sel.Indirect() {
				return nil
			}
			e = x.X
		case *ast.IndexExpr:
			tv, ok := info.Types[x.X]
			if !ok {
				return nil
			}
			if _, isArray := tv.Type.Underlying().(*types.Array); !isArray {
				return nil
			}
			e = x.X
		case *ast.Ident:
			if _, ok := info.ObjectOf(x).(*types.Var); !ok {
				return nil
			}
			return x
		default:
			return nil
		}
	}
}

// ChunkDeclared lists the objects the chunk's statements declare, in source order: top in the chunk's own block,
// nested deeper (function literals included). Labels and struct fields are left out.
func (t *Target) ChunkDeclared(c Chunk) (top, nested []types.Object) {
	scope := t.BlockScope(c.Block)
	add := func(obj types.Object) {
		if obj == nil {
			return
		}
		if v, ok := obj.(*types.Var); ok && v.IsField() {
			return
		}
		switch obj.(type) {
		case *types.Label, *types.PkgName:
			return
		}
		if obj.Parent() == scope {
			top = append(top, obj)
		} else {
			nested = append(nested, obj)
		}
	}
	for _, s := range c.Stmts() {
		ast.Inspect(s, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.Ident:
				add(t.L.Info.Defs[n])
			case *ast.CaseClause:
				add(t.L.Info.Implicits[n])
			}
			return true
		})
	}
	return top, nested
}

// Refs lists the identifiers of the chunk that denote objects, in source order, outside function literals.
func (t *Target) Refs(c Chunk) []Ref { return t.refs(c, false) }

// LitRefs lists the identifiers inside the chunk's function literals that denote objects, in source order.
func (t *Target) LitRefs(c Chunk) []Ref { return t.refs(c, true) }

func (t *Target) refs(c Chunk, inLits bool) []Ref {
	var out []Ref
	for _, s := range c.Stmts() {
		depth := 0
		var stack []ast.Node
		ast.Inspect(s, func(n ast.Node) bool {
			if n == nil {
				if _, ok := stack[len(stack)-1].(*ast.FuncLit); ok {
					depth--
				}
				stack = stack[:len(stack)-1]
				return true
			}
			stack = append(stack, n)
			switch n := n.(type) {
			case *ast.FuncLit:
				depth++
			case *ast.Ident:
				if (depth > 0) != inLits {
					return true
				}
				if obj := t.L.Info.Defs[n]; obj != nil {
					out = append(out, Ref{Id: n, Obj: obj, Def: true})
				} else if obj := t.L.Info.Uses[n]; obj != nil {
					out = append(out, Ref{Id: n, Obj: obj})
				}
			}
			return true
		})
	}
	return out
}
