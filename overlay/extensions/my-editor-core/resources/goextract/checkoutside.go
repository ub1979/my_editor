package main

import (
	"fmt"
	"go/ast"
	"go/token"
)

// outside is check 1 and 5: the files are equal token by token once each chunk and its call block are the same
// marker and the helpers are removed.
func (ck *checker) outside() []string {
	var beforeCuts, afterCuts []Cut
	for i, c := range ck.chunks {
		mark := fmt.Sprintf("⟨chunk %d⟩", i)
		beforeCuts = append(beforeCuts, Cut{c.Start, c.End, mark})
		afterCuts = append(afterCuts, Cut{ck.sites[i].Start, ck.sites[i].End, mark})
	}
	for _, d := range ck.decls {
		start, end := WholeLines(ck.at.Src, ck.at.Offset(declStart(d)), ck.at.Offset(d.End()))
		afterCuts = append(afterCuts, Cut{start, end, ""})
	}
	want := ScanTokens(ck.bt.Src, beforeCuts)
	got := ScanTokens(ck.at.Src, afterCuts)
	i := FirstDiff(want, got)
	if i < 0 {
		return nil
	}
	return []string{fmt.Sprintf("Outside the chunks, %s changed near line %d: expected %s, found %s.",
		ck.file, LineAt(got, i), TokAt(want, i), TokAt(got, i))}
}

// declStart is where a declaration starts, its doc comment included.
func declStart(d *ast.FuncDecl) token.Pos {
	if d.Doc != nil {
		return d.Doc.Pos()
	}
	return d.Pos()
}

// placement: each helper follows the function directly, in chunk order, with exactly its doc comment.
func (ck *checker) placement() []string {
	fn := ck.at.Func.Name.Name
	at := -1
	for i, decl := range ck.at.File.Decls {
		if decl == ast.Decl(ck.at.Func) {
			at = i
		}
	}
	var problems []string
	for i, d := range ck.decls {
		k := at + 1 + i
		doc := fmt.Sprintf("// %s is part of %s, extracted by my_editor.", d.Name.Name, fn)
		if k >= len(ck.at.File.Decls) || ck.at.File.Decls[k] != ast.Decl(d) || d.Doc == nil || len(d.Doc.List) != 1 || d.Doc.List[0].Text != doc {
			problems = append(problems, fmt.Sprintf("%s is not right after %s in chunk order.", d.Name.Name, fn))
		}
	}
	return problems
}
