# AI-ready: refactor long functions (design, Go first)

Status: revised after one adversarial review; approved by the user 2026-10-11 (refactors ticked only when tests run the function).

## Why

The fixer only moves whole declarations, byte for byte. A file over 400 lines whose excess is one huge function
(`main` 961 lines, `ServeHTTP` 559, `StepReportingInventoryVerification` 452, `buildOnboardingPlanTx` 401 in the
dialer) is reported as "needs a real refactor" and left alone. The user asked my_editor to do that refactor too.

The promise stays the one splits make: **the program does the same thing afterwards, and my_editor can show why**.
So this is not "the AI rewrites the function". It is the one refactor that can be done mechanically and checked:
**extract function**. The model only chooses which runs of statements become helpers and what they are called;
my_editor writes the helpers, with the statements copied byte for byte apart from a short list of mechanical
rewrites, refuses what it cannot prove equivalent, and runs the same build, vet and tests against the baseline as a
split. The same run then splits the file (the helpers are ordinary movable declarations): one click takes the file
under 400 lines or says why not.

## Scope

- Go only (the dialer). TS/JS and Python later, one language at a time.
- Functions and methods over 400 lines that `needsRefactor` settles. Not types, var/const blocks, generated, cgo or
  test files, generic functions, or functions with `//go:` directives.
- Only where the package's verifying compile check passed at baseline. On the dialer today: the two `internal/store`
  files. `cmd/dialer/main.go` and `internal/api/metrics.go` need onnxruntime first.

## The plan the model makes

Input: the function with line numbers and an outline: each block's statements with line ranges, the variables they
declare, and for every candidate boundary the inputs/outputs the tool would compute. Reply: JSON
`[{ "name": "queryOnboardingPlacementRows", "from": 177, "to": 295 }, …]`.

A **chunk** is a run of consecutive statements of one block of the function itself (the body or a nested block,
**never inside a function literal**), whole lines from the first statement's first line to the last statement's last
line, sharing no line with a statement outside it. Chunks don't overlap or nest. Plan problems (one retry, as for
splits): not statement boundaries of one block; a refused rule (named with the line); an interface too wide (more
than **6 parameters**, counting ctx, not the receiver; more than **3 outputs**, not counting the return plumbing);
a name that is not fresh (below); **the function not ending at ≤ 400 lines** (its `Lines`, doc comment included), or
a helper over 400. Each problem says the number of `(*x)` sites a chunk would need, so the model can move boundaries.

## How a chunk becomes a helper

Types come from `go/types` on the package, offline: export data from `go list -export -deps -json` and the `gc`
importer, stdlib only (prototype on the dialer's `internal/store`: 124 files, 232 deps, about 1.1 s warm).
Everything below is resolved **by object** (`types.Info.Defs/Uses/Implicits`, `Selections`), never by name.
**Outer locals** are the function's receiver, parameters, named results, and locals declared before the chunk in an
enclosing block of the function.

1. **Liveness, not mere use.** Input: an outer local that may be read before it is written on some path from the
   chunk's entry. Output: an outer local the chunk may assign (below) that may be read after the chunk (used after
   it, or anywhere in an enclosing loop). An output not definitely assigned on every non-returning path is also an
   input.
2. **Assignments through value paths count.** An outer local is assigned when it is the root of an assignable
   operand reached through field or array-index steps only (`cfg.Timeout = 5`, `arr[i] = v`, `x.f++`,
   `x.f, err = g()`), in every form: `=`, `op=`, `++`/`--`, `range` with `=`, `select` receive with `=`.
3. **Shared variables go by pointer.** An outer local is passed as `*T` when it is captured by any function literal
   in the function, or address-taken before or inside the chunk or anywhere in an enclosing loop: an explicit or
   implicit `&` (`Selections[].Indirect`, pointer-receiver method sets, method values) on the variable or on a path
   from it through fields or array indexes **without crossing a pointer** (`&plan.F` with `plan *T` does not
   address-take `plan`); slicing an array path; or its type contains a lock or `noCopy`. **If the function has any
   `defer`, every named result goes by pointer** (a deferred `recover` may return them after a panic in the helper).
   In the body each use becomes `(*x)`, except as the operand of a field selector when the variable's type is a
   struct, or a method call when it is a named non-pointer, non-interface type. Never dropped in `range`, type
   assertions, type switches, comparisons, or as a value. `&(*x)` is written `x`. Pointer params are not returned.
4. **Returns.** The helper's results are `outputs…, done bool, the function's results…`. `return e1, e2` becomes
   `return outputs…, true, e1, e2`; `return f()` with a multi-value `f` becomes `r1, r2 := f()` then that return; a
   bare `return` returns the named results (by rule 3, pointers when the function defers). At a done-return, output
   slots for chunk-declared variables not yet declared are zero values. The natural end returns
   `outputs…, false, zeros…` (untyped `0`, `""`, `false`, `nil`, or `T{}` by underlying type), and is omitted when
   the chunk ends in a terminating statement. A chunk that is the tail of the function body becomes `return h(…)` and
   its helper has just the function's results.
5. **`break`/`continue` to the natural end.** A `break` targeting the enclosing `switch`/`select`, or a `continue`
   of the enclosing loop, is allowed only when the chunk runs to the end of that clause or loop body: it becomes the
   natural-end return. Any other jump out of the chunk (`break`/`continue` elsewhere, `goto`, `fallthrough`, a label
   used from outside) is refused; so is a `goto` before the call to a label after it.
6. **Chunk-declared variables.** Those used after the chunk become outputs, declared before the call. Refused when
   such a variable is captured or address-taken inside the chunk, when a chunk-level declaration has the same name as
   an input, output, pointer param or the receiver, and when a chunk-declared `const` or `type` is used after it.
7. **Methods.** The helper is a method on the same pointer receiver only when the chunk uses the receiver; otherwise
   a function. A value receiver is an ordinary input.
8. **Names.** Helper and plumbing names must be absent from every scope of the function, from the package scope,
   from the receiver type's fields and method set including promoted members, and from the methods of the package's
   interfaces. Parameters are ordered receiver, `ctx`, then by first read, `err` last.
9. **Types written in the file.** Each type is written as its source text where one exists (aliases survive),
   qualified by the file's own import names (empty for dot imports), checked at the position it is written for a
   shadowing local (`errors`, `json`, `time`…), variadics as `[]T`. Refused when a type can't be written: a
   function-local type, a package the file doesn't import, an unexported type of another package.
10. **Call block.** With no outputs: `if done, r1, r2 := h(…); done { return r1, r2 }`. Otherwise fresh plumbing
    names; `:=` only when every output is declared in that same block, else `var` lines then `=`.
11. **Layout.** Helpers go right after the function, in chunk order, each with `// name is part of F, extracted by
    my_editor.`. Lines are re-indented only where the line's first byte is outside a multi-line raw string or
    `/* */` comment. The original file must be gofmt-clean; the result must be too.

**Refused besides the above:** `defer` or `recover()` in a chunk; a `go` statement whose call or function literal
uses an outer local; assigning a pointer receiver itself. `runtime.Caller`-style frame lookups are allowed and listed
under "What may differ" with `log.Lshortfile`, slog `AddSource` and stack traces.

## The extract check

Separate code from the builder, run on the files as written, verifying the actual result rather than re-deriving it
with the builder's classifier:

1. **Outside the chunks, nothing changed, in place**: before and after are equal once each chunk is replaced by a
   marker `⟨chunk i⟩` in the original and each call block by the same marker in the new function, and the helpers
   are removed. Compared token by token with comment text, ignoring only the padding before trailing comments.
2. **Each helper body is exactly its chunk plus the allowed rewrites**: the expected body is computed from the chunk
   and the helper's actual signature (`(*x)` at every use of a pointer param, per the type-based selector rule; each
   return rewritten with its exact output list in call-site order; allowed `break`/`continue` rewrites) and compared
   for equality.
3. **Alpha-equivalence**: every identifier in a helper resolves to the same package or universe object as in the
   chunk, to the parameter standing for the same outer local, or to the matching chunk-local definition. Every call
   block assigns each result back to the outer local it stands for, in order.
4. **Safety predicates on the actual signature**: each by-value parameter is never address-taken (rule 3) anywhere
   in the function, never captured, and not a named result of a function with a `defer`; each pointer parameter is
   dereferenced at every use.
5. The package type-checks; its declarations other than the function and the new helpers are unchanged; gofmt
   leaves the file unchanged.

Then the package's checks run against the baseline as for a split (`go build`, `go vet` with new lines compared,
`go test` test by test). Any failure restores the worktree and records the step as refused, with the reason.

## Tests as a second net, honestly

The baseline runs `go test` with `-coverprofile`. The commit and change note say whether any passing test executed
the function's lines. On the dialer, every test reaching both targets is an integration test that skips without a
database, so build, vet and the extract check are the whole net there, and the note says so.

## In a run

- `FixKind` gains `'refactor'`; the Go adapter lists it. `Candidates.unsplittable` keeps meaning "a split alone
  can't help"; when the adapter offers `refactor`, those files become refactor offers ("refactor `main` (961 lines)
  into helpers, then split"). `SETTLED_RULES` is unchanged.
- **Ticked** only when the last baseline's coverage shows the package's tests executing the function (the user's
  choice); otherwise **unticked** with "no test here runs `F` yet; build, vet and the extract check still apply". The
  picker runs before the baseline, so it reads the coverage the previous run recorded (like `checks.json`); with no
  record yet the refactor is unticked. Coverage comes from one extra approved command per package with a refactor
  offer, `go test -count=1 -coverprofile=<run dir>/cover-<n>.out <pkg>`, run in the baseline; the split checks stay
  as they are.
- A refused refactor is remembered by blob with its reason, so the next picker shows it unticked with "an earlier run
  could not refactor it: …", never ticked again and again.
- After a refactor commit the same run screens the file again and, when splittable, runs the split next.
- Commit `my_editor: extract 7 helpers from StepReportingInventoryVerification (…)`, body listing each helper's
  parameters (pointer ones marked), outputs, whether it carries returns, the extract check, coverage and checks.
- Change note: a "Refactored" section; "What may differ" adds helper frames in stack traces and frame lookups, and
  inlining/escape analysis (a pointer-passed variable moves to the heap): speed and allocations, not results.
- The Project card counts refactor offers with the splits left; "stuck" is only what can't be checked here and
  refactors refused for the current content.

## Expected on the dialer (from the review)

- `buildOnboardingPlanTx` (401 lines): one helper `queryOnboardingPlacementRows`, lines 177–295 (params `ctx, tx,
  staleAfter, req, imageRef`; outputs `rows, err`; no returns, no pointers). The function becomes about 284 lines;
  the file then splits.
- `StepReportingInventoryVerification` (452 lines): one helper per phase case of its switch (7 helpers, each ≤ 6
  params, ≤ 3 outputs; `p`, `resultErr`, `durableProgress` by pointer because the deferred closure captures them).
  The function becomes about 250 lines and the switch reads as dispatch. This needs rules 1, 4 and 5 as revised.
