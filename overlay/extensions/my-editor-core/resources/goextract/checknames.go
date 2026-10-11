package main

import (
	"fmt"
	"go/ast"
	"go/types"
	"path/filepath"
	"unicode"
	"unicode/utf8"
)

// nameCheck: helper i's name is fresh, so that nothing but its call changed meaning. Every identifier of the
// package's files that resolves to the helper is its declaration or its call; the name is not predeclared (a use
// elsewhere would now mean the helper), not used by the package's test files (which are not type-checked), not a
// method of an interface of the package, named or anonymous (a new method could satisfy it), and not exported (a
// new exported method could satisfy another package's interface).
func (ck *checker) nameCheck(i int) []string {
	d, site := ck.decls[i], ck.sites[i]
	h := d.Name.Name
	l := ck.at.L
	var problems []string
	notFresh := func(why string) { problems = append(problems, fmt.Sprintf("%s is not a fresh name: %s.", h, why)) }
	if r, _ := utf8.DecodeRuneInString(h); !unicode.IsLower(r) {
		problems = append(problems, h+" must start with a lower-case letter.")
	}
	if types.Universe.Lookup(h) != nil {
		notFresh("it is predeclared")
	}
	if l.TestNames[h] || l.TestIdents[h] {
		notFresh("a test file of the package uses it")
	}
	if at := interfaceMethodAt(ck.bt.L, h); at != "" {
		notFresh("it is a method of an interface of the package (" + at + ")")
	}
	obj, call := l.Info.Defs[d.Name], calleeIdent(site.Call)
	for k, file := range l.Files {
		ast.Inspect(file, func(n ast.Node) bool {
			if id, ok := n.(*ast.Ident); ok && id != call && l.Info.Uses[id] == obj {
				problems = append(problems, fmt.Sprintf("%s at line %d of %s now names the helper; only its call may.", h, l.Fset.Position(id.Pos()).Line,
					filepath.Base(l.Paths[k])))
			}
			return true
		})
	}
	return problems
}

// interfaceMethodAt is where the package's files first declare a method called name in an interface type, named or
// anonymous, or "".
func interfaceMethodAt(l *Loaded, name string) string {
	for k, file := range l.Files {
		at := ""
		ast.Inspect(file, func(n ast.Node) bool {
			if it, ok := n.(*ast.InterfaceType); ok && at == "" {
				for _, m := range it.Methods.List {
					for _, id := range m.Names {
						if id.Name == name && at == "" {
							at = fmt.Sprintf("%s line %d", filepath.Base(l.Paths[k]), l.Fset.Position(id.Pos()).Line)
						}
					}
				}
			}
			return at == ""
		})
		if at != "" {
			return at
		}
	}
	return ""
}
