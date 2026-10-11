package main

import (
	"fmt"
	"go/ast"
	"go/types"
)

// alphaCheck is check 3 for one helper whose body matched: each identifier of the helper denotes what its
// counterpart in the chunk denotes. A global (package-level, imported, predeclared) object stays the same object; an
// outer local becomes the parameter, receiver or named result standing for it, or one variable the helper declares
// for it; a variable the chunk declares becomes one variable the helper declares, one to one; a field or method
// stays the same field or method of the same type.
func (ck *checker) alphaCheck(i int, sig helperSig, pairs []aligned) []string {
	d := ck.decls[i]
	h := d.Name.Name
	stand := ck.standIns(i, sig)
	toHelper := map[types.Object]types.Object{}
	fromHelper := map[types.Object]types.Object{}
	inHelper := func(obj types.Object) bool {
		return obj != nil && d.Body.Pos() <= obj.Pos() && obj.Pos() < d.Body.End()
	}
	var problems []string
	for _, p := range pairs {
		a := ck.at.L.Info.ObjectOf(p.id)
		var b types.Object
		switch p.o.kind {
		case fromChunk:
			if p.o.id != nil {
				b = ck.bt.L.Info.ObjectOf(p.o.id)
			}
		case standsFor:
			b = p.o.obj
		case freshName:
			if !inHelper(a) || fromHelper[a] != nil {
				problems = append(problems, fmt.Sprintf("%s: %s at line %d is not a fresh variable of %s.", h, p.id.Name, ck.at.Line(p.id.Pos()), h))
			}
			continue
		case globalName:
			if a == nil || !global(a) {
				problems = append(problems, ck.rebound(h, p.id, a, "a global name"))
			}
			continue
		}
		ok := true
		switch {
		case b == nil:
			ok = a == nil
		case ck.declaredInChunk(i, b):
			ok = inHelper(a) && (toHelper[b] == nil || toHelper[b] == a) && (fromHelper[a] == nil || fromHelper[a] == b)
			toHelper[b], fromHelper[a] = a, b
		case ck.funcLocal(b):
			ok = a != nil && (stand[a] == b || (inHelper(a) && a.Name() == b.Name())) && (toHelper[b] == nil || toHelper[b] == a)
			if ok && inHelper(a) {
				ok = fromHelper[a] == nil || fromHelper[a] == b
				toHelper[b], fromHelper[a] = a, b
			}
		default:
			ok = a != nil && sameObject(b, a)
		}
		if !ok {
			problems = append(problems, ck.rebound(h, p.id, a, ck.expected(i, b, sig)))
		}
	}
	return problems
}

// standIns maps the helper's parameters, receiver and named results to the locals of the original they stand for.
func (ck *checker) standIns(i int, sig helperSig) map[types.Object]types.Object {
	out := map[types.Object]types.Object{}
	for _, p := range sig.Params {
		if p.Local != nil {
			out[p.Obj] = p.Local
		}
	}
	if sig.Recv != nil {
		out[sig.Recv] = ck.receiver()
	}
	for _, r := range sig.Results {
		if sig.Named[r.Name()] {
			if local := ck.lookupLocal(ck.chunks[i], r.Name()); local != nil {
				out[r] = local
			}
		}
	}
	return out
}

// declaredInChunk reports an object the chunk declares (labels and type switch variables included).
func (ck *checker) declaredInChunk(i int, obj types.Object) bool {
	c := ck.chunks[i]
	switch obj.(type) {
	case *types.Var, *types.Label, *types.Const, *types.TypeName, *types.Func:
		off := ck.bt.Offset(obj.Pos())
		return obj.Pos().IsValid() && c.Start <= off && off < c.End && ck.bt.Func.Pos() <= obj.Pos() && obj.Pos() < ck.bt.Func.End()
	}
	return false
}

// global reports a predeclared, package-level or imported object, or an import name.
func global(obj types.Object) bool {
	if _, ok := obj.(*types.PkgName); ok {
		return true
	}
	if v, ok := obj.(*types.Var); ok && v.IsField() {
		return true
	}
	if f, ok := obj.(*types.Func); ok && f.Type().(*types.Signature).Recv() != nil {
		return true
	}
	return obj.Parent() == types.Universe || (obj.Pkg() != nil && obj.Parent() == obj.Pkg().Scope())
}

// sameObject compares a global object of the original with one of the new file: the same kind, package and name;
// for an import, the same package; for a field or method, the same type too.
func sameObject(b, a types.Object) bool {
	if !global(b) || !global(a) || fmt.Sprintf("%T", b) != fmt.Sprintf("%T", a) || b.Name() != a.Name() || pkgPath(b) != pkgPath(a) {
		return false
	}
	switch b := b.(type) {
	case *types.PkgName:
		return b.Imported().Path() == a.(*types.PkgName).Imported().Path()
	case *types.Var:
		return typeKey(b.Type()) == typeKey(a.Type())
	case *types.Func:
		return typeKey(b.Type()) == typeKey(a.Type()) && recvKey(b) == recvKey(a)
	}
	return (b.Parent() == types.Universe) == (a.Parent() == types.Universe)
}

// recvKey is a method's receiver type, or "" for a function.
func recvKey(f types.Object) string {
	if r := f.Type().(*types.Signature).Recv(); r != nil {
		return typeKey(r.Type())
	}
	return ""
}

func pkgPath(obj types.Object) string {
	if obj.Pkg() == nil {
		return ""
	}
	return obj.Pkg().Path()
}

// rebound is the problem of an identifier that resolves to the wrong object.
func (ck *checker) rebound(h string, id *ast.Ident, a types.Object, want string) string {
	return fmt.Sprintf("%s: %s at line %d resolves to %s, not %s.", h, id.Name, ck.at.Line(id.Pos()), ck.describe(a), want)
}

// describe names an object of the new file for a problem.
func (ck *checker) describe(a types.Object) string {
	switch {
	case a == nil:
		return "nothing"
	case a.Parent() == types.Universe:
		return "the predeclared " + a.Name()
	}
	if _, ok := a.(*types.PkgName); ok {
		return "the import " + a.Name()
	}
	if global(a) {
		if a.Pkg() != ck.at.L.Pkg {
			return fmt.Sprintf("%s's %s", pkgPath(a), a.Name())
		}
		return "the package's " + a.Name()
	}
	return fmt.Sprintf("the variable %s declared at line %d", a.Name(), ck.at.Line(a.Pos()))
}

// expected names what an identifier should resolve to, given the original's object.
func (ck *checker) expected(i int, b types.Object, sig helperSig) string {
	fn := ck.bt.Func.Name.Name
	switch {
	case b == nil:
		return "nothing"
	case ck.funcLocal(b):
		for _, p := range sig.Params {
			if p.Local == b {
				return fmt.Sprintf("the parameter for %s's %s", fn, b.Name())
			}
		}
		return fmt.Sprintf("a variable standing for %s's %s", fn, b.Name())
	case global(b):
		return "the same " + b.Name()
	case ck.declaredInChunk(i, b):
		return fmt.Sprintf("the helper's own %s for the chunk's (line %d)", b.Name(), ck.bt.Line(b.Pos()))
	}
	kind := "const"
	if _, ok := b.(*types.TypeName); ok {
		kind = "type"
	}
	return fmt.Sprintf("%s's %s %s (line %d)", fn, kind, b.Name(), ck.bt.Line(b.Pos()))
}
