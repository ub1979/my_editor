package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/format"
	"go/token"
	"path/filepath"
	"sort"
	"strings"
)

// checker holds both loads of one extract check: the function before (bt) and after (at), each chunk of the
// original, and each helper's declaration and call block in the new file.
type checker struct {
	bt, at *Target
	file   string
	chunks []Chunk
	decls  []*ast.FuncDecl
	sites  []CallSite
}

// Check verifies the written file against the original. Empty means it passed. It uses only where the chunks are
// (built's names and lines); everything else is read from the file as written.
func Check(list, pkg, path, fn, recv string, before, after []byte, built BuildResult) []string {
	switch {
	case len(built.Problems) > 0:
		return []string{"The build reported problems, so there is nothing to check: " + strings.Join(built.Problems, " ")}
	case len(built.Helpers) == 0:
		return []string{"The build reported no helpers, so there is nothing to check."}
	}
	path = filepath.Clean(path)
	ck := &checker{file: filepath.Base(path)}
	if problem := ck.load(list, pkg, path, fn, recv, before, after); problem != "" {
		return []string{problem}
	}
	problems := []string{}
	if out, err := format.Source(after); err != nil || !bytes.Equal(out, after) {
		problems = append(problems, fmt.Sprintf("gofmt would change %s.", ck.file))
	}
	if more := ck.locate(built); len(more) > 0 {
		return append(problems, more...)
	}
	problems = append(problems, ck.outside()...)
	problems = append(problems, ck.placement()...)
	for i := range ck.decls {
		problems = append(problems, ck.helperProblems(i)...)
	}
	return problems
}

// load type-checks the package with the original file, then with the written one, and finds the function in each; it
// says why it cannot, or that the function is out of scope (generic, or with a //go: line).
func (ck *checker) load(list, pkg, path, fn, recv string, before, after []byte) string {
	bl, err := Load(list, pkg, map[string][]byte{path: before})
	if err != nil {
		return "the original does not load: " + err.Error()
	}
	if ck.bt, err = FindFunc(bl, path, fn, recv); err != nil {
		return err.Error()
	}
	if ck.bt.Generic() {
		return fn + " is generic."
	}
	if d := ck.bt.Directive(); d != "" {
		return fmt.Sprintf("%s has a %s line.", fn, d)
	}
	al, err := Load(list, pkg, map[string][]byte{path: after})
	if err != nil {
		if msg := err.Error(); !strings.HasPrefix(msg, "the package does not type-check") {
			return "the package does not type-check: " + msg
		}
		return err.Error()
	}
	if ck.at, err = FindFunc(al, path, fn, recv); err != nil {
		return err.Error()
	}
	return ""
}

// helperProblems are the name and statement checks, and checks 2, 3 and 4, for one helper, read from its signature
// and call block as written.
func (ck *checker) helperProblems(i int) []string {
	sig := ck.readSig(i)
	problems := append(ck.nameCheck(i), ck.stmtCheck(i)...)
	problems = append(problems, sig.Problems...)
	problems = append(problems, ck.blockCheck(i, sig)...)
	pairs, more := ck.bodyCheck(i, sig)
	problems = append(problems, more...)
	if len(more) == 0 {
		problems = append(problems, ck.alphaCheck(i, sig, pairs)...)
	}
	return append(problems, ck.safeCheck(i, sig, pairs)...)
}

// locate resolves each chunk in the original, in line order, and finds each helper and its call block in the new
// file. Chunks may not overlap or nest, and helpers may not share a name.
func (ck *checker) locate(built BuildResult) []string {
	helpers := append([]HelperFact{}, built.Helpers...)
	sort.SliceStable(helpers, func(a, b int) bool { return helpers[a].From < helpers[b].From })
	var problems []string
	named := map[string]int{}
	for k, h := range helpers {
		if named[h.Name]++; named[h.Name] == 2 {
			problems = append(problems, h.Name+" is named twice.")
		}
		for _, later := range helpers[k+1:] {
			if later.From <= h.To {
				problems = append(problems, fmt.Sprintf("%s (lines %d–%d) overlaps %s (lines %d–%d).", h.Name, h.From, h.To, later.Name, later.From, later.To))
			}
		}
	}
	for _, h := range helpers {
		c, problem := ck.bt.ResolveChunk(h.Name, h.From, h.To)
		if problem != "" {
			problems = append(problems, h.Name+": "+problem)
		}
		d := ck.helperDecl(h.Name)
		if d == nil {
			problems = append(problems, fmt.Sprintf("%s is not in %s.", h.Name, ck.file))
		}
		ck.chunks, ck.decls = append(ck.chunks, c), append(ck.decls, d)
	}
	if len(problems) > 0 {
		return problems
	}
	ck.sites, problems = FindCallSites(ck.at, ck.decls, ck.role)
	return problems
}

// role says what a name helper i's call block assigns was at the start of its chunk in the original.
func (ck *checker) role(i int, name string) Role {
	if _, chunk := ck.outputLocal(ck.chunks[i], name); chunk {
		return RoleChunk
	}
	if ck.lookupLocal(ck.chunks[i], name) != nil {
		return RoleOuter
	}
	return RolePlumbing
}

// helperDecl is the new file's function named name, or the method of that name on the function's receiver type.
func (ck *checker) helperDecl(name string) *ast.FuncDecl {
	for _, decl := range ck.at.File.Decls {
		d, ok := decl.(*ast.FuncDecl)
		if !ok || d.Name.Name != name || d.Body == nil {
			continue
		}
		if d.Recv == nil || (ck.at.Func.Recv != nil && recvBase(d.Recv.List[0].Type) == recvBase(ck.at.Func.Recv.List[0].Type)) {
			return d
		}
	}
	return nil
}

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
