# AI-ready: refactor long Go functions (extract function) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Go file over 400 lines only because of one long function gets a fix the picker can offer: the model chooses runs of statements and names; my_editor writes them as helpers (statements copied byte for byte apart from a short list of mechanical rewrites), refuses what it cannot prove equivalent, checks the written file with separate code, runs build, vet and tests against the baseline, commits, and splits the file in the same run.

**Architecture:** A new stdlib-only Go helper, `resources/goextract/` (subcommands `outline`, `build`, `check`; one job per file), makes every Go decision on `go/types` facts loaded offline from `go list -export -deps -json` and the `gc` importer. Its checker is separate code that verifies the actual output. TypeScript gets a `'refactor'` fix kind, one optional language-neutral hook on the adapter (`refactor`), a new step module `refactorStep.ts`, two blob-keyed records (coverage, refusals), and wording in the picker, run text, commit, change note and Project card.

**Tech Stack:** TypeScript (strict, CommonJS), `node:test`; Go standard library only (`go/ast`, `go/types`, `go/importer`, `go/scanner`, `go/format`), Go 1.22 syntax, built at run time with the user's Go; Git worktrees.

**Spec:** [refactor design](2026-10-11-ai-ready-refactor-design.md) (approved 2026-10-11), with the corrections under *Decisions made while planning*. Models for style: [Python plan](2026-10-10-ai-ready-python-plan.md), [Go plan](2026-10-09-ai-ready-stage2-go-plan.md).

**Base:** branch `main` at `1a2289b`, where `npm test` reports `ℹ pass 569`. The design's status edit is uncommitted: commit it first (`git add docs/plans/2026-10-11-ai-ready-refactor-design.md && git commit -m "Mark the refactor design approved"`). Every testdata file and every expected helper text below was compiled, vetted, gofmt-checked and tested on go1.26.4 in a scratch module (see *Dry run*).

---

## Decisions made while planning

Where the plan differs from the design's words or fills a gap, this is what it does and why.

- **Layout: splice, then format the whole file.** Rule 11 says lines starting inside a `/* */` comment are not re-indented; gofmt does re-indent block-comment continuation lines, re-pads trailing comments once a neighbor leaves, and drops the parentheses of `(*x)` in a `range` clause or `switch` tag (`range *arr`). So the builder dedents every chunk line whose first byte is not inside a raw string, splices, and runs `go/format.Source` on the file. The checker compares tokens: comment text line by line with leading blanks trimmed, every other literal byte for byte, and it formats its own expected helper before comparing. Raw strings are never touched.
- **Helper results are unnamed unless needed.** An outer local the chunk assigns that is neither a parameter nor first written by a top-level `:=` of the chunk has no declaration in the helper. Then all results are named: that local by its name, every other slot `_` (`func pickOne(c bool) (x int)`). Otherwise unnamed (`(Rows, error)`). A top-level `rows, err := …` in the helper declares `err` itself, or reuses a parameter or named result of that name (checked on go1.26: compiles).
- **An outer local the chunk writes but no one reads afterwards is a parameter.** Without it the variable is undeclared in the helper, and `m, err := f()` with a dead `err` would be "declared and not used". Widens the interface only.
- **A pointer-passed variable on the left of `:=` is refused** (`non-name (*p) on left side of :=`, go1.26). The design does not list it.
- **Liveness is structural and conservative.** No CFG package exists in the standard library. Inputs and outputs may be over-approximated (wider interfaces, more refusals), never under: an output is never missed and definite assignment is never claimed without proof. Rules, in `flow.go`: statements in order; any branch is "may"; a loop body may run zero or many times; a `return`, a builtin `panic` and a jump to the chunk's natural end end a path; anything used anywhere in an enclosing loop is read after the chunk. Do not "improve" this into a leaky analysis.
- **Parameter order:** receiver, then parameters of type `context.Context` in first-use order, then the rest by first use in source order, `err` last. Outputs by first appearance in the chunk, `err` last. The design's dialer listing (`ctx, tx, staleAfter, req, imageRef`) contradicts its own rule 8; the rule gives `ctx, staleAfter, tx, req, imageRef` (dry run).
- **Helpers without returns** have no `done` and no function-result slots (the design's dialer example says "no returns"; this plan reads rule 4 that way). A tail chunk of a function without results becomes a plain call statement, not `return h(…)`.
- **Call block:** with no outputs and returns, `if done, r0, r1 := h(…); done { return r0, r1 }`; with no outputs and no returns, `h(…)`. Otherwise the new names are the chunk-declared outputs and the plumbing: none → `a, b = h(…)`; some, and every other output declared in the call's own block → `:=`; else one `var name T` line per new name, then `=`, then `if done { … }`.
- **Coverage:** the approved command is `go test -count=1 -coverprofile=.my_editor-cover-<n>.out ./<pkg>`, a path relative to the worktree root, because `splitCommand` splits on whitespace and global storage is under `Application Support`. The file is untracked (`changedFiles` lists tracked changes only), read right after the command, then deleted. It is read from the raw profile (`path:l.c,l.c stmts count`) by the function's line range, not with `go tool cover -func` (which needs `go list` and the sources). "Ran" means exit 0 and a block in the function's lines with a count above zero.
- **The coverage record is keyed by blob, not by tip** (`coverage.json`). Checks.json is tip-keyed, and every run that commits moves the tip, so a refactor would never be ticked. A refactor offer's file is not changed by the run that measured it, so its blob survives.
- **Refused refactors** are kept by blob with their reason (`refactor-refused.json`), written at close like `settled.json`.
- **`SettledSplit.big`** (optional: name, receiver, lines) is written when a split is settled as needing a refactor, so a file changed on the branch (the dialer's two targets are both files `ai_fix` created) can be offered without parsing. `SETTLED_RULES` stays 1; a no-skip record without `big` is ignored when the adapter offers refactors, so that file is screened once more and recorded with `big` (one extra run, then offered).
- **Files changed on the branch** that no record knows cannot be parsed in the user's folder: they are screened after the baseline as today and become refactor offers on the next run.
- **Follow-up split.** A committed refactor returns `followUp` (a split of the same file with its recounted lines); `runQueue` splices it in at `state.next`, so it runs next. `RunState.fixes` becomes mutable. When a refactor is picked, its file's "can't be split" screening is dropped from the queue (it would list the file under *Still over*).
- **Receivers are named by base type** (`Store`), as `resources/goast` prints them, from the picker to `FindFunc`; the outline shows the receiver as written (`*Store`).
- **Fresh names** also avoid the package-level names of the package's own `_test.go` files (same package) and the universe scope.
- **Type loading.** The TS side runs `go list -export -deps -json ./<pkg>` (read-only tool env, GOPROXY=off) into a temp file. It compiles dependencies (cgo ones too, as the approved `go build` does); it runs only for a package whose verifying build passed at baseline, and the approval modal says so when a refactor is picked. A package with `CgoFiles` is refused (it cannot be type-checked from source without cgo), as are generic functions, functions with a `//go:` line, test files and packages with type errors.
- **Aliases** survive only with `//go:debug gotypesalias=1` in `goextract`'s main package: with `go 1.22` in its go.mod, `go/types` otherwise prints an inferred alias as its target (`int64` for `ID`, checked on go1.26).
- **Checker independence.** Shared with the builder: `load.go`, `chunks.go` (locating statements), `typestr.go` (writing a type or a zero value; a wrong one fails type-checking). Not shared: liveness, sharing, jumps, rewriting, call blocks. `checkbody.go` has its own `(*x)` and return rewriter, written from the helper's actual signature.
- **Rule 4 of the check uses rule 3's window.** "Never address-taken anywhere in the function" would refuse every value parameter whose variable is address-taken after the chunk, which rule 3 passes by value. The check uses rule 3's definition (before or inside the chunk, or anywhere in an enclosing loop); captures count anywhere.
- **The helper is built from its folder** (`goBuildTool.ts`): every non-test `.go` file and `go.mod` hashed with `go version`, built with `CGO_ENABLED=0 GOPROXY=off GOFLAGS= GOWORK=off GOENV=off`. If it does not build, the Go adapter offers no refactor and splits work as before.
- **Prompt cap:** the function with line numbers, at most 120 000 characters; a longer function is refused before any model call. The dialer's `main` (961 lines) is 39 867 characters.
- **Any failure after the plan is accepted is `refused`** (the design): extract check, formatter, other files changed, checks differing. Stop is `stopped` and leaves nothing.
- **The coverage pass runs once per package** after the two baseline runs, outside the baseline map, so steps never compare it.
- **The dialer's second target needs more pointers than the design lists.** `sourceAfter` and `bucketAfter` are address-taken by `Scan(&sourceAfter, &bucketAfter, …)` at line 120, before the loop, so rule 3 passes them by pointer too. The `source` case still fits: `stepCtx, tx, campaignID, p*, sourceAfter*, err` is six parameters (`err` is also an input: the `!summaryReady` break path skips its assignment). The switch has eight phase cases plus `default`; `replay` is eight lines, so "7 helpers" is plausible.

## Dry run

Run in the scratchpad on go1.26.4 against `git archive` of the dialer's `ai_fix` (`94b9f90`), never in the dialer itself.

1. **Type loading.** `go list -export -deps -json ./internal/store` (243 files on `ai_fix`, 232 packages): 1.08 s wall, warm cache. Parsing its `GoFiles` and type-checking from source with `importer.ForCompiler(fset, "gc", lookup)` over the listed `Export` paths: 75–102 ms. No `CgoFiles` in `internal/store`.
2. **Liveness on `buildOnboardingPlanTx`** (`internal/store/onboarding_plan.go`, function lines 17–417; chunk 177–295 = `interval := pgInterval(staleAfter)` and the 118-line `rows, err := tx.Query(…)`): parameters by first use `ctx, staleAfter, tx, req, imageRef` (`context.Context`, `time.Duration`, `pgx.Tx`, `OnboardingRequest`, `string`); outputs `rows` (chunk-declared, `pgx.Rows`) and `err` (outer, declared line 70: at line 178 `Info.Defs` is nil and `Info.Uses` points to line 70). None of the five is address-taken or captured anywhere in the function (it address-takes `source`, `callerIDURL`, `sourceConfigJSON`, `exists`, `retired`, `existingName`, `existingCallLegQuota`, `existingUserID`, `duplicate`, `item`; none is used in the chunk). As the design expects: one helper, no returns, no pointers.
3. **Splice on the dialer.** Helper = the chunk's bytes (depth 1, nothing to dedent) plus `return rows, err`; call `rows, err := queryOnboardingPlacementRows(ctx, staleAfter, tx, req, imageRef)`; the spliced file equals `format.Source` of itself. The function becomes lines 17–299 (283 lines), the helper 302–423, the file 417 → 423 lines (so the split runs next). `go build -o /dev/null ./internal/store` passes; `go vet ./internal/store` fails before and after the same way (`internal/vad`: `onnxruntime_c_api.h` not found, a test dependency), so the build is that package's verifying check; `gofmt -l` is clean. `go test -count=1 -coverprofile=… ./internal/store` does not build its test binary here either (same header), so the coverage pass records "not ran" and the offer starts unticked: on this machine the build and the extract check are the whole net, as the design expected.
4. **Nested splice** (depth 2, a raw string, a block comment, aligned trailing comments): raw-string bytes untouched; gofmt re-pads the trailing comments and re-indents the block comment's continuation line. Hence *Layout* above.
5. **`:=` and gofmt facts** (go1.26.4): `n, err := f()` with a named result `err` compiles; `n, (*p) := f()` does not; gofmt keeps `(*n) = 2`, `(*x)++`, `(*arr)[2]`, `if (*q) > 0`, and rewrites `range (*s)` → `range *s`, `switch (*q)` → `switch *q`.
6. **Coverage.** `go test -count=1 -coverprofile=.my_editor-cover-1.out ./sub` writes the profile in the command's working folder; lines read `cov/sub/a.go:3.21,4.11 1 1`.
7. **Every test case and expected helper below** (`testdata/cases`, `testdata/want`): `go vet ./...` clean, `gofmt -l` clean, and each case's `TestPin` passes on the original and on the expected output.
8. **Aliases:** with `go 1.22` in go.mod an inferred `ID` (alias of `int64`) prints `int64`; with `//go:debug gotypesalias=1` in a main-package file it prints `ID`, in `go test` too.

## Ground rules for every task

- Work in `overlay/extensions/my-editor-core/` unless a path says otherwise. Paths are relative to it.
- TypeScript: tabs, one short `/** … */` line on exported functions, the surrounding comment density. No file over 400 lines, and don't cram to fit: one job per file. No new line over 160 characters (`test/aiReadyLineLength.test.ts` enforces it for `src/aiready`; hold Go to it too). Pure modules must not import `vscode`; only `fixSetup.ts`, `fixRun.ts`, `fixLeft.ts`, `healthRun.ts` and `pyPick.ts` do. Every new pure module is listed in `tsconfig.test.json` and has its own test file.
- Go: standard library only, Go 1.22 syntax, gofmt and `go vet` clean, each file ≤ 400 lines with a `_test.go` per file. Run helper tests as `cd resources/goextract && GOTOOLCHAIN=local GOFLAGS= GOPROXY=off go test ./... && GOTOOLCHAIN=local GOFLAGS= go vet ./... && gofmt -l .`.
- In Go tasks, "run the tests" means the command above; it must print `ok  	goextract	…` and nothing from gofmt. A step that expects a failure names the first error.
- `npm test` compiles to `out-test/` and runs every test; Go-backed tests skip themselves without Go. Counts below assume Go is installed.
- Commits stay **local**. Never run `git push`, `git fetch` or any remote command. Never modify `/Users/u/funcoding/m_dialer`; only `git archive` it into a scratch folder. Never launch the my_editor GUI, `my_editor --version` or `pkill`.
- `scripts/build.sh` and `scripts/install.sh` copy `resources/` whole, so `resources/goextract` ships with the extension like `resources/goast`.

## How the design maps to files

| Design part | Built as |
|---|---|
| Loading types offline | `resources/goextract/load.go` |
| Chunks (statement runs of one block) | `chunks.go` |
| Rules 1, 2, 6 (liveness, value-path writes, chunk-declared variables) | `vars.go`, `flow.go`, `live.go` |
| Rule 3 (shared variables by pointer) | `shared.go` |
| Rule 5 and the "refused besides" list | `jumps.go` |
| Rule 8 (names) | `names.go` |
| Rule 9 (types written in the file), zero values | `typestr.go` |
| Rules 3–5 rewrites, rule 11 re-indent | `rewrite.go` |
| Rule 10 (call block) | `callblock.go` |
| Plan problems, layout | `build.go` |
| The model's outline | `outline.go` |
| Extract check 1 and 5 | `check.go` |
| Extract check 2 and 3 | `checkbody.go`, `checkalpha.go` |
| Extract check 4 | `checksafe.go` |
| CLI | `main.go` |
| Building the helper; running it | `src/aiready/goBuildTool.ts`, `goExtract.ts` |
| Coverage profile; records | `goCover.ts`, `coverRecord.ts`, `refusedRecord.ts`, `coverageRun.ts` |
| The model's plan and prompt | `refactorPlan.ts`, `goRefactorPrompt.ts` |
| The Go adapter's refactor hooks | `goRefactor.ts` (+ `goAdapter.ts`) |
| Ticking offers | `refactorOffers.ts` (+ `fixCandidates.ts`, `fixPicker.ts`, `fixSettled.ts`) |
| The step, its commit text | `refactorStep.ts`, `refactorText.ts` (+ `fixScreen.ts`, `steps.ts`) |
| In a run | `fixQueue.ts`, `fixSetup.ts`, `fixRun.ts`, `changeNote.ts`, `fixText.ts`, `fixLeft.ts`, `fixButton.ts` |

## File map

| File | Status | Responsibility |
|---|---|---|
| `resources/goextract/go.mod` | new | `module goextract`, `go 1.22` |
| `resources/goextract/main.go` | new | `//go:debug gotypesalias=1`; the CLI: flags, subcommands, JSON out |
| `resources/goextract/load.go` | new | `go list` JSON, export-data importer, type-check with an overlay, test-file names |
| `resources/goextract/chunks.go` | new | Find the function; its blocks; a chunk from lines; whole-statement and overlap problems |
| `resources/goextract/vars.go` | new | Outer locals, chunk-declared objects, value-path roots, references in order |
| `resources/goextract/flow.go` | new | The walk: inputs, assigned, definite assignment |
| `resources/goextract/live.go` | new | Read after the chunk (enclosing loops), outputs, rule 6 problems; `Analyze` |
| `resources/goextract/shared.go` | new | Captured, address-taken (explicit, implicit, method values, array slicing), locks, named results with `defer` |
| `resources/goextract/jumps.go` | new | Branch targets; allowed natural-end jumps; every refusal of rule 5 and the "refused besides" list |
| `resources/goextract/names.go` | new | Fresh names, plumbing names |
| `resources/goextract/typestr.go` | new | Types as source text or qualified strings; shadowing; variadics; zero values |
| `resources/goextract/rewrite.go` | new | The helper body: `(*x)`, returns, natural-end jumps, dedent |
| `resources/goextract/callblock.go` | new | The text replacing a chunk: `:=`, `=`, `var` lines, `if done` |
| `resources/goextract/build.go` | new | The interface, signature, limits, splice, format, line counts, facts |
| `resources/goextract/outline.go` | new | Blocks, statements, declarations, refusal notes, live names at boundaries |
| `resources/goextract/check.go` | new | Extract check: markers, token comparison, type-check, gofmt |
| `resources/goextract/checkbody.go` | new | Extract check: the expected body from the actual signature |
| `resources/goextract/checkalpha.go` | new | Extract check: alpha-equivalence by object; call-block order |
| `resources/goextract/checksafe.go` | new | Extract check: safety predicates of the actual signature |
| `resources/goextract/*_test.go`, `testdata/cases/**`, `testdata/want/*.go.txt` | new | Tests (broken outputs are made in the tests from the goldens), cases (one package per ★ finding), expected outputs |
| `src/aiready/language.ts` | modify | `FixKind` with `'refactor'`; `RefactorHooks` and its types; optional `refactor` on the adapter |
| `src/aiready/fixState.ts` | modify | Re-export `FixKind`; `kindLabel`; `FixChoice.target`; `StepRecord.refactor`, `followUp`, `lasting.big`; mutable `fixes`; `coverage` |
| `src/aiready/goBuildTool.ts` | new, no vscode | Build a Go helper from a folder, once per sources and Go version |
| `src/aiready/goExtract.ts` | new, no vscode | The helper's JSON types; `go list -export`; run `outline`, `build`, `check` |
| `src/aiready/goCover.ts` | new, pure | Whether a Go cover profile shows lines of a file executed |
| `src/aiready/coverRecord.ts` | new, no vscode | `coverage.json`: ran or not, by file and blob |
| `src/aiready/refusedRecord.ts` | new, no vscode | `refactor-refused.json`: refused refactors by blob, with reason |
| `src/aiready/refactorPlan.ts` | new, pure | Read the model's chunks; shape problems |
| `src/aiready/goRefactorPrompt.ts` | new, pure | The Go refactor prompt |
| `src/aiready/goRefactor.ts` | new, no vscode | The Go adapter's `RefactorHooks` |
| `src/aiready/goAdapter.ts` | modify | Build `goextract` in `goTools`; list `'refactor'`; wire `refactor` |
| `src/aiready/refactorOffers.ts` | new, pure | Which refactor rows are ticked, and why not |
| `src/aiready/fixCandidates.ts`, `fixPicker.ts`, `fixSettled.ts`, `stillOver.ts` | modify | Offers, rows, `big`, `largestDeclaration` |
| `src/aiready/refactorText.ts` | new, pure | Helper lines, commit subject and body, run line |
| `src/aiready/refactorStep.ts` | new, no vscode | One refactor fix |
| `src/aiready/steps.ts`, `fixScreen.ts` | modify | Export `runChecks`; screen refactor fixes |
| `src/aiready/coverageRun.ts` | new, no vscode | Coverage commands per package; the coverage pass |
| `src/aiready/fixQueue.ts`, `fixSetup.ts`, `fixRun.ts` | modify | Follow-up splice; approval, coverage pass, picker; dispatch, refusals at close |
| `src/aiready/changeNote.ts`, `fixText.ts`, `fixLeft.ts`, `fixButton.ts` | modify | Refactored section, may differ, approval note, counts |
| `tsconfig.test.json` | modify | The new pure modules |
| `test/aiReady*.test.ts`, `test/goRefactorPrompt.test.ts`, `test/goExtractFixture.ts` | new / modify | One test file per new module; named cases |
| `README.md`, `CHANGELOG.md`, `docs/progress.md`, the design (repo root) | modify | Docs |

## The review's ★ findings as regression tests

Each is a package under `resources/goextract/testdata/cases/` with a `TestPin` where behavior can differ, and a named Go test.

| ★ finding | Case | Plan | Expected | Test |
|---|---|---|---|---|
| named results + `defer` + `recover` | `deferrecover` | `advance` 14–17 | `n *int`; panic keeps `n=2` | `TestBuildGoldens/deferrecover`, `TestCheckRefusesValueNamedResultWithDefer`, `TestEndToEndPins` |
| `strings.Builder` in a struct copied | `buildercopy` | `writeWords` 15–18 | `a *acc` (implicit `&` through `a.b`) | `TestSharedImplicitAddress`, `TestCheckRefusesValueBuilder` |
| value-path writes | `valuepath` | `setFields` 22–25 / 22–24 | 4 outputs refused; 3 outputs built | `TestFlowValuePaths`, `TestBuildProblems`, `TestBuildGoldens/valuepath` |
| chunk-declared captured variable | `capturedecl` | `count` 7–9 | refused | `TestFlowCapturedDeclaration` |
| `var err` shadowing | `shadowerr` | `inspect` 14–20 | refused | `TestFlowShadowedInput` |
| multi-value `return f()` | `multireturn` | `early` 16–18 | `r0, r1 := f(m)` | `TestRewriteMultiValueReturn`, `TestBuildGoldens/multireturn` |
| tail chunk | `tail`, `tailvoid` | `finish` 9–12, `finishG` 10–13 | `return finish(n)`; `finishG(n, out)` | `TestBuildGoldens/tail`, `TestBuildGoldens/tailvoid` |
| `break` to the switch at clause end | `breakswitch` | `pickOne` 9–13 / 9–12 | built / refused | `TestJumpsBreakAtClauseEnd`, `TestBuildGoldens/breakswitch` |
| `**T` selector | `ptrselector` | `setP` 14–15 | `(*p).f`, `(*p).bump()` | `TestRewritePointerToPointer` |
| `range` over an array pointer | `rangearrayptr` | `sumAll` 11–14 | `range *arr` (gofmt), `(*arr)[2]` | `TestRewriteRangeArray`, `TestCheckRefusesDroppedDeref` |
| `&(*x)` | `addrderef` | `bump` 10–11 | `use(x)` | `TestRewriteAddressOfPointer` |
| method-set shadowing names | `methodset` | `loadRows`, `saveAll`, `rows`, `addRows` 22–23 | three refused, `addRows` built | `TestNamesMethodSet` |
| raw-string re-indent | `rawstring` | `buildQuery` 12–20 | raw string untouched, comments re-padded | `TestRewriteDedentOutsideRawStrings`, `TestBuildGoldens/rawstring` |

Besides: `onboarding` (the dialer's shape), `deadwrite`, `ptrdefine`, `gotoover`, `generic`, `typestr`, `names`, `loopout`, `basic`.

---

## Chunk 1: The Go helper: loading and the facts the rules need

### Task 1: Module, loader and the test cases

**Files:**
- Create: `resources/goextract/go.mod`, `main.go` (stub), `load.go`, `load_test.go`, `testutil_test.go`
- Create: `resources/goextract/testdata/cases/go.mod` and the 23 case packages below (every later Go task uses them)

`go list -export -deps -json` prints one JSON object per package, dependencies first and the named package last. The loader parses the target's `GoFiles` from source (or from an overlay, for the checker) and imports everything else from the listed `Export` files.

- [ ] **Step 1: Write the cases and the failing tests.**

Create `resources/goextract/go.mod`:

````text
module goextract

go 1.22
````

Create `resources/goextract/testdata/cases/go.mod`:

````text
module cases

go 1.22
````

Create each case file exactly as below (tabs, gofmt-clean; each `TestPin` pins today's behavior).

`testdata/cases/basic/a.go`:

````go
// Package basic is the smallest case: one function, two chunks.
package basic

import (
	"fmt"
	"strings"
)

// Report joins and prints.
func Report(items []string, upper bool) string {
	var out []string
	for _, it := range items {
		out = append(out, it)
	}
	text := strings.Join(out, ",")
	if upper {
		text = strings.ToUpper(text)
	}
	return fmt.Sprintf("[%s]", text)
}
````

`testdata/cases/onboarding/a.go`:

````go
// Package onboarding mirrors the dialer's buildOnboardingPlanTx chunk: a long query whose rows and error flow out.
package onboarding

import (
	"context"
	"errors"
	"time"
)

// Rows is a result set.
type Rows interface {
	Next() bool
	Close()
}

// Tx runs queries.
type Tx interface {
	Query(ctx context.Context, sql string, args ...any) (Rows, error)
}

// Request is what the caller asks for.
type Request struct {
	TenantID string
	CellID   string
}

func pgInterval(d time.Duration) string { return d.String() }

func currentImage(ctx context.Context, tx Tx) (string, error) { return "img", ctx.Err() }

// Plan builds a plan.
func Plan(ctx context.Context, tx Tx, req Request, staleAfter time.Duration) (int, error) {
	imageRef, err := currentImage(ctx, tx)
	if err != nil {
		return 0, err
	}

	interval := pgInterval(staleAfter)
	rows, err := tx.Query(ctx,
		`SELECT cell_id
		   FROM cells
		  WHERE last_seen_at > now()-$1::interval
		    AND tenant_id IN ('', $2)
		    AND ($3 = '' OR cell_id = $3)
		    AND image_ref = $4`,
		interval, req.TenantID, req.CellID, imageRef)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		n++
	}
	if n == 0 {
		return 0, errors.New("no cell")
	}
	return n, nil
}
````

`testdata/cases/deferrecover/a.go`:

````go
// Package deferrecover: named results, a defer with recover, and a chunk that may panic (★).
package deferrecover

import "fmt"

// F sets n in steps; a panic in the middle is recovered into err with n as it was.
func F(bad bool) (n int, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("recovered at n=%d: %v", n, r)
		}
	}()
	n = 1
	n = 2
	if bad {
		panic("boom")
	}
	n = 3
	return n, nil
}
````

`testdata/cases/deferrecover/a_test.go`:

````go
package deferrecover

import "testing"

func TestPin(t *testing.T) {
	if n, err := F(false); n != 3 || err != nil {
		t.Fatalf("F(false) = %d, %v", n, err)
	}
	if n, err := F(true); n != 2 || err == nil || err.Error() != "recovered at n=2: boom" {
		t.Fatalf("F(true) = %d, %v", n, err)
	}
}
````

`testdata/cases/buildercopy/a.go`:

````go
// Package buildercopy: a strings.Builder inside a struct value; copying it after use panics (★).
package buildercopy

import "strings"

type acc struct {
	b strings.Builder
	n int
}

// F writes through a.b before and inside the chunk.
func F(words []string) string {
	var a acc
	a.b.WriteString("<")
	for _, w := range words {
		a.b.WriteString(w)
		a.n++
	}
	a.b.WriteString(">")
	return a.b.String()
}
````

`testdata/cases/buildercopy/a_test.go`:

````go
package buildercopy

import "testing"

func TestPin(t *testing.T) {
	if got := F([]string{"a", "b"}); got != "<ab>" {
		t.Fatalf("F = %q", got)
	}
}
````

`testdata/cases/valuepath/a.go`:

````go
// Package valuepath: writes through field and array-index paths of values are assignments (★).
package valuepath

import "errors"

type config struct {
	Timeout int
	Name    string
}

type pair struct{ f int }

func g() (int, error) { return 7, errors.New("g") }

// F changes cfg, arr and x only through paths.
func F() (config, [3]int, pair, error) {
	cfg := config{Name: "a"}
	var arr [3]int
	var x pair
	var err error
	i := 1
	cfg.Timeout = 5
	arr[i] = 9
	x.f++
	x.f, err = g()
	return cfg, arr, x, err
}
````

`testdata/cases/valuepath/a_test.go`:

````go
package valuepath

import "testing"

func TestPin(t *testing.T) {
	cfg, arr, x, err := F()
	if cfg.Timeout != 5 || cfg.Name != "a" || arr[1] != 9 || x.f != 7 || err == nil {
		t.Fatalf("F = %+v %v %+v %v", cfg, arr, x, err)
	}
}
````

`testdata/cases/capturedecl/a.go`:

````go
// Package capturedecl: a chunk-declared variable used after the chunk and captured inside it is refused (★).
package capturedecl

// F counts with a closure.
func F() int {
	start := 1
	v := start
	inc := func() { v++ }
	inc()
	return v
}
````

`testdata/cases/shadowerr/a.go`:

````go
// Package shadowerr: the chunk reads the outer err, then declares its own err in the same block (★ var err shadowing).
package shadowerr

import "errors"

func a() error { return errors.New("a") }
func b() error { return nil }

// F reports which error it saw.
func F(x bool) string {
	err := a()
	out := ""
	if x {
		if err != nil {
			out = "outer"
		}
		var err = b()
		if err == nil {
			out += "+inner"
		}
	}
	return out
}
````

`testdata/cases/multireturn/a.go`:

````go
// Package multireturn: `return f()` with a multi-value f inside a chunk (★).
package multireturn

import "errors"

func f(n int) (int, error) {
	if n < 0 {
		return 0, errors.New("negative")
	}
	return n * 2, nil
}

// F returns early through f.
func F(n int) (int, error) {
	m := n + 1
	if m > 10 {
		return f(m)
	}
	m++
	return m, nil
}
````

`testdata/cases/multireturn/a_test.go`:

````go
package multireturn

import "testing"

func TestPin(t *testing.T) {
	if v, err := F(20); v != 42 || err != nil {
		t.Fatalf("F(20) = %d, %v", v, err)
	}
	if v, err := F(1); v != 3 || err != nil {
		t.Fatalf("F(1) = %d, %v", v, err)
	}
}
````

`testdata/cases/tail/a.go`:

````go
// Package tail: a chunk that is the tail of the body becomes `return h(…)` (★ tail chunk).
package tail

import "fmt"

// F ends in its chunk.
func F(n int) (string, error) {
	n *= 2
	if n > 100 {
		return "", fmt.Errorf("too big: %d", n)
	}
	return fmt.Sprint(n), nil
}
````

`testdata/cases/tail/a_test.go`:

````go
package tail

import "testing"

func TestPin(t *testing.T) {
	if s, err := F(3); s != "6" || err != nil {
		t.Fatal(s, err)
	}
	if _, err := F(60); err == nil || err.Error() != "too big: 120" {
		t.Fatal(err)
	}
}
````

`testdata/cases/tailvoid/a.go`:

````go
// Package tailvoid: the tail chunk of a function without results becomes a plain call.
package tailvoid

import "fmt"

// G has no results.
func G(n int, out *[]string) {
	n++
	*out = append(*out, fmt.Sprint(n))
	if n > 3 {
		return
	}
	*out = append(*out, "small")
}
````

`testdata/cases/tailvoid/a_test.go`:

````go
package tailvoid

import (
	"reflect"
	"testing"
)

func TestPin(t *testing.T) {
	var out []string
	G(1, &out)
	G(5, &out)
	if !reflect.DeepEqual(out, []string{"2", "small", "6"}) {
		t.Fatal(out)
	}
}
````

`testdata/cases/breakswitch/a.go`:

````go
// Package breakswitch: a break to the switch is the chunk's natural end only when the chunk ends its case (★).
package breakswitch

// F picks a value per kind.
func F(k int, c bool) int {
	x := 0
	switch k {
	case 1:
		x = 1
		if c {
			break
		}
		x = 2
	case 2:
		x = 20
	}
	return x
}
````

`testdata/cases/breakswitch/a_test.go`:

````go
package breakswitch

import "testing"

func TestPin(t *testing.T) {
	if F(1, true) != 1 || F(1, false) != 2 || F(2, false) != 20 || F(3, false) != 0 {
		t.Fatal(F(1, true), F(1, false), F(2, false), F(3, false))
	}
}
````

`testdata/cases/ptrselector/a.go`:

````go
// Package ptrselector: a pointer variable that is itself shared goes as **T; its selectors need (*p) (★ **T selector).
package ptrselector

type T struct{ f int }

func (t *T) bump() { t.f++ }

func keep(pp **T) {}

// F changes p's target.
func F() int {
	p := &T{}
	keep(&p)
	p.f = 1
	p.bump()
	return p.f
}
````

`testdata/cases/ptrselector/a_test.go`:

````go
package ptrselector

import "testing"

func TestPin(t *testing.T) {
	if F() != 2 {
		t.Fatal(F())
	}
}
````

`testdata/cases/rangearrayptr/a.go`:

````go
// Package rangearrayptr: ranging over a shared array must stay a range over the array value, (*arr) (★).
package rangearrayptr

func keep(p *[3]int) {}

// F changes the array while ranging over it; the range sees the copy.
func F() int {
	arr := [3]int{1, 2, 3}
	keep(&arr)
	sum := 0
	for _, v := range arr {
		arr[2] = 10
		sum += v
	}
	return sum + arr[2]
}
````

`testdata/cases/rangearrayptr/a_test.go`:

````go
package rangearrayptr

import "testing"

func TestPin(t *testing.T) {
	if F() != 16 {
		t.Fatal(F())
	}
}
````

`testdata/cases/addrderef/a.go`:

````go
// Package addrderef: &x of a pointer-passed x is written x, never &(*x) (★).
package addrderef

func use(p *int) { *p += 5 }

// F shares x with a closure, so x goes by pointer.
func F() int {
	x := 1
	get := func() int { return x }
	use(&x)
	x++
	return get()
}
````

`testdata/cases/addrderef/a_test.go`:

````go
package addrderef

import "testing"

func TestPin(t *testing.T) {
	if F() != 7 {
		t.Fatal(F())
	}
}
````

`testdata/cases/methodset/a.go`:

````go
// Package methodset: a helper name must not be a field or method of the receiver, promoted ones included,
// nor a method of an interface in the package (★ method-set shadowing names).
package methodset

// Base has a method S gets by embedding.
type Base struct{ rows int }

func (Base) loadRows() int { return 1 }

// Saver is satisfied by types with saveAll.
type Saver interface{ saveAll() }

// S embeds Base.
type S struct {
	Base
	count int
}

// Run sums.
func (s *S) Run() int {
	total := s.rows
	total += s.loadRows()
	s.count = total
	return total
}
````

`testdata/cases/rawstring/a.go`:

````go
// Package rawstring: a nested chunk with a multi-line raw string, a block comment and aligned trailing comments (★).
package rawstring

import "fmt"

// F builds a query.
func F(n int) string {
	total := 0
	q := ""
	if n > 0 {
		reallyLongNameHere := 3 // outside neighbor
		x := 1                  // short
		longer := 2             // aligned with x
		q = `SELECT a
	FROM t
		WHERE b`
		total += x + longer + len(q) + reallyLongNameHere
		/* a block
		   comment */
		fmt.Println(total)
	}
	return fmt.Sprint(total, q)
}
````

`testdata/cases/deadwrite/a.go`:

````go
// Package deadwrite: an outer local the chunk writes but nobody reads afterwards is passed in, so the helper compiles.
package deadwrite

import "errors"

func f() (int, error) { return 1, errors.New("f") }

// F ignores the second error.
func F() int {
	n, err := f()
	if err != nil {
		n++
	}
	m, err := f()
	n += m
	return n
}
````

`testdata/cases/ptrdefine/a.go`:

````go
// Package ptrdefine: a pointer-passed variable on the left of := cannot be rewritten to (*err) and is refused.
package ptrdefine

import "errors"

func f() (int, error) { return 1, errors.New("f") }

// F has a deferred closure over err.
func F() (n int, err error) {
	defer func() {
		if err != nil {
			n = -1
		}
	}()
	m, err := f()
	n = m
	return n, err
}
````

`testdata/cases/gotoover/a.go`:

````go
// Package gotoover: a goto before the call to a label after it would jump over the call block's declarations.
package gotoover

// F skips ahead.
func F(skip bool) int {
	x := 0
	if skip {
		goto done
	}
	x = 1
	x++
done:
	return x
}
````

`testdata/cases/generic/a.go`:

````go
// Package generic: generic functions are out of scope.
package generic

// Sum adds.
func Sum[T int | float64](xs []T) T {
	var s T
	for _, x := range xs {
		s += x
	}
	return s
}
````

`testdata/cases/typestr/a.go`:

````go
// Package typestr: writing types: aliases survive, a dot import, a shadowed package name, variadics, a local type.
package typestr

import (
	"errors"
	. "strings"
	tm "time"
)

// ID is an alias.
type ID = int64

// F uses each kind of type.
func F(id ID, d tm.Duration, parts ...string) (string, error) {
	b := Builder{}
	for _, p := range parts {
		b.WriteString(p)
	}
	total := id + ID(d)
	if total < 0 {
		return "", errors.New("negative")
	}
	errors := []string{b.String()}
	type local struct{ n int }
	l := local{n: len(errors)}
	return Join(errors, ",") + string(rune('0'+l.n)), nil
}
````

`testdata/cases/names/a.go`:

````go
// Package names: helper names must be fresh in every scope of the function, the package (test files too) and the universe.
package names

func helperTaken() {}

// F has a function literal with its own locals.
func F(n int) int {
	inner := func() int {
		innerOnly := n * 2
		return innerOnly
	}
	n += inner()
	n *= 2
	return n
}
````

`testdata/cases/names/a_test.go`:

````go
package names

import "testing"

func takenInTests() {}

func TestPin(t *testing.T) {
	if F(1) != 6 {
		t.Fatal(F(1))
	}
}
````

`testdata/cases/loopout/a.go`:

````go
// Package loopout: inside a loop, a variable the chunk assigns is an output when the loop reads it earlier.
package loopout

// F carries prev across iterations.
func F(xs []int) int {
	prev := 0
	sum := 0
	for _, x := range xs {
		sum += prev
		prev = x * 2
		sum++
	}
	return sum
}
````

`testdata/cases/loopout/a_test.go`:

````go
package loopout

import "testing"

func TestPin(t *testing.T) {
	if F([]int{1, 2, 3}) != 9 {
		t.Fatal(F([]int{1, 2, 3}))
	}
}
````

Create `resources/goextract/testutil_test.go`:

````go
package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
)

var (
	listMu    sync.Mutex
	listCache = map[string]string{}
)

func TestMain(m *testing.M) {
	code := m.Run()
	for _, file := range listCache {
		os.RemoveAll(filepath.Dir(file))
	}
	os.Exit(code)
}

// goEnv is how every go command in the tests runs: the installed toolchain only, no proxy, none of the user's GOFLAGS.
func goEnv() []string {
	return append(os.Environ(), "GOTOOLCHAIN=local", "GOFLAGS=", "GOPROXY=off")
}

// casesDir is the absolute path of testdata/cases.
func casesDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("testdata", "cases"))
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

// caseFile is the absolute path of a case's a.go.
func caseFile(t *testing.T, name string) string {
	return filepath.Join(casesDir(t), name, "a.go")
}

// listCase runs `go list -export -deps -json ./<name>` once per case; it returns the list file and the import path.
func listCase(t *testing.T, name string) (string, string) {
	t.Helper()
	listMu.Lock()
	defer listMu.Unlock()
	if file, ok := listCache[name]; ok {
		return file, "cases/" + name
	}
	cmd := exec.Command("go", "list", "-export", "-deps", "-json", "./"+name)
	cmd.Dir = casesDir(t)
	cmd.Env = goEnv()
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list %s: %v", name, err)
	}
	dir, err := os.MkdirTemp("", "goextract-list-")
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, name+".json")
	if err := os.WriteFile(file, out, 0o644); err != nil {
		t.Fatal(err)
	}
	listCache[name] = file
	return file, "cases/" + name
}

// loadCase type-checks a case package, with a.go replaced by aGo when it is not nil.
func loadCase(t *testing.T, name string, aGo []byte) *Loaded {
	t.Helper()
	list, pkg := listCase(t, name)
	var overlay map[string][]byte
	if aGo != nil {
		overlay = map[string][]byte{caseFile(t, name): aGo}
	}
	l, err := Load(list, pkg, overlay)
	if err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	return l
}

// readCase is a case's a.go.
func readCase(t *testing.T, name string) []byte {
	t.Helper()
	src, err := os.ReadFile(caseFile(t, name))
	if err != nil {
		t.Fatal(err)
	}
	return src
}
````

Create `resources/goextract/load_test.go`:

````go
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadListPicksTarget(t *testing.T) {
	stream := `{"ImportPath":"fmt","Export":"/x/fmt.a"}
{"ImportPath":"example.com/p","Dir":"/w/p","Name":"p","GoFiles":["a.go"],"ImportMap":{"q":"vendor/q"}}`
	target, exports, err := ReadList(strings.NewReader(stream), "example.com/p")
	if err != nil || target.Dir != "/w/p" || exports["fmt"] != "/x/fmt.a" || target.ImportMap["q"] != "vendor/q" {
		t.Fatalf("%+v %v %v", target, exports, err)
	}
	if _, _, err := ReadList(strings.NewReader(stream), "example.com/missing"); err == nil || !strings.Contains(err.Error(), "not in the list") {
		t.Fatal(err)
	}
}

func TestLoadRefusesCgoAndListErrors(t *testing.T) {
	file := filepath.Join(t.TempDir(), "list.json")
	write := func(text string) string {
		if err := os.WriteFile(file, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
		return file
	}
	if _, err := Load(write(`{"ImportPath":"p","Dir":"/w","GoFiles":["a.go"],"CgoFiles":["c.go"]}`), "p", nil); err == nil ||
		!strings.Contains(err.Error(), "uses cgo") {
		t.Fatal(err)
	}
	if _, err := Load(write(`{"ImportPath":"p","Dir":"/w","Error":{"Err":"no Go files in /w"}}`), "p", nil); err == nil ||
		!strings.Contains(err.Error(), "no Go files") {
		t.Fatal(err)
	}
}

func TestLoadTypeChecksFromExportData(t *testing.T) {
	l := loadCase(t, "basic", nil)
	found := false
	for id, obj := range l.Info.Uses {
		if id.Name == "Join" && obj.Pkg() != nil && obj.Pkg().Path() == "strings" {
			found = true
		}
	}
	if l.Pkg.Name() != "basic" || !found || l.File(caseFile(t, "basic")) == nil {
		t.Fatalf("package %s, strings.Join resolved: %v", l.Pkg.Name(), found)
	}
}

func TestLoadOverlayAndTypeErrors(t *testing.T) {
	src := readCase(t, "basic")
	l := loadCase(t, "basic", append(append([]byte{}, src...), "\nvar Extra = 1\n"...))
	if l.Pkg.Scope().Lookup("Extra") == nil {
		t.Fatal("the overlay was not used")
	}
	list, pkg := listCase(t, "basic")
	bad := append(append([]byte{}, src...), "\nvar bad int = \"s\"\n"...)
	if _, err := Load(list, pkg, map[string][]byte{caseFile(t, "basic"): bad}); err == nil || !strings.Contains(err.Error(), "does not type-check") {
		t.Fatal(err)
	}
}

func TestLoadTestNames(t *testing.T) {
	l := loadCase(t, "names", nil)
	if !l.TestNames["takenInTests"] || !l.TestNames["TestPin"] || l.TestNames["F"] {
		t.Fatal(l.TestNames)
	}
}
````

- [ ] **Step 2: Run them and see them fail.** `cd resources/goextract && GOTOOLCHAIN=local GOFLAGS= GOPROXY=off go test ./...` → `undefined: Load`, `undefined: ReadList`, `FAIL goextract [build failed]`.

- [ ] **Step 3: Implement.**

`main.go` (stub; Task 14 fills it):

````go
//go:debug gotypesalias=1

// Command goextract outlines, extracts and checks helpers of one long Go function for my_editor's AI-ready refactors.
// It uses only the standard library, reads the package's types from `go list -export -deps -json` output, and never
// writes the files it reads.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "usage: goextract outline|build|check -list FILE -pkg PATH -file FILE -func NAME [-recv TYPE] …")
	os.Exit(2)
}
````

`load.go`:

- `type Listed struct { ImportPath, Dir, Name, Export string; GoFiles, CgoFiles, TestGoFiles []string; ImportMap map[string]string; Error *struct{ Err string } }`
- `type Loaded struct { Fset *token.FileSet; Files []*ast.File; Paths []string; Src map[string][]byte; Pkg *types.Package; Info *types.Info; Listed Listed; TestNames map[string]bool }` with `func (l *Loaded) File(path string) *ast.File` (by absolute path).
- `func ReadList(r io.Reader, pkg string) (Listed, map[string]string, error)`: decode the stream with one `json.Decoder` until `io.EOF`; `exports[p.ImportPath] = p.Export` when set; the target is the object whose `ImportPath == pkg`; missing → `package <pkg> is not in the list`.
- `func Load(listFile, pkg string, overlay map[string][]byte) (*Loaded, error)`, in order: read the list; `target.Error` → its `Err`; `len(target.CgoFiles) > 0` → `the package uses cgo, which this check cannot type-check`; parse each `GoFiles` entry (`filepath.Join(target.Dir, name)`, bytes from `overlay` when present) with `parser.ParseComments|parser.SkipObjectResolution`; `Info` with `Types`, `Defs`, `Uses`, `Implicits`, `Selections`, `Scopes`; `types.Config{Importer: importer.ForCompiler(fset, "gc", lookup), Error: func(error) {}}` keeping the first error, where `lookup(path)` maps through `target.ImportMap`, then opens `exports[path]` (missing → `no export data for <path>`); a type error → `the package does not type-check: <first error>`. `TestNames`: parse each `TestGoFiles` entry (no type-check) and collect top-level func (not methods), type, var and const names.

- [ ] **Step 4: Run the tests.** `cd resources/goextract && GOTOOLCHAIN=local GOFLAGS= GOPROXY=off go test ./... && GOTOOLCHAIN=local GOFLAGS= go vet ./... && gofmt -l .` → `ok  	goextract	…` and nothing else. (`./...` skips `testdata`, which is its own module anyway.)

- [ ] **Step 5: Commit.**

```bash
git add resources/goextract
git commit -m "Go extract helper: load a package's types offline, with the refactor test cases"
```

### Task 2: The function, its blocks, and chunks from lines

**Files:**
- Create: `resources/goextract/chunks.go`, `chunks_test.go`

A chunk is consecutive statements of one block of the function itself (the body, a nested block, a `case`/`select` clause body; never inside a function literal), whole lines from the first statement's first line to the last statement's last line, sharing no line with anything else.

- [ ] **Step 1: Write the failing tests** (`chunks_test.go`), each with `loadCase` and `FindFunc`:

- `TestFindFunc`: `basic` `Report` found; `methodset` `Run` with recv `S` found (the pointer receiver `*S` matches its base name, as goast prints receivers), with recv `T` → error `no method Run on T in …/a.go`, with no recv → error `no function Run in …/a.go`; `generic` `Sum` → `Generic()` true; `basic` `Report` → `Generic()` false, `Directive()` empty.
- `TestBlocksDepth`: `rawstring` `F` → the body has depth 1 and 4 statements; the `if n > 0` body has depth 2 and 6 statements; `names` `F` has one block, its body (nothing from the literal `inner`).
- `TestResolveChunk`: `basic` 11–14 → `First 0`, `Last 1`, `Start` = offset of line 11, `End` = offset just after line 14's newline; `onboarding` 38–46 → 2 statements (a multi-line statement with a raw string); `basic` 13–13 → the `for` body's single statement, depth 2; `basic` 12–13 → problem `Lines 12–13 are not whole statements of one block of Report: line 13 is inside the statement at lines 12–14.`; `basic` 17–18 → `… line 18 is beyond the last statement of the block that line 17 starts in.`; `basic` 30–31 → `… no statement of Report starts at line 30.`
- `TestResolveChunkFuncLit`: `names` 9–9 → `Lines 9–9 are not whole statements of one block of F: line 9 is inside a function literal.`
- `TestOverlapProblems`: chunks `a` 11–14 and `b` 13–15 → `a (11–14) overlaps b (13–15).`; `a` 11–14 and `b` 15–15 → none.

- [ ] **Step 2: Run them and see them fail.** `go test ./...` (env as in the ground rules) → `undefined: FindFunc`.

- [ ] **Step 3: Implement** `chunks.go`:

- `type Target struct { L *Loaded; File *ast.File; Path string; Src []byte; Func *ast.FuncDecl }`; `func FindFunc(l *Loaded, path, name, recv string) (*Target, error)` (`recv` is `""` for a function, else the receiver's base type name as `resources/goast` prints it: `Store` for `func (s *Store)`, stars, parentheses and type arguments dropped); `func (t *Target) Line(p token.Pos) int`; `func (t *Target) Offset(p token.Pos) int`; `Generic()` (type parameters on the function or its receiver type); `Directive()` (the first `//go:` line in the doc comment, else `""`).
- `type Block struct { Owner ast.Node; List []ast.Stmt; Depth int }` (`Owner` is `*ast.BlockStmt`, `*ast.CaseClause` or `*ast.CommClause`); `func (t *Target) Blocks() []Block` walks the body without entering `*ast.FuncLit`; depth = 1 for the body, +1 per nested statement list.
- `type Chunk struct { Name string; From, To int; Block Block; First, Last int; Start, End int }`; `func (t *Target) ResolveChunk(name string, from, to int) (Chunk, string)`: the block and run whose first statement starts on `from` and last ends on `to` (problems, in this order: `line N is inside a function literal`, `line N is inside the statement at lines A–B`, `no statement of F starts at line N`, `line N is beyond the last statement of the block that line M starts in`, `line N shares a line with other code`); the line before the first statement's start and after the last statement's end (up to the newline, a trailing `//` comment allowed) hold only blanks; the previous statement ends before `from` and the next starts after `to`; the owner's opening line is before `from` and its closing line after `to`. The message forms are the ones in Step 1.
- `func OverlapProblems(chunks []Chunk) []string` on chunks sorted by `From`.

- [ ] **Step 4: Run the tests.** Same command as Task 1 → `ok`, nothing else.

- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract helper: find the function, its blocks, and chunks of whole statements"`

### Task 3: Outer locals and shared variables (rule 3)

**Files:**
- Create: `resources/goextract/vars.go`, `vars_test.go`, `shared.go`, `shared_test.go`

**Outer locals** are the receiver, parameters, named results, and locals declared before the chunk in an enclosing block. Everything is resolved by object (`Info.Defs/Uses/Implicits`, `Selections`), never by name. A variable is **shared** (passed as `*T`) when it is captured by any function literal in the function; or address-taken before or inside the chunk or anywhere in an enclosing loop — an explicit `&`, an implicit one (a pointer-receiver method called or taken as a method value on an addressable value), or slicing an array — on the variable or on a path from it through fields of struct values and indexes of array values, never through a pointer; or its type contains a lock (its pointer method set has `Lock()` and `Unlock()`, as vet's copylocks says, `sync.noCopy` included); or it is a named result of a function whose body has a `defer` (not counting function literals).

- [ ] **Step 1: Write the failing tests.**

`vars_test.go`:
- `TestValueRoot`: in `valuepath` `F`, `cfg.Timeout`, `arr[i]` and `x.f` have roots `cfg`, `arr`, `x`; in `ptrselector` `p.f` has none (through a pointer); in `onboarding`, `req.TenantID` has root `req`.
- `TestOuterAndChunkDeclared`: `onboarding` 38–46: the outer locals it references are `staleAfter tx ctx req imageRef err`, chunk-declared at top level `interval rows`; `shadowerr` 14–20: chunk-declared top level `err` (line 17), and the outer `err` (line 11) is a different object.

`shared_test.go` (`Shared(t, chunk) map[types.Object]string`, reason text in quotes):
- `TestSharedCaptured`: `addrderef` 10–11 → `x`: `captured by the function literal at line 9`; `deferrecover` 14–17 → `n`: `a named result of F, which defers` (named results win over the capture reason), `err` too.
- `TestSharedImplicitAddress` (★ Builder in a struct copied): `buildercopy` 15–18 → `a`: `address-taken at line 14 (a.b.WriteString has a pointer receiver)`.
- `TestSharedExplicitAddress`: `ptrselector` 14–15 → `p`: `address-taken at line 13`; `rangearrayptr` 11–14 → `arr`: `address-taken at line 9`; `onboarding` 38–46 → none of `ctx staleAfter tx req imageRef err`.
- `TestSharedOnlyBeforeOrInLoop`: an overlay of `basic` adding `func use(*bool) {}` and `use(&upper)` right after the `if`: the chunk 16–18 does not share `upper` (taken after it, outside any loop); with `use(&upper)` inside the `for` instead and the chunk 13–13, it does.
- `TestSharedLocksSlicesMethodValues`: an overlay `F` with `var mu sync.Mutex` (shared: `its type holds a lock`), `s := arr[:]` before the chunk (`arr` shared: `sliced at line N`), `f := v.ptrMethod` (`v` shared: `address-taken at line N (method value)`).

- [ ] **Step 2: Run them and see them fail.** → `undefined: ValueRoot`.

- [ ] **Step 3: Implement.**

`vars.go`: `func (t *Target) IsLocal(obj types.Object) bool` (a `*types.Var`, not a field, whose scope chain reaches `Info.Scopes[t.Func.Type]`); `func (t *Target) Outer(c Chunk, obj types.Object) bool` (local and declared before `c.Start`); `func ValueRoot(info *types.Info, e ast.Expr) *ast.Ident` (through `ParenExpr`, a `SelectorExpr` whose selection is a field of a non-pointer struct, an `IndexExpr` on an array value); `func (t *Target) ChunkDeclared(c Chunk) (top, nested []types.Object)` (top: declared in the chunk's own block scope by a chunk statement; nested: declared deeper, function literals included); `func (t *Target) Refs(c Chunk) []Ref` (`type Ref struct { Id *ast.Ident; Obj types.Object }` in source order, not entering function literals, plus `func (t *Target) LitRefs` for those inside literals).

`shared.go`: `func Shared(t *Target, c Chunk) map[types.Object]string` for outer locals; `func AddressTaken(t *Target, obj types.Object) []token.Pos` and `func CapturedAt(t *Target, obj types.Object) []token.Pos` (anywhere in the function; reused by `flow.go` for rule 6); `func HasDefer(fn *ast.FuncDecl) bool`; `func HoldsLock(t types.Type) bool` (struct fields and array elements recursively, never through pointers). Enclosing loops: every `*ast.ForStmt`/`*ast.RangeStmt` of the function containing the chunk.

- [ ] **Step 4: Run the tests.** → `ok`.

- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract helper: outer locals and the variables a helper must share by pointer"`

### Task 4: Liveness: inputs, outputs and chunk-declared variables (rules 1, 2, 6)

**Files:**
- Create: `resources/goextract/flow.go`, `flow_test.go`, `live.go`, `live_test.go`

`flow.go` walks the chunk once, in source order, with the set `D` of outer locals definitely assigned so far (`⊤` once a path has ended):

| Statement | Reads (an outer local read while not in `D` is an **input**) | `D` after |
|---|---|---|
| `x = e`, `x := e` (redeclared outer), `a, x = f()` | `e` first, then the left side's index and pointer parts | `D ∪ {x}` |
| `x op= e`, `x++`, `x--` | `x` and `e` | `D ∪ {x}` |
| a value-path write (`cfg.T = 5`, `arr[i] = v`, `x.f++`, `x.f, err = g()`) | the root too (other fields flow through) | `D` (not a whole write); the root is **assigned** |
| `if init; cond {A} else {B}` | init, cond | `walk(A) ∩ walk(B)` (no else: `∩ D`) |
| `for`, `range` (with `=`: key/value assigned) | init, cond, post, range expression; body with `D` | `D` after init |
| `switch`/type switch | init, tag; each clause from `D` | with `default`: `∩` of every clause end and every `break` to it; else `D` |
| `select` | each clause (receive with `=` assigns) | `∩` of clause ends and breaks |
| `return …`, builtin `panic(…)` | the operands; a bare `return` reads every named result | `⊤` |
| `break`/`continue` allowed to the natural end (Task 5) | — | records `D` into `Dend`; `⊤` |
| a function literal | every reference inside is a read | `D` |

At the end, `Dend = D ∩ (every recorded)`. **Assigned** = every outer local written in any form. `live.go` then: an outer local is **read after** when any reference to it lies after the chunk in the function (function literals included) or anywhere in an enclosing loop. **Outputs** = assigned and read after, plus chunk-declared top-level variables read after. An outer output not in `Dend` is also an input. Shared variables (Task 3) are never value inputs or outputs. **Rule 6** problems: a chunk-declared output captured or address-taken in the chunk; a chunk-level declaration with the name of an input, output, shared variable or the receiver; a chunk-declared `const` or `type` used after the chunk. `Declared` marks outer outputs whose first reference in the chunk is on the left of a top-level `:=`.

- [ ] **Step 1: Write the failing tests** (`Analyze(t, c, shared) (Flow, []string)`; names below are in `FirstUse` order):

`flow_test.go`:
- `TestFlowOnboarding`: 38–46 → inputs `staleAfter tx ctx req imageRef`; assigned `err`; nothing else.
- `TestFlowValuePaths` (★): `valuepath` 22–25 → inputs `cfg arr i x` (a left side is read in source order: root, then index); assigned `cfg arr x err`; `err` is not an input.
- `TestFlowBreakPath`: `breakswitch` 9–13 → assigned `x`, not an input (assigned on both paths to the end); with an overlay moving `x = 1` below the `if`, `x` is an input.
- `TestFlowReturnEndsPath`: an overlay chunk `if bad { return 0 }; v = 2` → `v` assigned and in `Dend`.

`live_test.go`:
- `TestLiveOutputs`: `onboarding` 38–46 → outputs `rows err` (`rows` chunk-declared; `Declared[err]`); `basic` 11–14 → output `out`.
- `TestLiveEnclosingLoop`: `loopout` 10–11 → outputs `prev sum` (`prev` is read at line 9 in the loop), inputs `x sum`.
- `TestLiveDeadWrite`: `deadwrite` 14–15 → assigned `err` and `n`, outputs `n` only.
- `TestFlowCapturedDeclaration` (★): `capturedecl` 7–9 → `v is declared in the chunk (line 7), used after it, and captured by a function literal (line 8).`
- `TestFlowShadowedInput` (★ `var err` shadowing): `shadowerr` 14–20 → `err is declared in the chunk (line 17) and also names an input.`
- `TestFlowAddressTakenDeclaration`: `typestr` 15–18 → `b is declared in the chunk (line 15), used after it, and address-taken (line 17).`
- `TestFlowTypeUsedAfter`: `typestr` 24–24 → `the type local is declared in the chunk (line 24) and used after it.`

- [ ] **Step 2: Run them and see them fail.** → `undefined: Analyze`.

- [ ] **Step 3: Implement** `flow.go` (`type Flow struct { Inputs, Assigned, Outputs []types.Object; FirstUse map[types.Object]token.Pos; Declared map[types.Object]bool; End map[types.Object]bool }`, the walk above) and `live.go` (read-after, outputs, rule 6 problems, `func Analyze(t *Target, c Chunk, shared map[types.Object]string) (Flow, []string)`). Keep the walk conservative as *Decisions* says: anything not modelled (an unknown statement kind) leaves `D` unchanged.

- [ ] **Step 4: Run the tests.** → `ok`.

- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract helper: inputs and outputs by conservative liveness"`

### Task 5: Jumps and refusals (rule 5 and the "refused besides" list)

**Files:**
- Create: `resources/goextract/jumps.go`, `jumps_test.go`

`func Jumps(t *Target, c Chunk, shared map[types.Object]string) (natural []*ast.BranchStmt, problems []string)`. A `break` whose target is the `switch`/`select` owning the chunk's clause, or a `continue` of the loop whose body is the chunk's block, is allowed when the chunk's last statement is the last of that body: it becomes the natural-end return. Every other jump leaving the chunk is refused; labels inside the chunk used from outside are refused; a `goto` before the chunk to a label after it is refused (it would jump over the call block's declarations). Also refused: `defer`, a call to the builtin `recover` (both outside function literals), a `go` statement whose call or literal references an outer local, assigning a pointer receiver itself, and a shared variable on the left of `:=`. Function literals are not entered except for the `go` rule.

- [ ] **Step 1: Write the failing tests.**
- `TestJumpsBreakAtClauseEnd` (★): `breakswitch` 9–13 → one natural jump (line 11), no problem; 9–12 → `break at line 11 leaves the switch, but the chunk ends before its case does (line 13).`
- `TestJumpsContinueAtLoopEnd`: an overlay loop body `a(); if c { continue }; b()` → the whole body allowed; the body without `b()` → `continue at line N skips the rest of the loop body, which the chunk does not end.`
- `TestJumpsGotoOverCall`: `gotoover` 10–11 → `goto done at line 8 would jump over the call at line 10.`
- `TestJumpsLabels`: an overlay with `goto out` inside the chunk to a label after it → `goto out at line N leaves the chunk.`; a label inside the chunk targeted from outside → `the label again (line N) is used from outside the chunk (line M).`
- `TestJumpsRefusedStatements`: `deferrecover` 8–12 → `defer at line 8.`; an overlay chunk calling `recover()` → `recover() at line N.`; `go work(x)` with outer `x` → `go statement at line N uses x.`; `s = &S{}` on a pointer receiver → `assigns the receiver s at line N.`; `ptrdefine` 15–16 with its shared set → `err is passed by pointer but assigned with := at line 15.`
- `TestJumpsFuncLitsIgnored`: a chunk holding `func() { defer f(); return }()` → no problem.

- [ ] **Step 2: Run them and see them fail.** → `undefined: Jumps`.
- [ ] **Step 3: Implement** `jumps.go` as above (branch targets resolved from the AST: innermost `for`/`range`/`switch`/`type switch`/`select` for unlabeled ones, the labeled statement for labeled ones).
- [ ] **Step 4: Run the tests.** → `ok`.
- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract helper: allowed jumps and refused statements"`

### Task 6: Fresh names (rule 8)

**Files:**
- Create: `resources/goextract/names.go`, `names_test.go`

`func NameProblems(t *Target, names []string) []string` and `func Plumbing(t *Target, taken map[string]bool, want string) string`. A helper name must be a Go identifier starting with a lower-case letter, not `init`, `main` or `_`, not a keyword, unique in the plan, and absent from every scope of the function (function literals included), the package scope, the package's test files (`TestNames`), the universe, the receiver type's fields and method set (both `T` and `*T`, promoted members included, via `types.LookupFieldOrMethod`), and the methods of every interface declared in the package (a new method could make a type satisfy one). Plumbing names (`done`, `r0`, `r1`, …) get a digit suffix (`done1`) until absent from the function's scopes and `taken` (parameters and chunk declarations).

- [ ] **Step 1: Write the failing tests.**
- `TestNamesFresh` (`names` `F`): `innerOnly` → `innerOnly is not a fresh name: F declares it (line 9).`; `n` → `… F declares it (line 7).`; `helperTaken` → `… the package declares it.`; `takenInTests` → `… a test file of the package declares it.`; `len` → `… it is predeclared.`; `F` → `… the package declares it.`; `double` → none; `Double` → `"Double" must start with a lower-case letter.`; `type`, `_`, `init`, `9x` → each refused; `[double double]` → `double is named twice.`
- `TestNamesMethodSet` (★): `methodset` `Run`: `loadRows` → `loadRows is not a fresh name: S has a method loadRows (promoted from Base).`; `rows` → `… S has a field rows (promoted from Base).`; `count` → `… S has a field count.`; `saveAll` → `… it is a method of the interface Saver in this package.`; `addRows` → none.
- `TestNamesPlumbing`: `basic` → `Plumbing(t, nil, "done") == "done"`; with `taken["done"]` → `done1`; an overlay declaring a local `r0` → `Plumbing(…, "r0") == "r01"`.

- [ ] **Step 2: Run them and see them fail.** → `undefined: NameProblems`.
- [ ] **Step 3: Implement** `names.go`.
- [ ] **Step 4: Run the tests.** → `ok`.
- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract helper: fresh helper and plumbing names"`

### Task 7: Types written in the file, and zero values (rule 9)

**Files:**
- Create: `resources/goextract/typestr.go`, `typestr_test.go`

`func (t *Target) TypeText(obj types.Object, at token.Pos) (string, error)` writes the variable's type: the source text of its declared type when one exists (a parameter, result or `var x T`), else `types.TypeString` with a qualifier giving `""` for the package itself and for dot imports and the file's own import name otherwise. A variadic parameter is written `[]T`. Errors: a function-local named type (`local is declared inside F`), a package the file does not import (`time.Time: this file does not import time`), an unexported type of another package. Every qualifier and every unqualified package-level type name used must resolve, from `at` (`Info.Scopes` innermost at that position, then `LookupParent`), to the same package or type object (`tm is shadowed at line N`). `func (t *Target) ZeroText(typ types.Type, at token.Pos) (string, error)`: `0`, `""`, `false`, `nil`, or `T{}` for struct and array types.

- [ ] **Step 1: Write the failing tests.**
- `TestTypeSourceText` (`typestr` `F`): `id` → `ID` (the alias survives), `d` → `tm.Duration`, `parts` → `[]string`, `b` (inferred from `Builder{}`) → `Builder` (dot import); `onboarding`: `tx` → `Tx`, `staleAfter` → `time.Duration`, `rows` (inferred) → `Rows`.
- `TestTypeInferredAlias`: an overlay with `func newID() ID { return 1 }` and `x := newID()` → `x` is written `ID`, not `int64` (needs `//go:debug gotypesalias=1` in `main.go`).
- `TestTypeShadowedQualifier`: an overlay of `typestr` with `tm := 0; _ = tm` before a chunk → writing `d`'s type at the chunk → `tm is shadowed at line N.`
- `TestTypeRefused`: `local` in `typestr` → `local is declared inside F.`; an overlay of `basic` importing `context` with `dl, _ := context.Background().Deadline()` → `time.Time: this file does not import time.`
- `TestZeroValues`: `int` → `0`, `string` → `""`, `bool` → `false`, `error`/pointer/slice/map/chan/func → `nil`, `config` (`valuepath`) → `config{}`, `[3]int` → `[3]int{}`.

- [ ] **Step 2: Run them and see them fail.** → `undefined` for `TypeText`.
- [ ] **Step 3: Implement** `typestr.go`.
- [ ] **Step 4: Run the tests.** → `ok`.
- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract helper: write types as the file names them"`

## Chunk 2: The Go helper: building helpers

### Task 8: The helper's body (rules 3–5 rewrites, rule 11 dedent)

**Files:**
- Create: `resources/goextract/rewrite.go`, `rewrite_test.go`

```go
// Iface is a helper's interface as the builder decided it.
type Iface struct {
	Name    string
	Method  bool // a method on the function's pointer receiver (the chunk uses the receiver)
	Params  []Param
	Outputs []Output
	Returns bool // carries done and the function's results
	Tail    bool // the chunk ends the function body
	Named   bool // results are named (see Decisions)
}
type Param struct{ Obj types.Object; Name, Type string; Pointer bool }
type Output struct{ Obj types.Object; Name, Type string; ChunkDeclared bool }

// Body is the helper's body for chunk c, dedented to depth 1, and its number of (*x) sites.
func Body(t *Target, c Chunk, f Iface, natural []*ast.BranchStmt, fresh func(string) string) (string, int, error)
```

Edits on the chunk's bytes, applied back to front:
1. **`(*x)`** at every reference (function literals in the chunk included) to a pointer parameter's object, except: `X` of a field selector when the variable's type's underlying type is a struct; `X` of a method selector when the variable's type is a named non-pointer, non-interface type; the operand of `&`, where `&x` becomes `x`. Each wrap is one site.
2. **Returns** of the function (not of literals). Tail chunks keep theirs, a bare `return` becoming `return n, err` (named results; `(*n)` when shared). Otherwise `return e…` → `return o…, true, e…`; a single multi-value call `return f()` → `r0, r1 := f()` on its own line at the return's indentation, then `return o…, true, r0, r1` (names from `fresh`); a bare `return` → `return o…, true, <named results>`; a function without results → `return o…, true`. Each `o` is the output's name, or its zero value (`ZeroText`) when it is chunk-declared and not yet declared at that return.
3. **Natural-end jumps** (Task 5) and **the natural end** (appended unless the chunk ends in a terminating statement, or the helper has no outputs and no returns): `return o…, false, zeros…` when it carries returns, else `return o…` (`return` alone when there are no outputs).
4. **Dedent:** remove `c.Block.Depth − 1` leading tabs from every line whose first byte is not inside a raw string (`go/scanner` over the chunk). Block comments are dedented like code; gofmt agrees (dry run).

- [ ] **Step 1: Write the failing tests** (bodies before formatting; `\t` is one tab):
- `TestRewritePointerToPointer` (★ `**T` selector): `ptrselector` 14–15, `p` a pointer → `(*p).f = 1\n(*p).bump()\n`, 2 sites.
- `TestRewriteRangeArray` (★): `rangearrayptr` 11–14, `arr` a pointer, `sum` a value output → `for _, v := range (*arr) {\n\t(*arr)[2] = 10\n\tsum += v\n}\nreturn sum\n`, 2 sites.
- `TestRewriteAddressOfPointer` (★ `&(*x)`): `addrderef` 10–11 → `use(x)\n(*x)++\n`, 1 site.
- `TestRewriteStructSelectorKept`: `buildercopy` 15–18 with `a` a pointer → the chunk's text unchanged, 0 sites.
- `TestRewriteMultiValueReturn` (★): `multireturn` 16–18 → `if m > 10 {\n\tr0, r1 := f(m)\n\treturn true, r0, r1\n}\nreturn false, 0, nil\n`.
- `TestRewriteBareReturn`: an overlay `func F(a int) (n int, err error)` whose chunk `if a > 1 { n++; return }` + `n += 2` → `… return n, true, n, err …` then `return n, false, 0, nil`; the same with a `defer` in `F` (so `n`, `err` are shared) → `return true, (*n), (*err)`.
- `TestRewriteBreakToNaturalEnd`: `breakswitch` 9–13, output `x` (named) → `x = 1\nif c {\n\treturn x\n}\nx = 2\nreturn x\n`.
- `TestRewriteDedentOutsideRawStrings` (★ raw-string re-indent): `rawstring` 12–20 → lines 15–16 of the file unchanged (`\tFROM t`, `\t\tWHERE b`), every other line one tab shorter (`\t   comment */` for line 19).
- `TestRewriteZeroForUndeclaredOutput`: an overlay chunk `if bad { return 0, errX }` + `y := 2` (`y` a chunk-declared output, `F` returns `(int, error)`) → `return 0, true, 0, errX` then the natural end `return y, false, 0, nil`.

- [ ] **Step 2: Run them and see them fail.** → `undefined: Body`.
- [ ] **Step 3: Implement** `rewrite.go`.
- [ ] **Step 4: Run the tests.** → `ok`.
- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract helper: write a helper's body from its chunk"`

### Task 9: The interface, the call block, and the built file (rules 4, 8, 10, 11)

**Files:**
- Create: `resources/goextract/callblock.go`, `callblock_test.go`, `build.go`, `build_test.go`
- Create: `resources/goextract/testdata/want/*.go.txt` (below)

`build.go`:

```go
type PlanChunk struct {
	Name string `json:"name"`
	From int    `json:"from"`
	To   int    `json:"to"`
}
type ParamFact struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Pointer bool   `json:"pointer"`
}
type OutputFact struct {
	Name string `json:"name"`
	Type string `json:"type"`
}
type HelperFact struct {
	Name         string       `json:"name"`
	From         int          `json:"from"`
	To           int          `json:"to"`
	Params       []ParamFact  `json:"params"`
	Outputs      []OutputFact `json:"outputs"`
	Returns      bool         `json:"returns"`
	Tail         bool         `json:"tail"`
	Lines        int          `json:"lines"`
	PointerSites int          `json:"pointerSites"`
}
type BuildResult struct {
	Problems      []string     `json:"problems"`
	Helpers       []HelperFact `json:"helpers,omitempty"`
	FunctionLines int          `json:"functionLines,omitempty"`
}

// Build applies the plan to the target's file; the new file is returned only when there are no problems.
func Build(t *Target, plan []PlanChunk) (BuildResult, []byte)
```

Per chunk, in plan order: `ResolveChunk`, then `Shared`, `Jumps`, `Analyze`, then the interface: shared variables the chunk references become pointer parameters; inputs, and outer locals the chunk assigns that are not outputs, become value parameters; the receiver makes the helper a method (a value receiver is an ordinary input); ordered as *Decisions* says; outputs exclude shared variables; `Named` when an outer output is neither a parameter nor `Declared`. Types with `TypeText` at the chunk's start (parameters and outputs) and the function's result types as their source text. Limits: more than 6 parameters (the receiver not counted) → `<name>: 7 parameters (a, b, c, d, e, f, g); at most 6.`; more than 3 outputs → `setFields: 4 outputs (cfg, arr, x, err); at most 3.`. Names: `NameProblems` over all helper names; plumbing from `Plumbing`. Every problem of a chunk is prefixed `<name>: ` and, when the chunk would need `(*x)` sites, ends `It would need N (*x) sites.`

Then the file: the function's bytes with each chunk's lines replaced by its call block, a blank line, and the helpers in chunk order, each `// <name> is part of <F>, extracted by my_editor.` then `func [(<receiver as written>)] <name>(<p T, …>) <results> {` + body + `}`; results are `T`, `(T1, T2)` or named `(x int, _ int)`. `format.Source` on the whole file. Lines are counted on the formatted file (doc comment included): the function over 400 → `<F> would still be N lines; it must end at 400 or fewer.`; a helper over 400 → `<name> would be N lines; at most 400.`

`callblock.go`: `func CallBlock(t *Target, c Chunk, f Iface, fresh func(string) string) (string, error)`, indented like the chunk's first line; arguments are the parameters in order (`&x` for pointers), `recv.name(…)` for methods; forms as *Decisions* says (`var` lines use `TypeText` at the chunk's start, so a shadowing local is caught there).

- [ ] **Step 1: Write the expected files and the failing tests.**

Create each expected file exactly as below (each is its case's `a.go` after the plan in the test table; all were vetted, gofmt-checked and pass their `TestPin`).

`testdata/want/basic.go.txt`:

````go
// Package basic is the smallest case: one function, two chunks.
package basic

import (
	"fmt"
	"strings"
)

// Report joins and prints.
func Report(items []string, upper bool) string {
	out := collectItems(items)
	text := strings.Join(out, ",")
	if upper {
		text = strings.ToUpper(text)
	}
	return fmt.Sprintf("[%s]", text)
}

// collectItems is part of Report, extracted by my_editor.
func collectItems(items []string) []string {
	var out []string
	for _, it := range items {
		out = append(out, it)
	}
	return out
}
````

`testdata/want/onboarding.go.txt`:

````go
// Package onboarding mirrors the dialer's buildOnboardingPlanTx chunk: a long query whose rows and error flow out.
package onboarding

import (
	"context"
	"errors"
	"time"
)

// Rows is a result set.
type Rows interface {
	Next() bool
	Close()
}

// Tx runs queries.
type Tx interface {
	Query(ctx context.Context, sql string, args ...any) (Rows, error)
}

// Request is what the caller asks for.
type Request struct {
	TenantID string
	CellID   string
}

func pgInterval(d time.Duration) string { return d.String() }

func currentImage(ctx context.Context, tx Tx) (string, error) { return "img", ctx.Err() }

// Plan builds a plan.
func Plan(ctx context.Context, tx Tx, req Request, staleAfter time.Duration) (int, error) {
	imageRef, err := currentImage(ctx, tx)
	if err != nil {
		return 0, err
	}

	rows, err := queryRows(ctx, staleAfter, tx, req, imageRef)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		n++
	}
	if n == 0 {
		return 0, errors.New("no cell")
	}
	return n, nil
}

// queryRows is part of Plan, extracted by my_editor.
func queryRows(ctx context.Context, staleAfter time.Duration, tx Tx, req Request, imageRef string) (Rows, error) {
	interval := pgInterval(staleAfter)
	rows, err := tx.Query(ctx,
		`SELECT cell_id
		   FROM cells
		  WHERE last_seen_at > now()-$1::interval
		    AND tenant_id IN ('', $2)
		    AND ($3 = '' OR cell_id = $3)
		    AND image_ref = $4`,
		interval, req.TenantID, req.CellID, imageRef)
	return rows, err
}
````

`testdata/want/deferrecover.go.txt`:

````go
// Package deferrecover: named results, a defer with recover, and a chunk that may panic (★).
package deferrecover

import "fmt"

// F sets n in steps; a panic in the middle is recovered into err with n as it was.
func F(bad bool) (n int, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("recovered at n=%d: %v", n, r)
		}
	}()
	n = 1
	advance(&n, bad)
	n = 3
	return n, nil
}

// advance is part of F, extracted by my_editor.
func advance(n *int, bad bool) {
	(*n) = 2
	if bad {
		panic("boom")
	}
}
````

`testdata/want/buildercopy.go.txt`:

````go
// Package buildercopy: a strings.Builder inside a struct value; copying it after use panics (★).
package buildercopy

import "strings"

type acc struct {
	b strings.Builder
	n int
}

// F writes through a.b before and inside the chunk.
func F(words []string) string {
	var a acc
	a.b.WriteString("<")
	writeWords(words, &a)
	a.b.WriteString(">")
	return a.b.String()
}

// writeWords is part of F, extracted by my_editor.
func writeWords(words []string, a *acc) {
	for _, w := range words {
		a.b.WriteString(w)
		a.n++
	}
}
````

`testdata/want/valuepath.go.txt`:

````go
// Package valuepath: writes through field and array-index paths of values are assignments (★).
package valuepath

import "errors"

type config struct {
	Timeout int
	Name    string
}

type pair struct{ f int }

func g() (int, error) { return 7, errors.New("g") }

// F changes cfg, arr and x only through paths.
func F() (config, [3]int, pair, error) {
	cfg := config{Name: "a"}
	var arr [3]int
	var x pair
	var err error
	i := 1
	cfg, arr, x = setFields(cfg, arr, i, x)
	x.f, err = g()
	return cfg, arr, x, err
}

// setFields is part of F, extracted by my_editor.
func setFields(cfg config, arr [3]int, i int, x pair) (config, [3]int, pair) {
	cfg.Timeout = 5
	arr[i] = 9
	x.f++
	return cfg, arr, x
}
````

`testdata/want/multireturn.go.txt`:

````go
// Package multireturn: `return f()` with a multi-value f inside a chunk (★).
package multireturn

import "errors"

func f(n int) (int, error) {
	if n < 0 {
		return 0, errors.New("negative")
	}
	return n * 2, nil
}

// F returns early through f.
func F(n int) (int, error) {
	m := n + 1
	if done, r0, r1 := early(m); done {
		return r0, r1
	}
	m++
	return m, nil
}

// early is part of F, extracted by my_editor.
func early(m int) (bool, int, error) {
	if m > 10 {
		r0, r1 := f(m)
		return true, r0, r1
	}
	return false, 0, nil
}
````

`testdata/want/tail.go.txt`:

````go
// Package tail: a chunk that is the tail of the body becomes `return h(…)` (★ tail chunk).
package tail

import "fmt"

// F ends in its chunk.
func F(n int) (string, error) {
	n *= 2
	return finish(n)
}

// finish is part of F, extracted by my_editor.
func finish(n int) (string, error) {
	if n > 100 {
		return "", fmt.Errorf("too big: %d", n)
	}
	return fmt.Sprint(n), nil
}
````

`testdata/want/tailvoid.go.txt`:

````go
// Package tailvoid: the tail chunk of a function without results becomes a plain call.
package tailvoid

import "fmt"

// G has no results.
func G(n int, out *[]string) {
	n++
	*out = append(*out, fmt.Sprint(n))
	finishG(n, out)
}

// finishG is part of G, extracted by my_editor.
func finishG(n int, out *[]string) {
	if n > 3 {
		return
	}
	*out = append(*out, "small")
}
````

`testdata/want/breakswitch.go.txt`:

````go
// Package breakswitch: a break to the switch is the chunk's natural end only when the chunk ends its case (★).
package breakswitch

// F picks a value per kind.
func F(k int, c bool) int {
	x := 0
	switch k {
	case 1:
		x = pickOne(c)
	case 2:
		x = 20
	}
	return x
}

// pickOne is part of F, extracted by my_editor.
func pickOne(c bool) (x int) {
	x = 1
	if c {
		return x
	}
	x = 2
	return x
}
````

`testdata/want/ptrselector.go.txt`:

````go
// Package ptrselector: a pointer variable that is itself shared goes as **T; its selectors need (*p) (★ **T selector).
package ptrselector

type T struct{ f int }

func (t *T) bump() { t.f++ }

func keep(pp **T) {}

// F changes p's target.
func F() int {
	p := &T{}
	keep(&p)
	setP(&p)
	return p.f
}

// setP is part of F, extracted by my_editor.
func setP(p **T) {
	(*p).f = 1
	(*p).bump()
}
````

`testdata/want/rangearrayptr.go.txt`:

````go
// Package rangearrayptr: ranging over a shared array must stay a range over the array value, (*arr) (★).
package rangearrayptr

func keep(p *[3]int) {}

// F changes the array while ranging over it; the range sees the copy.
func F() int {
	arr := [3]int{1, 2, 3}
	keep(&arr)
	sum := 0
	sum = sumAll(&arr, sum)
	return sum + arr[2]
}

// sumAll is part of F, extracted by my_editor.
func sumAll(arr *[3]int, sum int) int {
	for _, v := range *arr {
		(*arr)[2] = 10
		sum += v
	}
	return sum
}
````

`testdata/want/addrderef.go.txt`:

````go
// Package addrderef: &x of a pointer-passed x is written x, never &(*x) (★).
package addrderef

func use(p *int) { *p += 5 }

// F shares x with a closure, so x goes by pointer.
func F() int {
	x := 1
	get := func() int { return x }
	bump(&x)
	return get()
}

// bump is part of F, extracted by my_editor.
func bump(x *int) {
	use(x)
	(*x)++
}
````

`testdata/want/methodset.go.txt`:

````go
// Package methodset: a helper name must not be a field or method of the receiver, promoted ones included,
// nor a method of an interface in the package (★ method-set shadowing names).
package methodset

// Base has a method S gets by embedding.
type Base struct{ rows int }

func (Base) loadRows() int { return 1 }

// Saver is satisfied by types with saveAll.
type Saver interface{ saveAll() }

// S embeds Base.
type S struct {
	Base
	count int
}

// Run sums.
func (s *S) Run() int {
	total := s.rows
	total = s.addRows(total)
	return total
}

// addRows is part of Run, extracted by my_editor.
func (s *S) addRows(total int) int {
	total += s.loadRows()
	s.count = total
	return total
}
````

`testdata/want/rawstring.go.txt`:

````go
// Package rawstring: a nested chunk with a multi-line raw string, a block comment and aligned trailing comments (★).
package rawstring

import "fmt"

// F builds a query.
func F(n int) string {
	total := 0
	q := ""
	if n > 0 {
		reallyLongNameHere := 3 // outside neighbor
		q, total = buildQuery(total, reallyLongNameHere)
	}
	return fmt.Sprint(total, q)
}

// buildQuery is part of F, extracted by my_editor.
func buildQuery(total int, reallyLongNameHere int) (q string, _ int) {
	x := 1      // short
	longer := 2 // aligned with x
	q = `SELECT a
	FROM t
		WHERE b`
	total += x + longer + len(q) + reallyLongNameHere
	/* a block
	   comment */
	fmt.Println(total)
	return q, total
}
````

`testdata/want/deadwrite.go.txt`:

````go
// Package deadwrite: an outer local the chunk writes but nobody reads afterwards is passed in, so the helper compiles.
package deadwrite

import "errors"

func f() (int, error) { return 1, errors.New("f") }

// F ignores the second error.
func F() int {
	n, err := f()
	if err != nil {
		n++
	}
	n = addSecond(n, err)
	return n
}

// addSecond is part of F, extracted by my_editor.
func addSecond(n int, err error) int {
	m, err := f()
	n += m
	return n
}
````

`testdata/want/loopout.go.txt`:

````go
// Package loopout: inside a loop, a variable the chunk assigns is an output when the loop reads it earlier.
package loopout

// F carries prev across iterations.
func F(xs []int) int {
	prev := 0
	sum := 0
	for _, x := range xs {
		sum += prev
		prev, sum = step(x, sum)
	}
	return sum
}

// step is part of F, extracted by my_editor.
func step(x int, sum int) (prev int, _ int) {
	prev = x * 2
	sum++
	return prev, sum
}
````

`testdata/want/names.go.txt`:

````go
// Package names: helper names must be fresh in every scope of the function, the package (test files too) and the universe.
package names

func helperTaken() {}

// F has a function literal with its own locals.
func F(n int) int {
	inner := func() int {
		innerOnly := n * 2
		return innerOnly
	}
	n += inner()
	n = double(n)
	return n
}

// double is part of F, extracted by my_editor.
func double(n int) int {
	n *= 2
	return n
}
````

`testdata/want/typestr.go.txt`:

````go
// Package typestr: writing types: aliases survive, a dot import, a shadowed package name, variadics, a local type.
package typestr

import (
	"errors"
	. "strings"
	tm "time"
)

// ID is an alias.
type ID = int64

// F uses each kind of type.
func F(id ID, d tm.Duration, parts ...string) (string, error) {
	b := Builder{}
	for _, p := range parts {
		b.WriteString(p)
	}
	if done, r0, r1 := check(id, d); done {
		return r0, r1
	}
	errors := []string{b.String()}
	type local struct{ n int }
	l := local{n: len(errors)}
	return Join(errors, ",") + string(rune('0'+l.n)), nil
}

// check is part of F, extracted by my_editor.
func check(id ID, d tm.Duration) (bool, string, error) {
	total := id + ID(d)
	if total < 0 {
		return true, "", errors.New("negative")
	}
	return false, "", nil
}
````

`callblock_test.go`:
- `TestCallBlockForms`: `onboarding` 38–46 → `\trows, err := queryRows(ctx, staleAfter, tx, req, imageRef)\n`; `valuepath` 22–24 → `\tcfg, arr, x = setFields(cfg, arr, i, x)\n`; `deferrecover` 14–17 → `\tadvance(&n, bad)\n`; `multireturn` 16–18 → `\tif done, r0, r1 := early(m); done {\n\t\treturn r0, r1\n\t}\n`; `tail` 9–12 → `\treturn finish(n)\n`; `tailvoid` 10–13 → `\tfinishG(n, out)\n`; `methodset` 22–23 → `\ttotal = s.addRows(total)\n`.
- `TestCallBlockVarLines`: an overlay where a chunk-declared output and a returning chunk sit in a nested block whose output `err` is declared in an outer block → `var y int`, `var done bool`, `var r0 int`, `var r1 error` lines, then `y, err, done, r0, r1 = h(…)`, then `if done { return r0, r1 }`.

`build_test.go`:
- `TestBuildGoldens`: one subtest per row, named by the case: `Build` on the case's file with the one-chunk plan gives exactly `testdata/want/<case>.go.txt`, and `Load` with it as the overlay type-checks:

| Case | Plan |
|---|---|
| `basic` | `collectItems` 11–14 |
| `onboarding` | `queryRows` 38–46 |
| `deferrecover` | `advance` 14–17 |
| `buildercopy` | `writeWords` 15–18 |
| `valuepath` | `setFields` 22–24 |
| `multireturn` | `early` 16–18 |
| `tail` | `finish` 9–12 |
| `tailvoid` | `finishG` 10–13 |
| `breakswitch` | `pickOne` 9–13 |
| `ptrselector` | `setP` 14–15 |
| `rangearrayptr` | `sumAll` 11–14 |
| `addrderef` | `bump` 10–11 |
| `methodset` (`Run`, recv `S`) | `addRows` 22–23 |
| `rawstring` | `buildQuery` 12–20 |
| `deadwrite` | `addSecond` 14–15 |
| `loopout` | `step` 10–11 |
| `names` | `double` 13–13 |
| `typestr` | `check` 19–22 |

- `TestBuildFacts`: `onboarding` → one helper `queryRows` 38–46, params `ctx context.Context`, `staleAfter time.Duration`, `tx Tx`, `req Request`, `imageRef string` (none pointer), outputs `rows Rows`, `err error`, `returns` false, `tail` false, 13 lines, 0 sites, `functionLines` 21; `deferrecover` → params `n *int` (pointer) and `bad bool`, no outputs, 1 site, 7 lines, `functionLines` 12; `multireturn` → `returns` true, 8 lines; `tail` → `tail` true.
- `TestBuildProblems`: `valuepath` 22–25 → `setFields: 4 outputs (cfg, arr, x, err); at most 3.`; an overlay function of 7 parameters all read in a one-line chunk `h` → `h: 7 parameters (a, b, c, d, e, f, g); at most 6.`; an overlay `Long` with 418 one-line statements and a 5-line chunk → `Long would still be N lines; it must end at 400 or fewer.` (N computed in the test as its lines minus 4); `rangearrayptr` 11–14 named `len` → `len: len is not a fresh name: it is predeclared. It would need 2 (*x) sites.`; `methodset` 22–23 named `loadRows` → `loadRows: loadRows is not a fresh name: S has a method loadRows (promoted from Base).`; `capturedecl` 7–9 named `count` → `count: v is declared in the chunk (line 7), used after it, and captured by a function literal (line 8).`; `ptrdefine` 15–16 → `fetch: err is passed by pointer but assigned with := at line 15.`; `gotoover` 10–11 → `bump: goto done at line 8 would jump over the call at line 10.`; `shadowerr` 14–20 → `inspect: err is declared in the chunk (line 17) and also names an input.`

- [ ] **Step 2: Run them and see them fail.** → `undefined: Build`, `undefined: CallBlock`.
- [ ] **Step 3: Implement** `callblock.go` and `build.go`.
- [ ] **Step 4: Run the tests.** → `ok`. A golden mismatch prints both texts; fix the builder, never the golden.
- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract helper: build helpers and call blocks into a gofmt-clean file"`

### Task 10: The outline the model reads

**Files:**
- Create: `resources/goextract/outline.go`, `outline_test.go`

```go
type FuncFacts struct {
	Name      string `json:"name"`
	Receiver  string `json:"receiver"`
	StartLine int    `json:"startLine"` // the doc comment's first line, else the func line
	EndLine   int    `json:"endLine"`
	Lines     int    `json:"lines"`
}
type StmtFacts struct {
	From     int      `json:"from"`
	To       int      `json:"to"`
	// assign, define, var, const, type, if, for, range, switch, typeswitch, select,
	// return, expr, incdec, send, go, defer, block, label, branch
	Kind     string   `json:"kind"`
	Declares []string `json:"declares"`
	Refused  string   `json:"refused,omitempty"` // defer, recover, goto, label NAME, go
}
type BlockFacts struct {
	Line       int         `json:"line"`
	Depth      int         `json:"depth"`
	Statements []StmtFacts `json:"statements"`
	Live       [][]string  `json:"live"` // per boundary 0..len(statements): outer locals read at or after it, sorted
}
type Outline struct {
	Function FuncFacts    `json:"function"`
	Refused  string       `json:"refused,omitempty"`
	Blocks   []BlockFacts `json:"blocks"`
}
func MakeOutline(t *Target) Outline
```

`Refused` for the whole function: `Sum is generic.`, `Report has a //go:noinline line.`

- [ ] **Step 1: Write the failing tests.**
- `TestOutlineFunction`: `onboarding` `Plan` → startLine 31, endLine 59, lines 29; `methodset` `Run` → receiver `*S` (the outline shows it as written).
- `TestOutlineBody`: `basic` `Report` → the first block is line 10, depth 1, statements `11–11 var [out]`, `12–14 range []`, `15–15 define [text]`, `16–18 if []`, `19–19 return []`; live `[[items upper] [items out upper] [out upper] [text upper] [text] []]`.
- `TestOutlineRefusalNotes`: `onboarding` statement 50–50 is `defer`, refused `defer`; `gotoover`: the `if` body's 8–8 refused `goto`, the body's 12–13 kind `label`, refused `label done`.
- `TestOutlineRefusesFunction`: `generic` → `Sum is generic.`; an overlay of `basic` with `//go:noinline` above `Report` → `Report has a //go:noinline line.`

- [ ] **Step 2: Run them and see them fail.** → `undefined: MakeOutline`.
- [ ] **Step 3: Implement** `outline.go` (live sets reuse `live.go`'s read-after for each boundary).
- [ ] **Step 4: Run the tests.** → `ok`.
- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract helper: the outline the model plans from"`

## Chunk 3: The Go helper: the extract check

The checker runs on the files as written and verifies the result; it never calls `Shared`, `Analyze`, `Jumps`, `Body` or `CallBlock`. It may use `Load`, `FindFunc`/`ResolveChunk` (where the chunks are) and `TypeText`/`ZeroText` (writing a type or a zero value; a wrong one fails type-checking).

### Task 11: Nothing outside the chunks changed (check 1 and 5)

**Files:**
- Create: `resources/goextract/check.go`, `check_test.go`

```go
// Check verifies the written file against the original. Empty means it passed.
func Check(list, pkg, path, fn, recv string, before, after []byte, built BuildResult) []string
```

1. Load the package twice: with `before`, and with `after`, as overlays at `path`. `after` not type-checking → `the package does not type-check: …` (check 5).
2. `format.Source(after)` must equal `after` → else `gofmt would change <file>.`
3. **Markers:** the before-file's tokens with each chunk (from `built.Helpers[i].From/To`) replaced by one marker `⟨chunk i⟩`; the after-file's tokens with each helper (and its doc comment) removed and each call block replaced by the same marker. A call block is the statement in the new function calling helper `i`, with the `var` lines just before it that only declare names it assigns, and the `if <done> { … }` just after it that tests the `done` it assigns. Compare kind and text token by token; comments compare line by line with leading blanks trimmed; positions and other whitespace are not compared. First difference → `Outside the chunks, <file> changed near line N: expected <a>, found <b>.`
4. Each helper follows the function directly, in chunk order, with exactly its doc comment → else `<name> is not right after <F> in chunk order.`

- [ ] **Step 1: Write the failing tests** (tampered inputs are made in the test by replacing text in a golden; each test asserts the replacement happened):
- `TestCheckPassesGoldens`: every row of Task 9's table → no problem (later tasks add checks; this test keeps covering them).
- `TestCheckOutsideChanged`: `basic` golden with `if upper {` → `if !upper {` → `Outside the chunks, a.go changed near line 13: …`
- `TestCheckNotFormatted`: `basic` golden with `out := collectItems(items)` → `out :=  collectItems(items)` → `gofmt would change a.go.`
- `TestCheckExtraDeclaration`: `basic` golden plus `\nvar extra = 1\n` → a `changed near line` problem.
- `TestCheckTypeErrors`: `basic` golden with the helper's result `[]string` → `[]int` → `the package does not type-check: …`
- `TestCheckHelperPlacement`: `onboarding` golden with `queryRows` moved above `Plan` → `queryRows is not right after Plan in chunk order.`

- [ ] **Step 2: Run them and see them fail.** → `undefined: Check`.
- [ ] **Step 3: Implement** `check.go`.
- [ ] **Step 4: Run the tests.** → `ok`.
- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract check: nothing outside the chunks changed"`

### Task 12: Each helper is its chunk (checks 2 and 3)

**Files:**
- Create: `resources/goextract/checkbody.go`, `checkbody_test.go`, `checkalpha.go`, `checkalpha_test.go`
- Modify: `resources/goextract/check.go` (call both)

`checkbody.go` reads each helper's **actual** signature: a parameter named like an outer local visible at the chunk's start (`LookupParent` in the before-package) stands for it; it is a pointer parameter when its type is identical to a pointer to that local's type, a value parameter when identical to it, else `<h>: parameter p stands for no local of <F> at line N.` The outputs are the call's left side, in order, before the plumbing; `returns` when the results are outputs + `bool` + the function's results; `tail` when the call is the function's last statement. From these alone it writes the expected body with its own rewriter (`(*x)` per the type-based selector rule, `&x` → `x`, returns with the call-site output list, the natural end, natural-end jumps; temporaries named as in the actual `rA, rB := f(…)` line), formats the expected declaration with `format.Source`, and compares tokens as check 1 does → `<h> differs from its chunk near line N: expected <a>, found <b>.` Zero slots use `ZeroText`.

`checkalpha.go` aligns the helper's identifiers with the chunk's (each expected token remembers the chunk token it came from) and requires, by `types.Info` objects of the two loads: a package-level, imported or universe object → the same object (same package path, name and kind); an outer local → the parameter standing for it (or the receiver); a chunk-local object → one helper-local object, one to one; field and method selections → the same field or method of the same named type. And each call block assigns result `k` to the local named by the helper's natural-end return slot `k` → else `the call to <h> assigns result k (<a>) to <b>.`

- [ ] **Step 1: Write the failing tests.**

`checkbody_test.go`:
- `TestCheckRefusesDroppedDeref` (★ range over an array pointer): `rangearrayptr` golden with `range *arr` → `range arr` (still compiles: `range` over `*[3]int` is legal and sees the writes) → a problem starting `sumAll differs from its chunk near line 17`.
- `TestCheckRefusesChangedStatement`: `basic` golden with the helper's `out = append(out, it)` → `out = append(out, it, it)` → `collectItems differs from its chunk …`.
- `TestCheckUnknownParameter`: `names` golden with the helper's parameter renamed `m int` (body unchanged, plus `var n int` at package level so it compiles) → `double: parameter m stands for no local of F at line 13.` (line 13 is the chunk's start in the original)

`checkalpha_test.go`:
- `TestCheckRefusesSwappedOutputs`: `loopout` golden with `prev, sum = step(x, sum)` → `sum, prev = step(x, sum)` (both `int`, compiles) → `the call to step assigns result 1 (prev) to sum.`
- `TestCheckRefusesRebinding`: the `names` tamper above → also `double: n at line 19 resolves to the package's n, not the parameter for F's n.`
- `TestCheckGoldensStillPass`: (same table as Task 11) still no problem.

- [ ] **Step 2: Run them and see them fail.** → `undefined` for the new functions or the expected problems missing.
- [ ] **Step 3: Implement** `checkbody.go`, `checkalpha.go`; `Check` appends their problems.
- [ ] **Step 4: Run the tests.** → `ok`.
- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract check: each helper is exactly its chunk, by object"`

### Task 13: The signature is safe (check 4)

**Files:**
- Create: `resources/goextract/checksafe.go`, `checksafe_test.go`
- Modify: `resources/goextract/check.go` (call it)

On the actual signature, with the checker's own predicates over the before-function: each **value** parameter's local is never captured by a function literal in the function, never address-taken (explicit `&`, an implicit one through a pointer-receiver method or method value, slicing an array; on the local or a field/array path from it; before or inside the chunk or anywhere in an enclosing loop), and not a named result of a function with a `defer`. Each **pointer** parameter is used in the helper only as `(*x)`, as `X` of a struct field selector or of a method selector on a named non-pointer, non-interface type, or bare where the chunk had `&x`.

- [ ] **Step 1: Write the failing tests** (each tamper compiles):
- `TestCheckRefusesValueBuilder` (★ Builder copied): `buildercopy` golden made by-value (`a = writeWords(words, a)`, `func writeWords(words []string, a acc) acc { …; return a }`) → `writeWords: a goes by value, but F address-takes it at line 14.`
- `TestCheckRefusesValueCaptured`: `addrderef` golden made by-value (`x = bump(x)`, `func bump(x int) int { use(&x); x++; return x }`) → `bump: x goes by value, but a function literal captures it (line 9).`
- `TestCheckRefusesValueNamedResultWithDefer` (★ named results + defer + recover): `deferrecover` golden made by-value (`n = advance(n, bad)`, `func advance(n int, bad bool) int { n = 2; if bad { panic("boom") }; return n }`) → `advance: n goes by value, but it is a named result of F, which defers.`
- `TestCheckPointerUses`: `rangearrayptr` golden with `(*arr)[2] = 10` → `arr[2] = 10` → `sumAll: arr is passed by pointer but used without (*arr) at line 18.`

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** `checksafe.go`.
- [ ] **Step 4: Run the tests.** → `ok`.
- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract check: by-value parameters are never shared, pointers always dereferenced"`

### Task 14: The command line, and behavior end to end

**Files:**
- Modify: `resources/goextract/main.go`
- Create: `resources/goextract/main_test.go`

```text
goextract outline -list L -pkg P -file F -func NAME [-recv TYPE]
goextract build   -list L -pkg P -file F -func NAME [-recv TYPE] -plan PLAN.json -out OUT.go
goextract check   -list L -pkg P -file F -func NAME [-recv TYPE] -before BEFORE.go -build BUILD.json [-after AFTER.go]
```

`func run(args []string, stdout, stderr io.Writer) int`; `main` calls it. JSON on stdout and exit 0 whenever JSON was printed: `outline` prints an `Outline` (a load error becomes `{"refused": "<error>", …}`); `build` prints a `BuildResult` and writes `-out` only when there are no problems; `check` prints `{"problems": […]}` (`-after` defaults to `-file` on disk). Usage or I/O errors: a line on stderr, exit 2.

- [ ] **Step 1: Write the failing tests.**
- `TestCLIUsage`: no arguments, an unknown subcommand, and `build` without `-plan` → exit 2, the usage line on stderr.
- `TestCLIOutline`: `onboarding` → function `Plan` 31–59, 29 lines; the body block has 10 statements; statement 50–50 refused `defer`. `generic` → `refused` `Sum is generic.`
- `TestCLIBuildAndCheck`: `onboarding` with `[{"name":"queryRows","from":38,"to":46}]` → the `-out` file equals `testdata/want/onboarding.go.txt`; `check` with `-before` the case file and `-after` the out file → `{"problems":[]}`. A plan with problems writes no `-out`.
- `TestEndToEndPins`: copies `testdata/cases` to `t.TempDir()`; for each of `deferrecover` (`advance` 14–17), `buildercopy` (`writeWords` 15–18), `valuepath` (`setFields` 22–24), `multireturn` (`early` 16–18), `tail` (`finish` 9–12), `tailvoid` (`finishG` 10–13), `breakswitch` (`pickOne` 9–13), `ptrselector` (`setP` 14–15), `rangearrayptr` (`sumAll` 11–14), `addrderef` (`bump` 10–11), `loopout` (`step` 10–11), `names` (`double` 13–13): `go list` in the copy, `build`, write the result over the copy's `a.go`, `check` against the original → no problem, then `go vet ./<case>` and `go test -count=1 ./<case>` in the copy pass (`TestPin` pins the behavior: a by-value `n` in `deferrecover` would return `n=1`, a by-value `a` in `buildercopy` panics, `range arr` over the pointer in `rangearrayptr` would return 23).

- [ ] **Step 2: Run them and see them fail.** → `undefined: run`.
- [ ] **Step 3: Implement** `main.go` (flags with `flag.NewFlagSet` per subcommand; keep `//go:debug gotypesalias=1` first).
- [ ] **Step 4: Run every helper test.** `cd resources/goextract && GOTOOLCHAIN=local GOFLAGS= GOPROXY=off go test ./... && GOTOOLCHAIN=local GOFLAGS= go vet ./... && gofmt -l . && wc -l *.go | sort -n | tail -3` → `ok  	goextract	…`, nothing from gofmt, and no file over 400 lines.
- [ ] **Step 5: Commit.** `git add resources/goextract && git commit -m "Go extract helper: command line, with behavior pinned end to end"`

## Chunk 4: TypeScript: the fix kind, the helper, and the records

From here on, the TS test count is given after each task; it starts at `ℹ pass 569`.

### Task 15: The `'refactor'` fix kind and the refactor hook types

**Files:**
- Modify: `src/aiready/language.ts`, `src/aiready/fixState.ts`, `src/aiready/changeNote.ts`
- Modify: `test/aiReadyNote.test.ts`

`language.ts` (stays language-neutral; every new member optional on the adapter):

```ts
/** The kinds of fix a run can make. */
export type FixKind = 'split' | 'tests' | 'refactor';

/** A function a refactor would shorten. */
export interface RefactorTarget {
	readonly name: string;
	/** The receiver's base type name (`Store` for `func (s *Store)`), as the Go helper prints it, when it is a method. */
	readonly receiver?: string;
	readonly lines: number;
}

/** One run of whole statements the model wants as a helper: its name, and its first and last line in the file. */
export interface ExtractChunk {
	readonly name: string;
	readonly from: number;
	readonly to: number;
}

/** One helper, as the commit and the change note describe it. */
export interface HelperSummary {
	readonly name: string;
	/** Parameter names in order; pointer-passed ones start with `*`. */
	readonly params: readonly string[];
	readonly outputs: readonly string[];
	/** Whether it carries the function's returns. */
	readonly returns: boolean;
}

/** A built refactor: the new file, or the problems to show the model. */
export interface RefactorBuild {
	readonly problems: readonly string[];
	readonly text?: Buffer;
	readonly helpers?: readonly HelperSummary[];
	/** The function's lines afterwards, doc comment included. */
	readonly functionLines?: number;
	/** What `check` needs from the build, opaque to the core. */
	readonly facts?: string;
}

/** A language's mechanical refactor (Go: extract function), checked by the language's own code. */
export interface RefactorHooks {
	/** The function a refactor would shorten in a parsed file, or why there is none. */
	target(info: FileInfo): RefactorTarget | string;
	/** The extra approved command that records which code of the file's unit its tests run, and the profile it writes (relative to the worktree). */
	coverage(file: string, index: number): { readonly command: CheckCommand; readonly profile: string };
	/** Whether a profile's text shows the target's lines executed. */
	ran(profile: string, file: string, target: RefactorTarget): Promise<boolean>;
	/** The model's input, or why this function can't be refactored. */
	prompt(file: string, target: RefactorTarget): Promise<Prompt | string>;
	build(file: string, target: RefactorTarget, chunks: readonly ExtractChunk[]): Promise<RefactorBuild>;
	/** The extract check on the written file; empty means it passed. */
	check(file: string, before: Buffer, target: RefactorTarget, built: RefactorBuild): Promise<string[]>;
	/** For the change note's "What may differ" when a refactor was committed. */
	readonly mayDiffer: string;
	/** Added to the approval modal when a refactor is picked; ends with a space. */
	readonly approvalNote: string;
}
```

`LanguageInfo.fixes` and `LanguageAdapter.fixes` become `readonly FixKind[]`; `LanguageAdapter` gains `readonly refactor?: RefactorHooks;` after `fixes`.

`fixState.ts`: `import type { FixKind, HelperSummary, RefactorTarget } from './language';` and `export type { FixKind };` (drop the local type). `FixChoice` gains `readonly target?: RefactorTarget;` ("For a refactor: the function it shortens."). `StepRecord` gains

```ts
	/** For a refactor: the function, its helpers, its lines afterwards, and whether the package's tests ran it at baseline. */
	readonly refactor?: { readonly target: string; readonly helpers: readonly HelperSummary[]; readonly lines: number; readonly ran?: boolean };
	/** A fix the run adds right after this one (the split that follows a refactor commit). */
	readonly followUp?: FixChoice;
```

and `lasting` becomes `{ readonly skip?: string; readonly big?: RefactorTarget }` (`big`: the declaration that makes a split useless, kept so a later picker can offer its refactor). `RunState.fixes` becomes `fixes: FixChoice[]` (no `readonly`: a follow-up is spliced in) and gains `readonly coverage?: Readonly<Record<string, boolean>>;` ("Whether the package's tests ran each refactor offer's function, from this run's coverage pass.").

`changeNote.ts`: the three `${… === 'split' ? 'split' : 'tests'}` become `${…kind}`.

- [ ] **Step 1: Write the failing test.** Append to `test/aiReadyNote.test.ts` `test('a refactor fix reads as a refactor in the refused, not run and discarded lists', …)`: a state whose steps hold a refused refactor of `a.go` (reason `The extract check failed: x.`) and a discarded refactor of `c.go`, and whose `fixes` has a refactor of `b.go` past `next` → the note contains ``- `a.go` (refactor): refused. The extract check failed: x.``, ``## Not run yet\n\n- `b.go` (refactor)`` and ``## Discarded by you\n\n- `c.go` (refactor)``.
- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `Type '"refactor"' is not assignable to type 'FixKind'`.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run the tests.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 570`, `ℹ fail 0`.
- [ ] **Step 5: Commit.** `git add -A src/aiready test && git commit -m "AI-ready fixes: a refactor fix kind and language-neutral refactor hooks"`

### Task 16: Build and run the extract helper

**Files:**
- Create: `src/aiready/goBuildTool.ts`, `src/aiready/goExtract.ts`, `test/goExtractFixture.ts`, `test/aiReadyGoBuildTool.test.ts`, `test/aiReadyGoExtract.test.ts`
- Modify: `tsconfig.test.json` (add both modules after `src/aiready/goAst.ts`)

`goBuildTool.ts`:

```ts
/**
 * Builds the Go program in `dir` once per extension version, sources and `go version`, in an empty folder, for this
 * machine, with no cgo and no network. `probe` runs the new binary before it is kept. Returns the binary's path.
 */
export async function buildGoTool(dir: string, name: string, storageDir: string, version: string, go: string,
	probe: (binary: string) => Promise<boolean>): Promise<string>
```

The hash covers every `*.go` file not ending `_test.go` and `go.mod` in `dir` (sorted, name and bytes) and `go version`'s output; the binary lives at `<storageDir>/<name>/<version>-<hash8>/<name>`. Copy those files to a `mkdtemp` under that folder, run `go build -o <work>/<name> .` with `{ ...GO_READ_ENV, GOOS: '', GOARCH: '', GOENV: 'off', GOWORK: 'off', CGO_ENABLED: '0' }`, probe, rename, remove the work folder in `finally`. Failures: `` Could not build the Go helper `<name>`: <stderr, 500 chars> `` and `` The Go helper `<name>` was built but does not run. ``

`goExtract.ts` (no vscode): the helper's JSON as TS types (`ExtractParam`, `ExtractHelper`, `ExtractStatement`, `ExtractBlock`, `ExtractOutline`, `ExtractBuild`, field for field as Tasks 9 and 10 print them), and

```ts
/** Where a function lives, for every subcommand: the list file, the import path, the absolute file, the function and its receiver. */
export interface ExtractTarget { readonly list: string; readonly pkg: string; readonly file: string; readonly func: string; readonly recv?: string }
/** `go list -export -deps -json` of the file's package into `out`; the import path, or a plain message. */
export async function listPackage(go: string, root: string, file: string, out: string): Promise<{ list: string; pkg: string } | string>
export async function extractOutline(helper: string, target: ExtractTarget): Promise<ExtractOutline>
export async function extractBuild(helper: string, target: ExtractTarget, planFile: string, outFile: string): Promise<ExtractBuild>
export async function extractCheck(helper: string, target: ExtractTarget, beforeFile: string, buildFile: string): Promise<string[]>
/** The helper's usage line appears when it runs with no arguments: the probe for `buildGoTool`. */
export async function probeExtract(binary: string): Promise<boolean>
```

`listPackage` runs `go list -export -deps -json <goPackage(file)>` in `root` with `GO_READ_ENV` and a 10-minute limit; the import path is the last object's `ImportPath`; a failure → `` `go list` could not load <pkg>: <first stderr line> ``. The three runners call `runTool(helper, args, path.dirname(target.file), GO_READ_ENV)`; exit 2 throws with stderr; otherwise `JSON.parse(stdout)`.

`test/goExtractFixture.ts`: `extractHelper(): Promise<string | undefined>` builds `resources/goextract` once into `os.tmpdir()/my-editor-goextract-cache` (undefined without Go), and `goModule(files: Record<string, string>): string`, a temp module folder.

- [ ] **Step 1: Write the failing tests.**
	- `aiReadyGoBuildTool.test.ts`: `test('a Go helper is built once from its folder and rebuilt when a source changes', …)`: a temp folder with `go.mod` and `main.go` printing `v1`; two builds return the same path; changing `main.go` gives a new path whose binary prints `v2`; a `_test.go` file does not change the path. Skips without Go.
	- `aiReadyGoExtract.test.ts`: `test('outline, build and check run the extract helper on a small module', …)`: a module with `basic`'s `a.go` → `listPackage` gives `example.com/m`; the outline's function is `Report`, 12 lines; `extractBuild` with `[{"name":"collectItems","from":11,"to":14}]` writes the expected text (Task 9's `basic.go.txt`); writing it and `extractCheck` gives `[]`. `test('a package that does not type-check comes back as a refusal, not a crash', …)`: a module whose file has `var x int = "s"` → the outline's `refused` starts `the package does not type-check`.
- [ ] **Step 2: Run them and see them fail.** `npm test 2>&1 | grep -m1 'error TS'` → `Cannot find module '../src/aiready/goBuildTool'`.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run the tests.** → `ℹ pass 573`, `ℹ fail 0`.
- [ ] **Step 5: Commit.** `git add -A src/aiready test tsconfig.test.json && git commit -m "AI-ready fixes: build and run the Go extract helper"`

### Task 17: Coverage profiles, and two records kept by blob

**Files:**
- Create: `src/aiready/goCover.ts`, `src/aiready/coverRecord.ts`, `src/aiready/refusedRecord.ts`
- Create: `test/aiReadyGoCover.test.ts`, `test/aiReadyCoverRecord.test.ts`, `test/aiReadyRefusedRecord.test.ts`
- Modify: `tsconfig.test.json`

`goCover.ts` (pure):

```ts
/**
 * Whether a Go cover profile (`go test -coverprofile`) shows a statement of the file named `base` executed between lines
 * `from` and `to`: a block (`path:l1.c1,l2.c2 statements count`) overlapping them with a count above zero.
 */
export function coverRan(profile: string, base: string, from: number, to: number): boolean
```

A block's path matches when it is `base` or ends with `/` + `base` (one package per profile, so a base name is unique).

`coverRecord.ts` (no vscode; `coverage.json` in `runDir`, written through a `.tmp` and a rename like `settled.json`):

```ts
export interface CoverageEntry { readonly blob: string; readonly function: string; readonly ran: boolean }
export interface CoverageCache { readonly files: Readonly<Record<string, CoverageEntry>> }
/** This run's entries over the earlier record. */
export function coverageCache(entries: ReadonlyMap<string, CoverageEntry>, previous?: CoverageCache): CoverageCache
/** Whether the last coverage of this file, as it is now, ran its function; undefined when unknown. */
export function ranBefore(cache: CoverageCache | undefined, file: string, blob: string | undefined): boolean | undefined
export function saveCoverage(storageDir: string, root: string, cache: CoverageCache): void
export function loadCoverage(storageDir: string, root: string): CoverageCache | undefined
```

`refusedRecord.ts` (no vscode; `refactor-refused.json`):

```ts
export interface RefusedRefactor { readonly blob: string; readonly reason: string }
export interface RefusedCache { readonly files: Readonly<Record<string, RefusedRefactor>> }
/** Refused refactors by blob over the earlier record; a committed refactor of a file drops its entry. */
export function refusedCache(steps: readonly StepRecord[], blobs: ReadonlyMap<string, string>, previous?: RefusedCache): RefusedCache
/** Why an earlier run refused this file's refactor, while its content is the same; else undefined. */
export function refusedBefore(cache: RefusedCache | undefined, file: string, blob: string | undefined): string | undefined
export function saveRefused(storageDir: string, root: string, cache: RefusedCache): void
export function loadRefused(storageDir: string, root: string): RefusedCache | undefined
/** When a run closes: its refused refactors, blob ids read in its worktree. Never fails the close. */
export async function rememberRefused(storageDir: string, root: string, worktree: string, steps: readonly StepRecord[]): Promise<void>
```

- [ ] **Step 1: Write the failing tests.**
	- `aiReadyGoCover.test.ts`: `test('a block with a count inside the function\'s lines means it ran; zero counts and other files do not', …)` with the profile `mode: set\nm/a.go:3.21,4.11 1 1\nm/a.go:10.25,10.37 1 0\nm/b.go:3.1,9.2 2 1\n` → `coverRan(p, 'a.go', 3, 8)` true, `(p, 'a.go', 10, 12)` false, `(p, 'a.go', 20, 30)` false, `(p, 'c.go', 1, 99)` false; `test('an empty or garbled profile shows nothing ran', …)`.
	- `aiReadyCoverRecord.test.ts`: `test('coverage is kept by file and blob and read back per project', …)`; `test('a changed blob or another file is unknown, and a new run\'s entries replace older ones', …)`.
	- `aiReadyRefusedRecord.test.ts`: `test('refused refactors are kept by blob with their reason; a committed one drops the entry, splits are ignored', …)`; `test('the record is saved per project and read back; a changed file is unknown', …)`.
- [ ] **Step 2: Run them and see them fail.** → `Cannot find module '../src/aiready/goCover'`.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run the tests.** → `ℹ pass 579`, `ℹ fail 0`.
- [ ] **Step 5: Commit.** `git add -A src/aiready test tsconfig.test.json && git commit -m "AI-ready fixes: read Go coverage, keep coverage and refused refactors by blob"`

### Task 18: The model's plan and the Go refactor prompt

**Files:**
- Create: `src/aiready/refactorPlan.ts`, `src/aiready/goRefactorPrompt.ts`, `test/aiReadyRefactorPlan.test.ts`, `test/goRefactorPrompt.test.ts`
- Modify: `tsconfig.test.json`

`refactorPlan.ts` (pure):

```ts
/** The first JSON array of {"name", "from", "to"} in a reply; undefined when there is none. */
export function parseChunks(reply: string): ExtractChunk[] | undefined
/** Problems the core can see without the language: names, ranges, overlaps; at most 12 helpers. */
export function chunkShapeProblems(chunks: readonly ExtractChunk[]): string[]
```

Messages: `The plan names no helper.`; `At most 12 helpers per plan.`; `"Name" must start with a lower-case letter and use only letters, digits and underscores.` (the name JSON-quoted, cut to 60 characters); `name: from 30 is after to 20.`; `a (11–14) overlaps b (13–15).`; `name is named twice.` The retry reuses `splitPlan.retryText`.

`goRefactorPrompt.ts` (pure):

```ts
export const MAX_FUNCTION_CHARS = 120_000;
/** The prompt for one function: its numbered lines and the outline; a plain message when the function is too long to show. */
export function goRefactorPrompt(file: string, source: string, outline: ExtractOutline): Prompt | string
```

System text (one line each): you plan how to shorten one long Go function by moving runs of its statements into new helper functions; the host copies the statements byte for byte, passes what they read as parameters, returns what they change, and refuses what it cannot prove equivalent — you only choose the runs and their names; a run is whole consecutive statements of one block (the body, a nested block or a case body), given by its first and last line, never inside a function literal, runs don't overlap; at most 6 parameters per helper (ctx counts, the receiver doesn't) and at most 3 changed variables flowing out — the outline lists at each statement boundary the variables still needed after it, so choose boundaries where few are live; statements marked "refused" stay out of every run; the function must end at 400 lines or fewer, and each helper too; names are new, unexported lowerCamelCase verbs (`queryPlacementRows`, `applyLedgerPhase`); reply with only a JSON array, for example `[{"name":"queryPlacementRows","from":177,"to":295}]`. Text: `File: <file>`, `Function: <name> (<receiver>), lines A–B (N lines); it must end at 400 lines or fewer.`, `Outline:` with one JSON line per block, then `Source with line numbers:` and the function's lines as `<n>\t<text>`. Over `MAX_FUNCTION_CHARS` → `` `<name>` is <n> characters with line numbers, more than the 120000 a refactor prompt shows. ``

- [ ] **Step 1: Write the failing tests.**
	- `aiReadyRefactorPlan.test.ts`: `test('a reply\'s JSON array of name, from and to is read, with prose around it ignored', …)`; `test('shape problems: none, too many, bad names, reversed and overlapping ranges, a name twice', …)`; `test('the retry repeats the prompt with the rejected plan and its problems', …)`.
	- `goRefactorPrompt.test.ts`: `test('the prompt numbers the function\'s lines and gives the outline, the limits and the reply shape', …)` (an outline with one block; the text contains `17\tfunc build(`, `at most 6 parameters`, `"from":177`); `test('a function too long to show the model is refused before any call', …)`.
- [ ] **Step 2: Run them and see them fail.** → `Cannot find module '../src/aiready/refactorPlan'`.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run the tests.** → `ℹ pass 584`, `ℹ fail 0`.
- [ ] **Step 5: Commit.** `git add -A src/aiready test tsconfig.test.json && git commit -m "AI-ready fixes: the refactor plan and the Go refactor prompt"`

### Task 19: The Go adapter's refactor hooks

**Files:**
- Create: `src/aiready/goRefactor.ts`, `test/aiReadyGoRefactor.test.ts`
- Modify: `src/aiready/goAdapter.ts`, `tsconfig.test.json`

`goRefactor.ts` (no vscode): `export function createGoRefactor(root: string, tools: GoTools): RefactorHooks` (`tools.extract` set):
- `target(info)`: the declaration with the most lines (`info as GoFileInfo`); not over 400 → `no declaration is over 400 lines`; not a `func`/`method` → `` `<name>` is a <kind>, not a function ``; else `{ name, receiver, lines }` (receiver as goast prints it).
- `coverage(file, n)`: `{ command: { label: 'test', command: \`go test -count=1 -coverprofile=.my_editor-cover-${n}.out ${goPackage(file)}\` }, profile: \`.my_editor-cover-${n}.out\` }`.
- `ran(profile, file, target)`: parse the file with the goast helper, find the declaration by name and receiver, turn its byte span into lines, `coverRan(profile, path.posix.basename(file), from, to)`.
- `prompt(file, target)`: in a fresh temp folder (the previous one removed), `listPackage` → message or list; `extractOutline` → `refused` returns it; else `goRefactorPrompt(file, source, outline)`. The list and its folder are kept per file for `build` and `check`.
- `build(file, target, chunks)`: the plan JSON and an out file in that folder; `extractBuild`; problems → `{ problems }`; else `{ problems: [], text, helpers (pointer params as `*name`), functionLines, facts: <the build JSON> }`.
- `check(file, before, target, built)`: `before.go` and `build.json` in that folder; `extractCheck`; the folder is removed in `finally`.
- `mayDiffer`: `Helper functions add frames to stack traces and to runtime.Caller, log.Lshortfile and slog source lookups; inlining and escape analysis may differ (a variable passed by pointer may move to the heap), which changes speed and allocations, not results.`
- `approvalNote`: `For refactors, my_editor also runs go list -export on those packages, which compiles their dependencies as go build does, and type-checks them with its own helper. ` (with backticks around the two commands).

`goAdapter.ts`: `GoTools` gains `readonly extract?: string`; `goTools` builds it with `buildGoTool(path.join(path.dirname(path.dirname(mainGo)), 'goextract'), 'goextract', storageDir, version, go, probeExtract)`, catching any error (no refactors then); `GO_LANGUAGE.fixes` becomes `['split', 'tests', 'refactor']`; `createGoAdapter` sets `fixes: tools.extract ? ['split', 'tests', 'refactor'] : ['split', 'tests']` and `refactor: tools.extract ? createGoRefactor(root, tools) : undefined`.

- [ ] **Step 1: Write the failing tests** (`aiReadyGoRefactor.test.ts`; the last two skip without Go):
	- `test('the refactor target is the largest declaration over 400 lines, and only a function', …)` with hand-made `GoFileInfo` values (a 452-line method `*Store`, a 410-line `var` block, a file under the limit).
	- `test('coverage runs go test with a dot-file profile in the worktree root, one per package', …)` → `go test -count=1 -coverprofile=.my_editor-cover-2.out ./internal/store`.
	- `test('ran reads the profile by the function\'s lines in the file', …)`: a module file with two functions and a profile marking only the second.
	- `test('end to end on a small module: the prompt, a plan, the build and the extract check, and the result builds', …)`: a module whose `Big` has 405 `n += i` lines; the prompt mentions `Big`; a plan moving lines 3–300 into `addMany` builds and checks clean; `go build ./...` in the module passes after writing the text.
- [ ] **Step 2: Run them and see them fail.** → `Cannot find module '../src/aiready/goRefactor'`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** → `ℹ pass 588`, `ℹ fail 0`.
- [ ] **Step 5: Commit.** `git add -A src/aiready test tsconfig.test.json && git commit -m "AI-ready fixes: Go refactor hooks on the Go adapter"`

## Chunk 5: TypeScript: offering, running and reporting refactors

### Task 20: Refactor offers in the picker

**Files:**
- Create: `src/aiready/refactorOffers.ts`, `test/aiReadyRefactorOffers.test.ts`
- Modify: `src/aiready/fixCandidates.ts`, `src/aiready/fixPicker.ts`, `src/aiready/fixSettled.ts`, `src/aiready/fixScreen.ts`, `src/aiready/stillOver.ts`, `tsconfig.test.json`
- Modify: `test/aiReadyCandidates.test.ts`, `test/aiReadyNote.test.ts`, `test/aiReadySettled.test.ts`, `test/aiReadyRefactor.test.ts`

`refactorOffers.ts` (pure):

```ts
/**
 * Why each refactor offer starts unticked, in this order: its package can't be checked here (`blocked`); an earlier run
 * refused it for this content; no coverage record for this content shows the package's tests running the function.
 * Offers missing from the map are ticked.
 */
export function refactorUnticked(offers: readonly FixChoice[], blobs: ReadonlyMap<string, string>, coverage: CoverageCache | undefined,
	refused: RefusedCache | undefined, blocked: ReadonlyMap<string, string>): Map<string, string>
```

Texts: the `blocked` reason as is; `an earlier run could not refactor it: <reason>`; `` no test here runs `<name>` yet; build, vet and the extract check still apply ``.

`stillOver.ts`: export `largestDeclaration(info: FileInfo): Declaration | undefined` (the reduce `needsRefactor` already does; `needsRefactor` uses it).

`fixScreen.ts`: the needs-a-refactor settle records `lasting: { big: { name, lines, receiver? } }` from `largestDeclaration` (name as `needsRefactor` names it).

`fixSettled.ts`: `SettledSplit` gains `readonly big?: RefactorTarget`; `settledCache` copies `step.lasting.big` into it.

`fixCandidates.ts`: `Candidates` gains `readonly blobs: ReadonlyMap<string, string>` (refactor offers' blob ids). In the loop: a remembered no-skip record **without** `big` is ignored when `local.refactor` exists (the file is screened once more, see *Decisions*); with `big` and `local.refactor`, the file is unsplittable **and** offered with that target; a parsed file that `needsRefactor` is unsplittable and, when `local.refactor?.target(info)` is a target, offered. Offers become `{ file, kind: 'refactor', lines, target }` choices, sorted with the rest; `unsplittable` keeps its meaning.

`fixPicker.ts`: `pickFixes(choices, show, blocked, unticked = new Map())`; a refactor row's description is `` <lines> lines · refactor `<name>` (<n> lines) into helpers, then split ``; it is picked when neither `blocked` nor `unticked` has its file; its detail is `blocked.get(file) ?? unticked.get(file)`.

- [ ] **Step 1: Write the failing tests.**
	- `aiReadyRefactorOffers.test.ts`: `test('a refactor is ticked only when the last coverage of this content shows its tests running the function', …)`; `test('a refactor refused for this content is unticked with the earlier reason, and a blocked package wins', …)`; `test('with no coverage record yet a refactor is unticked and says why', …)`.
	- `aiReadyCandidates.test.ts`: `test('a file only a refactor can help is offered as a refactor when the adapter has one, and stays unsplittable without it', …)`; `test('a settled file with its big function is offered without parsing; an older record without it is screened once more', …)`.
	- `aiReadyNote.test.ts`: `test('refactor rows say what they do and are ticked only when allowed', …)`.
	- `aiReadySettled.test.ts`: `test('a split settled as needing a refactor keeps its big function by blob', …)`.
	- `aiReadyRefactor.test.ts`: in the screening test, the expected step's `lasting: {}` becomes `lasting: { big: { name: 'StepVerification', lines: 452 } }`.
- [ ] **Step 2: Run them and see them fail.** → `Cannot find module '../src/aiready/refactorOffers'`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** → `ℹ pass 595`, `ℹ fail 0`.
- [ ] **Step 5: Commit.** `git add -A src/aiready test tsconfig.test.json && git commit -m "AI-ready fixes: offer refactors in the picker, ticked only when tests run the function"`

### Task 21: One refactor fix

**Files:**
- Create: `src/aiready/refactorText.ts`, `src/aiready/refactorStep.ts`, `test/aiReadyRefactorText.test.ts`, `test/aiReadyRefactorStep.test.ts`
- Modify: `src/aiready/steps.ts` (export `runChecks` and `ChecksOutcome`), `src/aiready/fixScreen.ts`, `tsconfig.test.json`
- Modify: `test/aiReadyScreen.test.ts`

`refactorText.ts` (pure):

```ts
/** `queryRows(ctx, staleAfter, tx, req, imageRef) → rows, err`; `; carries returns` when it does. */
export function helperLine(helper: HelperSummary): string
/** `my_editor: extract 7 helpers from StepReportingInventoryVerification (internal/store/x.go)` */
export function refactorSubject(file: string, target: string, count: number): string
/** The commit body: what moved, each helper, the extract check, coverage and the checks. */
export function refactorBody(helpers: readonly HelperSummary[], target: string, ran: boolean | undefined, checks: string): string
/** The run's line for a refactor step. */
export function refactorRunLine(step: StepRecord): string
```

Body: `Moved runs of statements of <F> into helpers, byte for byte apart from the extract rewrites (parameters, (*x) for shared variables, returns).`, a blank line, one `- <helperLine>` per helper, a blank line, `Extract check: passed. Coverage: the package's tests ran <F> at baseline.` or `… Coverage: no passing test ran <F> at baseline; build, vet and the extract check are the net.` (unknown: `Coverage: not recorded.`), then `Checks: <summary>`. Run line: ``- Refactor `F` in `file`: committed `abc1234` (7 helpers).``, otherwise like the others (``- Refactor `F` in `file`: refused. <reason>``).

`fixScreen.ts` `screenParsed`, for `fix.kind === 'refactor'`: a skip → settle `Never refactored: <skip>.`; no `needsRefactor` any more → settle `No function in it needs a refactor now.`; no passing verifying check → settle unchecked, as for splits. `alreadyShort` also applies to refactors.

`refactorStep.ts` (no vscode): `export async function runRefactor(ctx: StepContext, fix: FixChoice): Promise<StepOutcome>`; `StepContext` (in `steps.ts`) gains `readonly coverage?: Readonly<Record<string, boolean>>`.
1. No `adapter.refactor` → skipped `This language has no refactor.` Parse, `screenParsed` (early outcome returned as is).
2. `target(info)` a string → refused with it; `prompt(file, target)` a string → refused with it.
3. Ask; `parseChunks` → `chunkShapeProblems`, then `build`; problems → one retry with `retryText`; still problems → refused `The refactor plan was rejected twice: <first 5>` (attempts and rejected kept in `plan`, like splits). Stop → `'stopped'`.
4. Write `built.text`; then, restoring the file on every failure (try/finally like `runSplit`): `check(file, before, target, built)` → refused `The extract check failed: <first 5>`; other tracked files changed → refused; the original was gofmt-clean and `unformatted([file])` is not empty → refused `The formatter would change <file>.`; `runChecks(ctx, file, [])` stopped → `'stopped'`, problems → refused `Checks differ from before: …`.
5. Commit with `refactorSubject`/`refactorBody`; return `{ file, kind: 'refactor', status: 'committed', commit, checks, plan, refactor: { target, helpers, lines: functionLines, ran: ctx.coverage?.[file] }, followUp }`, where `followUp = { file, kind: 'split', lines: <the new file's sourceLines> }` when that is over 400.

- [ ] **Step 1: Write the failing tests.**
	- `aiReadyRefactorText.test.ts`: `test('helper lines mark pointer parameters and returns', …)`; `test('the subject counts helpers and the body says what the tests and the extract check showed', …)`.
	- `aiReadyRefactorStep.test.ts` (a temp Git repository with a 460-line `big.txt`, a fake adapter whose `parse` gives one 450-line declaration and whose `refactor` hooks are fakes, `check` returning the baseline's results): `test('a refactor is planned, built, extract-checked, compared with the baseline and committed, and the split follows', …)` (one rejected plan then a good one; the commit subject; `followUp` with the new line count); `test('a plan rejected twice is refused and nothing is written', …)`; `test('an extract-check failure restores the file and refuses with the reason', …)`; `test('checks that differ from the baseline restore the file and refuse the refactor', …)`; `test('Stop while planning leaves nothing behind', …)`.
	- `aiReadyScreen.test.ts`: `test('a refactor is settled early when nothing needs one now or its build is blocked', …)`.
- [ ] **Step 2: Run them and see them fail.** → `Cannot find module '../src/aiready/refactorText'`.
- [ ] **Step 3: Implement.** `refactorStep.ts` stays under 250 lines; the texts live in `refactorText.ts`.
- [ ] **Step 4: Run the tests.** → `ℹ pass 603`, `ℹ fail 0`.
- [ ] **Step 5: Commit.** `git add -A src/aiready test tsconfig.test.json && git commit -m "AI-ready fixes: one refactor fix, checked and committed, then its split"`

### Task 22: In a run: coverage, approval, the queue and the close

**Files:**
- Create: `src/aiready/coverageRun.ts`, `test/aiReadyCoverageRun.test.ts`
- Modify: `src/aiready/fixQueue.ts`, `src/aiready/fixSetup.ts`, `src/aiready/fixRun.ts`, `tsconfig.test.json`
- Modify: `test/aiReadyScreen.test.ts`

`coverageRun.ts` (no vscode):

```ts
/** One coverage command per unit with a refactor offer, and the offers it measures. */
export interface CoverageCommand { readonly unit: string; readonly files: readonly string[]; readonly command: CheckCommand; readonly profile: string }
export function coverageCommands(offers: readonly FixChoice[], hooks: Pick<RefactorHooks, 'coverage'>): CoverageCommand[]
export interface CoverageDeps {
	readonly worktree: string;
	readonly run: (command: string, label: string) => Promise<CheckResult>;
	readonly blob: (file: string) => Promise<string | undefined>;
	readonly cancelled: () => boolean;
	readonly progress: (text: string) => void;
}
/** Runs each command once, reads and deletes its profile, and says per offer whether its function ran. */
export async function runCoverage(commands: readonly CoverageCommand[], offers: readonly FixChoice[], hooks: Pick<RefactorHooks, 'ran'>,
	deps: CoverageDeps): Promise<{ ran: Record<string, boolean>; entries: Map<string, CoverageEntry> } | 'stopped'>
```

A command that does not exit 0, or leaves no profile, records `ran: false`. The profile is removed in `finally`.

`fixQueue.ts`: after `state.next++`, `if (outcome.followUp) { state.fixes.splice(state.next, 0, outcome.followUp); }`.

`fixSetup.ts` (`startRun`):
- `offers = choices.filter(kind === 'refactor')`; `unticked = refactorUnticked(offers, found.blobs, loadCoverage(...), loadRefused(...), blocked)`; `pickFixes(choices, …, blocked, unticked)`.
- `coverage = local.refactor && offers.length ? coverageCommands(offers, local.refactor) : []`; approved = setup, checks, then the coverage commands; the approval note adds `local.refactor.approvalNote` when a refactor was picked.
- After the baseline: `runCoverage` with `run` = `runCheck(…, 'test')` and `blob` = `git rev-parse HEAD:<file>` in the worktree → `saveCoverage(storage, root, coverageCache(entries, loadCoverage(…)))`; `'stopped'` → discard as for the baseline; `RunState.coverage = ran`.
- The unsplittable list screened into the queue leaves out files whose refactor was picked.

`fixRun.ts`: the queue runs `runRefactor` for `'refactor'`; `ctx.coverage = state.coverage`; `stepLine` uses `refactorRunLine` for refactors; `closeRun` calls `rememberRefused` next to `rememberSettled` and passes `adapter.refactor?.mayDiffer` to the change note (Task 23).

- [ ] **Step 1: Write the failing tests.**
	- `aiReadyCoverageRun.test.ts`: `test('one coverage command per package with a refactor offer', …)` (two offers in `internal/store`, one in `cmd/x` → two commands, numbered 1 and 2); `test('the coverage pass runs each command once, reads and deletes the profile, and records ran by blob', …)`; `test('a failing coverage run records not ran', …)`.
	- `aiReadyScreen.test.ts`: `test('a step\'s follow-up fix runs next and counts in the progress', …)` (a refactor step returning `followUp`; the next run fix is that split; the label reads `Fix 2 of 3`).
- [ ] **Step 2: Run them and see them fail.** → `Cannot find module '../src/aiready/coverageRun'`.
- [ ] **Step 3: Implement.** `fixSetup.ts` stays under 250 lines; the logic lives in `coverageRun.ts` and `refactorOffers.ts`.
- [ ] **Step 4: Run the tests.** → `ℹ pass 607`, `ℹ fail 0`. `npx tsc --noEmit -p ./` → clean.
- [ ] **Step 5: Commit.** `git add -A src/aiready test tsconfig.test.json && git commit -m "AI-ready fixes: coverage for refactor offers, and refactors in the run"`

### Task 23: The change note, the Project card

**Files:**
- Modify: `src/aiready/changeNote.ts`, `src/aiready/fixRun.ts`, `src/aiready/fixLeft.ts`, `src/aiready/fixButton.ts`, `src/aiready/stillOver.ts`
- Modify: `test/aiReadyNote.test.ts`, `test/aiReadyFixButton.test.ts`, `test/aiReadyStillOver.test.ts`

`changeNote.ts`: `renderChangeNote(state, at, mayDiffer, hasReport, refactorMayDiffer?)`. The opening paragraph says commits move code into new files, extract helpers, or add tests. `stepLine` for refactors: ``- `abc1234` Refactored `F` in `file` into 7 helpers.`` A `## Refactored` section after `## Commits`, per committed refactor: ``### `F` (`file`)``, then `- <helperLine>` per helper, then `Now <lines> lines. Extract check: passed. <coverage sentence as in the commit>`. Under *Left for you*, when a refactor was committed, `- <refactorMayDiffer>`. `fixRun.closeRun` passes `adapter.refactor?.mayDiffer`.

`fixLeft.ts`: `FixLeft` gains `readonly offers?: number` (refactor offers not refused for their content); `refactor` counts the unsplittable files without an offer plus the refused offers.

`stillOver.ts`: `why()` says `it needs a real refactor, which a split can't do` (was "which this fixer doesn't do", now false for Go); `aiReadyStillOver.test.ts`'s `BIG_REASON` (line 14) changes with it.

`fixButton.ts`: `FixButtonInput.offers?: number`. `stuckText` says `need(s) a real refactor this fixer can't do here` (refactors not offered or refused for their content); the two assertions at lines 42 and 44 of `aiReadyFixButton.test.ts` change with it. With offers, the text adds `` <n> long function<s> to refactor into helpers. `` after the split count (or alone when `left` is 0), the button is primary, and `Fix remaining files` shows while `left + offers` is above 0.

- [ ] **Step 1: Write the failing tests.**
	- `aiReadyNote.test.ts`: `test('the change note has a Refactored section with helpers, pointer parameters, the extract check and coverage', …)`; `test('what may differ adds helper frames and inlining only when a refactor was committed', …)`.
	- `aiReadyFixButton.test.ts`: `test('refactor offers count with the files left, and refused ones stay stuck', …)` → `fixButton({ running: false, saved: false, branchExists: true, left: 0, offers: 2, refactor: 1 })` → label `Fix remaining files`, primary, text contains `2 long functions to refactor into helpers.` and `1 file needs a real refactor this fixer can't do here.`
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** → `ℹ pass 610`, `ℹ fail 0`; `wc -l src/aiready/*.ts | sort -n | tail -3` → none over 400.
- [ ] **Step 5: Commit.** `git add -A src/aiready test && git commit -m "AI-ready fixes: refactors in the change note and on the Project card"`

## Chunk 6: Dry run on a copy of the dialer, docs and verification

### Task 24: The whole refactor on a copy of the dialer

**Files:** none in the repository (a scratch folder only). Never touch `/Users/u/funcoding/m_dialer`; `git archive` reads it.

- [ ] **Step 1: Copy the dialer's `ai_fix` and compile the modules.**

```bash
W=$(mktemp -d); mkdir -p "$W/dialer" "$W/storage"
git -C /Users/u/funcoding/m_dialer/m_dialer archive ai_fix | tar -x -C "$W/dialer"
(cd "$W/dialer" && git init -q && git add -A && git -c user.email=t@example.com -c user.name=T commit -qm base)
npm test >/dev/null 2>&1   # compiles out-test/
```

- [ ] **Step 2: Write `$W/refactor-check.js`** (plain Node, requiring `out-test/src/aiready/*.js` by absolute path): `goTools(<ext>/resources/goast/main.go, $W/storage, 'dry')`; `prepare($W/dialer)`; `createGoAdapter(worktree, tools, trackedFiles)`; the baseline of `adapter.checks('internal/store/onboarding_plan.go')` twice with `runCommand`; `coverageCommands` and `runCoverage` for the offer `{ file: 'internal/store/onboarding_plan.go', kind: 'refactor', lines: 417, target: { name: 'buildOnboardingPlanTx', lines: 401 } }`; `runRefactor` with `ask` replying `[{"name":"queryOnboardingPlacementRows","from":177,"to":295}]`; then `runSplit` on the step's `followUp`, with `ask` replying a plan that moves the helper's declaration (found by `adapter.parse`) into `onboarding_plan_query.go`; print each outcome, `git log --oneline -3` and `git status --short` of the worktree; `remove` the worktree at the end.

- [ ] **Step 3: Run it.** `node "$W/refactor-check.js"`. Expected (shas vary):

```text
baseline `go build ./...`: exit 1 (internal/vad needs onnxruntime_c_api.h)
baseline `go build -o /dev/null ./internal/store`: exit 0
baseline `go vet ./internal/store`: exit 1
baseline `go test -count=1 -json ./internal/store`: exit 1 (the test binary does not build: internal/vad)
coverage `go test -count=1 -coverprofile=.my_editor-cover-1.out ./internal/store`: ran=false
refactor internal/store/onboarding_plan.go: committed <sha>
  queryOnboardingPlacementRows(ctx, staleAfter, tx, req, imageRef) → rows, err
  buildOnboardingPlanTx now 283 lines; the file 423 lines; follow-up: split (423 lines)
split internal/store/onboarding_plan.go: committed <sha>
<sha> my_editor: split into 1 file (internal/store/onboarding_plan.go)
<sha> my_editor: extract 1 helper from buildOnboardingPlanTx (internal/store/onboarding_plan.go)
```

and a clean `git status`. The refactor's body says `Coverage: no passing test ran buildOnboardingPlanTx at baseline; build, vet and the extract check are the net.` If a line differs, record why in the plan's *Dry run* section before going on.

- [ ] **Step 4: The second target, one phase.** Rerun with `internal/store/reporting_inventory_verification_step.go`, `StepReportingInventoryVerification` (452 lines) and the plan `[{"name":"stepSourcePhase","from":170,"to":209}]` → expected: committed, the helper line `stepSourcePhase(stepCtx, tx, campaignID, *p, *sourceAfter, err) → err; carries returns`, and the function still over 400 lines (one phase is not enough; the model's full plan takes more). A plan over the whole `switch` statement is expected to be refused for more than 6 parameters. Record what actually happens.

- [ ] **Step 5: Throw the scratch folder away.** `rm -rf "$W"`. Nothing to commit.

### Task 25: Docs and final verification

**Files:**
- Modify (repo root): `README.md`, `CHANGELOG.md`, `docs/progress.md`, `docs/plans/2026-10-11-ai-ready-refactor-design.md`

- [ ] **Step 1: README.** In the **AI-ready check** bullet, after the sentence about splitting long files, add: `In Go, a file over 400 lines because of one long function can be refactored first: the model picks runs of statements and names, my_editor writes them as helpers byte for byte, refuses what it cannot prove equivalent, checks the written file, runs build, vet and tests against the baseline, and splits the file in the same run.`
- [ ] **Step 2: CHANGELOG.** Above `## 0.0.13 alpha — 2026-10-11` add `## Unreleased` with: `- Go: a long function can be refactored into helpers on the fix branch, then its file split. The model only chooses which statements become helpers and their names; my_editor writes and checks them (types from go/types, an independent extract check, build, vet and tests against the baseline). A refactor is ticked only when the package's tests ran the function last time; refused ones are remembered for that content.`
- [ ] **Step 3: progress.md.** In the FR-090 row, after `dry-run on a copy of the dialer; live check pending.` add `Refactor of long Go functions (extract function) built and unit-tested (610 TS tests, goextract tests), dry-run on a copy of the dialer.`
- [ ] **Step 4: Design doc.** Status line: `Status: approved 2026-10-11; built 2026-10-?? (see plans/2026-10-11-ai-ready-refactor-plan.md, whose Decisions correct rules 4, 8, 10 and 11 and the dialer expectations).`
- [ ] **Step 5: Full verification**, from `overlay/extensions/my-editor-core`:

```bash
npx tsc --noEmit -p ./ && npm run -s compile >/dev/null 2>&1 && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'
(cd resources/goextract && GOTOOLCHAIN=local GOFLAGS= GOPROXY=off go test ./... && GOTOOLCHAIN=local GOFLAGS= go vet ./... && gofmt -l .)
(cd resources/goast && GOTOOLCHAIN=local go test ./...)
wc -l src/aiready/*.ts resources/goextract/*.go | sort -n | tail -4
git status --short
```

Expected: `ℹ pass 610`, `ℹ fail 0`; `ok  	goextract	…`; `ok  	goast	…`; nothing from gofmt; the largest file under 400 lines; a clean tree.

- [ ] **Step 6: Commit (local only).** `git add README.md CHANGELOG.md docs && git commit -m "Docs: refactor long Go functions on the fix branch"`
- [ ] **Step 7: Live check (only after the user confirms my_editor is closed):** `scripts/install.sh`, then on a Go project with a function over 400 lines in a package that builds: **Fix remaining files** → the picker shows `refactor \`F\` (N lines) into helpers, then split`, unticked with the coverage reason the first time; the approval modal lists the coverage command and the type-check note; afterwards `git log ai_fix` shows the extract commit, then the split. Do not push.

## Order and size

Estimated lines when each task is done; nothing reaches 400. If `build.go`, `rewrite.go`, `flow.go` or `checkbody.go` passes 380, split it by job (say `splice.go` out of `build.go`) rather than cramming.

| Task | Files (new unless marked) | Est. lines |
|---|---|---|
| 1 | `go.mod`, `main.go` (stub), `load.go`, `load_test.go`, `testutil_test.go`, `testdata/cases/**` (36 files) | 15, 150, 90, 95; cases 583 |
| 2 | `chunks.go`, `chunks_test.go` | 230, 120 |
| 3 | `vars.go`, `vars_test.go`, `shared.go`, `shared_test.go` | 170, 70, 240, 140 |
| 4 | `flow.go`, `flow_test.go`, `live.go`, `live_test.go` | 330, 110, 200, 130 |
| 5 | `jumps.go`, `jumps_test.go` | 260, 150 |
| 6 | `names.go`, `names_test.go` | 190, 100 |
| 7 | `typestr.go`, `typestr_test.go` | 220, 130 |
| 8 | `rewrite.go`, `rewrite_test.go` | 340, 190 |
| 9 | `callblock.go`, `callblock_test.go`, `build.go`, `build_test.go`, `testdata/want/*.go.txt` (18) | 160, 90, 360, 200; goldens 564 |
| 10 | `outline.go`, `outline_test.go` | 200, 100 |
| 11 | `check.go`, `check_test.go` | 300, 140 |
| 12 | `checkbody.go`, `checkbody_test.go`, `checkalpha.go`, `checkalpha_test.go`, `check.go` (mod) | 330, 90, 230, 80; 310 |
| 13 | `checksafe.go`, `checksafe_test.go`, `check.go` (mod) | 200, 110; 315 |
| 14 | `main.go` (mod), `main_test.go` | 150, 220 |
| 15 | `language.ts` (mod), `fixState.ts` (mod), `changeNote.ts` (mod), `aiReadyNote.test.ts` (mod) | 245, 125, 131 |
| 16 | `goBuildTool.ts`, `goExtract.ts`, `goExtractFixture.ts`, two test files | 70, 140, 40, 50, 70 |
| 17 | `goCover.ts`, `coverRecord.ts`, `refusedRecord.ts`, three test files | 30, 60, 80, 30, 50, 60 |
| 18 | `refactorPlan.ts`, `goRefactorPrompt.ts`, two test files | 60, 70, 60, 50 |
| 19 | `goRefactor.ts`, `goAdapter.ts` (mod), test file | 150, 150, 110 |
| 20 | `refactorOffers.ts`, `fixCandidates.ts`, `fixPicker.ts`, `fixSettled.ts`, `fixScreen.ts`, `stillOver.ts` (mod), tests | 40, 100, 70, 82, 115, 58 |
| 21 | `refactorText.ts`, `refactorStep.ts`, `steps.ts`, `fixScreen.ts` (mod), tests | 70, 220, 251, 125 |
| 22 | `coverageRun.ts`, `fixQueue.ts`, `fixSetup.ts`, `fixRun.ts` (mod), test | 100, 38, 195, 160, 90 |
| 23 | `changeNote.ts`, `fixRun.ts`, `fixLeft.ts`, `fixButton.ts`, `stillOver.ts` (mod), tests | 165, 165, 62, 58, 58 |
| 24 | scratch only | — |
| 25 | docs | — |

TS test count after each task: 570, 573, 579, 584, 588, 595, 603, 607, 610.

Related: [refactor design](2026-10-11-ai-ready-refactor-design.md), [Go plan](2026-10-09-ai-ready-stage2-go-plan.md), [Python plan](2026-10-10-ai-ready-python-plan.md).
