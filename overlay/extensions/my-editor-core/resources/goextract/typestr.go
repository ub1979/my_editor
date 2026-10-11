package main

import (
	"errors"
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
)

// TypeText writes a variable's type as the file names it (rule 9): the source text of its declared type when it has
// one (a parameter, result or `var x T`; a variadic `...T` is written `[]T`), else the type with the file's own import
// names. Every package name and unqualified type name it uses must still mean the same thing at `at`.
func (t *Target) TypeText(obj types.Object, at token.Pos) (string, error) {
	if expr, variadic := t.declaredType(obj); expr != nil {
		if err := t.checkTypeExpr(expr, at); err != nil {
			return "", err
		}
		text := string(t.Src[t.Offset(expr.Pos()):t.Offset(expr.End())])
		if variadic {
			text = "[]" + text
		}
		return text, nil
	}
	return t.typeString(obj.Type(), at)
}

// ZeroText writes the zero value of a type at `at`: 0, "", false, nil, or T{} for struct and array types.
func (t *Target) ZeroText(typ types.Type, at token.Pos) (string, error) {
	if _, ok := types.Unalias(typ).(*types.TypeParam); ok {
		return "", fmt.Errorf("%s is a type parameter.", typ)
	}
	switch u := typ.Underlying().(type) {
	case *types.Basic:
		switch {
		case u.Info()&types.IsBoolean != 0:
			return "false", nil
		case u.Info()&types.IsString != 0:
			return `""`, nil
		case u.Info()&types.IsNumeric != 0:
			return "0", nil
		}
		return "nil", nil
	case *types.Struct, *types.Array:
		text, err := t.typeString(typ, at)
		if err != nil {
			return "", err
		}
		return text + "{}", nil
	}
	return "nil", nil
}

// declaredType is the type expression that declares obj in the function, if any, and whether it is variadic.
func (t *Target) declaredType(obj types.Object) (ast.Expr, bool) {
	var found ast.Expr
	variadic := false
	declares := func(names []*ast.Ident) bool {
		for _, id := range names {
			if id.Pos() == obj.Pos() {
				return true
			}
		}
		return false
	}
	ast.Inspect(t.Func, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.Field:
			if declares(n.Names) {
				found = n.Type
				if e, ok := n.Type.(*ast.Ellipsis); ok {
					found, variadic = e.Elt, true
				}
			}
		case *ast.ValueSpec:
			if n.Type != nil && declares(n.Names) {
				found = n.Type
			}
		}
		return found == nil
	})
	return found, variadic
}

// checkTypeExpr checks that each package name and unqualified type name of a type expression resolves at `at` to
// what it resolves to where it is written, and that no type is local to the function.
func (t *Target) checkTypeExpr(expr ast.Expr, at token.Pos) error {
	var err error
	ast.Inspect(expr, func(n ast.Node) bool {
		if err != nil {
			return false
		}
		switch n := n.(type) {
		case *ast.SelectorExpr:
			if id, ok := n.X.(*ast.Ident); ok {
				if pn, ok := t.L.Info.Uses[id].(*types.PkgName); ok {
					err = t.resolves(id.Name, pn, at)
					return false
				}
			}
		case *ast.Ident:
			if tn, ok := t.L.Info.Uses[n].(*types.TypeName); ok {
				err = t.checkTypeName(tn, at)
			}
		}
		return true
	})
	return err
}

// typeString writes a type with the file's import names, after checking every name it uses.
func (t *Target) typeString(typ types.Type, at token.Pos) (string, error) {
	var err error
	walkTypeNames(typ, map[types.Type]bool{}, func(tn *types.TypeName) {
		if err == nil {
			err = t.checkTypeName(tn, at)
		}
	})
	if err != nil {
		return "", err
	}
	return types.TypeString(typ, func(p *types.Package) string {
		if p == t.L.Pkg {
			return ""
		}
		if name, _ := t.importName(p); name != "." {
			return name
		}
		return ""
	}), nil
}

// checkTypeName checks one named type: not local to the function, exported when another package's, imported by the
// file, and resolving at `at` (its package name, or its own name when unqualified).
func (t *Target) checkTypeName(tn *types.TypeName, at token.Pos) error {
	p := tn.Pkg()
	switch {
	case p == nil:
		return t.resolves(tn.Name(), tn, at)
	case p == t.L.Pkg:
		if tn.Parent() != p.Scope() {
			return fmt.Errorf("%s is declared inside %s.", tn.Name(), t.Func.Name.Name)
		}
		return t.resolves(tn.Name(), tn, at)
	case !tn.Exported():
		return fmt.Errorf("%s.%s is not exported by %s.", p.Name(), tn.Name(), p.Path())
	}
	name, pn := t.importName(p)
	switch name {
	case "":
		return fmt.Errorf("%s.%s: this file does not import %s.", p.Name(), tn.Name(), p.Path())
	case ".":
		return t.resolves(tn.Name(), tn, at)
	}
	return t.resolves(name, pn, at)
}

// importName is the name the file imports package p under ("." for a dot import), and its object; "" when the file
// does not import p.
func (t *Target) importName(p *types.Package) (string, *types.PkgName) {
	for _, spec := range t.File.Imports {
		var obj types.Object
		if spec.Name != nil {
			obj = t.L.Info.Defs[spec.Name]
		} else {
			obj = t.L.Info.Implicits[spec]
		}
		if pn, ok := obj.(*types.PkgName); ok && pn.Imported() == p && pn.Name() != "_" {
			return pn.Name(), pn
		}
	}
	return "", nil
}

// resolves checks that name means want at `at`.
func (t *Target) resolves(name string, want types.Object, at token.Pos) error {
	scope := t.L.Pkg.Scope().Innermost(at)
	if scope == nil {
		scope = t.L.Info.Scopes[t.File]
	}
	_, got := scope.LookupParent(name, at)
	switch {
	case got == want:
		return nil
	case got != nil && got.Pos().IsValid():
		return fmt.Errorf("%s is shadowed at line %d.", name, t.Line(got.Pos()))
	}
	return errors.New(name + " does not name the same thing at line " + fmt.Sprint(t.Line(at)) + ".")
}

// walkTypeNames calls f for each named type a type is written with: named types and aliases (with their type
// arguments) and predeclared basic types, through composite types but never into a named type's definition.
func walkTypeNames(typ types.Type, seen map[types.Type]bool, f func(*types.TypeName)) {
	if seen[typ] {
		return
	}
	seen[typ] = true
	switch x := typ.(type) {
	case *types.Basic:
		if obj, ok := types.Universe.Lookup(x.Name()).(*types.TypeName); ok {
			f(obj)
		}
	case *types.Alias:
		f(x.Obj())
	case *types.Named:
		f(x.Obj())
		for i := 0; i < x.TypeArgs().Len(); i++ {
			walkTypeNames(x.TypeArgs().At(i), seen, f)
		}
	case *types.Pointer:
		walkTypeNames(x.Elem(), seen, f)
	case *types.Slice:
		walkTypeNames(x.Elem(), seen, f)
	case *types.Array:
		walkTypeNames(x.Elem(), seen, f)
	case *types.Chan:
		walkTypeNames(x.Elem(), seen, f)
	case *types.Map:
		walkTypeNames(x.Key(), seen, f)
		walkTypeNames(x.Elem(), seen, f)
	case *types.Signature:
		for _, tup := range []*types.Tuple{x.Params(), x.Results()} {
			for i := 0; i < tup.Len(); i++ {
				walkTypeNames(tup.At(i).Type(), seen, f)
			}
		}
	case *types.Struct:
		for i := 0; i < x.NumFields(); i++ {
			walkTypeNames(x.Field(i).Type(), seen, f)
		}
	case *types.Interface:
		for i := 0; i < x.NumExplicitMethods(); i++ {
			walkTypeNames(x.ExplicitMethod(i).Type(), seen, f)
		}
		for i := 0; i < x.NumEmbeddeds(); i++ {
			walkTypeNames(x.EmbeddedType(i), seen, f)
		}
	}
}
