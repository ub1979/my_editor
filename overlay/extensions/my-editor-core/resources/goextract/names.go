package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"path/filepath"
	"sort"
	"strconv"
	"unicode"
	"unicode/utf8"
)

// NameProblemsEach applies rule 8 to the plan's helper names, per name in plan order: each must be a lower-case Go
// identifier that is not `_`, `init` or `main`, unique in the plan (a repeated name's problem goes to its second
// use), and fresh: declared in no scope of the function, not by the package, its imports or its test files, not
// predeclared, not a field or method of the receiver's type, not a method of an interface of the package (a new
// method could make a type satisfy it), nor used as an identifier anywhere in the package.
func NameProblemsEach(t *Target, names []string) [][]string {
	out := make([][]string, len(names))
	seen := map[string]int{}
	for i, name := range names {
		seen[name]++
		if seen[name] == 2 {
			out[i] = append(out[i], fmt.Sprintf("%s is named twice.", name))
		}
		if seen[name] > 1 {
			continue
		}
		if problem := nameShape(name); problem != "" {
			out[i] = append(out[i], problem)
		} else if why := takenBy(t, name); why != "" {
			out[i] = append(out[i], fmt.Sprintf("%s is not a fresh name: %s.", name, why))
		} else if r, _ := utf8.DecodeRuneInString(name); !unicode.IsLower(r) {
			out[i] = append(out[i], strconv.Quote(name)+" must start with a lower-case letter.")
		}
	}
	return out
}

// nameShape says why a name cannot name a helper at all, or "". The case of its first letter is checked after
// freshness, so a name the package already declares is reported as taken.
func nameShape(name string) string {
	q := strconv.Quote(name)
	switch {
	case !token.IsIdentifier(name):
		if token.IsKeyword(name) {
			return q + " is a Go keyword."
		}
		return q + " is not a Go identifier."
	case name == "_" || name == "init" || name == "main":
		return q + " cannot name a helper."
	}
	return ""
}

// takenBy says what already uses a name, or "".
func takenBy(t *Target, name string) string {
	if obj := funcScopesLookup(t, name); obj != nil {
		return fmt.Sprintf("%s declares it (line %d)", t.Func.Name.Name, t.Line(obj.Pos()))
	}
	if t.L.Pkg.Scope().Lookup(name) != nil {
		return "the package declares it"
	}
	if file := importedBy(t, name); file != "" {
		return file + " imports it"
	}
	if t.L.TestNames[name] {
		return "a test file of the package declares it"
	}
	if types.Universe.Lookup(name) != nil {
		return "it is predeclared"
	}
	if why := receiverMember(t, name); why != "" {
		return why
	}
	if why := interfaceMethod(t, name); why != "" {
		return why
	}
	return usedAnywhere(t, name)
}

// usedAnywhere says where the package's files first use an identifier called name (a selector, a field, a method
// of an anonymous interface…), or "": a new method so named could be promoted into another type or satisfy an
// interface it does not satisfy now.
func usedAnywhere(t *Target, name string) string {
	for i, file := range t.L.Files {
		var at *ast.Ident
		ast.Inspect(file, func(n ast.Node) bool {
			if id, ok := n.(*ast.Ident); ok && id.Name == name && at == nil {
				at = id
			}
			return at == nil
		})
		if at != nil {
			return fmt.Sprintf("the package uses it (%s line %d)", filepath.Base(t.L.Paths[i]), t.L.Fset.Position(at.Pos()).Line)
		}
	}
	if t.L.TestIdents[name] {
		return "a test file of the package uses it"
	}
	return ""
}

// importedBy is the first file of the package whose imports declare name, or "".
func importedBy(t *Target, name string) string {
	for i, f := range t.L.Files {
		if s := t.L.Info.Scopes[f]; s != nil && s.Lookup(name) != nil {
			return filepath.Base(t.L.Paths[i])
		}
	}
	return ""
}

// funcScopesLookup is the earliest object called name in any scope of the function, function literals included.
func funcScopesLookup(t *Target, name string) types.Object {
	var found types.Object
	var walk func(s *types.Scope)
	walk = func(s *types.Scope) {
		if obj := s.Lookup(name); obj != nil && (found == nil || obj.Pos() < found.Pos()) {
			found = obj
		}
		for i := 0; i < s.NumChildren(); i++ {
			walk(s.Child(i))
		}
	}
	if s := t.L.Info.Scopes[t.Func.Type]; s != nil {
		walk(s)
	}
	return found
}

// receiverMember says which field or method of the receiver's type (T and *T, promoted ones included) is called
// name, or "".
func receiverMember(t *Target, name string) string {
	if t.Func.Recv == nil || len(t.Func.Recv.List) == 0 {
		return ""
	}
	typ := t.L.Info.TypeOf(t.Func.Recv.List[0].Type)
	if p, ok := typ.(*types.Pointer); ok {
		typ = p.Elem()
	}
	named, ok := typ.(*types.Named)
	if !ok {
		return ""
	}
	obj, index, _ := types.LookupFieldOrMethod(types.NewPointer(named), true, t.L.Pkg, name)
	if obj == nil {
		return ""
	}
	kind := "method"
	if v, ok := obj.(*types.Var); ok && v.IsField() {
		kind = "field"
	}
	why := fmt.Sprintf("%s has a %s %s", named.Obj().Name(), kind, name)
	if len(index) > 1 {
		why += fmt.Sprintf(" (promoted from %s)", embeddedAt(named, index[:len(index)-1]))
	}
	return why
}

// embeddedAt is the name of the embedded field that an index path through struct fields reaches.
func embeddedAt(typ types.Type, path []int) string {
	name := ""
	for _, i := range path {
		if p, ok := typ.Underlying().(*types.Pointer); ok {
			typ = p.Elem()
		}
		st, ok := typ.Underlying().(*types.Struct)
		if !ok {
			return name
		}
		f := st.Field(i)
		name, typ = f.Name(), f.Type()
	}
	return name
}

// interfaceMethod says which interface declared at the package level has a method called name, or "".
func interfaceMethod(t *Target, name string) string {
	scope := t.L.Pkg.Scope()
	names := scope.Names()
	sort.Strings(names)
	for _, n := range names {
		tn, ok := scope.Lookup(n).(*types.TypeName)
		if !ok {
			continue
		}
		iface, ok := tn.Type().Underlying().(*types.Interface)
		if !ok {
			continue
		}
		for i := 0; i < iface.NumMethods(); i++ {
			if iface.Method(i).Name() == name {
				return fmt.Sprintf("it is a method of the interface %s in this package", n)
			}
		}
	}
	return ""
}

// Plumbing is want, or want with the smallest digit suffix, such that no scope of the function, the package, a
// file's imports, the universe or taken (parameters and chunk declarations) has it. Avoiding the package and the universe keeps a `var`
// line of the call block from shadowing a name the rest of its block uses.
func Plumbing(t *Target, taken map[string]bool, want string) string {
	free := func(name string) bool {
		return !taken[name] && funcScopesLookup(t, name) == nil && t.L.Pkg.Scope().Lookup(name) == nil && types.Universe.Lookup(name) == nil &&
			importedBy(t, name) == ""
	}
	if free(want) {
		return want
	}
	for i := 1; ; i++ {
		if name := want + strconv.Itoa(i); free(name) {
			return name
		}
	}
}
