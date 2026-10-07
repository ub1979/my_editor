# Make a project AI-ready: design

- **Date:** 7 October 2026
- **Status:** approved design, not built. Revised after two spec reviews the same day.
- **Builds on:** Analyse (brain, summaries, part notes, draft architecture), the 400-line source policy, Pair's approved test runs

## Goal

When the user opens a project that my_editor did not create, offer to make it easier for AI models (and people) to
work on: every source file focused and within 400 lines, one class per file, a summary of every file, a project
brain and architecture, tests that pin current behavior, and a change note. The user must be able to see that the
program still behaves as before.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Where do changes go? | A new local Git branch, worked on in a separate Git worktree, one fix per commit | The user's open folder is never switched or dirtied; a branch is easy to review and to delete |
| Pushing | Never. Commits stay local until the user pushes or explicitly allows it | The user owns publishing |
| What may change? | Restructure only: split files and classes, add tests | Only behavior-preserving changes can be checked. Bugs and design problems are reported as suggestions |
| Proof of "nothing changed" | A span-exact move check (no AI), build and type check, and tests (existing plus new characterization tests) compared with a baseline | Tests alone are weak in projects with few tests |
| When a move is unsafe | Refuse that split and report why, instead of relying on the checks to catch it | Some meaning changes (import order, module identity) pass compilers and thin test suites |

## Two stages

The feature ships in two stages, each with its own implementation plan:

1. **Stage 1: health report.** The offer, Analyse, and the report. It changes no code and is useful on its own.
2. **Stage 2: fixes.** Worktree and branch, project commands and baseline, characterization tests, definition
   extractor, split, move check, step runner, and the change note.

## User flow

1. **Offer (stage 1).** Opening a folder that has code and no `.my_editor/` folder asks once:
   *Shall I get to know this project and make it AI-ready?* Choices: **Yes**, **Only get to know it** (Analyse as
   today), **Not now**. This replaces the current Analyse offer for such folders. A folder that has `.my_editor/`
   but no brain keeps today's offer. **Make This Project AI-Ready** in the Project view and the command palette starts
   the same flow at any time.
2. **Understand (stage 1).** Run Analyse as today: brain, file summaries, part notes, draft `architecture.md` and
   `tree.json` for Keep/Undo.
3. **Health report (stage 1).** Write `.my_editor/ai-ready/report.md` directly in the user's folder (it is
   my_editor's own record, like the brain, not a project file to Keep or Undo) and open it. No code changes. In
   stage 1 the report ends with the kinds of fix stage 2 will offer, without per-file promises.
4. **Pick fixes (stage 2).** A multi-select list of fixes from the report; safe ones pre-selected.
5. **Safety net (stage 2).** Prerequisites, worktree, approval of the exact commands, dependency install in the
   worktree, baseline, characterization tests.
6. **Fixes (stage 2).** One fix per commit. A fix that fails a check is undone and recorded as skipped.
7. **Close (stage 2).** Commit the change note on the branch, remove the worktree (the branch stays), and tell the
   user how to review, merge or delete the branch. After a merge, offer Analyse's incremental re-run to refresh the
   brain for changed files. The user's folder stays on its own branch throughout. Nothing is pushed.

## Health report (stage 1)

Deterministic findings, no AI:

- Source files above 400 lines, and at 360+ lines (`sourcePolicy`).
- More than one top-level class in a file (`classNames`; a match inside a multi-line string is a known false positive).
- Untested source files, for TS/JS, Python, Go and Rust only. A file counts as tested when a test file with its
  basename exists anywhere in the project (`foo.test.ts`, `foo.spec.js`, `__tests__/foo.ts`, `test_foo.py`,
  `foo_test.py`, `foo_test.go`), or, in Rust, when it contains a `#[cfg(test)]` module. Test files themselves,
  `.d.ts`, and config files (`*.config.*`, `setup.py`, `conftest.py`) are not checked.
- No test runner detected (`commandDetect.ts`, pure, from the project's root files: `package.json` `scripts.test`,
  `pytest.ini`/`pyproject.toml`/`conftest.py`, `go.mod`, `Cargo.toml`).
- Coverage gaps from Analyse (files too large, generated, or beyond limits).

AI findings, per part (Analyse's part grouping), from file summaries and bounded source excerpts, using the chat's
chosen model:

- A file doing more than one job, with a proposed grouping of its definitions.
- Design problems: tangled responsibilities, duplicated logic, a pattern that would simplify the code.
- Likely bugs and poor code, labelled **suggestion**. This skill never fixes them; the report tells the user to ask Pair about it.

Limits for the AI review:

- At most 40 model calls per run. Parts are reviewed in order of their deterministic findings, most first, then by
  size. Unreviewed parts are listed in the report.
- Each call gets one part: file summaries plus excerpts of up to 6,000 characters per file, with line numbers. The
  excerpts start with each file's flagged regions (long or multi-class files), then its beginning.
- Analyse's sensitive-file exclusion and secret redaction apply.
- Reply schema: a JSON array of `{file, line, kind, text, grouping?}`, where `kind` is `mixed-job`, `design`,
  `bug` or `poor-code`. A reply that doesn't parse gets one retry, then the part is marked *not reviewed*.
- Stop writes the report with what was finished and marks it partial.

The host keeps an AI finding only if its file was in the call and its line falls inside an excerpt the model saw.

Report layout: summary counts first; then per file: line count, classes, test status, findings with `path:line`
links; then suggestions; then the fix kinds stage 2 offers. Stage 2 adds per-file plans and refusals when it runs.

## Safety net (stage 2)

**Prerequisites**, each stopping with a plain message:

- The folder is a Git repository with at least one commit (offer `git init` and an initial commit if not).
- Tracked files have no uncommitted changes (`git status --porcelain --untracked-files=no`). Untracked files are
  ignored; the worktree starts from the last commit, so they don't affect the run.
- The branch name `my_editor/ai-ready` is free, else `-2`, `-3`…

**Worktree.** `git worktree add <parent folder>/<project name>.ai-ready -b <branch> HEAD`, next to the project, so
relative paths that leave the repository (Go `replace ../x`, npm `file:../x`, `tsconfig` `extends: ../`) still
resolve. If that folder exists, add `-2`, `-3`…; if the parent folder is not writable, stop with a plain message. All commands, edits and
commits happen there. The user's folder, its branch and its open editors are not touched. At close,
`git worktree remove`. After a crash, Continue finds the worktree from saved state, or `git worktree prune` and
re-adds it from the branch.

**Run state** lives in the extension's global storage, keyed by project path: branch, worktree path, approved
commands, baseline, chosen fixes, step index and results. Nothing is written to the project during the run. Only the
change note is committed on the branch, at close.

**Commands.** Detected from project files and approved once as exact text. They run without a shell, in the worktree,
through a new runner: per-command timeout (default 10 minutes, a setting), full output saved to a log file in run
state, and a bounded tail shown in Pair. Pair's `run_tests` allow-list is not reused.

| Language | Install in worktree | Build / type check | Tests |
|---|---|---|---|
| JS/TS | `npm ci` (or `pnpm`/`yarn` per lockfile) | `npx tsc --noEmit` when `tsconfig.json` exists | `npm test` only if `scripts.test` is defined |
| Python | none; uses the interpreter the user picks once | `python -m compileall -q` on tracked `.py` files | `pytest -q -rA` |
| Go | none (module cache) | `go build ./...`, `go vet ./...` | `go test -json ./...` |
| Rust | none (cargo cache) | `cargo check` | `cargo test` |

With no test command, fixes run on the move check and build only, and the change note says so.

**Python import check.** Before the baseline, run the interpreter in the worktree to print `__file__` for the
project's top-level packages. If any resolves outside the worktree (an editable install, a `src` layout), retry
with `PYTHONPATH` set to the worktree (or its `src`). If it still resolves elsewhere, Python splits are refused for
this run, because tests would check the user's folder instead of the branch.

**Baseline.** Run build and tests twice on the untouched worktree. Per-test results are parsed where the format
allows (`go test -json`, `pytest -rA`, Node's TAP, Jest and Vitest summaries, `cargo test`), otherwise counts and
exit code. A test whose result differs between the two runs is marked **flaky** and excluded from comparison.
Failing tests are recorded and must fail the same way later.

**Characterization tests.** For each file chosen for a split, the model writes tests of its exported functions and
classes asserting today's results. They must pass twice on the original code. One retry with the failure shown;
otherwise that file has *no new tests*, its split relies on the move check and build, and the report says so.
Passing tests are committed first. Placement: next to the source by the project's convention (TS/JS, Python), in the
package directory (Go). Rust: none in this version.

## Fixes (stage 2)

**Languages.** Splits run for TS/JS and Python in this version. Go and Rust get the report, brain and (Go) new
tests; their split rules (init order, build tags, `mod` declarations, visibility, macros) come later.

**Definition extractor** (new, per language). It returns each top-level definition's name, kind, and exact byte span
including its doc comment, decorators and leading attributes. It also returns the names each definition references
(including names inside Python string annotations) and what the module exports, including `export default`,
`export =`, CommonJS `module.exports`, and Python `__all__`, constants and `_private` names.

**Split plan.** The model proposes which definitions move to which new file and writes only each new file's import
lines. The host:

- copies each definition span byte for byte;
- deletes the spans from the original;
- adds a re-export facade to the original (`export { … } from './x'`, with `export type { … }` for types;
  `from .x import …`), so callers don't change.

**Refuse to split** (reported, not attempted) when:

- a moved definition references a name that stays in the original (that would need an import back into the original,
  a cycle with the facade). The plan must move such helpers together, or the split is refused;
- a non-exported helper would be used from two new files (it would need a new `export`, which edits its span). It
  must move to the same new file as every definition that uses it, or the split is refused;
- a moved span is not a function, class, interface or type declaration, or a constant with a literal initializer
  (top-level statements, side-effecting initializers and import-time code keep their order);
- Python: the moved code uses `global`, `__name__`, `__module__`, `__file__`, `getLogger(__name__)`, pickling or
  registration decorators; the file is not in a package (relative imports); or the module defines `__all__` and the
  facade would change what `import *` exports;
- the file has a shebang, encoding cookie, or tool directives (`@ts-nocheck`, `eslint-disable` at file level,
  `# type:` pragmas) that the new files would need.

**Move check** (pure, no AI), per step:

1. Each moved span appears contiguous and byte-identical in exactly one new file.
2. The original minus the moved spans equals its new content, except the added facade lines and named import
   specifiers that nothing left in the original uses, in TS/JS only (side-effect imports such as `import './x'`
   always stay). Python keeps every import, because each imported name is also an attribute callers may use.
3. A new file contains only its moved spans, its import lines and an optional header comment.
4. The original path exports every name it exported before (the extractor runs on both versions).
5. No other tracked file changed (`git status` in the worktree, tracked files plus the step's new files only).

**New-test fixes** add only files under test paths, change no source file, and must pass twice.

**Every step then runs** build and tests. Results must equal the baseline (flaky tests excluded; new tests passing).
On failure, the model gets the error once to correct import lines only; the host re-checks. If it still fails, the
step's files are restored (`git checkout -- <paths>`, new files removed), the reason is recorded, and the run moves
on. A passing step is committed as `my_editor: <what> (<file>)` with check results in the body, under the user's Git
identity.

A run handles at most 25 fixes. **Continue** resumes from saved state.

## Records

- `.my_editor/ai-ready/report.md`: written in the user's folder (stage 1, updated by stage 2). Never committed by
  this feature.
- Run state and command logs: extension global storage, not the project.
- `.my_editor/changes/ai-ready-<date>-<time>.md`: the only `.my_editor` file the branch commits, at a new path, so a
  merge cannot collide with the brain, report or other untracked `.my_editor` files in the user's folder. It lists
  each commit, what moved where, checks passed, flaky tests excluded, skipped and refused fixes with reasons,
  suggestions left for the user, and how to review (`git diff <base>..<branch>`).
- The branch does not commit brain files. After a merge, Analyse's incremental re-run (offered at close) refreshes
  them.

## Components (extension `src/aiready/`)

| Unit | Stage | Job | Interface |
|---|---|---|---|
| `offer.ts` | 1 | Which offer a folder gets (pure); `chat/analysisOffer.ts` does the file checks | `offerKind(hasMyEditorFolder, hasBrain): 'ai-ready' \| 'analyse' \| undefined` |
| `commandDetect.ts` | 1 | Which build and test commands a project has | `detectCommands(rootFiles): DetectedCommands` (pure) |
| `health.ts` | 1 | File stats, test-file matching, deterministic findings | `fileStats(path, text)`, `scanHealth(stats, allPaths, commands, notCovered): HealthFinding[]` (pure) |
| `healthReview.ts` | 1 | Excerpts, reply parsing, the per-part review loop | `reviewParts(parts, ask, limits, cancelled): Promise<ReviewResult>` (model call passed in) |
| `report.ts` | 1 | Render `report.md`, escaping model text | `renderReport(input): string` (pure) |
| `healthRun.ts` | 1 | Run Analyse, then scan, review, write and open the report | `makeAiReady(keys, proposals, sink, token)` |
| `definitions.ts` | 2 | Per-language definition extractor | `extractDefinitions(path, text): Definition[]` (pure) |
| `split.ts` | 2 | Validate a split plan, apply it, build the facade | `planIssues(plan, defs): string[]`, `applySplit(...)` (pure) |
| `moveCheck.ts` | 2 | The five move rules | `checkMove(before, after): string[]` (pure; empty means pass) |
| `projectCommands.ts` | 2 | Approve and run detected commands; parse test output | `run(cmd, cwd, timeout)`, `parseResults(...)` |
| `worktree.ts` | 2 | Prerequisites, worktree, commit, restore, remove. No push or remote operation | `prepare(root)`, `commit(...)`, `restore(paths)` |
| `steps.ts` | 2 | Fix queue; one step through checks to commit or restore | `runStep(step, ctx): StepResult` |
| `runner.ts` | 2 | Orchestrate, progress in Pair, Stop and Continue, run state | `startAiReady()`, `continueAiReady()` |
| `changeNote.ts` | 2 | Render the change note | `renderChangeNote(state): string` (pure) |

Each file stays under 400 lines with one job, following the rule the feature enforces.

## Testing my_editor's implementation

- Stage 1 unit tests: health scan (sizes, classes, test matching by basename per language, excluded files),
  command detection, parsing and location checking of AI findings (a line outside the shown excerpt is dropped),
  report rendering including partial and not-reviewed parts, and the offer choice for each folder state and answer.
- Stage 2 unit tests for `moveCheck`:
  - pass: a clean split;
  - fail: an edited body, lines reordered between definitions, an `export const X = 1` changed to `= 2`, a dropped
    export, an extra file changed, a span split across files.
- Stage 2 unit tests for `split.ts` refusals: a helper left behind (cycle), a side-effecting initializer, Python
  `global` and `__name__`, `__all__`, a shebang.
- Stage 2 unit tests for the rest:
  - extractor spans: doc comments, decorators, `export default`, CommonJS, `__all__`, string annotations;
  - unused import specifiers removed from the original, side-effect imports kept;
  - the Python import check with an editable install;
  - test-output parsers;
  - flaky detection;
  - a guard test that `worktree.ts` never builds a `push`, `fetch` or `remote` command.
- Fixtures: a 600-line TypeScript file with two classes and a helper, and a long Python module. Run end to end with a
  real model in a dev host. Expect:
  - the branch builds and its tests match the baseline;
  - one commit per fix;
  - the user's folder is unchanged and on its original branch;
  - no remote change.
- The user's live check on a real foreign project in the installed app.

## Out of scope for this version

- Fixing bugs or changing behavior.
- Renaming public names.
- Updating callers to the new paths.
- Comment-only fixes (file summaries live in the brain instead).
- Splits in Go, Rust and other languages.
- Rust test generation.
- Mutation testing or coverage tools.
- Running the app to compare outputs.
- Pushing or opening pull requests.

Related: [plan v2](my_editor-plan-v2.md), [vision and status](../vision-and-status.md), [development](../development.md).
