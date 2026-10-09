# AI-ready Stage 2a (Go fixes on a local branch) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the Stage 1 health report, Pair offers **Fix on a local branch**: the user picks fixes, approves the exact commands once, and my_editor splits long Go files (moving whole declarations, byte for byte) and adds Go tests on a new local branch in a worktree next to the project, one checked commit per fix, ending with a change note. Nothing is pushed and the user's folder is not touched.

**Architecture:** A language-neutral core (worktree, command runner, baseline and comparison, run state, Stop and Continue, fix picker, change note, step runner, split-plan validation and move rules 1–3 on byte spans) talks to one `LanguageAdapter` (`src/aiready/language.ts`). Go is the first adapter (`goAdapter.ts`), backed by a standard-library Go helper (`resources/goast/main.go`) built once with the user's Go. The core never imports Go modules; `languages.ts` picks the adapter. Pure modules are unit-tested with `node --test`; the helper has its own `go test`.

**Next adapters, in order:** TS/JS, Python, C#, Rust, then C/C++ (see the design's *Languages after Go*). Each is one new `<language>Adapter.ts` plus its rules, registered in `languages.ts`.

**Tech Stack:** TypeScript (strict, CommonJS), VS Code extension API, `node:test`, esbuild; Go standard library (`go/parser`, `go/ast`, `go/build/constraint`) for the helper; Git worktrees.

**Spec:** [`2026-10-07-ai-ready-design.md`](2026-10-07-ai-ready-design.md), *Stage 2a: Go* plus the shared Stage 2 parts it relies on (Safety net, worktree, run state, baseline, Records, fix picker, change note). TS/JS and Python splits are out of scope.

---

## How the spec's Go components map to files

The spec's table predates the adapter split. Same jobs, these files:

| Spec unit | Built as | Why |
|---|---|---|
| `resources/goast/main.go` | same, plus `main_test.go`, `go.mod` and `testdata/` | The helper's own `go test` |
| `goAst.ts` `goFileInfo(path)` | `goAst.ts` `buildGoHelper(...)`, `goFileInfo(helper, path)` | The helper's path is passed in, so the module has no `vscode` import |
| `goSplit.ts` `planProblems(info, plan)` | core `splitPlan.ts` `planProblems(adapter, input, plan)` (IDs, duplicates, movability, names via the adapter, 400 lines by actually building the split) | Plan validation is the same for every language |
| `goSplit.ts` `applyGoSplit(source, info, plan)` | `goSplit.ts` `buildGoSplit(source, info, plan)`, behind `adapter.buildSplit` | |
| `goMoveCheck.ts` rules 1–4 | core `moveCheck.ts` `checkMove(...)` (rules 1–3 on byte spans) and `declarationProblems(...)` (rule 4, used as the Go adapter's `sameDeclarations`); rule 5 in `steps.ts` through `worktree.changedFiles` | Rules 1–3 are language-neutral |
| `projectCommands.ts` `runCommand`, `parseGoTest` | `projectCommands.ts` `runCommand` (core); `goTests.ts` `parseGoTest` behind `adapter.parseTests` | Test output formats differ per language |
| `goSteps.ts` `runGoSplit`, `runGoTests` | core `steps.ts` `runSplit`, `runAddTests` | The step loop is the same for every language |
| `fixRun.ts` `fixOnBranch(...)` | `fixRun.ts` (entry, loop, close) and `fixSetup.ts` (prerequisites, picker, approval, worktree, baseline) | Keeps each file well under 400 lines |
| — | `baseline.ts`, `fixState.ts`, `languages.ts`, `goRules.ts`, `goTests.ts`, `goPrompts.ts` | Comparison, run state, adapter choice, and the Go rules, test checks and prompts |

## Decisions made while planning

- **Fix list at fix time** comes from a fresh deterministic scan (`fileStats` + `scanHealth`) of tracked files, not from parsing `report.md`; it is cheap and never stale.
- **Hooks off.** Every git command runs with `-c core.hooksPath=/dev/null`: hooks could run project code, reformat files under the move check, or reach a remote. The change note says hooks did not run.
- **Restore** uses `git checkout HEAD -- <paths>` (index and files), and new files are deleted. `git worktree remove --force` at close, because tests may leave untracked files; the branch stays.
- **No model import correction for Go.** The host rebuilds Go imports from `go list`, so there are no model-written import lines to correct; a failing check restores the step.
- **Add-tests** gets one model retry with the error shown. A new test counts only when it passed in both runs; tests that never ran (say the package's test binary does not build) count as failing and are dropped.
- **Baseline failure lines** that appear in only one of the two baseline runs (such as `go: downloading …`) are volatile and ignored, like flaky tests.
- **GOOS/GOARCH names** come from `go tool dist list` merged with go/build's own known lists.
- **Discard the rest** (when an unfinished run exists) keeps the branch and its commits and closes the run with a change note.
- **report.md** gets a short *Fixes on a local branch* section at close (count and the change note's path), not per-file plans.
- **File over 400 lines after a split** is accepted only when one declaration in it is itself over 400 lines and nothing else in it could move; the change note lists it under *Left for you*.

## Ground rules for every task

- Work in `overlay/extensions/my-editor-core/` unless a path says otherwise. Paths are relative to it.
- Tabs, one short `/** … */` line on exported functions, the surrounding comment density.
- No file over 400 lines. `src/chat/view.ts` is at 397 now and ends at 399 (Task 9).
- Pure modules must not import `vscode` and are listed in `tsconfig.test.json`. Only `fixSetup.ts`, `fixRun.ts` and `healthRun.ts` import `vscode`.
- Commits stay **local**. Never run `git push`, `git fetch` or any remote command.
- `npm test` compiles to `out-test/` and runs every test; the Go-backed tests skip themselves when `go` is not installed. Before this plan it reports `ℹ pass 131`.
- `resources/` is copied into the app by `scripts/build.sh` and `scripts/install.sh` (they exclude only `src`, `node_modules`, maps and `tsconfig.json`), so the helper's source ships with the extension.

## File map

| File | Status | Responsibility |
|---|---|---|
| `resources/goast/main.go` | new, Go | Parse one Go file to JSON: imports, declarations by ID, spans, directives, file flags |
| `resources/goast/main_test.go, go.mod, testdata/*.go` | new, Go | The helper's tests and fixtures |
| `src/aiready/language.ts` | new, pure | The `LanguageAdapter` interface and shared types |
| `src/aiready/baseline.ts` | new, pure | Check results, flaky tests, volatile lines, comparison with the baseline |
| `src/aiready/projectCommands.ts` | new, no vscode | Find tools, run approved commands without a shell (timeout, log, process group), read-only tools |
| `src/aiready/goAst.ts` | new, no vscode | Build the helper once; run it; its JSON types |
| `src/aiready/goRules.ts` | new, pure | Go file-name rules, skipped files, movability, the neutral view of a Go file |
| `src/aiready/goSplit.ts` | new, pure | Build the new files and the new original for a Go split |
| `src/aiready/splitPlan.ts` | new, pure | Parse and validate a split plan; over-400 notes |
| `src/aiready/moveCheck.ts` | new, pure | Move rules 1–3 on byte spans; rule 4 by declaration multiset |
| `src/aiready/goTests.ts` | new, pure | `go test -json` parsing, Go test names, the generated-test guard |
| `src/aiready/goPrompts.ts` | new, pure | The split and add-tests prompts for Go |
| `src/aiready/goAdapter.ts` | new, no vscode | The Go `LanguageAdapter` (helper, `go list`, `gofmt -l`) |
| `src/aiready/languages.ts` | new, no vscode | Pick the adapter for a project |
| `src/aiready/worktree.ts` | new, no vscode | Prerequisites, worktree, commit, restore, remove; never a remote command |
| `src/aiready/fixState.ts` | new, no vscode | Run state and logs in global storage |
| `src/aiready/fixPicker.ts` | new, pure | Fix choices and the multi-select picker (picker passed in) |
| `src/aiready/changeNote.ts` | new, pure | The change note, its path, and the report section |
| `src/aiready/steps.ts` | new, no vscode | One split or add-tests fix: plan, apply, check, commit or restore |
| `src/aiready/fixSetup.ts` | new, VS Code | Prerequisites, picker, approval modal, worktree, baseline |
| `src/aiready/fixRun.ts` | new, VS Code | Entry point, Stop and Continue, the 25-fix limit, close |
| `src/aiready/healthRun.ts` | modify | Offer **Fix on a local branch** after a Go report |
| `src/aiready/report.ts` | modify | Next-step wording |
| `src/chat/view.ts` | modify | `runTask` for host jobs; allow the new action (397 → 399 lines) |
| `src/extension.ts` | modify | Register `myEditor.aiReadyFix` |
| `package.json` | modify | The command and `myEditor.aiReady.commandTimeoutMinutes` |
| `tsconfig.test.json` | modify | List the pure modules |
| `test/goFixture.ts` | new | Parse Go source with the real helper in tests |
| `test/aiReadyBaseline / GoRules / GoSplit / GoTests / Worktree / Note / Steps .test.ts` | new | Unit tests |
| `README.md, CHANGELOG.md, docs/progress.md, design doc` | modify (repo root) | Docs |

---

## Chunk 1: The Go parser helper

### Task 1: Go helper with fixtures and its own tests

**Files:**
- Create: `resources/goast/go.mod`, `resources/goast/main.go`, `resources/goast/main_test.go`
- Create: `resources/goast/testdata/basic.go`, `embed.go`, `directive.go`, `flags_linux.go`, `generated.go`

The helper prints facts; TypeScript decides what may move. Its span convention is used everywhere: a span starts at the beginning of the line where the doc comment (or the declaration) starts, and ends at the newline ending the declaration's last line, extended to a trailing comment that starts on that line (`// nolint`). The newline is not part of the span. `Qualifiers` are the `X` of every `X.Sel` whose `X` the parser left unresolved; the host maps them to imports with `go list` names. `Ident.Obj` is deprecated but still filled in by `go/parser` unless `SkipObjectResolution` is set (checked on go1.26).

- [ ] **Step 1: Write the fixtures and the failing test.**

Create `resources/goast/go.mod`:

````text
module goast

go 1.22
````

Create `resources/goast/testdata/basic.go`:

````go
// Package shop is a fixture for the goast helper.
package shop

import (
	"fmt"
	"strings"

	yaml "gopkg.in/yaml.v3"
	"gopkg.in/yaml.v3/extra"
)

// Kind is an enum.
type Kind int

const (
	KindA Kind = iota
	KindB
)

var (
	_ = fmt.Sprintf
	_ = strings.ToUpper
)

// counter starts at one.
var counter = 1

var cache map[string]int

func init() { cache = map[string]int{} }

// Detached note about the section below.

// Encode writes v as YAML.
func Encode(v any) ([]byte, error) { return yaml.Marshal(v) } // nolint

// Cart holds items.
type Cart[T any] struct{ items []T }

// Add appends an item.
func (c *Cart[T]) Add(item T) { c.items = append(c.items, item) }

func shadow() string {
	fmt := struct{ Sprint func(...any) string }{}
	_ = extra.Version
	return fmt.Sprint("x")
}
````

Create `resources/goast/testdata/embed.go`:

````go
package shop

import _ "embed"

//go:embed hello.txt

var hello string

// Generated below.
//
//go:generate stringer -type=Kind
type Colour int

var plain string
````

Create `resources/goast/testdata/directive.go`:

````go
package shop

//go:noinline

func slow() int { return 1 }

var a, b = 1, 2; var c int
````

Create `resources/goast/testdata/flags_linux.go`:

````go
//go:build linux

package shop

// #include <stdio.h>
import "C"

func cgoCall() {}
````

Create `resources/goast/testdata/generated.go`:

````go
// Code generated by stringer; DO NOT EDIT.

package shop

const x = 1
````

Create `resources/goast/main_test.go`:

````go
package main

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

func inspectFixture(t *testing.T, name string) (*File, string) {
	t.Helper()
	src, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	out, err := Inspect(name, src)
	if err != nil {
		t.Fatal(err)
	}
	return out, string(src)
}

func declNamed(t *testing.T, f *File, name string) Decl {
	t.Helper()
	for _, d := range f.Decls {
		for _, n := range d.Names {
			if n == name {
				return d
			}
		}
	}
	t.Fatalf("no declaration named %s", name)
	return Decl{}
}

func TestDeclarationsKindsAndNames(t *testing.T) {
	f, _ := inspectFixture(t, "basic.go")
	if f.Package != "shop" || len(f.Decls) != 10 {
		t.Fatalf("package %q with %d declarations", f.Package, len(f.Decls))
	}
	for i, d := range f.Decls {
		if d.ID != i {
			t.Fatalf("declaration %d has ID %d", i, d.ID)
		}
	}
	group := declNamed(t, f, "KindA")
	if group.Kind != "const" || !group.Grouped || !reflect.DeepEqual(group.Names, []string{"KindA", "KindB"}) {
		t.Fatalf("iota group: %+v", group)
	}
	blanks := f.Decls[2]
	if blanks.Kind != "var" || !reflect.DeepEqual(blanks.Names, []string{"_", "_"}) || !blanks.HasInit {
		t.Fatalf("repeated _ names: %+v", blanks)
	}
	if !declNamed(t, f, "counter").HasInit || declNamed(t, f, "cache").HasInit {
		t.Fatal("initializer facts are wrong")
	}
	if !declNamed(t, f, "init").IsInit {
		t.Fatal("init not flagged")
	}
	add := declNamed(t, f, "Add")
	if add.Kind != "method" || add.Receiver != "Cart" || add.Doc != "Add appends an item." {
		t.Fatalf("method: %+v", add)
	}
}

func TestSpansCarryDocAndTrailingComment(t *testing.T) {
	f, src := inspectFixture(t, "basic.go")
	encode := declNamed(t, f, "Encode")
	text := src[encode.Start:encode.End]
	if text != "// Encode writes v as YAML.\nfunc Encode(v any) ([]byte, error) { return yaml.Marshal(v) } // nolint" {
		t.Fatalf("span: %q", text)
	}
	if encode.Lines != 2 || !encode.Own || encode.DocText != "// Encode writes v as YAML." {
		t.Fatalf("encode: %+v", encode)
	}
	if strings.Contains(src[encode.Start:encode.End], "Detached") {
		t.Fatal("a detached comment must not join the span")
	}
	if src[f.PackageSpan[0]:f.PackageSpan[1]] != "package shop" {
		t.Fatalf("package span: %q", src[f.PackageSpan[0]:f.PackageSpan[1]])
	}
}

func TestImportsAndQualifiers(t *testing.T) {
	f, src := inspectFixture(t, "basic.go")
	if len(f.Imports) != 4 || f.Imports[2].Name != "yaml" || f.Imports[3].Path != "gopkg.in/yaml.v3/extra" {
		t.Fatalf("imports: %+v", f.Imports)
	}
	if f.Imports[0].Run != 0 || f.Imports[1].Run != 0 || f.Imports[2].Run != 1 || !f.Imports[0].Own {
		t.Fatalf("runs: %+v", f.Imports)
	}
	if src[f.Imports[3].Start:f.Imports[3].End] != "\t\"gopkg.in/yaml.v3/extra\"" {
		t.Fatalf("import span: %q", src[f.Imports[3].Start:f.Imports[3].End])
	}
	if !reflect.DeepEqual(declNamed(t, f, "Encode").Qualifiers, []string{"yaml"}) {
		t.Fatalf("Encode qualifiers: %v", declNamed(t, f, "Encode").Qualifiers)
	}
	// A local variable named fmt resolves, so only the unresolved extra counts.
	if !reflect.DeepEqual(declNamed(t, f, "shadow").Qualifiers, []string{"extra"}) {
		t.Fatalf("shadow qualifiers: %v", declNamed(t, f, "shadow").Qualifiers)
	}
}

func TestEmbedAndGenerate(t *testing.T) {
	f, _ := inspectFixture(t, "embed.go")
	if !f.Imports[0].Blank || f.Imports[0].Own {
		t.Fatalf("blank import: %+v", f.Imports[0])
	}
	if !declNamed(t, f, "hello").Embed {
		t.Fatal("an embed var separated by a blank line must still be flagged")
	}
	if !declNamed(t, f, "Colour").Generate || declNamed(t, f, "Colour").Embed {
		t.Fatalf("generate: %+v", declNamed(t, f, "Colour"))
	}
	if declNamed(t, f, "plain").Embed {
		t.Fatal("plain var flagged as embed")
	}
	if len(f.Directives) != 2 {
		t.Fatalf("directives: %+v", f.Directives)
	}
}

func TestSeparatedDirectiveAndSharedLines(t *testing.T) {
	f, _ := inspectFixture(t, "directive.go")
	if len(f.Directives) != 1 || f.Directives[0].Text != "//go:noinline" || f.Directives[0].Line != 3 {
		t.Fatalf("directives: %+v", f.Directives)
	}
	if declNamed(t, f, "slow").DocText != "" {
		t.Fatal("a directive after a blank line is not doc")
	}
	if declNamed(t, f, "a").Own || declNamed(t, f, "c").Own {
		t.Fatal("declarations sharing a line must not be own")
	}
}

func TestFileFlags(t *testing.T) {
	f, _ := inspectFixture(t, "flags_linux.go")
	if !f.BuildConstraint || !f.Cgo {
		t.Fatalf("flags: %+v", f)
	}
	g, _ := inspectFixture(t, "generated.go")
	if !g.Generated || g.BuildConstraint {
		t.Fatalf("generated: %+v", g)
	}
	crlf, err := Inspect("crlf.go", []byte("package shop\r\n\r\nfunc a() {}\r\n"))
	if err != nil || !crlf.CRLF || crlf.BOM {
		t.Fatalf("crlf: %+v %v", crlf, err)
	}
	bom, err := Inspect("bom.go", []byte("\xEF\xBB\xBFpackage shop\n"))
	if err != nil || !bom.BOM {
		t.Fatalf("bom: %+v %v", bom, err)
	}
}
````

`testdata/` is ignored by the Go tool, so the fixtures never build. `directive.go` is deliberately not gofmt-clean (two declarations on one line).

- [ ] **Step 2: Run it and see it fail.** `cd resources/goast && GOTOOLCHAIN=local go test ./...` → `undefined: Inspect` and `undefined: File`, `FAIL goast [build failed]`.

- [ ] **Step 3: Implement.**

Create `resources/goast/main.go`:

````go
// Command goast prints JSON facts about one Go file for my_editor's AI-ready splits.
// It uses only the standard library and never changes the file.
//
// Spans are UTF-8 byte offsets. A span starts at the beginning of its first line and ends at the newline that ends
// its last line (the newline itself is not part of the span), or at the end of the file.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/build/constraint"
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"strings"
)

// File is the helper's output.
type File struct {
	Package         string      `json:"package"`
	PackageSpan     [2]int      `json:"packageSpan"`
	BuildConstraint bool        `json:"buildConstraint"`
	Cgo             bool        `json:"cgo"`
	Generated       bool        `json:"generated"`
	BOM             bool        `json:"bom"`
	CRLF            bool        `json:"crlf"`
	Imports         []Import    `json:"imports"`
	ImportDecls     [][2]int    `json:"importDecls"`
	Decls           []Decl      `json:"decls"`
	Directives      []Directive `json:"directives"`
}

// Import is one import spec. Run groups specs that are adjacent in one import declaration.
type Import struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Start int    `json:"start"`
	End   int    `json:"end"`
	Own   bool   `json:"own"`
	Decl  int    `json:"decl"`
	Run   int    `json:"run"`
	Blank bool   `json:"blank"`
	Dot   bool   `json:"dot"`
}

// Decl is one top-level declaration other than an import. ID is its index among them.
type Decl struct {
	ID         int      `json:"id"`
	Kind       string   `json:"kind"`
	Grouped    bool     `json:"grouped"`
	Names      []string `json:"names"`
	Receiver   string   `json:"receiver"`
	Start      int      `json:"start"`
	End        int      `json:"end"`
	Lines      int      `json:"lines"`
	Doc        string   `json:"doc"`
	DocText    string   `json:"docText"`
	IsInit     bool     `json:"isInit"`
	HasInit    bool     `json:"hasInit"`
	Embed      bool     `json:"embed"`
	Generate   bool     `json:"generate"`
	Own        bool     `json:"own"`
	Qualifiers []string `json:"qualifiers"`
}

// Directive is a `//go:` or `//line` comment.
type Directive struct {
	Line   int    `json:"line"`
	Offset int    `json:"offset"`
	Text   string `json:"text"`
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: goast <file.go>")
		os.Exit(2)
	}
	src, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	out, err := Inspect(os.Args[1], src)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// Inspect parses src and collects the facts my_editor needs.
func Inspect(name string, src []byte) (*File, error) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, name, src, parser.ParseComments)
	if err != nil {
		return nil, err
	}
	off := func(p token.Pos) int { return fset.Position(p).Offset }
	line := func(p token.Pos) int { return fset.Position(p).Line }
	out := &File{
		Package:     f.Name.Name,
		PackageSpan: [2]int{lineStart(src, off(f.Package)), lineEnd(src, off(f.Name.End()))},
		Generated:   ast.IsGenerated(f),
		BOM:         bytes.HasPrefix(src, []byte{0xEF, 0xBB, 0xBF}),
		CRLF:        bytes.Contains(src, []byte("\r\n")),
		Imports:     []Import{},
		ImportDecls: [][2]int{},
		Decls:       []Decl{},
		Directives:  []Directive{},
	}
	for _, group := range f.Comments {
		for _, c := range group.List {
			if c.Pos() < f.Package && (constraint.IsGoBuild(c.Text) || constraint.IsPlusBuild(c.Text)) {
				out.BuildConstraint = true
			}
			if strings.HasPrefix(c.Text, "//go:") || strings.HasPrefix(c.Text, "//line ") || strings.HasPrefix(c.Text, "/*line ") {
				out.Directives = append(out.Directives, Directive{Line: line(c.Pos()), Offset: off(c.Pos()), Text: firstLine(c.Text)})
			}
		}
	}
	trailingEnd := func(end token.Pos) int {
		last := line(end)
		for _, group := range f.Comments {
			if line(group.Pos()) == last && group.Pos() >= end && line(group.End()) > last {
				last = line(group.End())
			}
		}
		return lineEnd(src, off(fset.File(end).LineStart(last)))
	}
	run := -1
	prevEnd := -1
	for _, decl := range f.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.IMPORT {
			continue
		}
		start, end := spanStart(src, off, gen.Doc, gen.Pos()), trailingEnd(gen.End())
		out.ImportDecls = append(out.ImportDecls, [2]int{start, end})
		prevEnd = -1
		for _, s := range gen.Specs {
			spec := s.(*ast.ImportSpec)
			path, _ := strconv.Unquote(spec.Path.Value)
			name := ""
			if spec.Name != nil {
				name = spec.Name.Name
			}
			if path == "C" {
				out.Cgo = true
			}
			sStart, sEnd := spanStart(src, off, spec.Doc, spec.Pos()), trailingEnd(spec.End())
			if prevEnd < 0 || hasBlankLine(src, prevEnd, sStart) {
				run++
			}
			prevEnd = sEnd
			out.Imports = append(out.Imports, Import{
				Name: name, Path: path, Start: sStart, End: sEnd, Own: gen.Lparen.IsValid() && ownLines(src, sStart, sEnd, firstPos(off, spec.Doc, spec.Pos()), off(spec.End())),
				Decl: len(out.ImportDecls) - 1, Run: run, Blank: name == "_", Dot: name == ".",
			})
		}
	}
	for _, decl := range f.Decls {
		if gen, ok := decl.(*ast.GenDecl); ok && gen.Tok == token.IMPORT {
			continue
		}
		d := describe(decl)
		d.ID = len(out.Decls)
		var doc *ast.CommentGroup
		switch x := decl.(type) {
		case *ast.FuncDecl:
			doc = x.Doc
		case *ast.GenDecl:
			doc = x.Doc
		}
		d.Start, d.End = spanStart(src, off, doc, decl.Pos()), trailingEnd(decl.End())
		d.Lines = bytes.Count(src[d.Start:d.End], []byte("\n")) + 1
		d.Own = ownLines(src, d.Start, d.End, firstPos(off, doc, decl.Pos()), off(decl.End()))
		if doc != nil {
			d.Doc = firstLine(strings.TrimSpace(doc.Text()))
			d.DocText = string(src[off(doc.Pos()):off(doc.End())])
		}
		d.Qualifiers = qualifiers(decl)
		out.Decls = append(out.Decls, d)
	}
	markDirectives(out)
	return out, nil
}

// describe fills a declaration's kind, names, receiver and initializer facts.
func describe(decl ast.Decl) Decl {
	d := Decl{Names: []string{}}
	switch x := decl.(type) {
	case *ast.FuncDecl:
		d.Kind = "func"
		d.Names = append(d.Names, x.Name.Name)
		if x.Recv != nil && len(x.Recv.List) > 0 {
			d.Kind = "method"
			d.Receiver = receiverName(x.Recv.List[0].Type)
		}
		d.IsInit = x.Recv == nil && x.Name.Name == "init"
	case *ast.GenDecl:
		d.Kind = x.Tok.String()
		d.Grouped = x.Lparen.IsValid()
		for _, s := range x.Specs {
			switch spec := s.(type) {
			case *ast.TypeSpec:
				d.Names = append(d.Names, spec.Name.Name)
			case *ast.ValueSpec:
				for _, n := range spec.Names {
					d.Names = append(d.Names, n.Name)
				}
				if x.Tok == token.VAR && len(spec.Values) > 0 {
					d.HasInit = true
				}
			}
		}
	}
	return d
}

// markDirectives flags declarations that a `//go:embed` precedes or a `//go:generate` sits inside.
func markDirectives(out *File) {
	for _, dir := range out.Directives {
		embed := strings.HasPrefix(dir.Text, "//go:embed")
		generate := strings.HasPrefix(dir.Text, "//go:generate")
		for i := range out.Decls {
			d := &out.Decls[i]
			inside := dir.Offset >= d.Start && dir.Offset < d.End
			if generate && inside {
				d.Generate = true
			}
			if embed && (inside || dir.Offset < d.Start) {
				d.Embed = true
				break
			}
		}
	}
}

// receiverName is the receiver's base type name, without pointer or type parameters.
func receiverName(expr ast.Expr) string {
	for {
		switch x := expr.(type) {
		case *ast.StarExpr:
			expr = x.X
		case *ast.ParenExpr:
			expr = x.X
		case *ast.IndexExpr:
			expr = x.X
		case *ast.IndexListExpr:
			expr = x.X
		case *ast.Ident:
			return x.Name
		default:
			return ""
		}
	}
}

// qualifiers lists X for every selector X.Sel whose X the parser could not resolve in this file: import names,
// or names declared in other files of the package. A local variable named like an import resolves and is skipped.
func qualifiers(decl ast.Decl) []string {
	seen := map[string]bool{}
	list := []string{}
	ast.Inspect(decl, func(n ast.Node) bool {
		if sel, ok := n.(*ast.SelectorExpr); ok {
			// Obj is deprecated in favour of go/types, but the parser's own file-level resolution is what is wanted here.
			if id, ok := sel.X.(*ast.Ident); ok && id.Obj == nil && !seen[id.Name] {
				seen[id.Name] = true
				list = append(list, id.Name)
			}
		}
		return true
	})
	return list
}

// firstPos is the offset of the doc comment, or else of the node.
func firstPos(off func(token.Pos) int, doc *ast.CommentGroup, pos token.Pos) int {
	if doc != nil {
		pos = doc.Pos()
	}
	return off(pos)
}

// spanStart is the start of the line where the doc comment, or else the node, begins.
func spanStart(src []byte, off func(token.Pos) int, doc *ast.CommentGroup, pos token.Pos) int {
	if doc != nil {
		pos = doc.Pos()
	}
	return lineStart(src, off(pos))
}

func lineStart(src []byte, i int) int {
	return bytes.LastIndexByte(src[:i], '\n') + 1
}

func lineEnd(src []byte, i int) int {
	if j := bytes.IndexByte(src[i:], '\n'); j >= 0 {
		return i + j
	}
	return len(src)
}

// ownLines reports whether the node has its lines to itself: only indentation before it, and only whitespace or a
// trailing comment after it.
func ownLines(src []byte, start, end, first, nodeEnd int) bool {
	if strings.TrimSpace(string(src[start:first])) != "" {
		return false
	}
	rest := strings.TrimSpace(string(src[nodeEnd:end]))
	return rest == "" || strings.HasPrefix(rest, "//") && !strings.Contains(rest, "\n") || strings.HasPrefix(rest, "/*") && strings.HasSuffix(rest, "*/")
}

// hasBlankLine reports whether a blank line lies between the line ending at from and the line starting at to.
func hasBlankLine(src []byte, from, to int) bool {
	if from+1 >= to {
		return false
	}
	lines := strings.Split(string(src[from+1:to]), "\n")
	for _, l := range lines[:len(lines)-1] {
		if strings.TrimSpace(l) == "" {
			return true
		}
	}
	return false
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 160 {
		s = s[:160]
	}
	return s
}
````

- [ ] **Step 4: Run the tests.** `cd resources/goast && GOTOOLCHAIN=local go test ./... && go vet ./... && gofmt -l main.go main_test.go` → `ok  	goast	0.2s` and nothing else.

Also check the standalone build the extension will do, from an empty folder outside any module:

```bash
D=$(mktemp -d) && cp resources/goast/main.go "$D" && (cd "$D" && GOTOOLCHAIN=local GOFLAGS= GOWORK=off go build -o goast main.go && ./goast "$OLDPWD/resources/goast/testdata/basic.go" | head -c 80)
```

Expected: `{"package":"shop","packageSpan":[51,63],"buildConstraint":false,"cgo":false,"gen`

- [ ] **Step 5: Commit.**

```bash
git add resources/goast
git commit -m "Add the Go parser helper for AI-ready splits"
```

---

## Chunk 2: The adapter interface, baseline comparison and Go parsing

### Task 2: Language adapter interface and baseline comparison

**Files:**
- Create: `src/aiready/language.ts`, `src/aiready/baseline.ts`, `test/aiReadyBaseline.test.ts`
- Modify: `tsconfig.test.json`

`baseline.ts` is language-neutral: a check's exit status and its failure lines (positions stripped, so an error in a moved declaration still compares equal) must match the baseline, and per-test outcomes must match except for flaky tests. Lines that appear in only one baseline run are volatile.

- [ ] **Step 1: Write the failing test.**

Create `test/aiReadyBaseline.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CheckResult, checkSummary, compareWithBaseline, failureLines, flakyTests, Outcome, unverified } from '../src/aiready/baseline';

const tests = (outcomes: Record<string, Outcome>, packages: Record<string, Outcome> = {}) => ({ tests: outcomes, packages });
const testRun = (code: number, outcomes: Record<string, Outcome>, packages: Record<string, Outcome> = {}): CheckResult =>
	({ command: 'go test -count=1 -json ./a', code, failures: [], tests: tests(outcomes, packages), tail: '', log: '' });
const checkRun = (code: number, output: string): CheckResult =>
	({ command: 'go vet ./internal/store', code, failures: failureLines(output), tail: '', log: '' });

test('failureLines drops file positions so a moved declaration compares equal', () => {
	assert.deepEqual(failureLines('a/b.go:12:3: undefined: X\n./c.go:4: bad\n\n# pkg\nundefined: X\n'), ['# pkg', 'bad', 'undefined: X']);
});

test('the baseline excludes flaky tests, and failing tests must fail the same way', () => {
	const baseline: [CheckResult, CheckResult] = [
		testRun(1, { 'm/a TestX': 'pass', 'm/a TestFlaky': 'pass', 'm/a TestBroken': 'fail' }, { 'm/a': 'fail' }),
		testRun(1, { 'm/a TestX': 'pass', 'm/a TestFlaky': 'fail', 'm/a TestBroken': 'fail' }, { 'm/a': 'fail' }),
	];
	assert.deepEqual(flakyTests(baseline[0].tests, baseline[1].tests), ['m/a TestFlaky']);
	assert.deepEqual(compareWithBaseline(baseline, baseline[1]).problems, []);
	const changed = testRun(1, { 'm/a TestX': 'fail', 'm/a TestFlaky': 'pass', 'm/a TestBroken': 'fail' }, { 'm/a': 'fail' });
	assert.match(compareWithBaseline(baseline, changed).problems.join(' '), /m\/a TestX: pass before, fail now/);
	const fixed = testRun(1, { 'm/a TestX': 'pass', 'm/a TestBroken': 'pass' }, { 'm/a': 'fail' });
	assert.match(compareWithBaseline(baseline, fixed).problems.join(' '), /TestBroken: fail before, pass now/);
	const added = testRun(1, { ...baseline[0].tests!.tests, 'm/a TestAiNew': 'fail' }, { 'm/a': 'fail' });
	assert.deepEqual(compareWithBaseline(baseline, added, ['TestAiNew']), { problems: [], newFailing: ['m/a TestAiNew'] });
	assert.match(compareWithBaseline(baseline, added).problems.join(' '), /TestAiNew: a test that did not exist before/);
	assert.match(compareWithBaseline(baseline, { ...changed, code: undefined, timedOut: true }).problems[0], /timed out/);
});

test('a package that gains tests may go from no test files to pass, or fail only through its new tests', () => {
	const empty = testRun(0, {}, { 'm/b': 'skip' });
	const gained = testRun(1, { 'm/b TestAiOk': 'pass', 'm/b TestAiBad': 'fail' }, { 'm/b': 'fail' });
	assert.deepEqual(compareWithBaseline([empty, empty], gained, ['TestAiOk', 'TestAiBad']), { problems: [], newFailing: ['m/b TestAiBad'] });
	assert.deepEqual(compareWithBaseline([empty, empty], testRun(0, { 'm/b TestAiOk': 'pass' }, { 'm/b': 'pass' }), ['TestAiOk']).problems, []);
});

test('new tests count only when they passed: a test binary that did not build verifies nothing', () => {
	const run = tests({ 'm TestAiX': 'pass', 'm TestAiY': 'pass', 'm TestAiY/sub': 'fail' });
	assert.deepEqual(unverified(['TestAiX', 'TestAiY', 'TestAiZ'], run), ['TestAiY', 'TestAiZ']);
	assert.deepEqual(unverified(['TestAiX'], undefined), ['TestAiX']);
});

test('a vet failure that existed before must stay the same, wherever its line moved', () => {
	const before = '# m/internal/vad\nsilero_engine.c:6:10: fatal error: \'onnxruntime_c_api.h\' file not found\n';
	const baseline: [CheckResult, CheckResult] = [checkRun(1, before), checkRun(1, before)];
	assert.deepEqual(compareWithBaseline(baseline, checkRun(1, before.replace(':6:10:', ':9:2:'))).problems, []);
	assert.match(compareWithBaseline(baseline, checkRun(1, `${before}store/a.go:3:1: undefined: x\n`)).problems[0], /failed differently: \+ undefined: x/);
	assert.match(compareWithBaseline(baseline, checkRun(0, '')).problems[0], /now passes but failed before/);
	assert.match(compareWithBaseline([checkRun(0, ''), checkRun(0, '')], checkRun(2, 'x')).problems[0], /failed \(exit 2\) but passed before/);
	const downloading: [CheckResult, CheckResult] = [checkRun(1, `go: downloading golang.org/x/sys v0.33.0\n${before}`), checkRun(1, before)];
	assert.deepEqual(compareWithBaseline(downloading, checkRun(1, before)).problems, [], 'a line in only one baseline run is volatile');
});

test('checkSummary names each command once and counts the last test run', () => {
	const summary = checkSummary([checkRun(0, ''), testRun(0, { 'm A': 'pass', 'm B': 'skip' }), testRun(0, { 'm A': 'pass', 'm B': 'pass' })], ['m C']);
	assert.equal(summary, '`go vet ./internal/store`, `go test -count=1 -json ./a`: same as before (2 of 2 tests passing); 1 flaky excluded.');
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `test/aiReadyBaseline.test.ts(3,…): error TS2307: Cannot find module '../src/aiready/baseline' …`.

- [ ] **Step 3: Implement.**

Create `src/aiready/language.ts`:

````ts
import type { TestRun } from './baseline';

/**
 * A UTF-8 byte range. A declaration's span starts at the beginning of its first line (its doc comment, if any) and
 * ends at the newline that ends its last line; that newline is not part of the span.
 */
export interface Span {
	readonly start: number;
	readonly end: number;
}

/** One top-level declaration, as the language adapter sees it. */
export interface Declaration {
	/** Stable within one parse: the declaration's index in the file. Plans refer to declarations by this ID. */
	readonly id: number;
	readonly kind: string;
	/** A multiset: `_` may repeat. */
	readonly names: readonly string[];
	readonly receiver?: string;
	readonly span: Span;
	readonly lines: number;
	/** The first line of its doc comment, for the model. */
	readonly doc: string;
	/** The whole doc comment, compared by move rule 4. */
	readonly docText: string;
	/** Imports it uses, as the adapter names them (Go: import paths). */
	readonly uses: readonly string[];
	readonly movable: boolean;
	/** Why it may not move. */
	readonly reason?: string;
}

/** What an adapter knows about one source file. */
export interface FileInfo {
	/** Relative to the project root, with `/` separators. */
	readonly path: string;
	readonly declarations: readonly Declaration[];
	/** The region the adapter rebuilds rather than copies (Go: the import declarations); move rule 2 treats it as opaque. */
	readonly importRegion?: Span;
	/** Spans a new file may hold besides moved declarations: header comment, package clause, imports. */
	readonly frame: readonly Span[];
	/** Imports as comparable keys; after a split the original may only lose some. */
	readonly imports: readonly string[];
	/** Why this file is never split or given tests, if it is not. */
	readonly skip?: string;
}

/** The model's plan: which declarations go to which new file. */
export interface SplitGroup {
	readonly file: string;
	readonly declarations: readonly number[];
}
export type SplitPlan = readonly SplitGroup[];

export interface NewFile {
	readonly name: string;
	readonly text: Buffer;
}

export interface SplitResult {
	readonly original: Buffer;
	readonly files: readonly NewFile[];
}

/** One exact check command for a file's unit (Go: its package). */
export interface CheckCommand {
	readonly label: 'build' | 'vet' | 'test';
	readonly command: string;
}

export interface Prompt {
	readonly system: string;
	readonly text: string;
}

/**
 * Everything the language-neutral fixer needs from one language. Go is the first adapter; TS/JS, Python, C#, Rust and
 * C/C++ follow. Paths are relative to the root the adapter was created for, with `/` separators.
 */
export interface LanguageAdapter {
	readonly id: string;
	readonly label: string;
	readonly extensions: readonly string[];
	/** Parse one file, with each declaration's movability and the file's skip reason. */
	parse(file: string): Promise<FileInfo>;
	/** Why a new file may not have this name. */
	fileNameProblems(name: string): string[];
	/** New files and the new original, imports rebuilt. Throws when the plan cannot be applied. */
	buildSplit(source: Buffer, info: FileInfo, plan: SplitPlan): SplitResult;
	/** Move rule 4: the unit's declarations, before and after, are the same apart from their file. */
	sameDeclarations(before: readonly FileInfo[], after: readonly FileInfo[]): string[];
	/** The files rule 4 compares (Go: the package's files). */
	unitFiles(file: string): Promise<string[]>;
	/** Files that the formatter would change; empty when all are formatted or the language has no formatter. */
	unformatted(files: readonly string[]): Promise<string[]>;
	/** Exact build, vet and test commands for the file's unit, in order. */
	checks(file: string): CheckCommand[];
	/** Per-test results from a test command's output. */
	parseTests(output: string): TestRun;
	/** The add-tests fix writes this file. */
	testFileName(file: string): string;
	/** Test names a test file declares. */
	testNames(info: FileInfo): string[];
	/** Why a generated test file may not be used (wrong package, network access). */
	testProblems(text: string, info: FileInfo, source: FileInfo): string[];
	/** The model's input for a split plan of a file with this many lines. */
	splitPrompt(info: FileInfo, lines: number): Prompt;
	testPrompt(file: string, source: string, info: FileInfo): Prompt;
}
````

Create `src/aiready/baseline.ts`:

````ts
export type Outcome = 'pass' | 'fail' | 'skip';

/** Per-test and per-package outcomes of one test command. Test keys are `<package> <test>`. */
export interface TestRun {
	readonly tests: Readonly<Record<string, Outcome>>;
	readonly packages: Readonly<Record<string, Outcome>>;
}

/** One run of one check command. */
export interface CheckResult {
	readonly command: string;
	/** Exit code; undefined when the command could not start, timed out or was stopped. */
	readonly code: number | undefined;
	/** Error lines with file positions removed, so a moved declaration's error still compares equal. */
	readonly failures: readonly string[];
	readonly tests?: TestRun;
	readonly tail: string;
	readonly log: string;
	readonly timedOut?: boolean;
}

const POSITION = /^(?:\.{0,2}\/)?[^\s:]+\.\w+:\d+(?::\d+)?:\s*/;

/** Non-empty output lines with leading `file:line:col:` positions removed, sorted and unique. */
export function failureLines(output: string): string[] {
	return [...new Set(output.split(/\r?\n/).map(line => line.trim().replace(POSITION, '')).filter(Boolean))].sort();
}

/** Tests and packages whose outcome differs between the two baseline runs, or that appear in only one. */
export function flakyTests(first: TestRun | undefined, second: TestRun | undefined): string[] {
	const differs = (a: Readonly<Record<string, Outcome>>, b: Readonly<Record<string, Outcome>>) =>
		[...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => a[key] !== b[key]);
	if (!first || !second) { return []; }
	return [...differs(first.tests, second.tests), ...differs(first.packages, second.packages).map(name => `${name} (package)`)].sort();
}

/** Named new tests that did not pass in this run, including ones that never ran (say, the test binary did not build). */
export function unverified(names: readonly string[], run: TestRun | undefined): string[] {
	const outcomes = Object.entries(run?.tests ?? {}).map(([key, outcome]) => ({ test: key.slice(key.indexOf(' ') + 1), outcome }));
	return names.filter(name => !outcomes.some(o => o.test === name && o.outcome === 'pass')
		|| outcomes.some(o => (o.test === name || o.test.startsWith(`${name}/`)) && o.outcome === 'fail'));
}

/** Whether a test key belongs to one of the named top-level tests, subtests included. */
function belongsTo(key: string, names: readonly string[]): boolean {
	const test = key.slice(key.indexOf(' ') + 1);
	return names.some(name => test === name || test.startsWith(`${name}/`));
}

export interface Comparison {
	readonly problems: string[];
	/** New tests (from `allowNew`) that did not pass. */
	readonly newFailing: string[];
}

/**
 * Compares one run with the baseline's two runs. The exit status must match the first run, and the failure lines
 * both runs share (lines in only one are volatile and ignored);
 * every test that was not flaky must have the same outcome; tests may only be added when they are named in
 * `allowNew`, and those are reported when they do not pass.
 */
export function compareWithBaseline(baseline: readonly [CheckResult, CheckResult], now: CheckResult, allowNew: readonly string[] = []): Comparison {
	const [first, second] = baseline;
	const problems: string[] = [];
	if (now.code === undefined) {
		return { problems: [`\`${now.command}\` ${now.timedOut ? 'timed out' : 'did not finish'}.`], newFailing: [] };
	}
	const exitDiffers = (now.code === 0) !== (first.code === 0);
	if (!first.tests) {
		if (exitDiffers) { problems.push(exitProblem(now)); }
		// Lines in only one baseline run (`go: downloading …`) are volatile, like flaky tests.
		const stable = first.failures.filter(line => second.failures.includes(line));
		const volatile = new Set([...first.failures, ...second.failures].filter(line => !stable.includes(line)));
		const added = now.failures.filter(line => !stable.includes(line) && !volatile.has(line));
		const gone = stable.filter(line => !now.failures.includes(line));
		if (now.code !== 0 && first.code !== 0 && (added.length || gone.length)) {
			problems.push(`\`${now.command}\` failed differently: ${[...added.map(line => `+ ${line}`), ...gone.map(line => `- ${line}`)].slice(0, 6).join(' | ')}`);
		}
		return { problems, newFailing: [] };
	}
	const flaky = new Set(flakyTests(first.tests, second.tests));
	const tests = now.tests ?? { tests: {}, packages: {} };
	const newFailing: string[] = [];
	for (const [key, outcome] of Object.entries(first.tests.tests)) {
		if (flaky.has(key)) { continue; }
		const result = tests.tests[key];
		if (result !== outcome) { problems.push(`${key}: ${outcome} before, ${result ?? 'missing'} now.`); }
	}
	for (const [key, outcome] of Object.entries(tests.tests)) {
		if (key in first.tests.tests || flaky.has(key)) { continue; }
		if (!belongsTo(key, allowNew)) { problems.push(`${key}: a test that did not exist before.`); }
		else if (outcome === 'fail') { newFailing.push(key); }
	}
	// A package that gained tests may go from "no test files" (skip) to pass, or fail only through its new tests.
	const gained = new Set(Object.keys(tests.tests).filter(key => !(key in first.tests!.tests)).map(key => key.slice(0, key.indexOf(' '))));
	for (const [name, outcome] of Object.entries(first.tests.packages)) {
		if (flaky.has(`${name} (package)`) || gained.has(name)) { continue; }
		const result = tests.packages[name];
		if (result !== outcome) { problems.push(`Package ${name}: ${outcome} before, ${result ?? 'missing'} now.`); }
	}
	if (exitDiffers && !(gained.size && (now.code === 0 || newFailing.length))) { problems.push(exitProblem(now)); }
	return { problems, newFailing };
}

function exitProblem(now: CheckResult): string {
	return `\`${now.command}\` ${now.code === 0 ? 'now passes but failed before' : `failed (exit ${now.code}) but passed before`}.`;
}

/** A one-line summary of a passing step's checks, for the commit body and the change note. */
export function checkSummary(results: readonly CheckResult[], flaky: readonly string[]): string {
	const outcomes = Object.values([...results].reverse().find(result => result.tests)?.tests?.tests ?? {});
	const passed = outcomes.filter(outcome => outcome === 'pass').length;
	return `${[...new Set(results.map(result => `\`${result.command}\``))].join(', ')}: same as before`
		+ `${outcomes.length ? ` (${passed} of ${outcomes.length} tests passing)` : ''}${flaky.length ? `; ${flaky.length} flaky excluded` : ''}.`;
}
````

In `tsconfig.test.json`, add `"src/aiready/language.ts"`, `"src/aiready/baseline.ts"` to the end of the `include` array, in that order (add a comma after the previous last entry).

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 137`, `ℹ fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/language.ts src/aiready/baseline.ts test/aiReadyBaseline.test.ts tsconfig.test.json
git commit -m "Add the language adapter interface and baseline comparison"
```

### Task 3: Run tools, build the helper, and the Go file rules

**Files:**
- Create: `src/aiready/projectCommands.ts`, `src/aiready/goAst.ts`, `src/aiready/goRules.ts`, `test/goFixture.ts`, `test/aiReadyGoRules.test.ts`
- Modify: `tsconfig.test.json`

`findTool` looks beyond PATH because the app may be started from the Dock (`/opt/homebrew/bin`, `/usr/local/go/bin`, `~/go/bin`, `~/sdk/go*/bin`). `runCommand` refuses anything not in the approved list or containing shell characters, runs in its own process group (Stop and the timeout end `go test`'s children too), and writes the full output to a log. `runTool` is for read-only tools only.

`test/goFixture.ts` builds the real helper once per test run into the temp folder and parses source with it; tests skip when `go` is missing. It also holds the shared `SHOP` fixture (declaration IDs 0–8).

- [ ] **Step 1: Write the failing test.**

Create `test/goFixture.ts`:

````ts
import { mkdtempSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildGoHelper, goFileInfo } from '../src/aiready/goAst';
import { GoFileInfo, goFileInfoView, platforms } from '../src/aiready/goRules';
import { findTool } from '../src/aiready/projectCommands';

/** Test helper: parses Go source with the real helper, or undefined when Go is not installed. */
let helper: Promise<string | undefined> | undefined;
const work = mkdtempSync(path.join(os.tmpdir(), 'my-editor-goast-test-'));

function helperPath(): Promise<string | undefined> {
	const go = findTool('go');
	helper ??= go
		? buildGoHelper(path.resolve(__dirname, '../../resources/goast/main.go'), path.join(os.tmpdir(), 'my-editor-goast-cache'), 'test', go)
		: Promise.resolve(undefined);
	return helper;
}

export async function goInfo(file: string, text: string | Buffer, packageNames: ReadonlyMap<string, string> = new Map()):
	Promise<{ source: Buffer; info: GoFileInfo } | undefined> {
	const binary = await helperPath();
	if (!binary) { return undefined; }
	const source = Buffer.isBuffer(text) ? text : Buffer.from(text);
	const full = path.join(work, file.replace(/\//g, '_'));
	writeFileSync(full, source);
	return { source, info: goFileInfoView(file, await goFileInfo(binary, full), packageNames) };
}

/** Go's platform names plus two made-up ones, so a newer `go tool dist list` is honoured. */
export const KNOWN = platforms('linux/amd64\nwindows/arm64\nnewos/newarch\n');
export const YAML = new Map([['gopkg.in/yaml.v3', 'yaml'], ['fmt', 'fmt'], ['strings', 'strings']]);

/** A package file with every kind of declaration the split rules care about. IDs 0–8. */
export const SHOP = `package shop

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// Kind is an enum.
type Kind int

const (
	KindA Kind = iota
	KindB
)

var counter = 1

var _ fmt.Stringer
var _ fmt.Stringer

var cache map[string]int

// Detached note about encoding.

// Encode writes v as YAML.
func Encode(v any) ([]byte, error) { return yaml.Marshal(v) } // nolint

// Upper shouts.
func Upper(s string) string { return strings.ToUpper(s) }

func describe(k Kind) string { return fmt.Sprint(k) }
`;
````

Create `test/aiReadyGoRules.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { goFileNameProblems, goSkipReason, namedByDirective, platformSuffix } from '../src/aiready/goRules';
import { goInfo, KNOWN, SHOP, YAML } from './goFixture';

const NO_MODULE = { nestedModules: [], directiveLines: [] };

test('file names: Go ignores _ and . files, and _GOOS/_GOARCH endings are build constraints', () => {
	assert.deepEqual(goFileNameProblems('placements_query.go', KNOWN), []);
	for (const name of ['_x.go', '.x.go', 'X.go', 'x.txt', 'x_test.go', 'x_linux.go', 'x_amd64.go', 'x_windows_arm64.go', 'x_newos.go']) {
		assert.ok(goFileNameProblems(name, KNOWN).length, name);
	}
	assert.equal(platformSuffix('x_linux_test.go', KNOWN), '_linux');
	assert.equal(platformSuffix('linux.go', KNOWN), undefined);
	assert.equal(platformSuffix('store_wasm.go', KNOWN), '_wasm');
});

test('the helper reports IDs, groups, repeated _ names and uses through go list names', async t => {
	const parsed = await goInfo('shop/shop.go', SHOP, YAML);
	if (!parsed) { t.skip('Go is not installed'); return; }
	const d = parsed.info.declarations;
	assert.deepEqual(d.map(x => x.names.join(',')), ['Kind', 'KindA,KindB', 'counter', '_', '_', 'cache', 'Encode', 'Upper', 'describe']);
	assert.equal(d[1].kind, 'const (…)');
	assert.deepEqual(d[6].uses, ['gopkg.in/yaml.v3']);
	assert.equal(d[2].movable, false);
	assert.match(d[2].reason ?? '', /initialization order/);
	assert.ok(d[5].movable, 'an uninitialized var may move');
});

test('skipped files: directives, a directive after a blank line, CRLF, generated, cgo and files named by directives', async t => {
	const separated = await goInfo('shop/a.go', 'package shop\n\n//go:noinline\n\nfunc slow() int { return 1 }\n');
	if (!separated) { t.skip('Go is not installed'); return; }
	assert.match(goSkipReason('shop/a.go', separated.info.go, NO_MODULE, KNOWN) ?? '', /go:noinline/);
	const crlf = (await goInfo('shop/b.go', 'package shop\r\n\r\nfunc b() {}\r\n'))!;
	assert.match(goSkipReason('shop/b.go', crlf.info.go, NO_MODULE, KNOWN) ?? '', /CRLF/);
	const generated = (await goInfo('shop/c.go', '// Code generated by x; DO NOT EDIT.\n\npackage shop\n'))!;
	assert.equal(goSkipReason('shop/c.go', generated.info.go, NO_MODULE, KNOWN), 'generated code');
	const plain = (await goInfo('shop/d.go', 'package shop\n\nfunc d() {}\n'))!;
	assert.equal(goSkipReason('shop/d.go', plain.info.go, NO_MODULE, KNOWN), undefined);
	assert.match(goSkipReason('shop/d_linux.go', plain.info.go, NO_MODULE, KNOWN) ?? '', /_linux/);
	assert.match(goSkipReason('svc/d.go', plain.info.go, { ...NO_MODULE, nestedModules: ['svc'] }, KNOWN) ?? '', /nested module svc/);
	assert.match(goSkipReason('vendor/x/d.go', plain.info.go, NO_MODULE, KNOWN) ?? '', /vendored/);
	assert.ok(namedByDirective('shop/d.go', [{ dir: 'shop', text: '//go:embed *.go' }]));
	assert.ok(namedByDirective('shop/d.go', [{ dir: 'tools', text: '//go:generate cp ../shop/d.go out.go' }]));
	assert.ok(!namedByDirective('shop/d.go', [{ dir: 'shop', text: '//go:embed static/*' }]));
	const cgo = (await goInfo('shop/e.go', 'package shop\n\n// #include <stdio.h>\nimport "C"\n'))!;
	assert.equal(goSkipReason('shop/e.go', cgo.info.go, NO_MODULE, KNOWN), 'it uses cgo');
});

test('embed vars, //go:generate in a doc comment, and an iota group move only as their rules allow', async t => {
	const text = 'package shop\n\nimport _ "embed"\n\n//go:embed hello.txt\n\nvar hello string\n\n// Colour is generated.\n//\n//go:generate stringer -type=Colour\n'
		+ 'type Colour int\n\nconst (\n\tRed Colour = iota\n\tGreen\n)\n\nvar plain string\n';
	const parsed = await goInfo('shop/embed.go', text);
	if (!parsed) { t.skip('Go is not installed'); return; }
	const [hello, colour, group, plain] = parsed.info.declarations;
	assert.match(hello.reason ?? '', /go:embed/);
	assert.match(colour.reason ?? '', /go:generate/);
	assert.deepEqual(group.names, ['Red', 'Green']);
	assert.ok(group.movable && plain.movable);
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `error TS2307: Cannot find module '../src/aiready/goRules'` (or `goAst`).

- [ ] **Step 3: Implement.**

Create `src/aiready/projectCommands.ts`:

````ts
import { execFile, spawn } from 'child_process';
import { accessSync, constants, createWriteStream, mkdirSync, readdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** A cancellation token; `vscode.CancellationToken` fits. */
export interface Cancel {
	readonly isCancellationRequested: boolean;
	onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface CommandOutput {
	/** Undefined when the command could not start, timed out or was stopped. */
	readonly code: number | undefined;
	readonly stdout: string;
	/** Stdout and stderr together, interleaved as they arrived. */
	readonly output: string;
	readonly timedOut: boolean;
	readonly error?: string;
}

const SHELL_CHARACTERS = /[;&|<>`$(){}[\]*?!~"'\\\n]/;
const MAX_OUTPUT = 64 * 1024 * 1024;

/**
 * Finds a tool without a shell: PATH first, then the usual install folders, because apps started from the Dock get a
 * shorter PATH than the user's terminal.
 */
export function findTool(name: string): string | undefined {
	const home = os.homedir();
	let sdks: string[] = [];
	try { sdks = readdirSync(path.join(home, 'sdk')).filter(dir => dir.startsWith('go')).map(dir => path.join(home, 'sdk', dir, 'bin')); } catch { sdks = []; }
	const dirs = [...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
		'/opt/homebrew/bin', '/usr/local/go/bin', '/usr/local/bin', '/usr/bin', path.join(home, 'go', 'bin'), ...sdks];
	return dirs.map(dir => path.join(dir, name)).find(file => {
		try { accessSync(file, constants.X_OK); return true; } catch { return false; }
	});
}

/** An approved command line as program and arguments; undefined when it has anything a shell would interpret. */
export function splitCommand(text: string): { bin: string; args: string[] } | undefined {
	if (SHELL_CHARACTERS.test(text)) { return undefined; }
	const [bin, ...args] = text.trim().split(/\s+/);
	return bin ? { bin, args } : undefined;
}

export interface RunOptions {
	readonly cwd: string;
	/** The exact command lines the user approved; anything else is refused. */
	readonly approved: readonly string[];
	readonly timeoutMs: number;
	/** The full output is written here. */
	readonly logFile: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly cancel?: Cancel;
}

/** Runs one approved command without a shell, in its own process group so Stop and the timeout end its children too. */
export function runCommand(text: string, options: RunOptions): Promise<CommandOutput> {
	const parts = splitCommand(text);
	if (!options.approved.includes(text) || !parts) {
		return Promise.resolve({ code: undefined, stdout: '', output: '', timedOut: false, error: `Refused a command that was not approved: ${text}` });
	}
	const bin = path.isAbsolute(parts.bin) ? parts.bin : findTool(parts.bin);
	if (!bin) { return Promise.resolve({ code: undefined, stdout: '', output: '', timedOut: false, error: `${parts.bin} was not found.` }); }
	mkdirSync(path.dirname(options.logFile), { recursive: true });
	const log = createWriteStream(options.logFile);
	log.write(`$ ${text}\n# in ${options.cwd}\n`);
	return new Promise(resolve => {
		const child = spawn(bin, parts.args, {
			cwd: options.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, ...options.env, PATH: `${path.dirname(bin)}${path.delimiter}${process.env.PATH ?? ''}` },
		});
		const stdout: Buffer[] = [];
		const output: Buffer[] = [];
		let size = 0;
		let timedOut = false;
		let ended = false;
		const kill = () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); } };
		const keep = (into: Buffer[]) => (chunk: Buffer) => {
			log.write(chunk);
			size += chunk.length;
			if (size > MAX_OUTPUT) { kill(); return; }
			into.push(chunk);
			output.push(chunk);
		};
		child.stdout.on('data', keep(stdout));
		child.stderr.on('data', keep([]));
		const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
		const cancelled = options.cancel?.onCancellationRequested(kill);
		const finish = (code: number | undefined, error?: string) => {
			if (ended) { return; }
			ended = true;
			clearTimeout(timer);
			cancelled?.dispose();
			const stopped = timedOut || options.cancel?.isCancellationRequested || size > MAX_OUTPUT;
			const result = { code: stopped ? undefined : code, stdout: Buffer.concat(stdout).toString('utf8'), output: Buffer.concat(output).toString('utf8'), timedOut, error };
			// Resolve once the log is on disk, so it is complete when the result is read.
			log.end(`\n# exit ${code ?? (timedOut ? 'timeout' : 'stopped')}\n`, () => resolve(result));
		};
		child.on('error', error => finish(undefined, `Could not start ${parts.bin}: ${error.message}`));
		child.on('close', code => finish(code ?? undefined));
	});
}

/** The last lines of a command's output, for Pair. */
export function tail(output: string, lines = 20): string {
	return output.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

/** Runs a read-only tool (git, go list, gofmt -l, the parser helper) and returns its output. */
export function runTool(bin: string, args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise(resolve => {
		execFile(bin, [...args], { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }, (error, stdout, stderr) => {
			const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
			resolve({ code, stdout, stderr: stderr || (error && !stderr ? error.message : '') });
		});
	});
}
````

Create `src/aiready/goAst.ts`:

````ts
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'fs';
import * as path from 'path';
import { runTool } from './projectCommands';

/** One import spec, as `resources/goast` prints it. */
export interface GoImport {
	readonly name: string;
	readonly path: string;
	readonly start: number;
	readonly end: number;
	/** In a parenthesized group and alone on its lines, so it can be removed line by line. */
	readonly own: boolean;
	/** Index into `importDecls`. */
	readonly decl: number;
	/** Specs in one run are adjacent; runs are separated by a blank line or another import declaration. */
	readonly run: number;
	readonly blank: boolean;
	readonly dot: boolean;
}

/** One top-level declaration other than an import. */
export interface GoDecl {
	readonly id: number;
	readonly kind: 'func' | 'method' | 'type' | 'const' | 'var';
	readonly grouped: boolean;
	readonly names: readonly string[];
	readonly receiver: string;
	readonly start: number;
	readonly end: number;
	readonly lines: number;
	readonly doc: string;
	readonly docText: string;
	readonly isInit: boolean;
	readonly hasInit: boolean;
	readonly embed: boolean;
	readonly generate: boolean;
	readonly own: boolean;
	/** X of each selector X.Sel that the parser left unresolved: import names, or names from other files. */
	readonly qualifiers: readonly string[];
}

export interface GoDirective {
	readonly line: number;
	readonly offset: number;
	readonly text: string;
}

/** The helper's JSON for one file. */
export interface GoAst {
	readonly package: string;
	readonly packageSpan: readonly [number, number];
	readonly buildConstraint: boolean;
	readonly cgo: boolean;
	readonly generated: boolean;
	readonly bom: boolean;
	readonly crlf: boolean;
	readonly imports: readonly GoImport[];
	readonly importDecls: readonly (readonly [number, number])[];
	readonly decls: readonly GoDecl[];
	readonly directives: readonly GoDirective[];
}

/**
 * Builds the parser helper once per extension version and helper source, with the user's own Go and
 * `GOTOOLCHAIN=local`, in an empty folder outside any module. Returns the binary's path.
 */
export async function buildGoHelper(mainGo: string, storageDir: string, version: string, go: string): Promise<string> {
	const hash = createHash('sha1').update(readFileSync(mainGo)).digest('hex').slice(0, 8);
	const dir = path.join(storageDir, 'goast', `${version}-${hash}`);
	const binary = path.join(dir, 'goast');
	if (existsSync(binary)) { return binary; }
	mkdirSync(dir, { recursive: true });
	const work = mkdtempSync(path.join(dir, 'build-'));
	try {
		copyFileSync(mainGo, path.join(work, 'main.go'));
		const built = await runTool(go, ['build', '-o', path.join(work, 'goast'), 'main.go'], work,
			{ GOTOOLCHAIN: 'local', GOFLAGS: '', GOWORK: 'off', CGO_ENABLED: '0' });
		if (built.code !== 0) { throw new Error(`Could not build the Go parser helper: ${built.stderr.trim().slice(0, 500)}`); }
		renameSync(path.join(work, 'goast'), binary);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
	return binary;
}

/** Parses one Go file with the helper. */
export async function goFileInfo(helper: string, file: string): Promise<GoAst> {
	const result = await runTool(helper, [file], path.dirname(file));
	if (result.code !== 0) { throw new Error(`${path.basename(file)} could not be parsed: ${result.stderr.trim().slice(0, 300)}`); }
	return JSON.parse(result.stdout) as GoAst;
}
````

Create `src/aiready/goRules.ts`:

````ts
import * as path from 'path';
import type { GoAst, GoDecl, GoImport } from './goAst';
import type { Declaration, FileInfo } from './language';

/** go/build's known GOOS and GOARCH values (syslist.go); `go tool dist list` adds any newer ones. */
const KNOWN_OS = 'aix android darwin dragonfly freebsd hurd illumos ios js linux nacl netbsd openbsd plan9 solaris wasip1 windows zos';
const KNOWN_ARCH = '386 amd64 amd64p32 arm armbe arm64 arm64be loong64 mips mipsle mips64 mips64le mips64p32 mips64p32le ppc ppc64 ppc64le riscv riscv64 s390 s390x sparc sparc64 wasm';

export interface Platforms {
	readonly os: ReadonlySet<string>;
	readonly arch: ReadonlySet<string>;
}

/** GOOS and GOARCH names from `go tool dist list` output (`linux/amd64` lines) plus go/build's own lists. */
export function platforms(distList = ''): Platforms {
	const os = new Set(KNOWN_OS.split(' '));
	const arch = new Set(KNOWN_ARCH.split(' '));
	for (const line of distList.split('\n')) {
		const [goos, goarch] = line.trim().split('/');
		if (goos && goarch) { os.add(goos); arch.add(goarch); }
	}
	return { os, arch };
}

/** The `_GOOS`, `_GOARCH` or `_GOOS_GOARCH` ending that makes Go treat a file name as a build constraint. */
export function platformSuffix(name: string, known: Platforms): string | undefined {
	const stem = name.split('.')[0];
	const underscore = stem.indexOf('_');
	if (underscore < 0) { return undefined; }
	const parts = stem.slice(underscore).split('_');
	if (parts[parts.length - 1] === 'test') { parts.pop(); }
	const n = parts.length;
	if (n >= 2 && known.os.has(parts[n - 2]) && known.arch.has(parts[n - 1])) { return `_${parts[n - 2]}_${parts[n - 1]}`; }
	if (n >= 1 && (known.os.has(parts[n - 1]) || known.arch.has(parts[n - 1]))) { return `_${parts[n - 1]}`; }
	return undefined;
}

/** Why Go would ignore, constrain or misread a new file with this name. */
export function goFileNameProblems(name: string, known: Platforms): string[] {
	const problems: string[] = [];
	if (!/^[a-z0-9][a-z0-9_]*\.go$/.test(name)) {
		problems.push('use lower-case letters, digits and underscores, end in .go, and do not start with _ or . (Go ignores such files)');
	}
	if (name.endsWith('_test.go')) { problems.push('a new file must not be a test file'); }
	const suffix = platformSuffix(name, known);
	if (suffix) { problems.push(`the name ends in ${suffix}, which Go treats as a build constraint`); }
	return problems;
}

/** Module-wide facts a file's skip decision needs. */
export interface GoModuleFacts {
	/** Folders below the root (relative, `/`-separated) that have their own go.mod. */
	readonly nestedModules: readonly string[];
	/** Every `//go:generate` and `//go:embed` line in the module, with the folder of its file. */
	readonly directiveLines: readonly { readonly dir: string; readonly text: string }[];
}

/** `//go:generate` and `//go:embed` lines in one file's text. */
export function directiveLines(file: string, text: string): { dir: string; text: string }[] {
	const dir = path.posix.dirname(file);
	return [...text.matchAll(/^[ \t]*(\/\/go:(?:generate|embed)\s.*)$/gm)].map(match => ({ dir, text: match[1].trim() }));
}

function globToRegExp(glob: string): RegExp {
	const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
	return new RegExp(`^${body}(?:/.*)?$`);
}

/** Whether a `//go:generate` or `//go:embed` line anywhere in the module names this file. */
export function namedByDirective(file: string, lines: GoModuleFacts['directiveLines']): boolean {
	const base = path.posix.basename(file);
	return lines.some(line => {
		const tokens = line.text.split(/\s+/).slice(1).map(token => token.replace(/^["`]|["`]$/g, ''));
		if (line.text.startsWith('//go:generate')) { return tokens.some(token => token.includes(base)); }
		const relative = path.posix.relative(line.dir === '.' ? '' : line.dir, file);
		return tokens.some(token => token.includes(base) || globToRegExp(token).test(relative));
	});
}

/** Why a Go file is never split or given tests, or undefined. */
export function goSkipReason(file: string, ast: GoAst, module: GoModuleFacts, known: Platforms): string | undefined {
	if (file.endsWith('_test.go')) { return 'test files are not split in this version'; }
	if (/(^|\/)vendor\//.test(file)) { return 'vendored code'; }
	const nested = module.nestedModules.find(dir => file.startsWith(`${dir}/`));
	if (nested) { return `inside the nested module ${nested}/`; }
	if (ast.generated) { return 'generated code'; }
	if (ast.buildConstraint) { return 'it has a build constraint'; }
	const suffix = platformSuffix(path.posix.basename(file), known);
	if (suffix) { return `its name ends in ${suffix}, a build constraint`; }
	if (ast.cgo) { return 'it uses cgo'; }
	if (ast.bom) { return 'it starts with a byte-order mark'; }
	if (ast.crlf) { return 'it has CRLF line endings'; }
	const directive = ast.directives.find(d => !d.text.startsWith('//go:embed') && !d.text.startsWith('//go:generate'));
	if (directive) { return `it has the directive \`${directive.text}\` on line ${directive.line}`; }
	if (ast.imports.some(i => i.dot)) { return 'it has a dot import'; }
	if (namedByDirective(file, module.directiveLines)) { return 'a //go:generate or //go:embed line names it'; }
	return undefined;
}

/** The name a file uses for an import: its explicit name, else the package name from `go list`, else a guess. */
export function importName(spec: GoImport, packageNames: ReadonlyMap<string, string>): string {
	if (spec.name) { return spec.name; }
	return packageNames.get(spec.path) ?? spec.path.split('/').filter(part => !/^v\d+$/.test(part)).pop() ?? spec.path;
}

function unmovable(decl: GoDecl): string | undefined {
	if (!decl.own) { return 'it shares a line with other code'; }
	if (decl.isInit) { return 'init functions run in file order'; }
	if (decl.embed) { return 'a //go:embed variable needs the embed import kept with it'; }
	if (decl.generate) { return 'a //go:generate line inside it would change $GOFILE and generation order'; }
	if (decl.kind === 'var' && decl.hasInit) { return 'an initialized package variable keeps its place in initialization order'; }
	return undefined;
}

/** A parsed Go file: the language-neutral view plus the helper's output, which the Go split needs. */
export interface GoFileInfo extends FileInfo {
	readonly go: GoAst;
}

/** The language-neutral view of a parsed Go file. */
export function goFileInfoView(file: string, ast: GoAst, packageNames: ReadonlyMap<string, string>, skip?: string): GoFileInfo {
	const usable = ast.imports.filter(i => !i.blank && !i.dot);
	const declarations: Declaration[] = ast.decls.map(decl => {
		const reason = unmovable(decl);
		return {
			id: decl.id, kind: decl.grouped ? `${decl.kind} (…)` : decl.kind, names: decl.names, receiver: decl.receiver || undefined,
			span: { start: decl.start, end: decl.end }, lines: decl.lines, doc: decl.doc, docText: decl.docText,
			uses: usable.filter(i => decl.qualifiers.includes(importName(i, packageNames))).map(i => i.path),
			movable: !reason, reason,
		};
	});
	const decls = ast.importDecls;
	return {
		path: file, declarations,
		importRegion: decls.length ? { start: decls[0][0], end: decls[decls.length - 1][1] } : undefined,
		frame: [{ start: 0, end: ast.packageSpan[1] }, ...decls.map(([start, end]) => ({ start, end }))],
		imports: ast.imports.map(i => `${i.name} ${i.path}`.trim()),
		skip, go: ast,
	};
}
````

In `tsconfig.test.json`, add `"src/aiready/projectCommands.ts"`, `"src/aiready/goAst.ts"`, `"src/aiready/goRules.ts"` to the end of the `include` array, in that order (add a comma after the previous last entry).

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\|skipped\)'` → `ℹ pass 141`, `ℹ fail 0`, `ℹ skipped 0` (with Go installed).

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/projectCommands.ts src/aiready/goAst.ts src/aiready/goRules.ts test/goFixture.ts test/aiReadyGoRules.test.ts tsconfig.test.json
git commit -m "Build the Go helper and decide which Go files and declarations may move"
```

---

## Chunk 3: Applying a split, validating plans, and the move check

### Task 4: Go split, plan validation and move rules 1–4

**Files:**
- Create: `src/aiready/goSplit.ts`, `src/aiready/splitPlan.ts`, `src/aiready/moveCheck.ts`, `test/aiReadyGoSplit.test.ts`
- Modify: `tsconfig.test.json`

`buildGoSplit` works on lines of a `Buffer` (byte offsets, never JS string indices). New file: header comment, blank line, package clause, an import block with exactly the imports its declarations use (original names, paths and groups), then the spans in original order, one blank line apart. Original: moved spans and unused import specs removed; a run of blank lines and removed lines collapses to one blank line (none at the end of the file), and inside a kept import block there is no blank line after `(` or before `)`, so a gofmt-clean original stays gofmt-clean.

`checkMove` is independent of `buildGoSplit`: it re-reads the written files through the adapter's parse. Rule 1 compares each new file's declarations with its planned spans byte for byte; rule 3 removes declarations and the frame (header, package clause, imports) and requires only whitespace to remain; rule 2 compares the original line by line, with the import region as one opaque line and the import set only allowed to shrink. `declarationProblems` (rule 4) compares the package's multiset of `kind (receiver) names + doc comment`, so `_` names and several `init`s count correctly and a detached comment that became a doc comment is caught.

- [ ] **Step 1: Write the failing test.**

Create `test/aiReadyGoSplit.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { goFileNameProblems } from '../src/aiready/goRules';
import { buildGoSplit } from '../src/aiready/goSplit';
import type { LanguageAdapter, SplitPlan } from '../src/aiready/language';
import { checkMove, declarationProblems } from '../src/aiready/moveCheck';
import { parsePlan, planProblems } from '../src/aiready/splitPlan';
import { goInfo, KNOWN, SHOP, YAML } from './goFixture';

const PLAN: SplitPlan = [{ file: 'shop_yaml.go', declarations: [6] }, { file: 'shop_misc.go', declarations: [3, 4, 5, 7] }];

/** Only the parts of the adapter that the pure plan check uses. */
const adapter = {
	fileNameProblems: (name: string) => goFileNameProblems(name, KNOWN),
	buildSplit: buildGoSplit,
} as unknown as LanguageAdapter;

test('a split builds new files with a header, a blank line and only the imports they use', async t => {
	const parsed = await goInfo('shop/shop.go', SHOP, YAML);
	if (!parsed) { t.skip('Go is not installed'); return; }
	const result = buildGoSplit(parsed.source, parsed.info, PLAN);
	assert.equal(result.files[0].text.toString(), '// Split from shop.go by my_editor.\n\npackage shop\n\nimport (\n\t"gopkg.in/yaml.v3"\n)\n\n'
		+ '// Encode writes v as YAML.\nfunc Encode(v any) ([]byte, error) { return yaml.Marshal(v) } // nolint\n');
	assert.match(result.files[1].text.toString(), /import \(\n\t"fmt"\n\t"strings"\n\)\n\nvar _ fmt.Stringer\n\nvar _ fmt.Stringer\n\nvar cache/);
	const original = result.original.toString();
	assert.match(original, /import \(\n\t"fmt"\n\)\n/);
	assert.match(original, /var counter = 1\n\n\/\/ Detached note about encoding.\n\nfunc describe/);
	assert.doesNotMatch(original, /\n\n\n/);
});

test('the move check passes a clean split, including rule 4 across the package', async t => {
	const parsed = await goInfo('shop/shop.go', SHOP, YAML);
	if (!parsed) { t.skip('Go is not installed'); return; }
	const result = buildGoSplit(parsed.source, parsed.info, PLAN);
	const after = (await goInfo('shop/shop.go', result.original, YAML))!;
	const files = [(await goInfo('shop/shop_yaml.go', result.files[0].text, YAML))!, (await goInfo('shop/shop_misc.go', result.files[1].text, YAML))!];
	const input = { before: { text: parsed.source, info: parsed.info }, after: { text: after.source, info: after.info },
		files: files.map(f => ({ text: f.source, info: f.info })), plan: PLAN };
	assert.deepEqual(checkMove(input), []);
	assert.deepEqual(declarationProblems([parsed.info], [after.info, ...files.map(f => f.info)]), []);
});

test('the move check catches an edited body, extra content, reordering and a new import', async t => {
	const parsed = await goInfo('shop/shop.go', SHOP, YAML);
	if (!parsed) { t.skip('Go is not installed'); return; }
	const result = buildGoSplit(parsed.source, parsed.info, PLAN);
	const after = (await goInfo('shop/shop.go', result.original, YAML))!;
	const misc = (await goInfo('shop/shop_misc.go', result.files[1].text, YAML))!;
	const check = async (yamlText: string, originalText = result.original.toString()) => {
		const yaml = (await goInfo('shop/shop_yaml.go', yamlText, YAML))!;
		const original = (await goInfo('shop/shop.go', originalText, YAML))!;
		return checkMove({ before: { text: parsed.source, info: parsed.info }, after: { text: original.source, info: original.info },
			files: [{ text: yaml.source, info: yaml.info }, { text: misc.source, info: misc.info }], plan: PLAN }).join(' ');
	};
	const yaml = result.files[0].text.toString();
	assert.match(await check(yaml.replace('yaml.Marshal', 'yaml.Unmarshal')), /Rule 1/);
	assert.match(await check(`${yaml}\n// stray\n`), /Rule 3/);
	const original = result.original.toString();
	const swapped = original.replace('var counter = 1\n\n', '').replace('func describe', 'var counter = 1\n\nfunc describe');
	assert.match(await check(yaml, swapped), /Rule 2/);
	assert.match(await check(yaml, original.replace('\t"fmt"\n', '\t"fmt"\n\t"os"\n')), /gained the import os/);
	const attached = (await goInfo('shop/shop.go', original.replace('encoding.\n\nfunc', 'encoding.\nfunc'), YAML))!;
	assert.match(declarationProblems([after.info], [attached.info]).join(' '), /Rule 4: func describe/);
});

test('plans refer to IDs: unknown, repeated, unmovable and over-long plans are refused with reasons', async t => {
	const parsed = await goInfo('shop/shop.go', SHOP, YAML);
	if (!parsed) { t.skip('Go is not installed'); return; }
	const input = { source: parsed.source, info: parsed.info, existing: ['shop.go', 'Shop_Yaml.go'] };
	assert.deepEqual(planProblems(adapter, { ...input, existing: ['shop.go'] }, PLAN), []);
	const problems = planProblems(adapter, input, [{ file: 'shop_yaml.go', declarations: [6, 6, 2, 42] }, { file: 'shop_linux.go', declarations: [3] }]).join(' ');
	assert.match(problems, /42 does not exist/);
	assert.match(problems, /6 is listed twice/);
	assert.match(problems, /2 \(var counter\) may not move: an initialized package variable/);
	assert.match(problems, /shop_yaml.go already exists/);
	assert.match(problems, /_linux, which Go treats as a build constraint/);
	const long = `package shop\n\n${Array.from({ length: 450 }, (_, i) => `func f${i}() {}`).join('\n')}\n`;
	const big = (await goInfo('shop/big.go', long))!;
	assert.match(planProblems(adapter, { source: big.source, info: big.info, existing: [] }, [{ file: 'big_a.go', declarations: [0] }]).join(' '),
		/big.go would still have 451 lines/);
	assert.deepEqual(parsePlan('Here: [{"file":"a.go","declarations":[1,2]}]'), [{ file: 'a.go', declarations: [1, 2] }]);
	assert.equal(parsePlan('[{"file":"a.go","declarations":["x"]}]'), undefined);
});

test('a blank import stays in the original, and a file with no used import gets no import block', async t => {
	const parsed = await goInfo('shop/embed.go', 'package shop\n\nimport _ "embed"\n\ntype Colour int\n\nvar plain string\n');
	if (!parsed) { t.skip('Go is not installed'); return; }
	const result = buildGoSplit(parsed.source, parsed.info, [{ file: 'embed_more.go', declarations: [0, 1] }]);
	assert.equal(result.original.toString(), 'package shop\n\nimport _ "embed"\n');
	assert.equal(result.files[0].text.toString(), '// Split from embed.go by my_editor.\n\npackage shop\n\ntype Colour int\n\nvar plain string\n');
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `error TS2307: Cannot find module '../src/aiready/goSplit'`.

- [ ] **Step 3: Implement.**

Create `src/aiready/goSplit.ts`:

````ts
import * as path from 'path';
import type { GoImport } from './goAst';
import type { GoFileInfo } from './goRules';
import type { Declaration, SplitPlan, SplitResult } from './language';

interface Line {
	readonly text: Buffer;
	readonly start: number;
	readonly end: number;
	/** A gap is a removed line; blank lines around gaps collapse. */
	gap: boolean;
}

/**
 * Applies a Go split plan, without AI. Each new file is a header comment naming the original, a blank line, the
 * package clause, an import block with exactly the imports its declarations use, then the moved spans byte for byte
 * in their original order, one blank line apart. The original keeps everything else byte for byte, minus the moved
 * spans and the import specs nothing left in it uses; blank lines around a removed span collapse to one.
 */
export function buildGoSplit(source: Buffer, info: GoFileInfo, plan: SplitPlan): SplitResult {
	if (info.go.imports.some(spec => spec.dot)) { throw new Error(`${info.path} has a dot import and is not split.`); }
	const byId = new Map(info.declarations.map(d => [d.id, d]));
	const moved = new Set(plan.flatMap(group => group.declarations));
	const files = plan.map(group => ({
		name: group.file,
		text: newFile(source, info, group.declarations.map(id => byId.get(id)!).sort((a, b) => a.id - b.id)),
	}));
	const used = new Set(info.declarations.filter(d => !moved.has(d.id)).flatMap(d => d.uses));
	return { original: rebuildOriginal(source, info, moved, used), files };
}

function newFile(source: Buffer, info: GoFileInfo, declarations: readonly Declaration[]): Buffer {
	const used = new Set(declarations.flatMap(d => d.uses));
	const specs = info.go.imports.filter(spec => !spec.blank && used.has(spec.path));
	const lines: string[] = [];
	specs.forEach((spec, index) => {
		if (index > 0 && spec.run !== specs[index - 1].run) { lines.push(''); }
		lines.push(`\t${spec.name ? `${spec.name} ` : ''}${JSON.stringify(spec.path)}`);
	});
	const head = `// Split from ${path.posix.basename(info.path)} by my_editor.\n\npackage ${info.go.package}\n\n`
		+ (lines.length ? `import (\n${lines.join('\n')}\n)\n\n` : '');
	const spans = declarations.flatMap((d, index) => [...(index ? [Buffer.from('\n\n')] : []), source.subarray(d.span.start, d.span.end)]);
	return Buffer.concat([Buffer.from(head), ...spans, Buffer.from('\n')]);
}

function rebuildOriginal(source: Buffer, info: GoFileInfo, moved: ReadonlySet<number>, used: ReadonlySet<string>): Buffer {
	let lines = splitLines(source);
	const inside = (line: Line, start: number, end: number) => line.start >= start && line.end <= end;
	for (const d of info.declarations.filter(d => moved.has(d.id))) {
		for (const line of lines) { if (inside(line, d.span.start, d.span.end)) { line.gap = true; } }
	}
	const keep = (spec: GoImport) => spec.blank || used.has(spec.path);
	info.go.importDecls.forEach(([start, end], index) => {
		const specs = info.go.imports.filter(spec => spec.decl === index);
		if (!specs.some(keep)) {
			for (const line of lines) { if (inside(line, start, end)) { line.gap = true; } }
			return;
		}
		const dropped = specs.filter(spec => !keep(spec));
		if (!dropped.length) { return; }
		const shared = dropped.find(spec => !spec.own);
		if (shared) { throw new Error(`The import ${shared.path} in ${info.path} shares a line with other code.`); }
		const block = lines.filter(line => inside(line, start, end) && !dropped.some(spec => inside(line, spec.start, spec.end)));
		lines = [...lines.filter(line => line.end < start), ...tidyImportBlock(block), ...lines.filter(line => line.start > end)];
	});
	return joinLines(collapse(lines), source.length > 0 && source[source.length - 1] === 10);
}

/** Inside a parenthesized import block: no blank line after `(` or before `)`, and no two blank lines in a row. */
function tidyImportBlock(block: Line[]): Line[] {
	const blank = (line: Line) => line.text.toString('utf8').trim() === '';
	const out: Line[] = [];
	for (const line of block) {
		const previous = out[out.length - 1];
		if (blank(line) && (!previous || blank(previous) || previous.text.toString('utf8').trimEnd().endsWith('('))) { continue; }
		if (line.text.toString('utf8').trim().startsWith(')') && previous && blank(previous)) { out.pop(); }
		out.push(line);
	}
	return out;
}

/**
 * Each run of blank lines and gaps holding a gap becomes one blank line if it held a blank line, else nothing; at the
 * end of the file it becomes nothing.
 */
function collapse(lines: readonly Line[]): Buffer[] {
	const blank = (line: Line) => !line.gap && line.text.toString('utf8').trim() === '';
	const out: Buffer[] = [];
	for (let i = 0; i < lines.length;) {
		if (!lines[i].gap && !blank(lines[i])) { out.push(lines[i].text); i++; continue; }
		let j = i;
		while (j < lines.length && (lines[j].gap || blank(lines[j]))) { j++; }
		const run = lines.slice(i, j);
		if (!run.some(line => line.gap)) { out.push(...run.map(line => line.text)); }
		else if (run.some(blank) && j < lines.length) { out.push(Buffer.alloc(0)); }
		i = j;
	}
	return out;
}

function splitLines(source: Buffer): Line[] {
	const lines: Line[] = [];
	let start = 0;
	for (let i = source.indexOf(10); i >= 0; i = source.indexOf(10, start)) {
		lines.push({ text: source.subarray(start, i), start, end: i, gap: false });
		start = i + 1;
	}
	if (start < source.length) { lines.push({ text: source.subarray(start), start, end: source.length, gap: false }); }
	return lines;
}

function joinLines(lines: readonly Buffer[], finalNewline: boolean): Buffer {
	const parts = lines.flatMap((line, index) => index ? [Buffer.from('\n'), line] : [line]);
	return Buffer.concat([...parts, ...(finalNewline && lines.length ? [Buffer.from('\n')] : [])]);
}
````

Create `src/aiready/splitPlan.ts`:

````ts
import { MAX_SOURCE_LINES, sourceLines } from '../quality/sourcePolicy';
import type { Declaration, FileInfo, LanguageAdapter, Prompt, SplitPlan, SplitResult } from './language';

/** The model's split plan from its reply: a JSON array of `{ file, declarations }`, or undefined. */
export function parsePlan(reply: string): SplitPlan | undefined {
	const start = reply.indexOf('[');
	const end = reply.lastIndexOf(']');
	if (start < 0 || end <= start) { return undefined; }
	try {
		const value: unknown = JSON.parse(reply.slice(start, end + 1));
		if (!Array.isArray(value)) { return undefined; }
		const plan = value.map(item => {
			const group = item as { file?: unknown; declarations?: unknown };
			if (typeof group.file !== 'string' || !Array.isArray(group.declarations)
				|| !group.declarations.every(id => Number.isInteger(id))) { throw new Error('bad group'); }
			return { file: group.file, declarations: group.declarations as number[] };
		});
		return plan;
	} catch {
		return undefined;
	}
}

/** Tells the model why its plan was rejected, for its one retry. */
export function retryText(prompt: Prompt, reply: string, problems: readonly string[]): string {
	return `${prompt.text}\n\nYour previous plan:\n${reply.slice(0, 4_000)}\n\nIt was rejected:\n${problems.map(p => `- ${p}`).join('\n')}\n\nReply with a corrected JSON array only.`;
}

export interface PlanInput {
	readonly source: Buffer;
	readonly info: FileInfo;
	/** File names already in the folder. */
	readonly existing: readonly string[];
}

/** Every reason the plan cannot be used; empty means the plan may be applied. */
export function planProblems(adapter: LanguageAdapter, input: PlanInput, plan: SplitPlan): string[] {
	const problems: string[] = [];
	const byId = new Map(input.info.declarations.map(d => [d.id, d]));
	const seen = new Set<number>();
	const names = new Set<string>();
	const existing = new Set(input.existing.map(name => name.toLowerCase()));
	if (!plan.length) { problems.push('The plan moves nothing.'); }
	for (const group of plan) {
		if (!group.declarations.length) { problems.push(`${group.file} has no declarations.`); }
		for (const id of group.declarations) {
			const declaration = byId.get(id);
			if (!declaration) { problems.push(`Declaration ${id} does not exist.`); }
			else if (seen.has(id)) { problems.push(`Declaration ${id} is listed twice.`); }
			else if (!declaration.movable) { problems.push(`Declaration ${id} (${label(declaration)}) may not move: ${declaration.reason ?? 'not movable'}.`); }
			seen.add(id);
		}
		problems.push(...adapter.fileNameProblems(group.file).map(problem => `${group.file}: ${problem}`));
		if (existing.has(group.file.toLowerCase())) { problems.push(`${group.file} already exists in the folder.`); }
		if (names.has(group.file.toLowerCase())) { problems.push(`${group.file} appears twice in the plan.`); }
		names.add(group.file.toLowerCase());
	}
	if (problems.length) { return problems; }
	let result: SplitResult;
	try { result = adapter.buildSplit(input.source, input.info, plan); }
	catch (error) { return [error instanceof Error ? error.message : String(error)]; }
	const moved = new Set(plan.flatMap(group => group.declarations));
	const left = input.info.declarations.filter(d => !moved.has(d.id));
	if (!lineLimitAllowed(result.original, left)) {
		problems.push(`${input.info.path} would still have ${lines(result.original)} lines; the limit is ${MAX_SOURCE_LINES}.`);
	}
	for (const [index, file] of result.files.entries()) {
		const group = plan[index].declarations.map(id => byId.get(id)!);
		if (!lineLimitAllowed(file.text, group)) {
			problems.push(`${file.name} would have ${lines(file.text)} lines; the limit is ${MAX_SOURCE_LINES}.`);
		}
	}
	return problems;
}

/**
 * A file may exceed the limit only when one declaration in it is itself over the limit and nothing else in it could
 * move out: it holds that declaration plus unmovable ones only.
 */
function lineLimitAllowed(text: Buffer, declarations: readonly Declaration[]): boolean {
	if (lines(text) <= MAX_SOURCE_LINES) { return true; }
	const big = declarations.filter(d => d.lines > MAX_SOURCE_LINES);
	return big.length === 1 && declarations.every(d => d === big[0] || !d.movable);
}

/** Files left over the limit by a single long declaration, for the change note. */
export function oversizeNotes(result: SplitResult, info: FileInfo, plan: SplitPlan): string[] {
	const moved = new Set(plan.flatMap(group => group.declarations));
	const notes: string[] = [];
	const note = (name: string, text: Buffer, declarations: readonly Declaration[]) => {
		const big = declarations.find(d => d.lines > MAX_SOURCE_LINES);
		if (lines(text) > MAX_SOURCE_LINES && big) {
			notes.push(`${name} stays at ${lines(text)} lines: ${label(big)} alone is ${big.lines} lines and needs a real refactor.`);
		}
	};
	const byId = new Map(info.declarations.map(d => [d.id, d]));
	note(info.path, result.original, info.declarations.filter(d => !moved.has(d.id)));
	result.files.forEach((file, index) => note(file.name, file.text, plan[index].declarations.map(id => byId.get(id)!)));
	return notes;
}

export function label(declaration: Declaration): string {
	const name = declaration.names.join(', ') || '(unnamed)';
	return declaration.receiver ? `${declaration.kind} (${declaration.receiver}) ${name}` : `${declaration.kind} ${name}`;
}

function lines(text: Buffer): number {
	return sourceLines(text.toString('utf8'));
}
````

Create `src/aiready/moveCheck.ts`:

````ts
import type { Declaration, FileInfo, Span, SplitPlan } from './language';

/** A file's bytes with the adapter's parse of them. */
export interface ParsedFile {
	readonly text: Buffer;
	readonly info: FileInfo;
}

export interface MoveCheckInput {
	/** The original file before and after the split. */
	readonly before: ParsedFile;
	readonly after: ParsedFile;
	/** The new files, re-parsed from disk, in plan order. */
	readonly files: readonly ParsedFile[];
	readonly plan: SplitPlan;
}

const IMPORTS = '\u0000imports';

/**
 * Move rules 1–3, on byte spans and without AI. 1: each moved span is byte-identical to a declaration in exactly the
 * new file the plan names. 2: the original equals its old bytes minus the moved spans, with only import specs removed
 * and blank lines around removed spans collapsed to one. 3: a new file holds only its frame (header comment, package
 * clause, imports) and its moved spans. Empty means pass.
 */
export function checkMove(input: MoveCheckInput): string[] {
	const problems: string[] = [];
	const { before, after, files, plan } = input;
	const byId = new Map(before.info.declarations.map(d => [d.id, d]));
	if (files.length !== plan.length) { return [`Expected ${plan.length} new files, found ${files.length}.`]; }
	plan.forEach((group, index) => {
		const file = files[index];
		const wanted = group.declarations.map(id => slice(before.text, byId.get(id)!.span)).sort();
		const found = file.info.declarations.map(d => slice(file.text, d.span)).sort();
		if (wanted.length !== found.length || wanted.some((text, i) => text !== found[i])) {
			problems.push(`Rule 1: ${group.file} does not hold exactly its moved declarations, byte for byte.`);
		}
		const rest = remove(file.text, [...file.info.declarations.map(d => d.span), ...file.info.frame]);
		if (rest.trim()) { problems.push(`Rule 3: ${group.file} has extra content: ${JSON.stringify(rest.trim().slice(0, 80))}.`); }
	});
	const moved = plan.flatMap(group => group.declarations.map(id => byId.get(id)!.span));
	const expected = collapse(marked(before, moved, !!after.info.importRegion));
	const actual = marked(after, [], true).map(item => item ?? '');
	if (expected.length !== actual.length || expected.some((line, i) => line !== actual[i])) {
		const at = expected.findIndex((line, i) => line !== actual[i]);
		problems.push(`Rule 2: ${before.info.path} changed beyond the moved spans near line ${at + 1}: `
			+ `expected ${JSON.stringify(expected[at] ?? '(end)')}, found ${JSON.stringify(actual[at] ?? '(end)')}.`);
	}
	const count = (keys: readonly string[], key: string) => keys.filter(k => k === key).length;
	for (const key of new Set(after.info.imports)) {
		if (count(after.info.imports, key) > count(before.info.imports, key)) { problems.push(`Rule 2: ${before.info.path} gained the import ${key}.`); }
	}
	return [...new Set(problems)];
}

/** Move rule 4 for adapters whose declarations carry kind, receiver, names and doc: the same multiset before and after. */
export function declarationProblems(before: readonly FileInfo[], after: readonly FileInfo[]): string[] {
	const key = (d: Declaration) => `${d.kind}${d.receiver ? ` (${d.receiver})` : ''} ${d.names.join(', ')}\n${d.docText}`;
	const count = (infos: readonly FileInfo[]) => {
		const counts = new Map<string, number>();
		for (const d of infos.flatMap(info => info.declarations)) { counts.set(key(d), (counts.get(key(d)) ?? 0) + 1); }
		return counts;
	};
	const was = count(before);
	const now = count(after);
	const problems: string[] = [];
	for (const name of new Set([...was.keys(), ...now.keys()])) {
		const a = was.get(name) ?? 0;
		const b = now.get(name) ?? 0;
		if (a !== b) {
			const [title, doc] = name.split('\n');
			problems.push(`Rule 4: ${title}${doc ? ' (with its doc comment)' : ''} appears ${b} time${b === 1 ? '' : 's'} after the move, ${a} before.`);
		}
	}
	return problems;
}

/** The file's lines, with the import region as one marker line and removed spans as gaps (undefined). */
function marked(file: ParsedFile, removed: readonly Span[], keepImports: boolean): (string | undefined)[] {
	const out: (string | undefined)[] = [];
	const region = file.info.importRegion;
	let offset = 0;
	for (const line of lines(file.text)) {
		const start = offset;
		const end = offset + line.length;
		offset = end + 1;
		if (region && start >= region.start && end <= region.end) {
			if (start === region.start) { out.push(keepImports ? IMPORTS : undefined); }
			continue;
		}
		out.push(removed.some(span => start >= span.start && end <= span.end) ? undefined : line.toString('utf8'));
	}
	return out;
}

/** Each run of blank lines and gaps that holds a gap becomes one blank line if it held a blank line, else nothing; at the end, nothing. */
function collapse(items: readonly (string | undefined)[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < items.length;) {
		if (items[i] !== undefined && items[i]!.trim() !== '') { out.push(items[i]!); i++; continue; }
		let j = i;
		let gap = false;
		let blank = false;
		while (j < items.length && (items[j] === undefined || items[j]!.trim() === '')) {
			if (items[j] === undefined) { gap = true; } else { blank = true; }
			j++;
		}
		if (!gap) { out.push(...(items.slice(i, j) as string[])); }
		else if (blank && j < items.length) { out.push(''); }
		i = j;
	}
	return out;
}

function lines(text: Buffer): Buffer[] {
	const out: Buffer[] = [];
	let start = 0;
	for (let i = text.indexOf(10); i >= 0; i = text.indexOf(10, start)) {
		out.push(text.subarray(start, i));
		start = i + 1;
	}
	if (start < text.length) { out.push(text.subarray(start)); }
	return out;
}

function slice(text: Buffer, span: Span): string {
	return text.subarray(span.start, span.end).toString('utf8');
}

/** The text left after removing the spans. */
function remove(text: Buffer, spans: readonly Span[]): string {
	const sorted = [...spans].sort((a, b) => a.start - b.start);
	const parts: Buffer[] = [];
	let at = 0;
	for (const span of sorted) {
		if (span.start > at) { parts.push(text.subarray(at, span.start)); }
		at = Math.max(at, span.end);
	}
	parts.push(text.subarray(at));
	return Buffer.concat(parts).toString('utf8');
}
````

In `tsconfig.test.json`, add `"src/aiready/goSplit.ts"`, `"src/aiready/splitPlan.ts"`, `"src/aiready/moveCheck.ts"` to the end of the `include` array, in that order (add a comma after the previous last entry).

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 146`, `ℹ fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/goSplit.ts src/aiready/splitPlan.ts src/aiready/moveCheck.ts test/aiReadyGoSplit.test.ts tsconfig.test.json
git commit -m "Apply Go splits by declaration ID and check every move without AI"
```

---

## Chunk 4: The Go adapter, the worktree and run state

### Task 5: Go test output, prompts and the Go adapter

**Files:**
- Create: `src/aiready/goTests.ts`, `src/aiready/goPrompts.ts`, `src/aiready/goAdapter.ts`, `src/aiready/languages.ts`, `test/aiReadyGoTests.test.ts`
- Modify: `tsconfig.test.json`

The adapter's checks per file are exactly `go build ./...`, `go vet ./<pkg>` and `go test -count=1 -json ./<pkg>` (`-count=1` defeats the test cache). Package names for imports come from `go list -deps -e -f '{{.ImportPath}} {{.Name}}' ./<pkg>`, once per package (`-e` so one broken dependency does not hide the rest). Rule 4's files come from `go list -e -f '{{join .GoFiles "\n"}}' ./<pkg>`. The add-tests file is `<name>_ai_test.go`. The generated-test guard refuses another package, `TestMain`/`init`, `net`, `os/exec`, `syscall`, `unsafe`, `plugin`, `net/http` without `httptest`, and remote URLs.

- [ ] **Step 1: Write the failing test.**

Create `test/aiReadyGoTests.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { goTestNames, goTestProblems, parseGoTest } from '../src/aiready/goTests';
import { goInfo } from './goFixture';

const json = (events: object[]) => events.map(event => JSON.stringify(event)).join('\n');

test('parseGoTest keeps per-test and per-package outcomes and ignores other actions', () => {
	const parsed = parseGoTest([json([
		{ Action: 'start', Package: 'm/a' }, { Action: 'run', Package: 'm/a', Test: 'TestX' },
		{ Action: 'output', Package: 'm/a', Test: 'TestX', Output: 'ok\n' }, { Action: 'pass', Package: 'm/a', Test: 'TestX' },
		{ Action: 'fail', Package: 'm/a', Test: 'TestY/sub' }, { Action: 'skip', Package: 'm/a', Test: 'TestZ' },
		{ Action: 'build-fail', Package: 'm/b' }, { Action: 'fail', Package: 'm/a' },
	]), 'not json', '{broken'].join('\n'));
	assert.deepEqual(parsed, { tests: { 'm/a TestX': 'pass', 'm/a TestY/sub': 'fail', 'm/a TestZ': 'skip' }, packages: { 'm/a': 'fail' } });
});

test('generated Go tests must stay in the package and off the network', async t => {
	const source = await goInfo('shop/a.go', 'package shop\n\nfunc A() int { return 1 }\n');
	if (!source) { t.skip('Go is not installed'); return; }
	const good = 'package shop\n\nimport "testing"\n\nfunc TestAiA(t *testing.T) { if A() != 1 { t.Fatal() } }\n\nfunc helper() {}\n';
	const goodInfo = (await goInfo('shop/a_ai_test.go', good))!;
	assert.deepEqual(goTestNames(goodInfo.info), ['TestAiA']);
	assert.deepEqual(goTestProblems(good, goodInfo.info, source.info), []);
	const bad = 'package shop_test\n\nimport (\n\t"net/http"\n\t"os/exec"\n\t"testing"\n)\n\nfunc TestMain(m *testing.M) {}\n\n'
		+ 'func TestAiGet(t *testing.T) { http.Get("https://api.example.io/x"); exec.Command("ls") }\n';
	const badInfo = (await goInfo('shop/b_ai_test.go', bad))!;
	const problems = goTestProblems(bad, badInfo.info, source.info).join('; ');
	for (const pattern of [/package shop, not shop_test/, /TestMain/, /os\/exec/, /net\/http without/, /remote URL/]) { assert.match(problems, pattern); }
	assert.doesNotMatch(goTestProblems('x := "http://localhost:8080/" // http://example.com', goodInfo.info, source.info).join(), /remote URL/);
});

const fix = (file: string, kind: 'split' | 'tests', lines: number) => ({ file, kind, lines });
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `error TS2307: Cannot find module '../src/aiready/goTests'`.

- [ ] **Step 3: Implement.**

Create `src/aiready/goTests.ts`:

````ts
import type { Outcome, TestRun } from './baseline';
import type { GoFileInfo } from './goRules';
import type { FileInfo } from './language';

const OUTCOMES = new Set<string>(['pass', 'fail', 'skip']);
const NETWORK_IMPORTS = new Set(['net', 'net/smtp', 'net/rpc', 'net/rpc/jsonrpc', 'os/exec', 'syscall', 'unsafe', 'plugin']);
const REMOTE_URL = /\bhttps?:\/\/(?!(?:localhost|127\.0\.0\.1|\[::1\]|example\.(?:com|org|net))(?:[:/"`]|$))/;

/**
 * Per-test outcomes from `go test -json` output. Test keys are `<package> <test>`; package events have no Test.
 * Other actions (run, output, pause, start, build-output, build-fail) and non-JSON lines are ignored.
 */
export function parseGoTest(output: string): TestRun {
	const tests: Record<string, Outcome> = {};
	const packages: Record<string, Outcome> = {};
	for (const line of output.split('\n')) {
		if (!line.startsWith('{')) { continue; }
		let event: { Action?: string; Package?: string; Test?: string };
		try { event = JSON.parse(line) as typeof event; } catch { continue; }
		if (!event.Action || !OUTCOMES.has(event.Action) || !event.Package) { continue; }
		if (event.Test) { tests[`${event.Package} ${event.Test}`] = event.Action as Outcome; }
		else { packages[event.Package] = event.Action as Outcome; }
	}
	return { tests, packages };
}

/** Top-level test functions a Go test file declares. */
export function goTestNames(info: FileInfo): string[] {
	return info.declarations.filter(d => d.kind === 'func' && /^Test(?:[^a-z]|$)/.test(d.names[0] ?? '') && d.names[0] !== 'TestMain')
		.map(d => d.names[0]);
}

/** Why a generated Go test file may not be used: wrong package, TestMain, or a way to reach the network or other programs. */
export function goTestProblems(text: string, info: GoFileInfo, source: GoFileInfo): string[] {
	const problems: string[] = [];
	if (info.go.package !== source.go.package) { problems.push(`it must be in package ${source.go.package}, not ${info.go.package}`); }
	if (!goTestNames(info).length) { problems.push('it declares no Test functions'); }
	if (info.declarations.some(d => d.names.includes('TestMain') || d.names.includes('init'))) { problems.push('it must not declare TestMain or init'); }
	const paths = info.go.imports.map(spec => spec.path);
	for (const path of paths.filter(p => NETWORK_IMPORTS.has(p))) { problems.push(`it imports ${path}`); }
	if (paths.includes('net/http') && !paths.includes('net/http/httptest')) { problems.push('it imports net/http without net/http/httptest'); }
	if (REMOTE_URL.test(text)) { problems.push('it names a remote URL'); }
	return problems;
}
````

Create `src/aiready/goPrompts.ts`:

````ts
import * as path from 'path';
import { redact } from '../records/redact';
import type { GoFileInfo } from './goRules';
import type { Prompt } from './language';

const MAX_SOURCE_CHARS = 60_000;

const SPLIT_SYSTEM = `You plan how to split one long Go file into focused files in the same package and folder.
The host moves whole declarations byte for byte and rebuilds imports; you only choose groups.
Rules:
- Refer to declarations only by their numeric "id". Never move one marked "movable": false.
- Every new file and the original must end up at 400 lines or fewer. Leave declarations that belong to the original's main job in it.
- Group by responsibility: a type with its methods and constructors, a query with its row scanning helpers, and so on.
- New file names: lower-case letters, digits and underscores, ending in .go, starting with the original's base name and an underscore (for example store_query.go). Never end a name in _test.go or in a GOOS or GOARCH name such as _linux.go or _amd64.go.
Reply with only a JSON array, for example: [{"file":"placements_query.go","declarations":[3,7]}]`;

const TEST_SYSTEM = `You write a Go test file that pins how one file behaves today, so later refactors can be checked.
Rules:
- Same package as the file under test (an internal test). Use only the standard library and packages that file already imports.
- Test what the code does now, even if it looks wrong. Prefer pure functions and simple types; skip anything that needs a database, the network, other programs, environment variables or real time.
- No network, no os/exec, no files outside t.TempDir(), no TestMain, no init, no global state changes that leak between tests.
- Name tests TestAi<Something> so they do not collide with existing tests.
Reply with the whole test file in one \`\`\`go code block and nothing else.`;

/** The model's input for a Go split plan: the file's declarations by ID, with unmovable ones marked. */
export function goSplitPrompt(info: GoFileInfo, totalLines: number): Prompt {
	const declarations = info.declarations.map(d => ({
		id: d.id, kind: d.kind, names: d.names, ...(d.receiver ? { receiver: d.receiver } : {}), lines: d.lines,
		...(d.doc ? { firstDocLine: d.doc } : {}), imports: d.uses,
		...(d.movable ? {} : { movable: false, reason: d.reason }),
	}));
	return {
		system: SPLIT_SYSTEM,
		text: `File: ${info.path} (package ${info.go.package}, ${totalLines} lines)\n`
			+ `Declarations:\n${declarations.map(d => JSON.stringify(d)).join('\n')}\n\n`
			+ `Plan new files so ${path.posix.basename(info.path)} and every new file are at most 400 lines.`,
	};
}

/** The model's input for an add-tests fix. */
export function goTestPrompt(file: string, source: string, info: GoFileInfo, testFile: string): Prompt {
	return {
		system: TEST_SYSTEM,
		text: `Write ${testFile} for ${file} (package ${info.go.package}).\n\n=== ${file} ===\n${redact(source).slice(0, MAX_SOURCE_CHARS)}`,
	};
}
````

Create `src/aiready/goAdapter.ts`:

````ts
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { buildGoHelper, goFileInfo } from './goAst';
import { goSplitPrompt, goTestPrompt } from './goPrompts';
import { directiveLines, goFileInfoView, GoFileInfo, goFileNameProblems, GoModuleFacts, goSkipReason, Platforms, platforms } from './goRules';
import { buildGoSplit } from './goSplit';
import { goTestNames, goTestProblems, parseGoTest } from './goTests';
import type { LanguageAdapter } from './language';
import { declarationProblems } from './moveCheck';
import { findTool, runTool } from './projectCommands';

/** The Go tools a run needs, found and built once. */
export interface GoTools {
	readonly go: string;
	readonly gofmt?: string;
	readonly helper: string;
	readonly platforms: Platforms;
}

/** Finds Go and gofmt, builds the parser helper, and reads Go's platform list. Returns a plain message on failure. */
export async function goTools(mainGo: string, storageDir: string, version: string): Promise<GoTools | string> {
	const go = findTool('go');
	if (!go) { return 'Go was not found. Install Go or add it to your PATH, then try again.'; }
	let helper: string;
	try { helper = await buildGoHelper(mainGo, storageDir, version, go); }
	catch (error) { return error instanceof Error ? error.message : String(error); }
	const local = { GOTOOLCHAIN: 'local' };
	const dist = await runTool(go, ['tool', 'dist', 'list'], storageDir, local);
	const goroot = (await runTool(go, ['env', 'GOROOT'], storageDir, local)).stdout.trim();
	const bundled = goroot && path.join(goroot, 'bin', 'gofmt');
	return { go, helper, platforms: platforms(dist.stdout), gofmt: bundled && existsSync(bundled) ? bundled : findTool('gofmt') };
}

/** The `./dir` form `go` wants for a file's package. */
export function goPackage(file: string): string {
	const dir = path.posix.dirname(file);
	return dir === '.' ? '.' : `./${dir}`;
}

/**
 * The Go language adapter for one root (the user's folder for the picker, the worktree for fixes). `tracked` lists the
 * root's tracked files, for nested modules and `//go:generate`/`//go:embed` lines.
 */
export function createGoAdapter(root: string, tools: GoTools, tracked: readonly string[]): LanguageAdapter {
	let facts: GoModuleFacts | undefined;
	const names = new Map<string, Promise<Map<string, string>>>();
	const moduleFacts = (): GoModuleFacts => {
		facts ??= {
			nestedModules: tracked.filter(file => file.endsWith('/go.mod')).map(file => path.posix.dirname(file)),
			directiveLines: tracked.filter(file => file.endsWith('.go')).flatMap(file => {
				let text = '';
				try { text = readFileSync(path.join(root, file), 'utf8'); } catch { return []; }
				return text.includes('//go:') ? directiveLines(file, text) : [];
			}),
		};
		return facts;
	};
	const packageNames = (file: string) => {
		const pkg = goPackage(file);
		if (!names.has(pkg)) {
			names.set(pkg, runTool(tools.go, ['list', '-deps', '-e', '-f', '{{.ImportPath}} {{.Name}}', pkg], root).then(result =>
				new Map(result.stdout.split('\n').map(line => line.trim().split(' ')).filter(parts => parts.length === 2 && parts[1]) as [string, string][])));
		}
		return names.get(pkg)!;
	};
	const testFileName = (file: string) => file.replace(/\.go$/, '_ai_test.go');
	return {
		id: 'go',
		label: 'Go',
		extensions: ['.go'],
		async parse(file) {
			const ast = await goFileInfo(tools.helper, path.join(root, file));
			return goFileInfoView(file, ast, await packageNames(file), goSkipReason(file, ast, moduleFacts(), tools.platforms));
		},
		fileNameProblems: name => goFileNameProblems(name, tools.platforms),
		buildSplit: (source, info, plan) => buildGoSplit(source, info as GoFileInfo, plan),
		sameDeclarations: declarationProblems,
		async unitFiles(file) {
			const listed = await runTool(tools.go, ['list', '-e', '-f', '{{join .GoFiles "\\n"}}', goPackage(file)], root);
			const dir = path.posix.dirname(file);
			return listed.stdout.split('\n').map(name => name.trim()).filter(Boolean).map(name => (dir === '.' ? name : `${dir}/${name}`));
		},
		async unformatted(files) {
			if (!tools.gofmt || !files.length) { return []; }
			const result = await runTool(tools.gofmt, ['-l', ...files], root);
			return result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
		},
		checks: file => [
			{ label: 'build', command: 'go build ./...' },
			{ label: 'vet', command: `go vet ${goPackage(file)}` },
			{ label: 'test', command: `go test -count=1 -json ${goPackage(file)}` },
		],
		parseTests: parseGoTest,
		testFileName,
		testNames: goTestNames,
		testProblems: (text, info, source) => goTestProblems(text, info as GoFileInfo, source as GoFileInfo),
		splitPrompt: (info, lines) => goSplitPrompt(info as GoFileInfo, lines),
		testPrompt: (file, source, info) => goTestPrompt(file, source, info as GoFileInfo, path.posix.basename(testFileName(file))),
	};
}
````

Create `src/aiready/languages.ts`:

````ts
import { existsSync } from 'fs';
import * as path from 'path';
import { createGoAdapter, goTools } from './goAdapter';
import type { LanguageAdapter } from './language';

/** Creates a language adapter for a root (the user's folder or the worktree) and its tracked files. */
export type AdapterFactory = (root: string, tracked: readonly string[]) => LanguageAdapter;

/** Where the extension keeps its files, for adapters that ship or build helpers. */
export interface AdapterHost {
	readonly extensionPath: string;
	readonly storageDir: string;
	readonly version: string;
}

/**
 * The adapter for the project's language, or a plain message. Go is the first adapter; TS/JS, Python, C#, Rust and
 * C/C++ follow, each in its own `<language>Adapter.ts` registered here.
 */
export async function adapterFor(root: string, host: AdapterHost): Promise<AdapterFactory | string> {
	if (existsSync(path.join(root, 'go.mod'))) {
		const tools = await goTools(path.join(host.extensionPath, 'resources', 'goast', 'main.go'), host.storageDir, host.version);
		return typeof tools === 'string' ? tools : (dir, tracked) => createGoAdapter(dir, tools, tracked);
	}
	return 'Fixing on a branch works for Go projects first (a `go.mod` in the top folder). TypeScript, JavaScript, Python, C#, Rust and C/C++ come next.';
}
````

In `tsconfig.test.json`, add `"src/aiready/goTests.ts"`, `"src/aiready/goPrompts.ts"`, `"src/aiready/goAdapter.ts"`, `"src/aiready/languages.ts"` to the end of the `include` array, in that order (add a comma after the previous last entry).

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 148`, `ℹ fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/goTests.ts src/aiready/goPrompts.ts src/aiready/goAdapter.ts src/aiready/languages.ts test/aiReadyGoTests.test.ts tsconfig.test.json
git commit -m "Add the Go language adapter"
```

### Task 6: Worktree, approved commands and run state

**Files:**
- Create: `src/aiready/worktree.ts`, `src/aiready/fixState.ts`, `test/aiReadyWorktree.test.ts`
- Modify: `tsconfig.test.json`

The worktree goes next to the project (`<parent>/<name>.ai-ready`, then `-2`, `-3`…) on `my_editor/ai-ready` (then `-2`, `-3`…), created at `HEAD`. `gitArgs` refuses every remote subcommand as a second guard, and the test scans `worktree.ts` to prove no such command is ever built. The top-level check compares real paths (macOS temp folders are symlinks). Run state is one JSON file per project in global storage, written atomically; logs sit beside it and are emptied when a new run starts.

- [ ] **Step 1: Write the failing test.**

Create `test/aiReadyWorktree.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { clearState, loadState, RunState, saveState } from '../src/aiready/fixState';
import { runCommand, splitCommand } from '../src/aiready/projectCommands';
import { changedFiles, commit, gitArgs, prepare, prerequisites, remove, restore } from '../src/aiready/worktree';

test('commands run only when approved, without a shell, with a full log', async () => {
	assert.equal(splitCommand('go test ./... ; rm -rf /'), undefined);
	assert.equal(splitCommand('go test $(x)'), undefined);
	assert.deepEqual(splitCommand('go vet ./internal/store'), { bin: 'go', args: ['vet', './internal/store'] });
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-run-'));
	const options = { cwd: dir, approved: ['node --version'], timeoutMs: 20_000, logFile: path.join(dir, 'logs', 'a.log') };
	assert.match((await runCommand('node --help', options)).error ?? '', /not approved/);
	const result = await runCommand('node --version', options);
	assert.equal(result.code, 0);
	assert.match(result.stdout, /^v\d+/);
	assert.match(readFileSync(options.logFile, 'utf8'), /\$ node --version[\s\S]*# exit 0/);
});

test('worktree.ts never builds a push, fetch or remote command', () => {
	for (const command of ['push', 'fetch', 'pull', 'remote', 'clone', 'ls-remote', 'submodule']) {
		assert.throws(() => gitArgs([command, 'origin']), /does not run git/);
	}
	assert.deepEqual(gitArgs(['status']), ['-c', 'core.hooksPath=/dev/null', 'status']);
	const source = readFileSync(path.join(__dirname, '../../src/aiready/worktree.ts'), 'utf8');
	const built = [...source.matchAll(/(?:git|succeeds)\(\w+, \['([\w-]+)'/g)].map(match => match[1]);
	assert.ok(built.length >= 10);
	assert.deepEqual(built.filter(command => ['push', 'fetch', 'pull', 'remote', 'clone', 'ls-remote', 'submodule'].includes(command)), []);
});

test('a worktree next to the project gets a branch, a commit and a restore; the user folder stays put', async () => {
	const parent = mkdtempSync(path.join(os.tmpdir(), 'my-editor-wt-'));
	const root = path.join(parent, 'shop');
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	execFileSync('git', ['init', '--quiet', root]);
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(path.join(root, 'a.go'), 'package shop\n');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	assert.deepEqual(await prerequisites(root), {});
	const branch = git('branch', '--show-current');
	const wt = await prepare(root);
	assert.equal(wt.path, path.join(parent, 'shop.ai-ready'));
	assert.equal(wt.branch, 'my_editor/ai-ready');
	assert.equal((await prepare(root)).branch, 'my_editor/ai-ready-2');
	writeFileSync(path.join(wt.path, 'a.go'), 'package shop\n\nfunc A() {}\n');
	writeFileSync(path.join(wt.path, 'b.go'), 'package shop\n');
	assert.deepEqual(await changedFiles(wt.path), ['a.go']);
	await restore(wt.path, ['b.go']);
	assert.deepEqual(await changedFiles(wt.path), []);
	assert.ok(!existsSync(path.join(wt.path, 'b.go')));
	writeFileSync(path.join(wt.path, 'b.go'), 'package shop\n');
	await commit(wt.path, ['b.go'], 'my_editor: add b (b.go)', 'Body.');
	await remove(root, wt.path);
	assert.ok(!existsSync(wt.path));
	assert.equal(git('log', '-1', '--format=%s', wt.branch), 'my_editor: add b (b.go)');
	assert.equal(git('branch', '--show-current'), branch);
	assert.equal(git('status', '--porcelain'), '');
	writeFileSync(path.join(root, 'a.go'), 'package changed\n');
	assert.match((await prerequisites(root)).problem ?? '', /uncommitted changes/);
});

test('run state is saved per project in storage and survives a reload', () => {
	const storage = mkdtempSync(path.join(os.tmpdir(), 'my-editor-state-'));
	const saved: RunState = {
		version: 1, root: '/p/shop', language: 'Go', worktree: { branch: 'my_editor/ai-ready', path: '/p/shop.ai-ready', base: 'abc' },
		startedAt: '2026-10-09T10:00:00Z', approved: ['go build ./...'], fixes: [{ file: 'a.go', kind: 'split', lines: 900 }], next: 0, steps: [],
		baseline: {}, skippedFiles: [],
	};
	saveState(storage, saved);
	assert.deepEqual(loadState(storage, '/p/shop'), saved);
	assert.equal(loadState(storage, '/p/other'), undefined);
	clearState(storage, '/p/shop');
	assert.equal(loadState(storage, '/p/shop'), undefined);
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `error TS2307: Cannot find module '../src/aiready/fixState'`.

- [ ] **Step 3: Implement.**

Create `src/aiready/worktree.ts`:

````ts
import { accessSync, constants, existsSync, realpathSync, rmSync } from 'fs';
import * as path from 'path';
import { findTool, runTool } from './projectCommands';

/** Git subcommands that reach a remote. This module never builds them; `gitArgs` refuses them as a second guard. */
const REMOTE_COMMANDS = new Set(['push', 'fetch', 'pull', 'remote', 'clone', 'ls-remote', 'submodule', 'request-pull', 'send-email', 'archive']);
const BRANCH = 'my_editor/ai-ready';

/**
 * The full argument list for one local git command: hooks off (they could run project code, reformat files or talk to
 * a remote) and no credential prompts. Throws for any command that reaches a remote.
 */
export function gitArgs(args: readonly string[]): string[] {
	const command = args.find(arg => !arg.startsWith('-'));
	if (!command || REMOTE_COMMANDS.has(command)) { throw new Error(`my_editor does not run git ${command ?? ''} here.`); }
	return ['-c', 'core.hooksPath=/dev/null', ...args];
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
	const bin = findTool('git');
	if (!bin) { throw new Error('Git was not found.'); }
	const result = await runTool(bin, gitArgs(args), cwd, { GIT_TERMINAL_PROMPT: '0' });
	if (result.code !== 0) { throw new Error(`git ${args[0]} failed: ${result.stderr.trim().split('\n').slice(-2).join(' ')}`); }
	return result.stdout;
}

async function succeeds(cwd: string, args: readonly string[]): Promise<boolean> {
	try { await git(cwd, args); return true; } catch { return false; }
}

/** Why the folder cannot be fixed on a branch yet, as a plain message; `noRepository` when `git init` could help. */
export async function prerequisites(root: string): Promise<{ problem?: string; noRepository?: boolean }> {
	if (!await succeeds(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])) {
		return { problem: 'This folder is not a Git repository with a commit yet.', noRepository: true };
	}
	if (realpathSync((await git(root, ['rev-parse', '--show-toplevel'])).trim()) !== realpathSync(root)) {
		return { problem: 'Open the repository’s top folder to fix it on a branch.' };
	}
	if ((await git(root, ['status', '--porcelain', '--untracked-files=no'])).trim()) {
		return { problem: 'Some tracked files have uncommitted changes. Commit or stash them first, so the branch starts from a known state.' };
	}
	return {};
}

/** Creates a repository with one commit of the current files (everything but `.my_editor/`), after the user agreed. */
export async function initRepository(root: string): Promise<void> {
	if (!existsSync(path.join(root, '.git'))) { await git(root, ['init', '--quiet']); }
	await git(root, ['add', '--all', '--', '.', ':(exclude).my_editor']);
	await git(root, ['commit', '--quiet', '-m', 'Initial commit']);
}

/** Tracked files, relative and `/`-separated. */
export async function trackedFiles(root: string): Promise<string[]> {
	return (await git(root, ['ls-files', '-z'])).split('\0').filter(Boolean);
}

export interface Worktree {
	readonly branch: string;
	readonly path: string;
	/** The commit the branch started from. */
	readonly base: string;
}

/** The first free branch name: `my_editor/ai-ready`, then `-2`, `-3`… */
async function freeBranch(root: string): Promise<string> {
	for (let n = 1; ; n++) {
		const name = n === 1 ? BRANCH : `${BRANCH}-${n}`;
		if (!await succeeds(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) { return name; }
	}
}

/** A free folder next to the project, so relative paths that leave the repository still resolve. */
export function freeFolder(root: string): string {
	const parent = path.dirname(path.resolve(root));
	try { accessSync(parent, constants.W_OK); } catch { throw new Error(`The folder ${parent} is not writable, so the branch's working copy cannot go next to the project.`); }
	for (let n = 1; ; n++) {
		const folder = path.join(parent, `${path.basename(root)}.ai-ready${n === 1 ? '' : `-${n}`}`);
		if (!existsSync(folder)) { return folder; }
	}
}

/** Creates the branch at HEAD and checks it out in a new worktree next to the project. The user's folder is not touched. */
export async function prepare(root: string): Promise<Worktree> {
	const branch = await freeBranch(root);
	const folder = freeFolder(root);
	const base = (await git(root, ['rev-parse', 'HEAD'])).trim();
	await git(root, ['worktree', 'add', '--quiet', folder, '-b', branch, base]);
	return { branch, path: folder, base };
}

/** After a crash: the worktree from saved state, or prune and check the branch out again. */
export async function reattach(root: string, worktree: Worktree): Promise<Worktree> {
	if (existsSync(path.join(worktree.path, '.git'))) { return worktree; }
	await git(root, ['worktree', 'prune']);
	const folder = existsSync(worktree.path) ? freeFolder(root) : worktree.path;
	await git(root, ['worktree', 'add', '--quiet', folder, worktree.branch]);
	return { ...worktree, path: folder };
}

/** Tracked files with changes in the worktree. */
export async function changedFiles(worktree: string): Promise<string[]> {
	return (await git(worktree, ['diff', '--name-only', 'HEAD'])).split('\n').map(line => line.trim()).filter(Boolean);
}

/** Commits exactly these paths under the user's Git identity; returns the commit hash. */
export async function commit(worktree: string, paths: readonly string[], subject: string, body: string): Promise<string> {
	await git(worktree, ['add', '--force', '--', ...paths]);
	await git(worktree, ['commit', '--quiet', '-m', subject, '-m', body, '--', ...paths]);
	return (await git(worktree, ['rev-parse', 'HEAD'])).trim();
}

/** Undoes a step: tracked files back to the last commit, the step's new files removed. */
export async function restore(worktree: string, newFiles: readonly string[]): Promise<void> {
	const changed = await changedFiles(worktree);
	if (changed.length) { await git(worktree, ['checkout', 'HEAD', '--', ...changed]); }
	for (const file of newFiles) { rmSync(path.join(worktree, file), { force: true }); }
}

/** Removes the worktree (files the tests left behind included); the branch stays. */
export async function remove(root: string, worktree: string): Promise<void> {
	await git(root, ['worktree', 'remove', '--force', worktree]);
}

/** Deletes a branch this run created, when the run is discarded before anything was committed on it. */
export async function deleteBranch(root: string, branch: string): Promise<void> {
	await git(root, ['branch', '-D', branch]);
}
````

Create `src/aiready/fixState.ts`:

````ts
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import type { CheckResult } from './baseline';
import type { Worktree } from './worktree';

export type FixKind = 'split' | 'tests';

/** One fix the user picked. */
export interface FixChoice {
	readonly file: string;
	readonly kind: FixKind;
	readonly lines: number;
}

/** What happened to one fix. */
export interface StepRecord {
	readonly file: string;
	readonly kind: FixKind;
	readonly status: 'committed' | 'skipped' | 'refused';
	readonly reason?: string;
	readonly commit?: string;
	/** For a split: each new file and the declarations moved into it. */
	readonly moved?: readonly { readonly file: string; readonly names: readonly string[] }[];
	/** For new tests: the test file and the tests dropped because they failed. */
	readonly testFile?: string;
	readonly dropped?: readonly string[];
	readonly checks?: string;
	readonly notes?: readonly string[];
}

/** A run's saved state, in global storage, keyed by project path. Nothing is written to the project during a run. */
export interface RunState {
	readonly version: 1;
	readonly root: string;
	readonly language: string;
	/** Updated when Continue has to check the branch out again. */
	worktree: Worktree;
	readonly startedAt: string;
	/** The exact commands the user approved. */
	readonly approved: readonly string[];
	readonly fixes: readonly FixChoice[];
	/** Index of the next fix to run. */
	next: number;
	readonly steps: StepRecord[];
	/** Two baseline runs per command. */
	readonly baseline: Record<string, readonly [CheckResult, CheckResult]>;
	/** Files that are never split, with the reason, for the change note. */
	readonly skippedFiles: readonly { readonly file: string; readonly reason: string }[];
}

/** At most this many fixes per run; Continue picks up the rest. */
export const MAX_FIXES_PER_RUN = 25;

/** The folder holding a project's run state and command logs. */
export function runDir(storageDir: string, root: string): string {
	return path.join(storageDir, 'ai-ready', createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 16));
}

export function loadState(storageDir: string, root: string): RunState | undefined {
	try {
		const state = JSON.parse(readFileSync(path.join(runDir(storageDir, root), 'state.json'), 'utf8')) as RunState;
		return state.version === 1 && state.root === root ? state : undefined;
	} catch {
		return undefined;
	}
}

/** Writes the state atomically, so a crash leaves either the old or the new state. */
export function saveState(storageDir: string, state: RunState): void {
	const dir = runDir(storageDir, state.root);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, 'state.json.tmp'), JSON.stringify(state));
	renameSync(path.join(dir, 'state.json.tmp'), path.join(dir, 'state.json'));
}

/** Forgets a finished or discarded run. Its logs stay until the next run starts. */
export function clearState(storageDir: string, root: string): void {
	rmSync(path.join(runDir(storageDir, root), 'state.json'), { force: true });
}

/** The folder for this run's command logs, emptied when a new run starts. */
export function logDir(storageDir: string, root: string, fresh = false): string {
	const dir = path.join(runDir(storageDir, root), 'logs');
	if (fresh) { rmSync(dir, { recursive: true, force: true }); }
	mkdirSync(dir, { recursive: true });
	return dir;
}
````

In `tsconfig.test.json`, add `"src/aiready/worktree.ts"`, `"src/aiready/fixState.ts"` to the end of the `include` array, in that order (add a comma after the previous last entry).

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 152`, `ℹ fail 0`. The worktree test creates repositories only under the temp folder.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/worktree.ts src/aiready/fixState.ts test/aiReadyWorktree.test.ts tsconfig.test.json
git commit -m "Prepare a local branch in a worktree and keep run state in global storage"
```

---

## Chunk 5: Change note, fix picker and the step runner

### Task 7: Change note and fix picker

**Files:**
- Create: `src/aiready/changeNote.ts`, `src/aiready/fixPicker.ts`, `test/aiReadyNote.test.ts`
- Modify: `tsconfig.test.json`

The picker lists each fixable file with its line count and fix, biggest first, splits pre-selected and add-tests not; the VS Code quick pick is passed in, so the module stays pure. The note lives at `.my_editor/changes/ai-ready-<date>-<time>.md` (local time).

- [ ] **Step 1: Write the failing test.**

Create `test/aiReadyNote.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CheckResult } from '../src/aiready/baseline';
import { noteFileName, renderChangeNote, reportWithRun } from '../src/aiready/changeNote';
import { fixChoices, pickFixes } from '../src/aiready/fixPicker';
import type { RunState } from '../src/aiready/fixState';
import { fileStats } from '../src/aiready/health';

const fix = (file: string, kind: 'split' | 'tests', lines: number) => ({ file, kind, lines });
const testRun = (code: number, outcome: 'pass' | 'fail'): CheckResult =>
	({ command: 'go test -count=1 -json ./a', code, failures: [], tests: { tests: { 'm TestF': outcome }, packages: {} }, tail: '', log: '' });

test('fix choices: Go files only, never-split files left out, biggest first, splits pre-selected', async () => {
	const stats = [fileStats('a.go', 'x\n'.repeat(900)), fileStats('b.go', 'x\n'.repeat(500)), fileStats('c.ts', 'x\n'.repeat(700)), fileStats('gen.go', 'x\n'.repeat(800))];
	const findings = [
		{ kind: 'too-long' as const, file: 'b.go', text: '' }, { kind: 'too-long' as const, file: 'a.go', text: '' },
		{ kind: 'untested' as const, file: 'b.go', text: '' }, { kind: 'too-long' as const, file: 'c.ts', text: '' },
		{ kind: 'too-long' as const, file: 'gen.go', text: '' }, { kind: 'design' as const, file: 'a.go', text: '' },
	];
	const choices = fixChoices(findings, stats, ['.go'], new Map([['gen.go', 'generated code']]));
	assert.deepEqual(choices, [fix('a.go', 'split', 900), fix('b.go', 'split', 500), fix('b.go', 'tests', 500)]);
	let shown: { picked: boolean; description: string }[] = [];
	const picked = await pickFixes(choices, async items => { shown = items; return items.filter(item => item.picked); });
	assert.deepEqual(shown.map(item => item.picked), [true, true, false]);
	assert.equal(shown[0].description, '900 lines · split into focused files');
	assert.deepEqual(picked, choices.slice(0, 2));
	assert.equal(await pickFixes(choices, async () => undefined), undefined);
});

function state(root: string): RunState {
	return {
		version: 1, root, language: 'Go', worktree: { branch: 'my_editor/ai-ready', path: `${root}.ai-ready`, base: '0123456789abcdef' },
		startedAt: '2026-10-09T10:00:00Z', approved: ['go build ./...'], next: 3,
		fixes: [fix('a.go', 'split', 900), fix('b.go', 'tests', 500), fix('c.go', 'split', 450), fix('d.go', 'split', 420)],
		steps: [
			{ file: 'a.go', kind: 'split', status: 'committed', commit: 'abcdef123', moved: [{ file: 'a_query.go', names: ['Find', 'List'] }],
				checks: '`go build ./...`: same as before.', notes: ['a.go stays at 450 lines: func Big alone is 430 lines and needs a real refactor.'] },
			{ file: 'b.go', kind: 'tests', status: 'committed', commit: 'fedcba987', testFile: 'b_ai_test.go', dropped: ['TestAiSlow'] },
			{ file: 'c.go', kind: 'split', status: 'refused', reason: 'The move check failed: Rule 2.' },
		],
		baseline: { 'go test -count=1 -json ./a': [testRun(1, 'pass'), testRun(0, 'fail')] },
		skippedFiles: [{ file: 'gen.go', reason: 'generated code' }],
	};
}

test('the change note lists commits, refusals, flaky tests, what is left and how to review', () => {
	const note = renderChangeNote(state('/p/shop'), new Date('2026-10-09T12:34:00Z'));
	for (const pattern of [/^# AI-ready changes: shop/, /`abcdef1` Split `a.go` into `a_query.go` \(Find, List\)/, /Checks: `go build/,
		/`fedcba9` Added tests for `b.go` in `b_ai_test.go`; dropped failing tests TestAiSlow/, /`c.go` \(split\): refused. The move check failed/,
		/## Not run yet\n\n- `d.go` \(split\)/, /`gen.go`: generated code/, /- m TestF/, /stays at 450 lines/, /glob\.\.funcN/,
		/already failed before the run[\s\S]*- `go test -count=1 -json \.\/a`/, /git diff 0123456789ab\.\.my_editor\/ai-ready/, /Nothing was pushed/]) {
		assert.match(note, pattern);
	}
	assert.match(noteFileName(new Date(2026, 9, 9, 7, 5)), /^\.my_editor\/changes\/ai-ready-2026-10-09-0705\.md$/);
	const report = reportWithRun('# Report\n\nBody\n\n## Fixes on a local branch\n\nOld run.\n', state('/p/shop'), 'x.md');
	assert.equal(report, '# Report\n\nBody\n\n## Fixes on a local branch\n\n2 fixes committed on `my_editor/ai-ready`, 1 skipped or refused. Details: `x.md` on that branch.\n');
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `error TS2307: Cannot find module '../src/aiready/changeNote'`.

- [ ] **Step 3: Implement.**

Create `src/aiready/changeNote.ts`:

````ts
import * as path from 'path';
import { flakyTests } from './baseline';
import type { RunState, StepRecord } from './fixState';

const RUN_SECTION = '## Fixes on a local branch';

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** `.my_editor/changes/ai-ready-<date>-<time>.md`, in local time: a new path each run, so merges never collide. */
export function noteFileName(at: Date): string {
	return `.my_editor/changes/ai-ready-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.md`;
}

/** Flaky tests across all baseline commands. */
export function runFlaky(state: RunState): string[] {
	return Object.values(state.baseline).flatMap(([first, second]) => flakyTests(first.tests, second.tests));
}

function stepLine(step: StepRecord): string {
	const short = step.commit?.slice(0, 7);
	if (step.kind === 'split') {
		const moved = (step.moved ?? []).map(m => `\`${m.file}\` (${m.names.join(', ')})`).join('; ');
		return `- \`${short}\` Split \`${step.file}\` into ${moved}.`;
	}
	return `- \`${short}\` Added tests for \`${step.file}\` in \`${step.testFile}\`${step.dropped?.length ? `; dropped failing tests ${step.dropped.join(', ')}` : ''}.`;
}

/** The change note committed on the branch at close (pure). */
export function renderChangeNote(state: RunState, at: Date): string {
	const committed = state.steps.filter(step => step.status === 'committed');
	const notDone = state.steps.filter(step => step.status !== 'committed');
	const pending = state.fixes.slice(state.next);
	const flaky = runFlaky(state);
	const failing = Object.entries(state.baseline).filter(([, [first]]) => first.code !== 0).map(([command]) => command);
	const notes = state.steps.flatMap(step => step.notes ?? []);
	const { branch, base } = state.worktree;
	const lines = [
		`# AI-ready changes: ${path.basename(state.root)}`, '',
		`${at.toISOString().slice(0, 16).replace('T', ' ')} UTC · branch \`${branch}\` from \`${base.slice(0, 7)}\` · ${state.language}`, '',
		'Each commit moves code into new files or adds tests; none is meant to change what the program does. Every split passed the move check '
		+ '(each moved declaration copied byte for byte, nothing else changed, the same declarations and doc comments in the package), '
		+ 'then the build, vet and tests of its package, with the same results as before the run.', '',
		'## Commits', '',
		...(committed.length ? committed.flatMap(step => [stepLine(step), ...(step.checks ? [`  Checks: ${step.checks}`] : [])]) : ['No fix was committed.']), '',
		...(notDone.length ? ['## Skipped or refused', '', ...notDone.map(step => `- \`${step.file}\` (${step.kind === 'split' ? 'split' : 'tests'}): ${step.status}. ${step.reason ?? ''}`.trimEnd()), ''] : []),
		...(pending.length ? ['## Not run yet', '', ...pending.map(fix => `- \`${fix.file}\` (${fix.kind === 'split' ? 'split' : 'tests'})`), ''] : []),
		...(state.skippedFiles.length ? ['## Files never split', '', ...state.skippedFiles.map(s => `- \`${s.file}\`: ${s.reason}.`), ''] : []),
		...(flaky.length ? ['## Flaky tests excluded from comparison', '', ...flaky.map(name => `- ${name}`), ''] : []),
		...(failing.length ? ['## Checks that already failed before the run', '',
			'They had to fail the same way after every fix, so they prove less for the files they cover:', '',
			...failing.map(command => `- \`${command}\``), ''] : []),
		'## Left for you', '',
		...notes.map(note => `- ${note}`),
		'- File names and line numbers in panics, `runtime.Caller`, `log.Lshortfile`, `slog` source attributes and package-level closure names '
		+ '(`glob..funcN`) may differ for moved code. The program’s behavior does not.',
		'- Git hooks did not run for these commits. Run your usual checks when you review.',
		'- Bugs and design problems from the health report are suggestions; ask Pair about them.', '',
		'## How to review', '',
		'```sh',
		`git diff ${base.slice(0, 12)}..${branch}`,
		`git log --stat ${base.slice(0, 12)}..${branch}`,
		`git merge ${branch}        # keep the changes`,
		`git branch -D ${branch}    # or throw them away`,
		'```', '',
		'Nothing was pushed. After merging, run **Analyse** again to refresh the project brain for the changed files.', '',
	];
	return lines.join('\n');
}

/** The health report with this run's summary as its last section, replacing an earlier run's. */
export function reportWithRun(report: string, state: RunState, notePath: string): string {
	const committed = state.steps.filter(step => step.status === 'committed').length;
	const others = state.steps.length - committed;
	const kept = report.split(`\n${RUN_SECTION}`)[0].trimEnd();
	return `${kept}\n\n${RUN_SECTION}\n\n${committed} fix${committed === 1 ? '' : 'es'} committed on \`${state.worktree.branch}\``
		+ `${others ? `, ${others} skipped or refused` : ''}. Details: \`${notePath}\` on that branch.\n`;
}
````

Create `src/aiready/fixPicker.ts`:

````ts
import * as path from 'path';
import type { FixChoice } from './fixState';
import type { FileStats, HealthFinding } from './health';

/**
 * The fixes a run can offer, from the deterministic health findings (re-scanned at fix time, never parsed from the
 * report): a split for each long file and tests for each untested one, in the adapter's languages, minus files that
 * are never split. Biggest first.
 */
export function fixChoices(findings: readonly HealthFinding[], stats: readonly FileStats[], extensions: readonly string[],
	skipped: ReadonlyMap<string, string>): FixChoice[] {
	const lines = new Map(stats.map(s => [s.path, s.lines]));
	const choices: FixChoice[] = [];
	for (const finding of findings) {
		const file = finding.file;
		if (!file || !extensions.includes(path.extname(file)) || skipped.has(file)) { continue; }
		if (finding.kind === 'too-long') { choices.push({ file, kind: 'split', lines: lines.get(file) ?? 0 }); }
		if (finding.kind === 'untested') { choices.push({ file, kind: 'tests', lines: lines.get(file) ?? 0 }); }
	}
	return choices.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind));
}

export interface PickItem {
	readonly label: string;
	readonly description: string;
	readonly picked: boolean;
	readonly choice: FixChoice;
}

/** Shows a multi-select list; `vscode.window.showQuickPick` with `canPickMany` fits. */
export type ShowPicker = (items: PickItem[], options: { title: string; placeHolder: string }) => PromiseLike<readonly PickItem[] | undefined>;

/** The multi-select list of fixes: splits pre-selected, add-tests not. Undefined when the user cancels. */
export async function pickFixes(choices: readonly FixChoice[], show: ShowPicker): Promise<FixChoice[] | undefined> {
	const items = choices.map(choice => ({
		label: choice.file,
		description: `${choice.lines} lines · ${choice.kind === 'split' ? 'split into focused files' : 'add tests'}`,
		picked: choice.kind === 'split',
		choice,
	}));
	const picked = await show(items, {
		title: 'Fix on a local branch',
		placeHolder: 'Choose the fixes. Each one is checked and committed on its own; at most 25 run at a time.',
	});
	return picked?.map(item => item.choice);
}
````

In `tsconfig.test.json`, add `"src/aiready/fixPicker.ts"`, `"src/aiready/changeNote.ts"` to the end of the `include` array, in that order (add a comma after the previous last entry).

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 154`, `ℹ fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/changeNote.ts src/aiready/fixPicker.ts test/aiReadyNote.test.ts tsconfig.test.json
git commit -m "Render the AI-ready change note and offer the fix picker"
```

### Task 8: Step runner: one split or add-tests fix

**Files:**
- Create: `src/aiready/steps.ts`, `test/aiReadySteps.test.ts`
- Modify: `tsconfig.test.json`

A split: parse, ask for a plan by ID (one retry with the reasons), apply, move rules 1–5 and the formatter (when the original was gofmt-clean), then build, vet and tests against the baseline; commit as `my_editor: split into N files (<file>)` with the moved names and check results in the body, or restore. Add-tests: write `<name>_ai_test.go`, guard it, run checks, run tests a second time, drop tests that failed or never ran, commit as `my_editor: add tests for <name> (<file>)`. Stop returns `'stopped'` after restoring, so Continue reruns that fix. The test builds a tiny module in a temp Git repository and runs both steps for real with canned model replies.

- [ ] **Step 1: Write the failing test.**

Create `test/aiReadySteps.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CheckResult, failureLines } from '../src/aiready/baseline';
import { createGoAdapter, goTools } from '../src/aiready/goAdapter';
import type { LanguageAdapter } from '../src/aiready/language';
import { findTool, runCommand, tail } from '../src/aiready/projectCommands';
import { runAddTests, runSplit, StepContext } from '../src/aiready/steps';
import { changedFiles, prepare, remove, trackedFiles } from '../src/aiready/worktree';

const SHOP = `package shop

import (
	"fmt"
	"strings"
)

// Upper shouts.
func Upper(s string) string { return strings.ToUpper(s) }

// Describe prints a number.
func Describe(n int) string { return fmt.Sprint(n) }
`;
const TEST = 'package shop\n\nimport "testing"\n\nfunc TestUpper(t *testing.T) {\n\tif Upper("a") != "A" {\n\t\tt.Fatal()\n\t}\n}\n';
const NEW_TESTS = 'package shop\n\nimport "testing"\n\nfunc TestAiDescribe(t *testing.T) {\n\tif Describe(2) != "2" {\n\t\tt.Fatal()\n\t}\n}\n\n'
	+ 'func TestAiWrong(t *testing.T) { t.Fatal("pins nothing") }\n';

/** A Go module in a fresh Git repository, with a worktree, a Go adapter on it and its baseline. */
async function setup(): Promise<{ root: string; worktree: string; adapter: LanguageAdapter; ctx: Omit<StepContext, 'ask'> } | undefined> {
	if (!findTool('go')) { return undefined; }
	const parent = mkdtempSync(path.join(os.tmpdir(), 'my-editor-steps-'));
	const root = path.join(parent, 'shop');
	mkdirSync(root);
	writeFileSync(path.join(root, 'go.mod'), 'module example.com/shop\n\ngo 1.22\n');
	writeFileSync(path.join(root, 'shop.go'), SHOP);
	writeFileSync(path.join(root, 'shop_test.go'), TEST);
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	git('init', '--quiet');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	const tools = await goTools(path.resolve(__dirname, '../../resources/goast/main.go'), path.join(os.tmpdir(), 'my-editor-goast-cache'), 'test');
	assert.equal(typeof tools, 'object', String(tools));
	const wt = await prepare(root);
	const adapter = createGoAdapter(wt.path, tools as Exclude<typeof tools, string>, await trackedFiles(wt.path));
	const approved = adapter.checks('shop.go').map(check => check.command);
	const check = async (command: string, label: string): Promise<CheckResult> => {
		const out = await runCommand(command, { cwd: wt.path, approved, timeoutMs: 120_000, logFile: path.join(parent, 'logs', `${Date.now()}.log`) });
		return { command, code: out.code, failures: label === 'test' ? [] : failureLines(out.output), tests: label === 'test' ? adapter.parseTests(out.stdout) : undefined, tail: tail(out.output), log: '' };
	};
	const baseline: Record<string, [CheckResult, CheckResult]> = {};
	for (const { command, label } of adapter.checks('shop.go')) { baseline[command] = [await check(command, label), await check(command, label)]; }
	return { root, worktree: wt.path, adapter, ctx: { adapter, worktree: wt.path, baseline, flaky: [], check, cancelled: () => false, progress: () => undefined } };
}

test('steps: a split is planned by ID, checked and committed; a bad plan is refused after one retry; new tests drop failures', async t => {
	const run = await setup();
	if (!run) { t.skip('Go is not installed'); return; }
	const { root, worktree, ctx } = run;
	const asked: string[] = [];
	const bad = await runSplit({ ...ctx, ask: async (_system, text) => { asked.push(text); return '[{"file":"shop_linux.go","declarations":[9]}]'; } },
		{ file: 'shop.go', kind: 'split', lines: 13 });
	assert.equal(asked.length, 2);
	assert.match(asked[1], /It was rejected:\n- Declaration 9 does not exist/);
	assert.equal(typeof bad === 'object' && bad.status, 'refused');
	assert.deepEqual(await changedFiles(worktree), []);

	const split = await runSplit({ ...ctx, ask: async () => '[{"file":"shop_describe.go","declarations":[1]}]' }, { file: 'shop.go', kind: 'split', lines: 13 });
	assert.ok(typeof split === 'object' && split.status === 'committed', JSON.stringify(split));
	assert.deepEqual(split.moved, [{ file: 'shop_describe.go', names: ['Describe'] }]);
	assert.equal(readFileSync(path.join(worktree, 'shop.go'), 'utf8'),
		'package shop\n\nimport (\n\t"strings"\n)\n\n// Upper shouts.\nfunc Upper(s string) string { return strings.ToUpper(s) }\n');
	const log = execFileSync('git', ['log', '--format=%s', '-2', 'my_editor/ai-ready'], { cwd: root, encoding: 'utf8' });
	assert.match(log, /^my_editor: split into 1 file \(shop.go\)\nfirst\n$/);

	const tests = await runAddTests({ ...ctx, ask: async () => `\`\`\`go\n${NEW_TESTS}\`\`\`` }, { file: 'shop_describe.go', kind: 'tests', lines: 6 });
	assert.ok(typeof tests === 'object' && tests.status === 'committed', JSON.stringify(tests));
	assert.deepEqual(tests.dropped, ['TestAiWrong']);
	assert.doesNotMatch(readFileSync(path.join(worktree, 'shop_describe_ai_test.go'), 'utf8'), /TestAiWrong/);

	const stopped = await runSplit({ ...ctx, cancelled: () => true, ask: async () => '[]' }, { file: 'shop.go', kind: 'split', lines: 8 });
	assert.equal(stopped, 'stopped');
	await remove(root, worktree);
	assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `error TS2307: Cannot find module '../src/aiready/steps'`.

- [ ] **Step 3: Implement.**

Create `src/aiready/steps.ts`:

````ts
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import { fileFromReply } from '../pair/codeBlock';
import { sourceLines } from '../quality/sourcePolicy';
import { CheckResult, checkSummary, compareWithBaseline, unverified } from './baseline';
import type { FixChoice, StepRecord } from './fixState';
import type { FileInfo, LanguageAdapter, SplitPlan } from './language';
import { checkMove } from './moveCheck';
import { oversizeNotes, parsePlan, planProblems, retryText } from './splitPlan';
import { changedFiles, commit, restore } from './worktree';

/** What a step needs from the run; the model call and command runner are passed in. */
export interface StepContext {
	/** The language adapter, created for the worktree. */
	readonly adapter: LanguageAdapter;
	readonly worktree: string;
	readonly ask: (system: string, text: string) => Promise<string>;
	/** Runs one approved command in the worktree and parses its output. */
	readonly check: (command: string, label: string) => Promise<CheckResult>;
	readonly baseline: Readonly<Record<string, readonly [CheckResult, CheckResult]>>;
	readonly flaky: readonly string[];
	readonly cancelled: () => boolean;
	readonly progress: (text: string) => void;
}

/** A step either records an outcome or stops (Stop pressed); a stopped step is undone and runs again on Continue. */
export type StepOutcome = StepRecord | 'stopped';

interface ChecksOutcome {
	readonly results: CheckResult[];
	readonly problems: string[];
	readonly newFailing: string[];
	readonly stopped: boolean;
}

/** Runs the file's checks in order and compares each with the baseline; stops at the first that differs. */
async function runChecks(ctx: StepContext, file: string, allowNew: readonly string[], only?: 'test'): Promise<ChecksOutcome> {
	const results: CheckResult[] = [];
	const newFailing: string[] = [];
	for (const check of ctx.adapter.checks(file).filter(c => !only || c.label === only)) {
		ctx.progress(`Running \`${check.command}\`…`);
		const result = await ctx.check(check.command, check.label);
		if (ctx.cancelled()) { return { results, problems: [], newFailing, stopped: true }; }
		const baseline = ctx.baseline[check.command];
		if (!baseline) { return { results, problems: [`No baseline for \`${check.command}\`.`], newFailing, stopped: false }; }
		const comparison = compareWithBaseline(baseline, result, allowNew);
		results.push(result);
		newFailing.push(...comparison.newFailing);
		if (comparison.problems.length) {
			return { results, problems: [...comparison.problems, ...(result.tail ? [`Output:\n${result.tail}`] : [])], newFailing, stopped: false };
		}
	}
	return { results, problems: [], newFailing, stopped: false };
}

function relative(dir: string, name: string): string {
	return dir === '.' ? name : `${dir}/${name}`;
}

/** One split: plan with the model (one retry), apply without AI, move check, build and tests, then commit or restore. */
export async function runSplit(ctx: StepContext, fix: FixChoice): Promise<StepOutcome> {
	const { adapter, worktree } = ctx;
	const abs = (file: string) => path.join(worktree, file);
	const done = (status: StepRecord['status'], reason: string): StepRecord => ({ file: fix.file, kind: 'split', status, reason });
	const info = await adapter.parse(fix.file);
	if (info.skip) { return done('skipped', `Never split: ${info.skip}.`); }
	if (!info.declarations.some(d => d.movable)) { return done('refused', 'Nothing in it may move.'); }
	const source = readFileSync(abs(fix.file));
	const input = { source, info, existing: readdirSync(path.dirname(abs(fix.file))) };
	const prompt = adapter.splitPrompt(info, sourceLines(source.toString('utf8')));
	ctx.progress(`Planning how to split ${fix.file}…`);
	let reply = await ctx.ask(prompt.system, prompt.text);
	let plan = parsePlan(reply);
	let problems = plan ? planProblems(adapter, input, plan) : ['The reply was not a JSON array of {"file", "declarations"}.'];
	if (problems.length && !ctx.cancelled()) {
		reply = await ctx.ask(prompt.system, retryText(prompt, reply, problems));
		plan = parsePlan(reply);
		problems = plan ? planProblems(adapter, input, plan) : ['The reply was not a JSON array of {"file", "declarations"}.'];
	}
	if (ctx.cancelled()) { return 'stopped'; }
	if (problems.length || !plan) { return done('refused', `The split plan was rejected twice: ${problems.slice(0, 5).join(' ')}`); }
	const dir = path.posix.dirname(fix.file);
	const unitBefore = await Promise.all((await adapter.unitFiles(fix.file)).map(file => adapter.parse(file)));
	const formatted = !(await adapter.unformatted([fix.file])).length;
	const result = adapter.buildSplit(source, info, plan);
	const newFiles = result.files.map(file => relative(dir, file.name));
	try {
		writeFileSync(abs(fix.file), result.original);
		result.files.forEach((file, index) => writeFileSync(abs(newFiles[index]), file.text));
		ctx.progress(`Checking the move in ${fix.file}…`);
		const moveProblems = await checkSplit(ctx, fix.file, newFiles, { source, info, plan, unitBefore, formatted });
		if (moveProblems.length) {
			await restore(worktree, newFiles);
			return done('refused', `The move check failed: ${moveProblems.slice(0, 5).join(' ')}`);
		}
		const checks = await runChecks(ctx, fix.file, []);
		const changed = (await changedFiles(worktree)).filter(file => file !== fix.file);
		if (checks.stopped || checks.problems.length || changed.length) {
			await restore(worktree, newFiles);
			if (checks.stopped) { return 'stopped'; }
			return done('skipped', checks.problems.length ? `Checks differ from before: ${checks.problems.join(' ')}` : `Other tracked files changed: ${changed.join(', ')}.`);
		}
		const byId = new Map(info.declarations.map(d => [d.id, d]));
		const moved = plan.map(group => ({ file: group.file, names: group.declarations.map(id => byId.get(id)!.names.join(', ')) }));
		const summary = checkSummary(checks.results, ctx.flaky);
		const body = ['Moved whole declarations byte for byte; nothing else changed.', '',
			...moved.map(m => `${m.file}: ${m.names.join('; ')}`), '', `Move check: passed. Checks: ${summary}`].join('\n');
		const sha = await commit(worktree, [fix.file, ...newFiles], `my_editor: split into ${newFiles.length} file${newFiles.length === 1 ? '' : 's'} (${fix.file})`, body);
		return { file: fix.file, kind: 'split', status: 'committed', commit: sha, moved, checks: summary, notes: oversizeNotes(result, info, plan) };
	} catch (error) {
		await restore(worktree, newFiles);
		return done('skipped', error instanceof Error ? error.message : String(error));
	}
}

interface SplitFacts {
	readonly source: Buffer;
	readonly info: FileInfo;
	readonly plan: SplitPlan;
	readonly unitBefore: readonly FileInfo[];
	readonly formatted: boolean;
}

/** Move rules 1–5 and the formatter, on the files as written. */
async function checkSplit(ctx: StepContext, file: string, newFiles: readonly string[], facts: SplitFacts): Promise<string[]> {
	const { adapter, worktree } = ctx;
	const read = async (name: string) => ({ text: readFileSync(path.join(worktree, name)), info: await adapter.parse(name) });
	const after = await read(file);
	const files = await Promise.all(newFiles.map(read));
	const unitAfter = await Promise.all((await adapter.unitFiles(file)).map(name => adapter.parse(name)));
	const problems = [
		...checkMove({ before: { text: facts.source, info: facts.info }, after, files, plan: facts.plan }),
		...adapter.sameDeclarations(facts.unitBefore, unitAfter),
	];
	const other = (await changedFiles(worktree)).filter(name => name !== file);
	if (other.length) { problems.push(`Rule 5: other tracked files changed: ${other.join(', ')}.`); }
	if (facts.formatted) {
		const unformatted = await adapter.unformatted([file, ...newFiles]);
		if (unformatted.length) { problems.push(`The formatter would change ${unformatted.join(', ')}.`); }
	}
	return problems;
}

/** Top-level test names from test keys (`<package> <Test>/<subtest>`). */
function topLevel(keys: readonly string[]): string[] {
	return [...new Set(keys.map(key => key.slice(key.indexOf(' ') + 1).split('/')[0]))];
}

/**
 * One add-tests fix: the model writes the adapter's test file (one retry with the error shown); it must build, pass
 * twice, not touch the network, and change nothing else. Failing tests are dropped with a note.
 */
export async function runAddTests(ctx: StepContext, fix: FixChoice): Promise<StepOutcome> {
	const { adapter, worktree } = ctx;
	const testFile = adapter.testFileName(fix.file);
	const abs = (file: string) => path.join(worktree, file);
	const done = (status: StepRecord['status'], reason: string): StepRecord => ({ file: fix.file, kind: 'tests', status, reason, testFile });
	const info = await adapter.parse(fix.file);
	if (info.skip) { return done('skipped', `No tests added: ${info.skip}.`); }
	if (existsSync(abs(testFile))) { return done('skipped', `${testFile} already exists.`); }
	const prompt = adapter.testPrompt(fix.file, readFileSync(abs(fix.file), 'utf8'), info);
	let feedback = '';
	for (let attempt = 0; attempt < 2; attempt++) {
		ctx.progress(`Writing tests for ${fix.file}…`);
		const reply = await ctx.ask(prompt.system, feedback ? `${prompt.text}\n\nYour previous file failed:\n${feedback.slice(0, 6_000)}\n\nReply with a corrected file.` : prompt.text);
		if (ctx.cancelled()) { return 'stopped'; }
		const code = fileFromReply(reply);
		if (!code) { feedback = 'The reply had no ```go code block.'; continue; }
		writeFileSync(abs(testFile), code.endsWith('\n') ? code : `${code}\n`);
		const outcome = await checkNewTests(ctx, fix.file, testFile, info);
		if (outcome === 'stopped' || typeof outcome === 'string') {
			rmSync(abs(testFile), { force: true });
			await restore(worktree, []);
			if (outcome === 'stopped') { return 'stopped'; }
			feedback = outcome;
			continue;
		}
		const summary = checkSummary(outcome.results, ctx.flaky);
		const body = `Adds ${testFile}; no source file changed.\n\nChecks: ${summary}${outcome.dropped.length ? `\nDropped failing tests: ${outcome.dropped.join(', ')}` : ''}`;
		const sha = await commit(worktree, [testFile], `my_editor: add tests for ${path.posix.basename(fix.file)} (${fix.file})`, body);
		return { file: fix.file, kind: 'tests', status: 'committed', commit: sha, testFile, dropped: outcome.dropped, checks: summary };
	}
	return done('skipped', `The tests did not work: ${feedback.split('\n')[0]}`);
}

/** Checks a written test file; returns the passing result, a failure to show the model, or 'stopped'. */
async function checkNewTests(ctx: StepContext, file: string, testFile: string, source: FileInfo):
	Promise<string | 'stopped' | { results: CheckResult[]; dropped: string[] }> {
	const { adapter, worktree } = ctx;
	let testInfo: FileInfo;
	try { testInfo = await adapter.parse(testFile); } catch (error) { return error instanceof Error ? error.message : String(error); }
	const problems = adapter.testProblems(readFileSync(path.join(worktree, testFile), 'utf8'), testInfo, source);
	if (problems.length) { return `The test file was refused: ${problems.join('; ')}.`; }
	const dropped: string[] = [];
	for (let round = 0; round < 2; round++) {
		const names = adapter.testNames(testInfo);
		if (!names.length) { return 'No test passed.'; }
		const first = await runChecks(ctx, file, names);
		if (first.stopped) { return 'stopped'; }
		if (first.problems.length) { return first.problems.join('\n'); }
		const second = await runChecks(ctx, file, names, 'test');
		if (second.stopped) { return 'stopped'; }
		if (second.problems.length) { return second.problems.join('\n'); }
		const testRun = (outcome: ChecksOutcome) => [...outcome.results].reverse().find(result => result.tests)?.tests;
		const failing = [...new Set([...topLevel([...first.newFailing, ...second.newFailing]),
			...unverified(names, testRun(first)), ...unverified(names, testRun(second))])];
		const other = await changedFiles(worktree);
		if (other.length) { return `Running the tests changed tracked files: ${other.join(', ')}.`; }
		if (!failing.length) { return { results: [...first.results, ...second.results], dropped }; }
		dropped.push(...failing);
		const ids = testInfo.declarations.filter(d => failing.includes(d.names[0])).map(d => d.id);
		const text = readFileSync(path.join(worktree, testFile));
		const kept = adapter.buildSplit(text, testInfo, [{ file: 'dropped.go', declarations: ids }]).original;
		writeFileSync(path.join(worktree, testFile), kept);
		testInfo = await adapter.parse(testFile);
	}
	return `Tests kept failing after dropping ${dropped.join(', ')}.`;
}
````

In `tsconfig.test.json`, add `"src/aiready/steps.ts"` to the end of the `include` array, in that order (add a comma after the previous last entry).

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 155`, `ℹ fail 0` (the steps test takes about 4 seconds).

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/steps.ts test/aiReadySteps.test.ts tsconfig.test.json
git commit -m "Run one AI-ready fix through checks to a commit or a restore"
```

---

## Chunk 6: Wiring, a dry run on a real project, and docs

### Task 9: Run setup, orchestration and the Pair action

**Files:**
- Create: `src/aiready/fixSetup.ts`, `src/aiready/fixRun.ts`
- Modify: `src/chat/view.ts`, `src/extension.ts`, `src/aiready/healthRun.ts`, `src/aiready/report.ts`, `package.json`

These are the only new modules that import `vscode`. The flow: model and adapter → saved run? (Continue / Discard the rest) → prerequisites (offer `git init` and a first commit) → fresh scan and picker → one modal approving the exact commands → worktree and branch → baseline twice → at most 25 fixes, state saved after each → on Stop or at 25, a **Continue** button → when all are done, the change note is committed, the worktree removed (branch kept), `report.md` gets a section, and Pair shows how to review, merge or delete, plus **Refresh the brain after merging**.

- [ ] **Step 1: Create the two modules.**

Create `src/aiready/fixSetup.ts`:

````ts
import { readFileSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Sink } from '../chat/engine';
import { CheckResult, failureLines } from './baseline';
import { fixChoices, pickFixes } from './fixPicker';
import { logDir, RunState, saveState } from './fixState';
import { fileStats, scanHealth } from './health';
import type { LanguageAdapter } from './language';
import { runCommand, tail } from './projectCommands';
import { deleteBranch, freeFolder, initRepository, prepare, prerequisites, remove, trackedFiles } from './worktree';

const MAX_FAILURE_LINES = 200;

/** Everything a run needs to run commands in the worktree. */
export interface CommandEnv {
	readonly storage: string;
	readonly root: string;
	readonly token: vscode.CancellationToken;
}

/** The per-command timeout from settings (minutes, default 10). */
function timeoutMs(): number {
	return Math.max(1, vscode.workspace.getConfiguration('myEditor').get<number>('aiReady.commandTimeoutMinutes', 10)) * 60_000;
}

/** Runs one approved command in the worktree, logs its full output in run state, and parses it. */
export async function runCheck(env: CommandEnv, adapter: LanguageAdapter, worktree: string, approved: readonly string[],
	command: string, label: string): Promise<CheckResult> {
	const log = path.join(logDir(env.storage, env.root), `${Date.now()}-${label}.log`);
	const output = await runCommand(command, { cwd: worktree, approved, timeoutMs: timeoutMs(), logFile: log, cancel: env.token });
	return {
		command, code: output.code, timedOut: output.timedOut, log,
		failures: label === 'test' ? [] : failureLines(output.error ?? output.output).slice(0, MAX_FAILURE_LINES),
		tests: label === 'test' && output.code !== undefined ? adapter.parseTests(output.stdout) : undefined,
		tail: tail(output.error ?? output.output),
	};
}

/** Prerequisites, with `git init` and a first commit offered when the folder has no repository. False means stop. */
async function checkPrerequisites(root: string, sink: Sink): Promise<boolean> {
	let ready = await prerequisites(root);
	if (ready.noRepository) {
		const answer = await vscode.window.showInformationMessage('This folder is not a Git repository yet.',
			{ modal: true, detail: 'Fixes go on a separate branch. Create a repository here with one commit of the current files (not .my_editor/)?' }, 'Create it');
		if (answer !== 'Create it') { sink.text('Fixes need a Git repository, so nothing was changed.'); return false; }
		await initRepository(root);
		ready = await prerequisites(root);
	}
	if (ready.problem) { sink.text(ready.problem); return false; }
	return true;
}

/**
 * A new run: prerequisites, the fix picker (from a fresh deterministic scan, never the report's text), approval of the
 * exact commands, the worktree and branch, and the baseline run twice. Undefined when the user stopped or declined.
 */
export async function startRun(env: CommandEnv, adapter: (root: string, tracked: readonly string[]) => LanguageAdapter, sink: Sink): Promise<RunState | undefined> {
	const { root, token } = env;
	if (!await checkPrerequisites(root, sink)) { return undefined; }
	sink.progress('Finding files to fix…');
	const tracked = await trackedFiles(root);
	const local = adapter(root, tracked);
	const sources = tracked.filter(file => local.extensions.includes(path.extname(file)));
	const stats = sources.map(file => fileStats(file, readFileSync(path.join(root, file), 'utf8')));
	const findings = scanHealth(stats, tracked, { languages: [local.label], checks: [], tests: [] }, []);
	const candidates = [...new Set(findings.filter(f => f.file && (f.kind === 'too-long' || f.kind === 'untested')).map(f => f.file!))]
		.filter(file => sources.includes(file));
	const skipped = new Map<string, string>();
	for (const file of candidates) {
		if (token.isCancellationRequested) { return undefined; }
		try {
			const reason = (await local.parse(file)).skip;
			if (reason) { skipped.set(file, reason); }
		} catch (error) { skipped.set(file, error instanceof Error ? error.message : String(error)); }
	}
	const choices = fixChoices(findings, stats, local.extensions, skipped);
	sink.progress('');
	if (!choices.length) { sink.text(`Nothing here can be fixed on a branch yet: no long or untested ${local.label} files that may be split or tested.`); return undefined; }
	const picked = await pickFixes(choices, (items, options) => vscode.window.showQuickPick(items, { ...options, canPickMany: true }));
	if (!picked?.length) { sink.text('No fixes were chosen, so nothing changed.'); return undefined; }
	const checks = [...new Map(picked.flatMap(fix => local.checks(fix.file)).map(check => [check.command, check])).values()];
	const approved = checks.map(check => check.command);
	const folder = freeFolder(root);
	const answer = await vscode.window.showWarningMessage('Run these commands on a new local branch?', {
		modal: true,
		detail: `In a new working copy at ${folder}, on a new branch:\n\n${approved.join('\n')}\n\n`
			+ `They build the project and run its tests, which runs project code. my_editor also runs read-only ${local.label} tools `
			+ '(to list packages and check formatting) and local git commands there. Your folder and branch are not touched, and nothing is pushed.',
	}, 'Run them');
	if (answer !== 'Run them') { sink.text('The commands were not approved, so nothing changed.'); return undefined; }
	const worktree = await prepare(root);
	sink.text(`Working on branch \`${worktree.branch}\` in \`${worktree.path}\`. Your folder stays as it is.\n`);
	logDir(env.storage, root, true);
	const state: RunState = {
		version: 1, root, language: local.label, worktree, startedAt: new Date().toISOString(), approved, fixes: picked, next: 0, steps: [],
		baseline: {}, skippedFiles: [...skipped].map(([file, reason]) => ({ file, reason })),
	};
	const inWorktree = adapter(worktree.path, await trackedFiles(worktree.path));
	for (const { command, label } of checks) {
		const runs: CheckResult[] = [];
		for (const round of [1, 2]) {
			sink.progress(`Baseline ${round} of 2: \`${command}\`…`);
			runs.push(await runCheck(env, inWorktree, worktree.path, approved, command, label));
			if (token.isCancellationRequested) { return discardUnstarted(state, sink); }
		}
		state.baseline[command] = [runs[0], runs[1]];
		if (runs[0].code !== 0) { sink.text(`\`${command}\` already fails before any change; it must keep failing the same way.\n`); }
	}
	saveState(env.storage, state);
	sink.progress('');
	return state;
}

/** Stop during the baseline: nothing was committed, so the worktree and its branch go away. */
async function discardUnstarted(state: RunState, sink: Sink): Promise<undefined> {
	try {
		await remove(state.root, state.worktree.path);
		await deleteBranch(state.root, state.worktree.branch);
	} catch { /* The user can delete them by hand; the message below names them. */ }
	sink.text(`Stopped before any fix. The branch \`${state.worktree.branch}\` and its working copy were removed.`);
	return undefined;
}
````

Create `src/aiready/fixRun.ts`:

````ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ask } from '../brain/analyse';
import type { Sink } from '../chat/engine';
import { loadCatalog, pickDefault } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { noteFileName, renderChangeNote, reportWithRun, runFlaky } from './changeNote';
import { CommandEnv, runCheck, startRun } from './fixSetup';
import { clearState, loadState, MAX_FIXES_PER_RUN, RunState, saveState, StepRecord } from './fixState';
import { AdapterFactory, adapterFor } from './languages';
import { runAddTests, runSplit, StepContext } from './steps';
import { commit, reattach, remove, trackedFiles } from './worktree';

const ASK_TIMEOUT_MS = 300_000;

export interface FixOptions {
	/** Resume the saved run without asking (the Continue button). */
	readonly continue?: boolean;
}

/** "Fix on a local branch": pick fixes, prepare the safety net, run up to 25 fixes, and close when all are done. */
export async function fixOnBranch(context: vscode.ExtensionContext, keys: ApiKeys, sink: Sink, token: vscode.CancellationToken,
	options: FixOptions = {}): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) { sink.text('Open a project folder first.'); return; }
	const storage = context.globalStorageUri.fsPath;
	const env: CommandEnv = { storage, root, token };
	const model = pickDefault(await loadCatalog(keys));
	if (!model) { sink.text('No model is available. Choose one with **my_editor: Choose Default Model** first.'); return; }
	const language = await adapterFor(root, {
		extensionPath: context.extensionUri.fsPath, storageDir: storage, version: String(context.extension.packageJSON.version ?? 'dev'),
	});
	if (typeof language === 'string') { sink.text(language); return; }
	let state = loadState(storage, root);
	if (state && !options.continue) {
		const answer = await vscode.window.showInformationMessage(`A fix run on ${state.worktree.branch} is not finished.`, {
			modal: true, detail: `${state.next} of ${state.fixes.length} fixes done. Continue it, or discard the rest (the branch and its commits stay)?`,
		}, 'Continue', 'Discard the rest');
		if (answer === 'Discard the rest') { state.next = state.fixes.length; }
		else if (answer !== 'Continue') { return; }
	}
	if (!state) {
		state = await startRun(env, language, sink);
		if (!state) { return; }
	} else {
		state.worktree = await reattach(root, state.worktree);
		if (state.next < state.fixes.length) { sink.text(`Continuing on \`${state.worktree.branch}\` with ${state.fixes.length - state.next} fix${state.fixes.length - state.next === 1 ? '' : 'es'} left.\n`); }
	}
	await runFixes(env, state, language, sink, (system, text) => ask(model, keys, system, text, token, ASK_TIMEOUT_MS));
}

function stepLine(step: StepRecord): string {
	const what = step.kind === 'split' ? `Split \`${step.file}\`` : `Tests for \`${step.file}\``;
	if (step.status === 'committed') {
		const detail = step.kind === 'split' ? ` into ${(step.moved ?? []).map(m => `\`${m.file}\``).join(', ')}` : ` in \`${step.testFile}\``;
		return `- ${what}${detail}: committed \`${step.commit?.slice(0, 7)}\`.`;
	}
	return `- ${what}: ${step.status}. ${step.reason ?? ''}`.trimEnd();
}

async function runFixes(env: CommandEnv, state: RunState, language: AdapterFactory, sink: Sink,
	askModel: (system: string, text: string) => Promise<string>): Promise<void> {
	const { storage, token } = env;
	const worktree = state.worktree.path;
	const adapter = language(worktree, await trackedFiles(worktree));
	const ctx: StepContext = {
		adapter, worktree, ask: askModel, baseline: state.baseline, flaky: runFlaky(state),
		check: (command, label) => runCheck(env, adapter, worktree, state.approved, command, label),
		cancelled: () => token.isCancellationRequested,
		progress: text => sink.progress(text),
	};
	let done = 0;
	while (state.next < state.fixes.length && done < MAX_FIXES_PER_RUN && !token.isCancellationRequested) {
		const fix = state.fixes[state.next];
		sink.progress(`Fix ${state.next + 1} of ${state.fixes.length}: ${fix.file}`);
		let outcome: StepRecord | 'stopped';
		try { outcome = fix.kind === 'split' ? await runSplit(ctx, fix) : await runAddTests(ctx, fix); }
		catch (error) {
			if (token.isCancellationRequested) { break; }
			outcome = { file: fix.file, kind: fix.kind, status: 'skipped', reason: error instanceof Error ? error.message : String(error) };
		}
		if (outcome === 'stopped') { break; }
		state.steps.push(outcome);
		state.next++;
		done++;
		saveState(storage, state);
		sink.text(`${stepLine(outcome)}\n`);
	}
	sink.progress('');
	if (state.next < state.fixes.length) {
		saveState(storage, state);
		const left = state.fixes.length - state.next;
		sink.text(`\n${token.isCancellationRequested ? 'Stopped.' : `That is ${MAX_FIXES_PER_RUN} fixes for this run.`} `
			+ `${left} fix${left === 1 ? ' is' : 'es are'} left on \`${state.worktree.branch}\`; Continue picks up from \`${state.fixes[state.next].file}\`.`);
		sink.action('Continue', 'myEditor.aiReadyFix', [{ continue: true }]);
		return;
	}
	await closeRun(env, state, sink);
}

/** Commits the change note on the branch, removes the worktree (the branch stays), and updates the report. */
async function closeRun(env: CommandEnv, state: RunState, sink: Sink): Promise<void> {
	const at = new Date();
	const note = noteFileName(at);
	const worktree = state.worktree.path;
	mkdirSync(path.dirname(path.join(worktree, note)), { recursive: true });
	writeFileSync(path.join(worktree, note), renderChangeNote(state, at));
	await commit(worktree, [note], 'my_editor: change note for the AI-ready fixes', 'What this branch changed, how each change was checked, and what was left.');
	let removed = true;
	try { await remove(state.root, worktree); } catch { removed = false; }
	const report = path.join(state.root, '.my_editor', 'ai-ready', 'report.md');
	try { writeFileSync(report, reportWithRun(existsSync(report) ? readFileSync(report, 'utf8') : '# AI-ready health report', state, note)); } catch { /* The note on the branch is the record. */ }
	clearState(env.storage, state.root);
	const committed = state.steps.filter(step => step.status === 'committed').length;
	const { branch, base } = state.worktree;
	sink.text(`\n**Done.** ${committed} fix${committed === 1 ? '' : 'es'} committed on \`${branch}\`, with the change note \`${note}\`. `
		+ `Your folder and its branch were not touched, and nothing was pushed.${removed ? '' : ` Remove the working copy \`${worktree}\` when you are done with it.`}\n\n`
		+ `Review with \`git diff ${base.slice(0, 12)}..${branch}\`, keep the changes with \`git merge ${branch}\`, or delete them with \`git branch -D ${branch}\`.`);
	sink.action('Refresh the brain after merging', 'myEditor.analyseProject', []);
}
````

- [ ] **Step 2: `src/chat/view.ts` (must end at 399 lines).** Two replacements.

In `src/chat/view.ts`, replace:

````ts
const ALLOWED_ACTIONS = new Set(['myEditor.saveDecision', 'myEditor.adaptFile', 'myEditor.analyseProject']);
````

with:

````ts
const ALLOWED_ACTIONS = new Set(['myEditor.saveDecision', 'myEditor.adaptFile', 'myEditor.analyseProject', 'myEditor.aiReadyFix']);
````

In `src/chat/view.ts`, replace:

````ts
	/** Reads the project into the brain and drafts its architecture; with aiReady, also writes the health report. */
	async analyse(aiReady = false): Promise<void> {
		await this.openLounge();
		if (!this.webviews().length) {
			this.pending = { text: '', mode: aiReady ? AI_READY : ANALYSE };
			return;
		}
		if (this.running) {
			return;
		}
		await this.context.workspaceState.update(ANALYSE_ANSWERED, true);
		this.broadcast({ type: 'offer', offer: undefined });
		this.messages.push({ id: newChatId(), role: 'user', markdown: aiReady ? 'Check AI-readiness' : 'Analyse this project', proposals: [], actions: [], done: true });
		const reply: Message = { id: newChatId(), role: 'assistant', characterId: this.characterId, markdown: '', proposals: [], actions: [], done: false };
		this.messages.push(reply);
		this.postMessages();
		await this.runReply(reply, (sink, token) => (aiReady ? makeAiReady : analyseProject)(this.keys, this.proposals, sink, token));
	}
````

with:

````ts
	/** Reads the project into the brain and drafts its architecture; with aiReady, also writes the health report. */
	async analyse(aiReady = false): Promise<void> {
		await this.openLounge();
		if (!this.webviews().length) { this.pending = { text: '', mode: aiReady ? AI_READY : ANALYSE }; return; }
		if (this.running) { return; }
		await this.context.workspaceState.update(ANALYSE_ANSWERED, true);
		this.broadcast({ type: 'offer', offer: undefined });
		await this.runTask(aiReady ? 'Check AI-readiness' : 'Analyse this project', (sink, token) => (aiReady ? makeAiReady : analyseProject)(this.keys, this.proposals, sink, token));
	}

	/** Runs a host job as a Pair reply under a short request line, with progress, buttons and Stop (e.g. fixing on a branch). */
	async runTask(label: string, job: (sink: Sink, token: vscode.CancellationToken) => Promise<void>): Promise<void> {
		await this.openLounge();
		if (this.running) { return; }
		this.messages.push({ id: newChatId(), role: 'user', markdown: label, proposals: [], actions: [], done: true });
		const reply: Message = { id: newChatId(), role: 'assistant', characterId: this.characterId, markdown: '', proposals: [], actions: [], done: false };
		this.messages.push(reply);
		this.postMessages();
		await this.runReply(reply, job);
	}
````

Check: `wc -l src/chat/view.ts` → `399 src/chat/view.ts`.

- [ ] **Step 3: `src/extension.ts`.**

In `src/extension.ts`, replace:

````ts
import * as vscode from 'vscode';
import { buildBrain, updateBrainFile } from './brain/brain';
````

with:

````ts
import * as vscode from 'vscode';
import { fixOnBranch, FixOptions } from './aiready/fixRun';
import { buildBrain, updateBrainFile } from './brain/brain';
````

In `src/extension.ts`, replace:

````ts
		vscode.commands.registerCommand('myEditor.aiReady', () => chat.analyse(true)),
````

with:

````ts
		vscode.commands.registerCommand('myEditor.aiReady', () => chat.analyse(true)),
		vscode.commands.registerCommand('myEditor.aiReadyFix', (options?: FixOptions) => chat.runTask(
			options?.continue ? 'Continue fixing on the local branch' : 'Fix on a local branch',
			(sink, token) => fixOnBranch(context, keys, sink, token, options))),
````

- [ ] **Step 4: Offer the fix after a Go report.**

In `src/aiready/healthRun.ts`, replace:

````ts
	try { await vscode.commands.executeCommand('markdown.showPreview', uri); } catch { await vscode.window.showTextDocument(uri); }
````

with:

````ts
	if (commands.languages.includes('Go') && all.some(f => f.file?.endsWith('.go') && (f.kind === 'too-long' || f.kind === 'untested'))) {
		sink.action('Fix on a local branch', 'myEditor.aiReadyFix', []);
	}
	try { await vscode.commands.executeCommand('markdown.showPreview', uri); } catch { await vscode.window.showTextDocument(uri); }
````

In `src/aiready/report.ts`, replace:

````ts
	'Characterization tests that pin how files behave today, before anything moves',
````

with:

````ts
	'Characterization tests that pin how files behave today, before anything moves, where the compiler cannot prove a move safe',
````

In `src/aiready/report.ts`, replace:

````ts
		'Fixes will run on a separate local branch, one per commit, each checked so the program behaves as before. That step is not built yet.', '',
````

with:

````ts
		'Fixes run on a separate local branch, one per commit, each checked so the program behaves as before. For Go projects, choose **Fix on a local branch** in Pair; other languages follow.', '',
````

- [ ] **Step 5: `package.json`.** Add the command after the `myEditor.aiReady` command, and the setting before `myEditor.autoComments.enabled`.

In `package.json`, replace:

````json
      {
        "command": "myEditor.aiReady",
        "title": "Check AI-Readiness",
        "category": "my_editor"
      },
````

with:

````json
      {
        "command": "myEditor.aiReady",
        "title": "Check AI-Readiness",
        "category": "my_editor"
      },
      {
        "command": "myEditor.aiReadyFix",
        "title": "Fix on a Local Branch",
        "category": "my_editor"
      },
````

In `package.json`, replace:

````json
        "myEditor.autoComments.enabled": {
````

with:

````json
        "myEditor.aiReady.commandTimeoutMinutes": {
          "type": "number",
          "default": 10,
          "minimum": 1,
          "description": "How long one build or test command may run while fixing a project on a local branch, in minutes."
        },
        "myEditor.autoComments.enabled": {
````

- [ ] **Step 6: Compile, test and check sizes.**

```bash
npm run -s compile 2>&1 | grep -i error; npm test 2>&1 | grep '^ℹ \(pass\|fail\)'; wc -l src/aiready/*.ts src/chat/view.ts | sort -n | tail -4
```

Expected: no error lines; `ℹ pass 155`, `ℹ fail 0`; the largest files are `steps.ts` (about 220), `healthReview.ts` (170) and `view.ts` (399), all under 400.

- [ ] **Step 7: Commit.**

```bash
git add src/aiready/fixSetup.ts src/aiready/fixRun.ts src/chat/view.ts src/extension.ts src/aiready/healthRun.ts src/aiready/report.ts package.json
git commit -m "Fix Go projects on a local branch from Pair"
```

### Task 10: Dry run on a copy of a real Go project

**Files:** none in the repository. Everything runs in a scratch folder, on a **copy** of a Go project, never the original.

This runs the pure split, the move check and the whole step pipeline without VS Code; the model is replaced by a hand-made ID plan and a prepared test file. The commands below use the user's dialer, but any Go project with a long file and an untested file works.

- [ ] **Step 1: Copy the project and compile the modules.**

```bash
EXT=$PWD   # overlay/extensions/my-editor-core
W=$(mktemp -d) && mkdir -p "$W/check" && cp -R /Users/u/funcoding/m_dialer/m_dialer "$W/dialer"
npm test >/dev/null 2>&1   # fills out-test/ with the compiled modules
git -C "$W/dialer" status --short   # note what is there; it must be the same at the end
```

Create `$W/check/split-check.js`:

````js
// Splits one Go file in a scratch copy of a project with a hand-made ID plan (no model), then runs the move check and
// compares `go build ./...` and `go vet` with before. Usage: EXT=<extension> PROJECT=<copy> node split-check.js <file>
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const EXT = process.env.EXT, root = process.env.PROJECT, file = process.argv[2];
const m = name => require(path.join(EXT, 'out-test/src/aiready', name));
const { goTools, createGoAdapter, goPackage } = m('goAdapter');
const { planProblems, oversizeNotes } = m('splitPlan');
const { checkMove } = m('moveCheck');
const sh = (bin, args) => { try { return { code: 0, out: execFileSync(bin, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
const lines = p => fs.readFileSync(path.join(root, p), 'utf8').split('\n').length - 1;
(async () => {
	const tools = await goTools(path.join(EXT, 'resources/goast/main.go'), path.join(__dirname, 'storage'), 'check');
	if (typeof tools === 'string') { throw new Error(tools); }
	const go = createGoAdapter(root, tools, execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean));
	const source = fs.readFileSync(path.join(root, file));
	const info = await go.parse(file);
	console.log(`${file}: ${lines(file)} lines, ${info.declarations.length} declarations, ${info.declarations.filter(d => d.movable).length} movable, skip: ${info.skip ?? 'no'}`);
	// The hand plan: keep the first ~300 lines and unmovable declarations; the rest in order, ~330 lines per new file.
	const plan = [];
	let kept = 0;
	for (const d of info.declarations) {
		if (!d.movable || (!plan.length && kept + d.lines < 300)) { kept += d.lines; continue; }
		let group = plan[plan.length - 1];
		if (!group || group.size + d.lines > 330) { group = { file: `${path.basename(file, '.go')}_part${plan.length + 1}.go`, declarations: [], size: 0 }; plan.push(group); }
		group.declarations.push(d.id);
		group.size += d.lines + 1;
	}
	const ids = plan.map(({ file: name, declarations }) => ({ file: name, declarations }));
	fs.writeFileSync(path.join(__dirname, 'plan.json'), JSON.stringify(ids));
	const dir = path.posix.dirname(file);
	const problems = planProblems(go, { source, info, existing: fs.readdirSync(path.join(root, dir)) }, ids);
	console.log('plan problems:', problems.length ? problems : 'none');
	if (problems.length) { return; }
	const before = { build: sh('go', ['build', './...']), vet: sh('go', ['vet', goPackage(file)]) };
	const unitBefore = await Promise.all((await go.unitFiles(file)).map(f => go.parse(f)));
	const formatted = !(await go.unformatted([file])).length;
	const result = go.buildSplit(source, info, ids);
	const newPaths = result.files.map(f => (dir === '.' ? f.name : `${dir}/${f.name}`));
	fs.writeFileSync(path.join(root, file), result.original);
	result.files.forEach((f, i) => fs.writeFileSync(path.join(root, newPaths[i]), f.text));
	const read = async p => ({ text: fs.readFileSync(path.join(root, p)), info: await go.parse(p) });
	const unitAfter = await Promise.all((await go.unitFiles(file)).map(f => go.parse(f)));
	const moveProblems = [...checkMove({ before: { text: source, info }, after: await read(file), files: await Promise.all(newPaths.map(read)), plan: ids, header: go.splitHeader(file) }),
		...go.sameDeclarations(unitBefore, unitAfter)];
	console.log('move check:', moveProblems.length ? moveProblems : 'pass');
	console.log(`gofmt-clean before: ${formatted}; files gofmt would change after: ${JSON.stringify(await go.unformatted([file, ...newPaths]))}`);
	console.log('lines after:', [file, ...newPaths].map(p => `${path.basename(p)}=${lines(p)}`).join(' '));
	for (const note of oversizeNotes(result, info, ids)) { console.log('note:', note); }
	const after = { build: sh('go', ['build', './...']), vet: sh('go', ['vet', goPackage(file)]) };
	console.log(`go build ./...: exit ${before.build.code} before, ${after.build.code} after, same output: ${before.build.out === after.build.out}`);
	console.log(`go vet ${goPackage(file)}: exit ${before.vet.code} before, ${after.vet.code} after, same output: ${before.vet.out === after.vet.out}`);
})().catch(error => { console.error(error); process.exit(1); });
````

Create `$W/check/pipeline-check.js`:

````js
// Runs the real step pipeline without VS Code on a scratch copy of a project: worktree and branch, the baseline twice,
// one split (the model replaced by plan.json from split-check.js) and one add-tests fix (the model replaced by a
// prepared test file), the change note, and worktree removal. Usage:
//   EXT=<extension> PROJECT=<copy> node pipeline-check.js <file to split> <file to test> <prepared _test.go text>
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const EXT = process.env.EXT, root = process.env.PROJECT;
const [splitFile, testsFile, testText] = process.argv.slice(2);
const m = name => require(path.join(EXT, 'out-test/src/aiready', name));
const { goTools, createGoAdapter } = m('goAdapter');
const { runSplit, runAddTests } = m('steps');
const { failureLines, flakyTests } = m('baseline');
const { runCommand, tail } = m('projectCommands');
const { prepare, trackedFiles, commit, remove } = m('worktree');
const { renderChangeNote, noteFileName } = m('changeNote');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
(async () => {
	const user = () => JSON.stringify([git('branch', '--show-current'), git('rev-parse', 'HEAD'), git('status', '--porcelain')]);
	const userBefore = user();
	const tools = await goTools(path.join(EXT, 'resources/goast/main.go'), path.join(__dirname, 'storage'), 'check');
	const wt = await prepare(root);
	console.log(`worktree ${wt.path} on ${wt.branch}`);
	const adapter = createGoAdapter(wt.path, tools, await trackedFiles(wt.path));
	const fixes = [{ file: splitFile, kind: 'split', lines: 0 }, { file: testsFile, kind: 'tests', lines: 0 }];
	const checks = [...new Map(fixes.flatMap(f => adapter.checks(f.file)).map(c => [c.command, c])).values()];
	const approved = checks.map(c => c.command);
	let n = 0;
	const check = async (command, label) => {
		const out = await runCommand(command, { cwd: wt.path, approved, timeoutMs: 600_000, env: adapter.commandEnv, logFile: path.join(__dirname, 'logs', `${n++}-${label}.log`) });
		return { command, code: out.code, failures: label === 'test' ? [] : failureLines(out.output), tests: label === 'test' ? adapter.parseTests(out.stdout) : undefined, tail: tail(out.output), log: '' };
	};
	const baseline = {};
	for (const { command, label } of checks) {
		baseline[command] = [await check(command, label), await check(command, label)];
		const tests = baseline[command][0].tests;
		console.log(`baseline \`${command}\`: exit ${baseline[command][0].code}${tests ? `, ${Object.keys(tests.tests).length} tests, packages ${JSON.stringify(tests.packages)}` : ''}`);
	}
	const ctx = { adapter, worktree: wt.path, baseline, flaky: Object.values(baseline).flatMap(([a, b]) => flakyTests(a.tests, b.tests)),
		ask: async system => (system.includes('test file') ? `\`\`\`go\n${fs.readFileSync(testText, 'utf8')}\`\`\`` : fs.readFileSync(path.join(__dirname, 'plan.json'), 'utf8')),
		check, cancelled: () => false, progress: () => undefined };
	const steps = [];
	for (const fix of fixes) {
		const step = fix.kind === 'split' ? await runSplit(ctx, fix) : await runAddTests(ctx, fix);
		console.log(`${fix.kind} ${fix.file}: ${step.status}${step.commit ? ` ${step.commit.slice(0, 7)}` : ''}${step.reason ? ` (${step.reason})` : ''}${step.dropped?.length ? `, dropped ${step.dropped}` : ''}`);
		steps.push(step);
	}
	const state = { version: 1, root, language: 'Go', worktree: wt, startedAt: new Date().toISOString(), approved, fixes, next: 2, steps, baseline, skippedFiles: [] };
	const at = new Date();
	const note = noteFileName(at);
	fs.mkdirSync(path.dirname(path.join(wt.path, note)), { recursive: true });
	fs.writeFileSync(path.join(wt.path, note), renderChangeNote(state, at));
	await commit(wt.path, [note], 'my_editor: change note for the AI-ready fixes', 'Check run.');
	console.log(git('log', '--format=%h %s', `${wt.base}..${wt.branch}`));
	await remove(root, wt.path);
	console.log(`user folder unchanged: ${user() === userBefore}; worktree removed: ${!fs.existsSync(wt.path)}`);
})().catch(error => { console.error(error); process.exit(1); });
````

Create `$W/check/dncstate_ai_test.go`:

````go
package dncstate

import "testing"

func TestAiPageLimits(t *testing.T) {
	if BootstrapPageLimit != 8192 || DeltaPageLimit != 512 {
		t.Fatal("limits changed")
	}
}

func TestAiFails(t *testing.T) { t.Fatal("must be dropped") }
````

- [ ] **Step 2: Split one big file with an ID plan, read-only for the original.**

```bash
cd "$W/check" && EXT=$EXT PROJECT=$W/dialer node split-check.js internal/store/placements.go
```

Expected (the dialer at `69d97dd`):

```text
internal/store/placements.go: 2926 lines, 60 declarations, 59 movable, skip: no
plan problems: none
move check: pass
gofmt-clean before: true; files gofmt would change after: []
lines after: placements.go=324 placements_part1.go=306 placements_part2.go=316 placements_part3.go=145 placements_part4.go=304 placements_part5.go=255 placements_part6.go=268 placements_part7.go=127 placements_part8.go=348 placements_part9.go=321 placements_part10.go=327
go build ./...: exit 1 before, 1 after, same output: true
go vet ./internal/store: exit 1 before, 1 after, same output: true
```

The one unmovable declaration is the initialized `var (Err… = errors.New(…))` block. Both checks fail before and after only because `internal/vad` needs `onnxruntime_c_api.h` (cgo), so the store's vet and tests cannot build on this machine; the run must keep that failure identical. Also check `go build ./internal/store` exits 0 in the copy.

- [ ] **Step 3: Run the whole pipeline on a worktree of the copy.**

```bash
git -C "$W/dialer" checkout -q -- . && git -C "$W/dialer" clean -fdq internal/store
EXT=$EXT PROJECT=$W/dialer node pipeline-check.js internal/store/placements.go internal/dncstate/state.go "$W/check/dncstate_ai_test.go"
```

Expected:

```text
worktree …/dialer.ai-ready on my_editor/ai-ready
baseline `go build ./...`: exit 1
baseline `go build -o /dev/null ./internal/store`: exit 0
baseline `go vet ./internal/store`: exit 1
baseline `go test -count=1 -json ./internal/store`: exit 1, 0 tests, packages {"github.com/lucky-ali/go-dialer/internal/store":"fail"}
baseline `go build -o /dev/null ./internal/dncstate`: exit 0
baseline `go vet ./internal/dncstate`: exit 0
baseline `go test -count=1 -json ./internal/dncstate`: exit 0, 0 tests, packages {"github.com/lucky-ali/go-dialer/internal/dncstate":"skip"}
split internal/store/placements.go: committed <sha>
tests internal/dncstate/state.go: committed <sha>, dropped TestAiFails
<sha> my_editor: change note for the AI-ready fixes
<sha> my_editor: add tests for state.go (internal/dncstate/state.go)
<sha> my_editor: split into 10 files (internal/store/placements.go)
user folder unchanged: true; worktree removed: true
```

Then `git -C "$W/dialer" status --short` shows the same as in Step 1, and `git -C "$W/dialer" show my_editor/ai-ready:.my_editor/changes/<note>.md` lists both commits and, under *Checks that already failed before the run*, the store's build, vet and test commands.

- [ ] **Step 4: Two refusals.** Point the plan at a missing declaration and the tests at a package whose test binary cannot build:

```bash
git -C "$W/dialer" branch -D my_editor/ai-ready && echo '[{"file":"zz.go","declarations":[999]}]' > "$W/check/plan.json"
printf 'package store\n\nimport "testing"\n\nfunc TestAiNothing(t *testing.T) {}\n' > "$W/check/store_ai_test.go"
EXT=$EXT PROJECT=$W/dialer node pipeline-check.js internal/store/placements.go internal/store/cells.go "$W/check/store_ai_test.go" | grep -v baseline
```

Expected: `split …: refused (The split plan was rejected twice: Declaration 999 does not exist.)` and `tests internal/store/cells.go: skipped (The tests did not work: No test passed.)`; the user folder is unchanged.

- [ ] **Step 5: Throw the scratch folder away.** `rm -rf "$W"`. Nothing to commit.

### Task 11: Docs, live check and hand-off

**Files (repo root):** `README.md`, `CHANGELOG.md`, `docs/progress.md`, `docs/plans/2026-10-07-ai-ready-design.md`

- [ ] **Step 1: README.** In the **AI-ready check** bullet, replace `Fixing on a separate local branch is the next stage.` with:

```markdown
For Go projects, **Fix on a local branch** (after the report, or **my_editor: Fix on a Local Branch**) splits long files by
  moving whole declarations and adds tests, one checked commit per fix, on a new branch in a working copy next to the
  project. Your folder is not touched and nothing is pushed; a change note on the branch says how to review it.
```

- [ ] **Step 2: CHANGELOG.** Above `## 0.0.7 alpha — 2026-10-07 …` add:

```markdown
## Unreleased

- Go projects can be fixed on a local branch after the AI-ready report: long files are split by moving whole declarations byte for byte, and untested files get tests. Each fix is checked (move check, `go build`, `go vet`, `go test` against a baseline run twice) and committed on its own in a worktree next to the project; at most 25 per run, with Stop and Continue. Nothing is pushed.
```

- [ ] **Step 3: progress.md.** In the FR-090 row replace `Stage 2 fixes on a local branch are designed in \`plans/2026-10-07-ai-ready-design.md\`, not built.` with `Stage 2a (Go fixes on a local branch) built and unit-tested (155 tests), dry-run on a copy of the dialer; live check pending. TS/JS, Python, C#, Rust and C/C++ adapters next.`

- [ ] **Step 4: Design doc.** Set the status line to `Stage 1 built on 7 October 2026; Stage 2a (Go) built on 9 October 2026 …` and, under the *Go components* table, add one line: `Built as a language-neutral core plus a Go adapter; see plans/2026-10-09-ai-ready-stage2-go-plan.md for the file mapping.`

- [ ] **Step 5: Full verification.** From `overlay/extensions/my-editor-core`: `npm run -s compile && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 155`, `ℹ fail 0`; `(cd resources/goast && go test ./...)` → `ok`; `wc -l src/aiready/*.ts src/chat/view.ts` → every file ≤ 400.

- [ ] **Step 6: Commit (local only).**

```bash
cd /Users/u/funcoding/my_editor
git add README.md CHANGELOG.md docs/progress.md docs/plans/2026-10-07-ai-ready-design.md docs/plans/2026-10-09-ai-ready-stage2-go-plan.md
git commit -m "Document fixing Go projects on a local branch"
```

- [ ] **Step 7: Install for the user's live check.** Only after the user confirms my_editor is closed: `scripts/install.sh`. Live check on a cloned Go project with a committed, clean tree: run **Check AI-Readiness**, then **Fix on a local branch** → the picker lists long files (pre-selected) and untested ones → the modal shows the exact `go build`/`go vet`/`go test` lines → progress in Pair; press Stop once and use **Continue** → at the end `git -C <project> status` and `git branch --show-current` are unchanged, `git log my_editor/ai-ready` shows one commit per fix plus the change note, and `<project>.ai-ready` is gone. Do not push.

