package main

import (
	"go/ast"
	"go/token"
)

// maxLines is the line limit for every file and function.
const maxLines = 400

// splitHeaderLines is what a split puts before a new file's package clause: a comment naming the original, a blank line.
const splitHeaderLines = 2

// FunctionBudget is the most lines a refactored function may keep so that a split can then give it a file of its own:
// the limit less the split's header, the file's lines up to its imports (license, package clause, imports) and the
// blank line after them.
func FunctionBudget(fset *token.FileSet, file *ast.File) int {
	header := fset.Position(file.Package).Line
	for _, decl := range file.Decls {
		g, ok := decl.(*ast.GenDecl)
		if !ok || g.Tok != token.IMPORT {
			break
		}
		header = fset.Position(g.End()).Line
	}
	return maxLines - splitHeaderLines - header - 1
}
