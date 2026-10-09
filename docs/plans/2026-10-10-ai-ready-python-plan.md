# AI-ready Stage 2c (Python splits on a local branch) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AI-ready fixer splits oversized Python modules on its local branch, exactly within the design's *Version 1 scope*: whole top-level definitions move byte for byte into new modules in the same package, the original keeps a facade (`from .rows import a as a`) right after its leading imports, and each split is committed only after a host-side move check, the shipped import check, the project's type checker and its tests match the baseline. The add-tests fix also works for Python.

**Architecture:** One more `LanguageAdapter` (`src/aiready/pyAdapter.ts`), registered in `languages.ts` after Go and TS/JS. Parsing runs host-side in a stdlib-only helper shipped in `resources/pyast/`, run with the project's own interpreter as `python -I -S` (no site, no `.pth`, no project code); the TypeScript side reads its JSON and decides every rule. The import check (`python -m my_editor_pycheck <module>`) is the split's verifying check. The model only proposes groups of declaration IDs. The core gets a few optional, language-neutral hooks and never imports a Python module.

**Tech Stack:** TypeScript (strict, CommonJS), `node:test`, Python 3.9–3.14 stdlib (`ast`, `tokenize`, `symtable`, `importlib`), `unittest`, Git worktrees, the project's pytest/unittest/Django runner, mypy or pyright when configured.

**Spec:** [Python design](2026-10-10-ai-ready-python-design.md), section *Version 1 scope* and everything it refers to, plus the adversarial reviewer's four non-blocking points (each implemented and tested, see *Decisions*). Models for detail and style: [TS/JS plan](2026-10-09-ai-ready-ts-plan.md), [Go plan](2026-10-09-ai-ready-stage2-go-plan.md).

**Base:** branch `ai-ready-go` at `4dc2584`, where `npm test` reports `ℹ pass 280`. The plan was dry-run task by task on a copy of that tree (see *Dry run of this plan* at the end).

---

## How the design's components map to files

The design's table has eleven units; several would pass 400 lines, so they are split by job. Same jobs, these files:

| Design unit | Built as | Why |
|---|---|---|
| `resources/pyast/my_editor_pyast.py` | `my_editor_pyreads.py` (global reads, bindings, `__file__` forms, namespace access), `my_editor_pyfacts.py` (resolution by binding, purity, decorators, bases), `my_editor_pyast.py` (leading block, spans, declarations, the JSON) | One job each, all under 400 lines; written for 3.9 syntax |
| `resources/pyast/my_editor_pycheck.py` | same | It imports `my_editor_pyast` to read the original and its new modules |
| `pyInterpreter.ts` | same, plus `pyPick.ts` (the quick pick, the only file importing `vscode`) | `languages.ts` stays free of `vscode` and testable |
| `pyAst.ts` | same | |
| `pyProject.ts` | `pyConfig.ts` (TOML/INI settings, requires-python, dependencies, tool config naming a file), `pyScan.ts` (pattern scans of tracked files: pickling, `__module__` readers, scripts, folder scans, patches, reloads, `sys.modules`), `pyProject.ts` (import roots, module names, project skips, commands, env, `ready`) | Over 500 lines together |
| `pyRules.ts` | same: skip reasons, movability, the quiet window, the neutral view, file names | |
| `pySplit.ts` | `pyImports.ts` (filtered import text, the facade line, the rebuilt original) and `pySplit.ts` (name rules, patches, new files) | |
| `pyMoveCheck.ts`, `pyTests.ts`, `pyPrompts.ts`, `pyAdapter.ts` | same | |

## Decisions made while planning

Where the code had to differ from the design's words, this is what it does and why. Each was found by the dry run or a probe.

- **`CheckCommand.env` is threaded through the runners.** `BaselineRunner.check`, `StepContext.check` and `fixSetup.runCheck` take the check's own env as a third argument and merge it over `commandEnv`; only the import check uses it (the helper folder on `PYTHONPATH`).
- **Three more optional adapter hooks:** `blankLines` (`longest`, as the design asks for black), `approvalNote` (the modal shows the interpreter's path, version, `sys.prefix`, `requires-python` and env, which the design asks for but the core had no place for), and `testOutput: 'both'`, because `unittest -v` and `manage.py test` report on stderr and the core parsed stdout only.
- **`runSetup` asks `ready()` even with no setup commands.** Python installs nothing, but `ready()` must still prove the packages import from the worktree; one line of an existing core test changes from `undefined` to the message.
- **The quiet-call allowlist takes literal arguments only, plus `__name__` for `logging.getLogger`** (reviewer point 3), narrower than the design's "names bound by imports": `warnings.filterwarnings('ignore', category=DeprecationWarning)` is not quiet.
- **A clean fallback failure** (design: `ModuleNotFoundError` for exactly the module): the `ModuleNotFoundError` may name the module or one of its parent packages (nothing of either ran), and (reviewer point 1) a plain `ImportError` is also clean when its `name` is the module the statement imports from, that module finished loading and has no module `__getattr__` (`try: from yaml import CSafeLoader`).
- **The scratch run is a plain dict, never registered in `sys.modules`** (reviewer point 2). A leading import that comes back to the original therefore imports the real module during the scratch run; the check then fails with *A leading import of pkg.report imports pkg.report back (an import cycle)*. That is safe: the baseline check fails, the core skips the split with that line, and the change note says so. It also means an `__init__.py` whose leading block has a relative import always fails the check and is never split.
- **The import check also compares with the scratch namespace.** After the real import, every name a new module imports must be the same object as the scratch run bound, not only as the original binds: the scratch run already applied any side effect once, so comparing with the original alone cannot see an import that monkeypatches a module between the original's import and the facade (the design's test case).
- **`PICKLING_LIBRARIES`** (reviewer point 4) in `pyConfig.ts`: dill, cloudpickle, joblib, jsonpickle, celery, rq, dramatiq, ray, dask, distributed, torch, multiprocess, pathos, loky, huey, arq, read from `[project]` dependencies and optional dependencies, Poetry dependency tables, `requirements*.txt` and `setup.cfg` `install_requires`, PEP 503-normalized.
- **Test keys get parent keys** (`file Class`, `file Class/test`) with the worst outcome below them, like Go's parent tests, so the core's `unverified` and `belongsTo` find a new test class or a parametrized test by its top-level name; the "N of N tests" count includes those parent keys.
- **Project scans are patterns over tracked text in TypeScript**, as the design allows ("by pattern"); per-file facts come from the helper. A non-literal folder scan (`some_path.glob(...)`) skips every module at and below the scanning file's folder.
- **A file's own `from __future__ import annotations` defers its annotations** as the design says; the project-wide switch is the `requires-python` lower bound.
- **`find_spec(name).origin` must be the file** is checked by the import check at run time (the origin must be inside the worktree), not when parsing, so no project code runs before approval. The 3.9 stdlib list is read from the interpreter's own stdlib folder instead of a shipped list.
- **Comments that reach the file's first line are its header** (shebang, encoding cookie, license) and never attach to the first declaration; a comment run after a blank line does, so a new module's split header stays apart from a commented constant moved into it, and the facade of a file without imports goes before the first declaration's comments. Found by plan review: without it, a commented constant moved into a module with no imports failed move rules 1 and 3.
- **The parser helper runs as `python -I -S -B`.** `-I` ignores `PYTHONDONTWRITEBYTECODE`, so without `-B` the helper's own modules would get a `__pycache__` in the extension's `resources/pyast`.
- **mypy runs as `python -m mypy --no-error-summary --no-color-output`**: the summary line counts checked files, which a split changes.
- **Add-tests for Python asks for `unittest.TestCase` classes named `TestAi…`** (pytest runs them too, `unittest discover` only finds classes); a failing class is dropped by its span through `buildSplit` on the skipped test file, which then removes spans without a facade.

## Ground rules for every task

- Work in `overlay/extensions/my-editor-core/` unless a path says otherwise. Paths are relative to it.
- Tabs, one short `/** … */` line on exported functions, the surrounding comment density. No file over 400 lines and no new line over 160 characters; `src/chat/view.ts` stays at 399 and is not touched. Python helpers use four spaces, stdlib only, Python 3.9 syntax (no `match`, no `X | Y` at run time).
- Pure modules must not import `vscode`. Only `fixSetup.ts`, `fixRun.ts`, `healthRun.ts` and the new `pyPick.ts` import it.
- `npm test` compiles to `out-test/` and runs every test. The Python-backed tests find `python3` on PATH and skip themselves without it. Helper tests run with `python3 -m unittest` in `resources/pyast`, with `PYTHONDONTWRITEBYTECODE=1` so no `__pycache__` appears.
- Commits stay **local**. Never run `git push`, `git fetch` or any remote command.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/aiready/language.ts` | modify | `CheckCommand.env`; optional `blankLines`, `approvalNote`, `testOutput` |
| `src/aiready/projectCommands.ts` | modify | `findTool` searches a command env's PATH first; `runCommand` uses it |
| `src/aiready/baseline.ts` | modify | pyright positions; `runSetup` asks `ready()` with no commands; the runner gets each check's env |
| `src/aiready/moveCheck.ts` | modify | `collapse` exported, with the `longest` mode |
| `src/aiready/steps.ts`, `fixSetup.ts`, `fixRun.ts`, `fixText.ts` | modify | Pass each check's env and the blank-line mode; the approval note; stderr for test output |
| `resources/pyast/my_editor_pyreads.py` | new | Global reads (AST and `symtable`), bindings, `__file__` forms, namespace access, main guard, late imports |
| `resources/pyast/my_editor_pyfacts.py` | new | Names resolved by binding, purity, decorator, base and class-body rules |
| `resources/pyast/my_editor_pyast.py` | new | One file's JSON: byte facts, leading block, declarations with spans and facts |
| `resources/pyast/my_editor_pycheck.py` | new | The import check |
| `resources/pyast/test_py*.py` | new | Helper tests (`unittest`) |
| `src/aiready/pyAst.ts` | new, no vscode | The helper's JSON types; run it |
| `src/aiready/pyInterpreter.ts` | new, no vscode | Candidates, the remembered pick, probe, version gate, command env, approval note |
| `src/aiready/pyConfig.ts`, `pyScan.ts`, `pyProject.ts` | new, no vscode | Tool config, tracked-file scans, the project, commands, `ready` |
| `src/aiready/pyRules.ts` | new, pure | Skip reasons, movability, quiet window, neutral view, file names |
| `src/aiready/pyImports.ts`, `pySplit.ts` | new, pure | Filtered imports, facade, original; name and patch rules, new files |
| `src/aiready/pyMoveCheck.ts` | new, pure | Rule 2's import part, rules 4 and 6 |
| `src/aiready/pyTests.ts`, `pyPrompts.ts` | new, pure | pytest and unittest output, test names and problems; the prompts |
| `src/aiready/pyAdapter.ts` | new, no vscode | The Python `LanguageAdapter` |
| `src/aiready/pyPick.ts` | new, vscode | The interpreter quick pick and **AI-Ready: Choose Python Interpreter** |
| `src/aiready/languages.ts`, `src/extension.ts`, `package.json`, `tsconfig.test.json` | modify | Register Python; the command |
| `test/pyFixture.ts`, `test/aiReadyPy*.test.ts` | new | Fixtures and tests; each reviewer probe p1–p7 is a named case |
| `test/aiReadyCore.test.ts`, `aiReadyRunText.test.ts`, `aiReadyTsSteps.test.ts` | modify | One line each: `ready()` with no setup; `.py` is now fixable |

The reviewer's probes map to tests as follows. **p1** (an `importlib.import_module` that imports the original back, a `logging` setting, a `try`, a logging call before `HELPER` and `_CONST`): `test_pyast.py` *Quiet* and `aiReadyPyRules.test.ts` *reviewer probe p1*. **p2** (a thread started before `_CONST`): the same two plus the quiet-window test. **p3** (a fallback whose module fails half way, and a module run with `-m`): `test_pycheck.py` *fallback that failed half way* and *leading import cycle*, `aiReadyPyProject.test.ts` scripts. **p4** (doctest, a warnings filter by module): `aiReadyPyRules.test.ts` and `aiReadyPyProject.test.ts` *p4*. **p5** (a spawn pool pickling a moved function): `aiReadyPyProject.test.ts` *p5* and `aiReadyPyRules.test.ts` *p4 and p5*. **p6** (a lazy package `__getattr__`): `aiReadyPyProject.test.ts` *p6* and `test_pycheck.py` *lazy package*. **p7** (`def f(m=lib.heavy)` and an editable install): `test_pycheck.py` *attribute read when defined*, `aiReadyPyRules.test.ts` *p7*, `aiReadyPyProject.test.ts` *p7*.

## Chunk 1: Language-neutral core changes

### Task 1: Per-check env, a command env's PATH, blank runs of two, and three optional hooks

**Files:**
- Modify: `src/aiready/language.ts`, `src/aiready/projectCommands.ts`, `src/aiready/baseline.ts`, `src/aiready/moveCheck.ts`, `src/aiready/steps.ts`, `src/aiready/fixSetup.ts`, `src/aiready/fixRun.ts`, `src/aiready/fixText.ts`
- Create: `test/aiReadyPyCore.test.ts`
- Modify: `test/aiReadyCore.test.ts`

Go and TS/JS keep working unchanged: every hook is optional, the default blank-line mode is the old one, and a check without `env` runs as before.


- [ ] **Step 1: Write the failing tests.**

Create `test/aiReadyPyCore.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CheckResult, failureLines, runBaseline, runSetup } from '../src/aiready/baseline';
import { approvalDetail } from '../src/aiready/fixText';
import type { Declaration, FileInfo, ParsedFile, Span } from '../src/aiready/language';
import { checkMove, collapse } from '../src/aiready/moveCheck';
import { runCommand } from '../src/aiready/projectCommands';

test('runCommand finds the program on the command env PATH before the process PATH', async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-bin with space-'));
	writeFileSync(path.join(dir, 'python'), '#!/bin/sh\necho "fake python $1"\n');
	chmodSync(path.join(dir, 'python'), 0o755);
	const out = await runCommand('python -V', { cwd: dir, approved: ['python -V'], timeoutMs: 10_000, logFile: path.join(dir, 'log.txt'), env: { PATH: dir } });
	assert.equal(out.stdout.trim(), 'fake python -V');
});

test('runSetup asks ready() even when there is nothing to install', async () => {
	const runner = { check: async () => { throw new Error('no command runs'); }, cancelled: () => false, progress: () => undefined };
	assert.equal(await runSetup([], runner, async () => [], () => 'pkg resolves outside the working copy'), 'pkg resolves outside the working copy');
	assert.equal(await runSetup([], runner, async () => [], () => undefined), undefined);
});

test('failureLines strips pyright and mypy positions, so a moved error compares equal', () => {
	const before = failureLines('  /w/pkg/report.py:3:5 - error: "x" is not defined (reportUndefinedVariable)\npkg/report.py:9: error: Bad [misc]\n');
	const after = failureLines('  /w/pkg/rows.py:12:1 - error: "x" is not defined (reportUndefinedVariable)\npkg/rows.py:2: error: Bad [misc]\n');
	assert.deepEqual(before, ['error: "x" is not defined (reportUndefinedVariable)', 'error: Bad [misc]'].sort());
	assert.deepEqual(after, before);
});

test('runBaseline hands each check its own env', async () => {
	const seen: (Readonly<Record<string, string>> | undefined)[] = [];
	const result = (command: string): CheckResult => ({ command, code: 0, failures: [], tail: '', log: '' });
	const runner = { check: async (command: string, _label: string, env?: Readonly<Record<string, string>>) => { seen.push(env); return result(command); },
		cancelled: () => false, progress: () => undefined };
	await runBaseline([{ label: 'build', command: 'python -m my_editor_pycheck pkg.report', env: { PYTHONPATH: '/helper' } },
		{ label: 'test', command: 'python -m pytest' }], runner);
	assert.deepEqual(seen, [{ PYTHONPATH: '/helper' }, { PYTHONPATH: '/helper' }, undefined, undefined]);
});

test('the approval modal carries the adapter note (Python: the interpreter) before the closing sentence', () => {
	const detail = approvalDetail('/p/w', ['python -m pytest'], 'Python', 1, false, 'Python: /p/.venv/bin/python (3.12.2, sys.prefix /p/.venv). ');
	assert.match(detail, /local git commands there\. Python: \/p\/\.venv\/bin\/python \(3\.12\.2, sys\.prefix \/p\/\.venv\)\. Your files/);
});

test('collapse keeps the longer bordering blank run, at most two, in longest mode', () => {
	const gap = undefined;
	assert.deepEqual(collapse(['a', '', '', gap, '', '', 'b'], 'longest'), ['a', '', '', 'b']);
	assert.deepEqual(collapse(['a', '', gap, '', '', '', 'b'], 'longest'), ['a', '', '', 'b']);
	assert.deepEqual(collapse(['a', '', gap, '', 'b'], 'longest'), ['a', '', 'b']);
	assert.deepEqual(collapse(['a', gap, 'b'], 'longest'), ['a', 'b']);
	assert.deepEqual(collapse(['a', '', '', gap, '', '', 'b']), ['a', '', 'b']);
	assert.deepEqual(collapse(['a', '', '', gap, '', ''], 'longest'), ['a']);
});

function span(text: string, from: string, to?: string): Span {
	const start = text.indexOf(from);
	return { start, end: to === undefined ? text.length - 1 : text.indexOf(to, start) };
}

function decl(id: number, name: string, at: Span): Declaration {
	return { id, kind: 'def', names: [name], span: at, lines: 2, doc: '', docText: '', uses: [], movable: true };
}

function parsed(text: string, info: Omit<FileInfo, 'path' | 'frame' | 'imports'> & Partial<FileInfo>): ParsedFile {
	return { text: Buffer.from(text), info: { path: 'pkg/report.py', frame: [], imports: [], ...info } };
}

test('move check: Python keeps two blank lines where a moved definition was', () => {
	const header = '# Split from report.py by my_editor.\n\n';
	const before = 'import os\n\n\ndef a():\n    pass\n\n\ndef b():\n    pass\n\n\ndef c():\n    pass\n';
	const after = 'import os\nfrom .rows import b as b\n\n\ndef a():\n    pass\n\n\ndef c():\n    pass\n';
	const moved = `${header}def b():\n    pass\n`;
	const facade = after.indexOf('from .rows');
	const input = {
		before: parsed(before, {
			declarations: [decl(0, 'a', span(before, 'def a', '\n\n\ndef b')), decl(1, 'b', span(before, 'def b', '\n\n\ndef c')), decl(2, 'c', span(before, 'def c'))],
			importRegion: { start: before.indexOf('\n\n\ndef a') + 1, end: before.indexOf('\n\n\ndef a') + 1 },
		}),
		after: parsed(after, {
			declarations: [decl(0, 'a', span(after, 'def a', '\n\n\ndef c')), decl(1, 'c', span(after, 'def c'))],
			importRegion: { start: facade, end: after.indexOf('\n', facade) },
		}),
		files: [parsed(moved, { path: 'pkg/rows.py', declarations: [decl(0, 'b', span(moved, 'def b'))], frame: [{ start: 0, end: header.length }],
			prelude: { start: 0, end: header.length } })],
		plan: [{ file: 'rows.py', declarations: [1] }], header, importProblems: () => [],
	};
	assert.deepEqual(checkMove({ ...input, blankLines: 'longest' }), []);
	assert.match(checkMove(input).join(' '), /Rule 2: pkg\/report.py changed beyond the moved spans/);
});
````

One existing assertion described the old `runSetup`; it now expects the message:

In `test/aiReadyCore.test.ts`, replace:

````ts
	assert.equal(await runSetup(install, { ...runner(0), cancelled: () => true }, async () => [], () => undefined), 'stopped');
	assert.equal(await runSetup([], runner(1), async () => ['x'], () => 'no'), undefined);
});
````

with:

````ts
	assert.equal(await runSetup(install, { ...runner(0), cancelled: () => true }, async () => [], () => undefined), 'stopped');
	assert.equal(await runSetup([], runner(1), async () => ['x'], () => 'no'), 'no');
});
````


- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/aiReadyPyCore.test.ts(9,21): error TS2459: Module '"../src/aiready/moveCheck"' declares 'collapse' locally, but it is not exported.
```


- [ ] **Step 3: Implement.**

In `src/aiready/language.ts`:

In `src/aiready/language.ts`, replace:

````ts
	readonly verifies?: boolean;
}
````

with:

````ts
	readonly verifies?: boolean;
	/** Set for this command only, over the adapter's `commandEnv` (Python: the import check's helper folder on PYTHONPATH). */
	readonly env?: Readonly<Record<string, string>>;
}
````

In `src/aiready/language.ts`, replace:

````ts
	readonly commandEnv?: Readonly<Record<string, string>>;
	/** Parse one file, with each declaration's movability and the file's skip reason. */
````

with:

````ts
	readonly commandEnv?: Readonly<Record<string, string>>;
	/** How blank lines around a removed span collapse: to one (the default), or to the longer bordering run, at most two (Python). */
	readonly blankLines?: 'one' | 'longest';
	/** Said in the approval modal before anything runs (Python: the interpreter, its version and `sys.prefix`). */
	readonly approvalNote?: string;
	/** Which output `parseTests` reads: stdout (the default), or stdout and stderr together (Python: unittest reports on stderr). */
	readonly testOutput?: 'stdout' | 'both';
	/** Parse one file, with each declaration's movability and the file's skip reason. */
````

In `src/aiready/projectCommands.ts`, search the command env's PATH first:

In `src/aiready/projectCommands.ts`, replace:

````ts
 * Finds a tool without a shell: PATH first, then the usual install folders, because apps started from the Dock get a
 * shorter PATH than the user's terminal. Language adapters pass their own install folders.
 */
export function findTool(name: string, extraDirs: readonly string[] = []): string | undefined {
	const dirs = [...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', ...extraDirs];
	return dirs.map(dir => path.join(dir, name)).find(file => {
````

with:

````ts
 * Finds a tool without a shell: PATH first, then the usual install folders, because apps started from the Dock get a
 * shorter PATH than the user's terminal. Language adapters pass their own install folders; `firstPath` (a command env's
 * PATH) is searched before the process's.
 */
export function findTool(name: string, extraDirs: readonly string[] = [], firstPath = ''): string | undefined {
	const dirs = [...`${firstPath}${path.delimiter}${process.env.PATH ?? ''}`.split(path.delimiter).filter(Boolean), '/opt/homebrew/bin', '/usr/local/bin',
		'/usr/bin', ...extraDirs];
	return dirs.map(dir => path.join(dir, name)).find(file => {
````

In `src/aiready/projectCommands.ts`, replace:

````ts
	}
	const bin = path.isAbsolute(parts.bin) ? parts.bin : findTool(parts.bin);
	if (!bin) { return Promise.resolve({ code: undefined, stdout: '', output: '', timedOut: false, error: `${parts.bin} was not found.` }); }
````

with:

````ts
	}
	const bin = path.isAbsolute(parts.bin) ? parts.bin : findTool(parts.bin, [], options.env?.PATH);
	if (!bin) { return Promise.resolve({ code: undefined, stdout: '', output: '', timedOut: false, error: `${parts.bin} was not found.` }); }
````

In `src/aiready/baseline.ts` (pyright's `path:line:col - ` goes first, or `:3:` would match and leave `5 - error`):

In `src/aiready/baseline.ts`, replace:

````ts

const POSITION = /^(?:\.{0,2}\/)?[^\s:(]+\.\w+(?::\d+(?::\d+)?:|\(\d+,\d+\):)\s*/;

/** Non-empty output lines with leading `file:line:col:` (Go) or `file(line,col):` (tsc) positions removed, sorted and unique. */
export function failureLines(output: string): string[] {
````

with:

````ts

const POSITION = /^(?:\.{0,2}\/)?[^\s:(]+\.\w+(?::\d+:\d+ -|:\d+(?::\d+)?:|\(\d+,\d+\):)\s*/;

/**
 * Non-empty output lines with leading `file:line:col:` (Go, mypy), `file:line:col -` (pyright) or `file(line,col):` (tsc)
 * positions removed, sorted and unique.
 */
export function failureLines(output: string): string[] {
````

In `src/aiready/baseline.ts`, replace:

````ts
export interface BaselineRunner {
	readonly check: (command: string, label: string) => Promise<CheckResult>;
	readonly cancelled: () => boolean;
````

with:

````ts
export interface BaselineRunner {
	/** `env` is the check's own `CheckCommand.env`, set over the adapter's `commandEnv`. */
	readonly check: (command: string, label: string, env?: Readonly<Record<string, string>>) => Promise<CheckResult>;
	readonly cancelled: () => boolean;
````

In `src/aiready/baseline.ts`, replace:

````ts
 * message (a command failed, tracked files changed, or `ready` names a problem), or 'stopped'. With `installed`, what
 * the commands made is still in place (Continue): they do not run again, and only `ready` is asked.
 */
````

with:

````ts
 * message (a command failed, tracked files changed, or `ready` names a problem), or 'stopped'. With `installed`, what
 * the commands made is still in place (Continue): they do not run again, and only `ready` is asked; so it is with no
 * commands at all (Python installs nothing but still checks where imports resolve).
 */
````

In `src/aiready/baseline.ts`, replace:

````ts
	ready: () => string | undefined, installed = false): Promise<string | 'stopped' | undefined> {
	if (!commands.length) { return undefined; }
	if (installed) { return ready(); }
	for (const { command, label } of commands) {
````

with:

````ts
	ready: () => string | undefined, installed = false): Promise<string | 'stopped' | undefined> {
	if (!commands.length || installed) { return ready(); }
	for (const { command, label } of commands) {
````

In `src/aiready/baseline.ts`, replace:

````ts
	const baseline: Record<string, readonly [CheckResult, CheckResult]> = {};
	for (const { command, label } of checks) {
		const runs: CheckResult[] = [];
````

with:

````ts
	const baseline: Record<string, readonly [CheckResult, CheckResult]> = {};
	for (const { command, label, env } of checks) {
		const runs: CheckResult[] = [];
````

In `src/aiready/baseline.ts`, replace:

````ts
			runner.progress(`Baseline ${round} of 2: \`${command}\`…`);
			const result = await runner.check(command, label);
			if (runner.cancelled()) { return { stopped: true }; }
````

with:

````ts
			runner.progress(`Baseline ${round} of 2: \`${command}\`…`);
			const result = await runner.check(command, label, env);
			if (runner.cancelled()) { return { stopped: true }; }
````

In `src/aiready/moveCheck.ts`:

In `src/aiready/moveCheck.ts`, replace:

````ts
	readonly importProblems?: (before: ParsedFile, after: ParsedFile, files: readonly ParsedFile[]) => string[];
}
````

with:

````ts
	readonly importProblems?: (before: ParsedFile, after: ParsedFile, files: readonly ParsedFile[]) => string[];
	/** How blank lines around a removed span collapse (`LanguageAdapter.blankLines`); one by default. */
	readonly blankLines?: 'one' | 'longest';
}
````

In `src/aiready/moveCheck.ts`, replace:

````ts
 * new file the plan names. 2: the original equals its old bytes minus the moved spans, with only import specs removed
 * and blank lines around removed spans collapsed to one. 3: a new file holds only its frame (header comment, package
 * clause, imports) and its moved spans; the bytes before its package clause are exactly the header (no build or
 * `//go:debug` line), and its imports are some of the original's, none blank. Empty means pass.
 */
````

with:

````ts
 * new file the plan names. 2: the original equals its old bytes minus the moved spans, with only import specs removed
 * and blank lines around removed spans collapsed to one (or, with `longest`, to the longer bordering run, at most two).
 * 3: a new file holds only its frame (header comment, package clause, imports) and its moved spans; the bytes before
 * its package clause are exactly the header (no build or `//go:debug` line), and its imports are some of the
 * original's, none blank. Empty means pass.
 */
````

In `src/aiready/moveCheck.ts`, replace:

````ts
	const moved = plan.flatMap(group => group.declarations.map(id => byId.get(id)!.span));
	const expected = afterImports(collapse(marked(before, moved, !!after.info.importRegion)));
	const actual = afterImports(marked(after, [], true).map(item => item ?? ''));
````

with:

````ts
	const moved = plan.flatMap(group => group.declarations.map(id => byId.get(id)!.span));
	const expected = afterImports(collapse(marked(before, moved, !!after.info.importRegion), input.blankLines));
	const actual = afterImports(marked(after, [], true).map(item => item ?? ''));
````

In `src/aiready/moveCheck.ts`, replace:

````ts

/** Each run of blank lines and gaps that holds a gap becomes one blank line if it held a blank line, else nothing; at the end, nothing. */
function collapse(items: readonly (string | undefined)[]): string[] {
	const out: string[] = [];
````

with:

````ts

/**
 * Each run of blank lines and gaps that holds a gap becomes one blank line if it held a blank line, else nothing; with
 * `longest`, as many blank lines as its longest unbroken stretch of them, at most two. At the end, nothing.
 */
export function collapse(items: readonly (string | undefined)[], mode: 'one' | 'longest' = 'one'): string[] {
	const out: string[] = [];
````

In `src/aiready/moveCheck.ts`, replace:

````ts
		let gap = false;
		let blank = false;
		while (j < items.length && (items[j] === undefined || items[j]!.trim() === '')) {
			if (items[j] === undefined) { gap = true; } else { blank = true; }
			j++;
		}
		if (!gap) { out.push(...(items.slice(i, j) as string[])); }
		else if (blank && j < items.length) { out.push(''); }
		i = j;
````

with:

````ts
		let gap = false;
		let longest = 0;
		for (let stretch = 0; j < items.length && (items[j] === undefined || items[j]!.trim() === ''); j++) {
			stretch = items[j] === undefined ? 0 : stretch + 1;
			gap ||= items[j] === undefined;
			longest = Math.max(longest, stretch);
		}
		if (!gap) { out.push(...(items.slice(i, j) as string[])); }
		else if (longest && j < items.length) { out.push(...Array<string>(mode === 'longest' ? Math.min(longest, 2) : 1).fill('')); }
		i = j;
````

In `src/aiready/steps.ts`:

In `src/aiready/steps.ts`, replace:

````ts
	/** Runs one approved command in the worktree and parses its output. */
	readonly check: (command: string, label: string) => Promise<CheckResult>;
	readonly baseline: Readonly<Record<string, readonly [CheckResult, CheckResult]>>;
````

with:

````ts
	/** Runs one approved command in the worktree and parses its output. */
	readonly check: (command: string, label: string, env?: Readonly<Record<string, string>>) => Promise<CheckResult>;
	readonly baseline: Readonly<Record<string, readonly [CheckResult, CheckResult]>>;
````

In `src/aiready/steps.ts`, replace:

````ts
		ctx.progress(`Running \`${check.command}\`…`);
		const result = await ctx.check(check.command, check.label);
		if (ctx.cancelled()) { return { results, problems: [], newFailing, stopped: true }; }
````

with:

````ts
		ctx.progress(`Running \`${check.command}\`…`);
		const result = await ctx.check(check.command, check.label, check.env);
		if (ctx.cancelled()) { return { results, problems: [], newFailing, stopped: true }; }
````

In `src/aiready/steps.ts`, replace:

````ts
	const problems = [
		...checkMove({ before: { text: facts.source, info: facts.info }, after, files, plan: facts.plan, header: adapter.splitHeader(file), importProblems: adapter.importProblems }),
		...adapter.sameDeclarations(facts.unitBefore, unitAfter),
````

with:

````ts
	const problems = [
		...checkMove({
			before: { text: facts.source, info: facts.info }, after, files, plan: facts.plan, header: adapter.splitHeader(file),
			importProblems: adapter.importProblems, blankLines: adapter.blankLines,
		}),
		...adapter.sameDeclarations(facts.unitBefore, unitAfter),
````

In `src/aiready/fixSetup.ts` and `src/aiready/fixRun.ts`:

In `src/aiready/fixSetup.ts`, replace:

````ts

/** Runs one approved command in the worktree, logs its full output in run state, and parses it. */
export async function runCheck(env: CommandEnv, adapter: LanguageAdapter, worktree: string, approved: readonly string[],
	command: string, label: string): Promise<CheckResult> {
	const log = path.join(logDir(env.storage, env.root), `${Date.now()}-${label}.log`);
	const output = await runCommand(command, { cwd: worktree, approved, timeoutMs: timeoutMs(), logFile: log, cancel: env.token, env: adapter.commandEnv });
	return {
````

with:

````ts

/** Runs one approved command in the worktree (with its own `extra` env over the adapter's), logs its full output in run state, and parses it. */
export async function runCheck(env: CommandEnv, adapter: LanguageAdapter, worktree: string, approved: readonly string[],
	command: string, label: string, extra?: Readonly<Record<string, string>>): Promise<CheckResult> {
	const log = path.join(logDir(env.storage, env.root), `${Date.now()}-${label}.log`);
	const output = await runCommand(command, {
		cwd: worktree, approved, timeoutMs: timeoutMs(), logFile: log, cancel: env.token, env: { ...adapter.commandEnv, ...extra },
	});
	return {
````

In `src/aiready/fixSetup.ts`, replace:

````ts
		failures: label === 'test' ? [] : failureLines(output.error ?? output.output).slice(0, MAX_FAILURE_LINES),
		tests: label === 'test' && output.code !== undefined ? adapter.parseTests(output.stdout) : undefined,
		tail: tail(output.error ?? output.output),
````

with:

````ts
		failures: label === 'test' ? [] : failureLines(output.error ?? output.output).slice(0, MAX_FAILURE_LINES),
		tests: label === 'test' && output.code !== undefined ? adapter.parseTests(adapter.testOutput === 'both' ? output.output : output.stdout) : undefined,
		tail: tail(output.error ?? output.output),
````

In `src/aiready/fixSetup.ts`, replace:

````ts
	const answer = await vscode.window.showWarningMessage('Run these commands on a new local branch?',
		{ modal: true, detail: approvalDetail(folder, approved, local.label, picked.length, setup.length > 0) }, 'Run them');
	if (answer !== 'Run them') { sink.text('The commands were not approved, so nothing changed.'); return undefined; }
````

with:

````ts
	const answer = await vscode.window.showWarningMessage('Run these commands on a new local branch?',
		{ modal: true, detail: approvalDetail(folder, approved, local.label, picked.length, setup.length > 0, local.approvalNote) }, 'Run them');
	if (answer !== 'Run them') { sink.text('The commands were not approved, so nothing changed.'); return undefined; }
````

In `src/aiready/fixSetup.ts`, replace:

````ts
		const outcome = await runBaseline(checks, {
			check: (command, label) => runCheck(env, inWorktree, worktree.path, approved, command, label),
			cancelled: () => token.isCancellationRequested,
````

with:

````ts
		const outcome = await runBaseline(checks, {
			check: (command, label, extra) => runCheck(env, inWorktree, worktree.path, approved, command, label, extra),
			cancelled: () => token.isCancellationRequested,
````

In `src/aiready/fixRun.ts`, replace:

````ts
		adapter, worktree, ask: askModel, baseline: state.baseline, flaky: runFlaky(state),
		check: (command, label) => runCheck(env, adapter, worktree, state.approved, command, label),
		cancelled: () => token.isCancellationRequested,
````

with:

````ts
		adapter, worktree, ask: askModel, baseline: state.baseline, flaky: runFlaky(state),
		check: (command, label, extra) => runCheck(env, adapter, worktree, state.approved, command, label, extra),
		cancelled: () => token.isCancellationRequested,
````

In `src/aiready/fixText.ts`:

In `src/aiready/fixText.ts`, replace:

````ts

/** The approval modal's detail: where the commands run, the exact commands, and what they run. */
export function approvalDetail(folder: string, approved: readonly string[], language: string, fixCount = 0, installs = false): string {
	const over = fixCount > MAX_FIXES_PER_RUN ? `${fixCount} fixes chosen: ${MAX_FIXES_PER_RUN} now; Continue does the rest.\n\n` : '';
````

with:

````ts

/** The approval modal's detail: where the commands run, the exact commands, what they run, and the adapter's note. */
export function approvalDetail(folder: string, approved: readonly string[], language: string, fixCount = 0, installs = false, note = ''): string {
	const over = fixCount > MAX_FIXES_PER_RUN ? `${fixCount} fixes chosen: ${MAX_FIXES_PER_RUN} now; Continue does the rest.\n\n` : '';
````

In `src/aiready/fixText.ts`, replace:

````ts
		+ `${installs ? 'The others' : 'They'} build the project and run its tests, which runs project code and tests written by the AI model. `
		+ `my_editor also runs read-only ${language} tools (to list packages and check formatting) and local git commands there. `
		+ 'Your files and your branch stay as they are until the end, when the health report in .my_editor/ai-ready/ is updated. Nothing is pushed.';
````

with:

````ts
		+ `${installs ? 'The others' : 'They'} build the project and run its tests, which runs project code and tests written by the AI model. `
		+ `my_editor also runs read-only ${language} tools (to list packages and check formatting) and local git commands there. ${note}`
		+ 'Your files and your branch stay as they are until the end, when the health report in .my_editor/ai-ready/ is updated. Nothing is pushed.';
````


- [ ] **Step 4: Run the tests.**

Run: `npx tsc --noEmit -p ./ && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 287
ℹ fail 0
```


- [ ] **Step 5: Commit.**

```bash
git add src/aiready/language.ts src/aiready/projectCommands.ts src/aiready/baseline.ts src/aiready/moveCheck.ts src/aiready/steps.ts src/aiready/fixSetup.ts src/aiready/fixText.ts src/aiready/fixRun.ts test/aiReadyPyCore.test.ts test/aiReadyCore.test.ts
git commit -m "AI-ready core: per-check env, command PATH, blank runs of two, approval note, stderr test output"
```


## Chunk 2: The parser helper, part 1: reads and purity

### Task 2: Global reads, bindings and purity

**Files:**
- Create: `resources/pyast/my_editor_pyreads.py`, `resources/pyast/my_editor_pyfacts.py`, `resources/pyast/test_pyfacts.py`

The helper is stdlib only and written for Python 3.9 (it runs with the project's interpreter). `my_editor_pyreads.py` finds what statements read and bind, with `symtable` for every nested scope and `ast` for module-scope code; `my_editor_pyfacts.py` resolves names by binding (a name bound once by the leading block, a builtin the file never binds, or an earlier definition) and decides purity with the design's allowlists. Annotation purity is kept apart, because annotations may be deferred.


- [ ] **Step 1: Write the failing tests.**

Create `resources/pyast/test_pyfacts.py`:

````python
"""Tests for name resolution, purity and reads in my_editor's Python helper. Run: python3 -m unittest -v (in this folder)."""
import ast
import sys
import textwrap
import unittest

import my_editor_pyfacts as pf
import my_editor_pyreads as pr


def parsed(source):
    """The tree, its leading imports, and one group per later statement, with the file's names."""
    tree = ast.parse(textwrap.dedent(source))
    count = next((i for i, s in enumerate(tree.body) if not isinstance(s, (ast.Import, ast.ImportFrom))), len(tree.body))
    groups = [[s] for s in tree.body[count:]]
    return tree, groups, pf.names_of(tree.body[:count], groups, tree)


def purity(source, name):
    """(definition-time Purity, annotation Purity) of the statement that defines `name`."""
    tree, groups, names = parsed(source)
    index, stmt = next((i, g[0]) for i, g in enumerate(groups) if name in pr.binds(g[0]))
    p, ann = pf.Purity(names, index), pf.Purity(names, index)
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
        pf.function_pure(p, ann, stmt, pf.TOP_FUNC)
    elif isinstance(stmt, ast.ClassDef):
        pf.class_pure(p, ann, stmt)
    else:
        p.expr(stmt.value)
    return p, ann


LEAD = 'import os\nimport re\nfrom pathlib import Path\nfrom typing import TypeVar\na = 1\nb = 2\nk = 3\nx = 4\n'


class Values(unittest.TestCase):
    def check(self, value, pure):
        p, _ = purity(LEAD + 'Z = %s\n' % value, 'Z')
        self.assertEqual(p.reason is None, pure, '%s: %s' % (value, p.reason))

    def test_pure_values(self):
        for value in ['1', '-1', "'x'", "(1, 'a')", "{'a': 1}", 'object()', "re.compile(r'x', re.I)", "TypeVar('T')", 'list[int]',
                      'int | None', 'a', 'lambda q=1: q * 2', 'frozenset({1, 2})']:
            self.check(value, True)

    def test_impure_values(self):
        for value in ["f'{x}'", 'a + b', 'a.b', '{k: 1}', '[*a]', 'frozenset(x())', "os.environ.get('X')", "Path('x')",
                      '[i for i in range(3)]', 'later', 'a < b', 'a[0]']:
            self.check(value, False)

    def test_reads_of_earlier_definitions_need_the_same_file_and_module_attributes_need_the_import_check(self):
        p, _ = purity('import lib\nX = 1\ndef f(m=lib.heavy, x=X):\n    return m\n', 'f')
        self.assertIsNone(p.reason)
        self.assertEqual((p.same_file, p.attr_reads), ({'X'}, {('lib', 'heavy')}))

    def test_a_name_bound_twice_is_not_a_stable_read(self):
        p, _ = purity('import os\nX = 1\nX = 2\ndef f(x=X):\n    return x\n', 'f')
        self.assertIn('binds more than once', p.reason)


class Definitions(unittest.TestCase):
    def test_decorators_resolve_by_binding(self):
        cases = [('from flask import Flask\napp = Flask(__name__)\n@app.route("/")\ndef f(): pass\n', False),
                 ('import pytest\n@pytest.fixture\ndef f(): pass\n', False),
                 ('import attr\n@attr.s\nclass f: pass\n', False),
                 ('from dataclasses import dataclass\n@dataclass\nclass f:\n    x: int = 0\n', True),
                 ('from dataclasses import dataclass\n@dataclass(frozen=True)\nclass f:\n    x: int = 0\n', True),
                 ('from functools import lru_cache\n@lru_cache(maxsize=32)\ndef f(): pass\n', True),
                 ('from .util import dataclass\n@dataclass\nclass f: pass\n', False),
                 ('from .util import lru_cache\n@lru_cache(maxsize=32)\ndef f(): pass\n', False)]
        for src, pure in cases:
            self.assertEqual(purity(src, 'f')[0].reason is None, pure, src)

    def test_classes(self):
        cases = [('class E(Exception):\n    pass\n', True),
                 ('from pydantic import BaseModel\nclass E(BaseModel):\n    x: int = 1\n', False),
                 ('from .meta import Meta\nclass E(metaclass=Meta):\n    pass\n', False),
                 ('import abc\nclass E(metaclass=abc.ABCMeta):\n    pass\n', True),
                 ('def compute(): return 1\nclass E:\n    x = compute()\n', False),
                 ('class E:\n    @property\n    def a(self): return 1\n    @a.setter\n    def a(self, v): pass\n', True),
                 ('import enum\nclass E(enum.Enum):\n    A = enum.auto()\n', True),
                 ('class B:\n    pass\nclass E(B):\n    pass\n', True)]
        for src, pure in cases:
            self.assertEqual(purity(src, 'E')[0].reason is None, pure, src)

    def test_annotations_are_judged_apart(self):
        p, ann = purity('from .types import Row\ndef f(x: Row.Cell) -> int:\n    return x\n', 'f')
        self.assertIsNone(p.reason)
        self.assertIn('Row.Cell', ann.reason)


class Reads(unittest.TestCase):
    def test_definition_reads_and_annotation_reads(self):
        tree, _, _ = parsed('from typing import Optional\nX = 1\ndef f(a=X, *, b: Optional[int] = None) -> "Row":\n    return Y\n')
        self.assertEqual(pr.definition_reads(tree.body[2]), (['X'], ['Optional', 'int']))

    def test_nested_scopes_read_globals_through_symtable(self):
        source = ('import json\ndef f(a=1):\n    def g():\n        return json.dumps(a) + str(Y)\n    return g\n'
                  'class C:\n    z = 1\n    def m(self):\n        return z\n')
        found = {line: sorted(names) for line, names, _ in pr.table_reads(pr.module_table(source, 'm.py')) if names}
        self.assertEqual(found[3], ['Y', 'json', 'str'])
        self.assertEqual(found[8], ['z'])

    def test_forward_reference_strings(self):
        tree, _, _ = parsed('from typing import TypeVar, cast\nT = TypeVar("T", bound="Row")\ndef f(x):\n    return cast("Cell", x)\n')
        self.assertEqual(pr.forward_refs(tree.body[1]), ['Row'])
        self.assertEqual(pr.forward_refs(tree.body[2]), ['Cell'])

    def test_bindings(self):
        tree, groups, names = parsed('import os\nX = 1\nX = 2\nY = 1\ndel Y\nZ = 1\ndef f():\n    global Z\n    Z = 3\nfor i in range(2):\n    pass\n')
        self.assertEqual((names.counts['X'], names.counts['Y'], names.counts['Z'], names.counts['i']), (2, 2, 2, 1))
        self.assertEqual(pr.global_assignments(tree), ['Z'])
        self.assertEqual(names.canon(ast.parse('os.path', mode='eval').body), 'os.path')

    def test_file_forms_and_namespace_access(self):
        def use(src):
            return pr.file_use(ast.parse(src).body)
        self.assertEqual(use('import os\nD = os.path.dirname(__file__)\n'), 'folder')
        self.assertEqual(use('from pathlib import Path\nD = Path(__file__).resolve().parent\n'), 'folder')
        self.assertEqual(use('D = open(__file__)\n'), 'other')
        for src, why in [('exec("x = 1")\n', 'exec()'), ('def f():\n    return globals()\n', 'globals()'), ('vars()\n', 'vars() without arguments'),
                         ('import sys\nsys._getframe(1)\n', 'sys._getframe'), ('import sys\nsys.modules[__name__]\n', 'sys.modules[__name__]'),
                         ('import inspect\ninspect.stack()\n', 'inspect.stack')]:
            tree, _, names = parsed(src)
            self.assertEqual(pr.namespace_use(tree, names), why, src)
        self.assertIsNone(pr.namespace_use(*parsed('vars(os)\n')[::2]))

    def test_main_guard_and_late_imports(self):
        self.assertTrue(pr.main_guard(ast.parse('if __name__ == "__main__":\n    pass\n')))
        tree = ast.parse('X = 1\ntry:\n    import yaml\nexcept ImportError:\n    yaml = None\n')
        self.assertEqual(pr.late_import(tree.body), 3)
        self.assertIsNone(pr.late_import(ast.parse('def f():\n    import json\n').body))

    @unittest.skipUnless(sys.version_info >= (3, 12), 'type statements need Python 3.12')
    def test_type_alias_values_are_lazy(self):
        tree = ast.parse('type Rows = list[Row]\n')
        self.assertEqual(pr.definition_reads(tree.body[0]), ([], []))


if __name__ == '__main__':
    unittest.main()
````


- [ ] **Step 2: Run them to see them fail.**

Run: `(cd resources/pyast && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest test_pyfacts 2>&1 | grep -m1 '^ModuleNotFoundError')`

Expected:

```text
ModuleNotFoundError: No module named 'my_editor_pyfacts'
```


- [ ] **Step 3: Implement.**

Create `resources/pyast/my_editor_pyreads.py`:

````python
"""Global reads, bindings and `__file__` forms for my_editor's Python parser helper. Stdlib only, Python 3.9 syntax."""
import ast
import symtable

MODULE_DUNDERS = frozenset(['__name__', '__module__', '__doc__', '__spec__', '__loader__', '__package__', '__path__', '__builtins__',
                            '__cached__'])
FOLDER_FORMS = frozenset(['os.path.dirname(__file__)', 'os.path.dirname(os.path.abspath(__file__))', 'os.path.dirname(os.path.realpath(__file__))',
                          'Path(__file__).parent', 'Path(__file__).resolve().parent', 'Path(__file__).absolute().parent'])


def annotation_nodes(fn):
    a = fn.args
    params = a.posonlyargs + a.args + a.kwonlyargs + [x for x in (a.vararg, a.kwarg) if x]
    return [p.annotation for p in params if p.annotation] + ([fn.returns] if fn.returns else [])


def defaults(fn):
    return fn.args.defaults + [d for d in fn.args.kw_defaults if d is not None]


class Reads(ast.NodeVisitor):
    """Global names read in module-scope code: decorators, defaults, bases, values and class bodies (over-approximated)."""

    def __init__(self):
        self.names = []
        self.strings = []

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.names.append(node.id)

    def visit_Lambda(self, node):
        for d in defaults(node):
            self.visit(d)

    def visit_FunctionDef(self, node):
        for d in node.decorator_list + defaults(node):
            self.visit(d)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        for n in node.decorator_list + node.bases + [k.value for k in node.keywords] + node.body:
            self.visit(n)

    def visit_AnnAssign(self, node):
        self.visit(node.annotation)
        self.strings.extend(strings_in(node.annotation))
        if node.value is not None:
            self.visit(node.value)


def strings_in(node):
    """String constants in an annotation or forward reference, parsed for the names they use."""
    found = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
            try:
                expr = ast.parse(sub.value.strip(), mode='eval')
            except SyntaxError:
                continue
            found.extend(n.id for n in ast.walk(expr) if isinstance(n, ast.Name))
    return found


def forward_refs(stmt):
    """Names in string annotations of nested defs, `bound=`/constraint strings of TypeVar and `cast('X', …)`."""
    found = []
    for node in ast.walk(stmt):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for a in annotation_nodes(node):
                found.extend(strings_in(a))
        elif isinstance(node, ast.AnnAssign):
            found.extend(strings_in(node.annotation))
        elif isinstance(node, ast.Call):
            name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, 'id', '')
            if name == 'cast' and node.args:
                found.extend(strings_in(node.args[0]))
            elif name == 'TypeVar':
                for part in node.args[1:] + [k.value for k in node.keywords if k.arg == 'bound']:
                    found.extend(strings_in(part))
    return found


def class_functions(cls):
    """Methods of a class and of the classes nested in its body, not functions inside method bodies."""
    for stmt in cls.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield stmt
        elif isinstance(stmt, ast.ClassDef):
            yield from class_functions(stmt)


def definition_reads(stmt):
    """(definition-time reads, annotation reads): module-scope names, with annotations apart because they may be deferred."""
    reads = Reads()
    ann = []
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
        reads.visit(stmt)
        for a in annotation_nodes(stmt):
            ann.extend(n.id for n in ast.walk(a) if isinstance(n, ast.Name))
    elif isinstance(stmt, ast.ClassDef):
        reads.visit(stmt)
        for node in class_functions(stmt):
            for a in annotation_nodes(node):
                ann.extend(n.id for n in ast.walk(a) if isinstance(n, ast.Name))
    elif isinstance(stmt, ast.AnnAssign):
        ann.extend(n.id for n in ast.walk(stmt.annotation) if isinstance(n, ast.Name))
        if stmt.value is not None:
            reads.visit(stmt.value)
    elif type(stmt).__name__ != 'TypeAlias':
        reads.visit(stmt)
    return reads.names, ann


def table_reads(top):
    """Line number -> global names referenced by every nested scope (function, class, lambda, annotation, type alias)."""
    by_line = []

    def walk(table):
        for child in table.get_children():
            names = [s.get_name() for s in child.get_symbols() if (s.is_global() or s.is_declared_global()) and s.is_referenced()]
            declared = [s.get_name() for s in child.get_symbols() if s.is_declared_global()]
            by_line.append((child.get_lineno(), names, declared))
            walk(child)
    walk(top)
    return by_line


def module_table(source, filename):
    return symtable.symtable(source, filename, 'exec')


class Binder(ast.NodeVisitor):
    """Names a module-level statement binds or deletes, without entering function or class bodies."""

    def __init__(self):
        self.names = set()

    def visit_Name(self, node):
        if not isinstance(node.ctx, ast.Load):
            self.names.add(node.id)

    def visit_FunctionDef(self, node):
        self.names.add(node.name)
        for n in node.decorator_list + defaults(node):
            self.visit(n)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        self.names.add(node.name)
        for n in node.decorator_list + node.bases + [k.value for k in node.keywords]:
            self.visit(n)

    def visit_Lambda(self, node):
        for n in defaults(node):
            self.visit(n)

    def visit_Import(self, node):
        for a in node.names:
            self.names.add(a.asname or a.name.split('.')[0])

    visit_ImportFrom = visit_Import

    def visit_ExceptHandler(self, node):
        if node.name:
            self.names.add(node.name)
        self.generic_visit(node)

    def generic_visit(self, node):
        for field in ('name', 'rest'):
            value = getattr(node, field, None)
            if isinstance(value, str) and type(node).__name__.startswith('Match'):
                self.names.add(value)
        super().generic_visit(node)

    def visit_TypeAlias(self, node):
        self.names.add(node.name.id)


def binds(stmt):
    binder = Binder()
    binder.visit(stmt)
    return binder.names


def global_assignments(tree):
    """Names a function or class body declares `global` and assigns or deletes."""
    found = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            declared = set()
            stored = set()
            stack = list(node.body)
            while stack:
                sub = stack.pop()
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
                    continue
                if isinstance(sub, ast.Global):
                    declared.update(sub.names)
                if isinstance(sub, ast.Name) and not isinstance(sub.ctx, ast.Load):
                    stored.add(sub.id)
                stack.extend(ast.iter_child_nodes(sub))
            found.extend(sorted(declared & stored))
    return found


def docstrings(stmts):
    found = []
    for stmt in stmts:
        for node in ast.walk(stmt):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                doc = ast.get_docstring(node, clean=False)
                if doc:
                    found.append(doc)
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
            found.append(stmt.value.value)
    return found


def parents(node):
    out = {}
    for parent in ast.walk(node):
        for child in ast.iter_child_nodes(parent):
            out[child] = parent
    return out


def file_use(stmts):
    """None, 'folder' when every `__file__` is in a folder form, else 'other'."""
    use = None
    for stmt in stmts:
        up = parents(stmt)
        for node in ast.walk(stmt):
            if isinstance(node, ast.Name) and node.id == '__file__':
                chain = []
                at = node
                for _ in range(5):
                    at = up.get(at)
                    if at is None:
                        break
                    chain.append(ast.unparse(at))
                use = 'folder' if any(text in FOLDER_FORMS for text in chain) and use != 'other' else 'other'
    return use


def is_import(stmt):
    return isinstance(stmt, (ast.Import, ast.ImportFrom))


def namespace_use(tree, names):
    """Why the file reads or replaces its own namespace, or None."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            target = names.canon(node.func)
            if target in ('builtins.exec', 'builtins.eval', 'builtins.globals', 'builtins.locals'):
                return '%s()' % target[len('builtins.'):]
            if target in ('builtins.vars', 'builtins.dir') and not node.args:
                return '%s() without arguments' % target[len('builtins.'):]
        if isinstance(node, ast.Attribute) and (node.attr == '_getframe' or node.attr in ('currentframe', 'stack')
                                                and isinstance(node.value, ast.Name) and node.value.id == 'inspect'):
            return ast.unparse(node)
        if (isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Name) and node.slice.id == '__name__'
                and isinstance(node.value, ast.Attribute) and node.value.attr == 'modules'):
            return 'sys.modules[__name__]'
    return None


def module_getattr(tree, table, counts):
    """A module-level `__getattr__` or `__dir__`, and whether it reads other module names."""
    defined = [s for s in tree.body if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)) and s.name in ('__getattr__', '__dir__')]
    reads = [n for s in defined for line, found, _ in table_reads(table) if line == s.lineno for n in found if n in counts]
    return bool(defined), bool(reads)


def main_guard(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and isinstance(node.test, ast.Compare) and len(node.test.comparators) == 1:
            sides = [node.test.left, node.test.comparators[0]]
            if any(isinstance(s, ast.Name) and s.id == '__name__' for s in sides) and any(
                    isinstance(s, ast.Constant) and s.value == '__main__' for s in sides):
                return True
    return False


def late_import(stmts):
    """The line of an import after the leading block, outside function and class bodies."""
    stack = list(stmts)
    while stack:
        node = stack.pop(0)
        if is_import(node):
            return node.lineno
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda, ast.expr)):
            stack[0:0] = [c for c in ast.iter_child_nodes(node) if isinstance(c, (ast.stmt, ast.excepthandler))
                          or type(c).__name__ == 'match_case']
    return None
````

Create `resources/pyast/my_editor_pyfacts.py`:

````python
"""Name resolution, purity and global reads for my_editor's Python parser helper. Stdlib only, Python 3.9 syntax."""
import ast
import builtins

from my_editor_pyreads import annotation_nodes, binds, defaults, global_assignments

BUILTIN_NAMES = frozenset(dir(builtins))
BUILTIN_CLASSES = frozenset(n for n in BUILTIN_NAMES if isinstance(getattr(builtins, n), type))
TYPING = ('typing.', 'typing_extensions.')
GENERICS = frozenset(['list', 'dict', 'tuple', 'set', 'frozenset', 'type'])
PURE_CALLS = frozenset(['builtins.object', 'builtins.frozenset', 're.compile', 'collections.namedtuple', 'typing.TypeVar',
                        'typing.ParamSpec', 'typing.TypeVarTuple', 'typing.NewType'])
CLASS_CALLS = frozenset(['dataclasses.field', 'enum.auto'])
QUIET_CALLS = frozenset(['logging.getLogger', 'warnings.filterwarnings', 'warnings.simplefilter', 're.compile', 'os.environ.get',
                         'os.getenv', 'collections.namedtuple', 'typing.TypeVar', 'typing.NewType', 'typing.ParamSpec', 'builtins.object'])
TOP_FUNC = frozenset(['functools.cache', 'functools.lru_cache', 'contextlib.contextmanager', 'contextlib.asynccontextmanager',
                      'typing.overload', 'typing.final'])
TOP_CLASS = frozenset(['dataclasses.dataclass', 'functools.total_ordering', 'enum.unique', 'typing.final', 'typing.runtime_checkable'])
IN_CLASS = frozenset(['builtins.property', 'builtins.staticmethod', 'builtins.classmethod', 'functools.cached_property',
                      'abc.abstractmethod', 'typing.overload', 'typing.override', 'typing.final'])
CALLABLE_DECORATORS = frozenset(['functools.lru_cache', 'dataclasses.dataclass'])
STD_BASES = frozenset(['abc.ABC', 'enum.Enum', 'enum.IntEnum', 'enum.StrEnum', 'enum.Flag', 'enum.IntFlag', 'typing.NamedTuple',
                       'typing.TypedDict', 'typing.Protocol'])
SUBSCRIPT_BASES = frozenset(['typing.Generic', 'typing.Protocol'])
CLASS_HOOKS = ('__init_subclass__', '__class_getitem__', '__set_name__')


def normal(name):
    """typing_extensions names count as typing names."""
    return 'typing.' + name[len('typing_extensions.'):] if name and name.startswith('typing_extensions.') else name


class Names:
    """What the file binds: the leading block's imports and every top-level binding, for resolving names by binding."""

    def __init__(self, lead_canon, lead_modules, counts, defined):
        self.lead_canon = lead_canon      # name -> dotted target, None when the binding is conditional or relative
        self.lead_modules = lead_modules  # names bound by `import m` (module objects)
        self.counts = counts              # name -> number of statements that bind it
        self.defined = defined            # non-lead name -> id of the declaration that binds it first

    def canon(self, node):
        """The dotted target of a name or attribute chain resolved by binding, else None."""
        if isinstance(node, ast.Name):
            name = node.id
            if name in self.lead_canon and self.counts.get(name, 0) == 1:
                return normal(self.lead_canon[name])
            if name not in self.counts and name in BUILTIN_NAMES:
                return 'builtins.' + name
            return None
        if isinstance(node, ast.Attribute):
            base = self.canon(node.value)
            return normal(base + '.' + node.attr) if base else None
        return None


class Purity:
    """Decides whether definition-time code is pure, collecting what the decision relied on."""

    def __init__(self, names, index):
        self.names = names
        self.index = index
        self.reason = None
        self.same_file = set()
        self.attr_reads = set()
        self.relies = set()

    def fail(self, why):
        if self.reason is None:
            self.reason = why
        return False

    def rely(self, target):
        self.relies.add(target.split('.')[0])

    def read(self, name):
        names = self.names
        if name in names.lead_canon or name in names.lead_modules:
            return True if names.counts.get(name, 0) == 1 else self.fail('it reads %s, which the file binds more than once' % name)
        if name not in names.counts:
            return True if name in BUILTIN_NAMES else self.fail('it reads %s, which is not defined in the module' % name)
        if names.defined.get(name, self.index) >= self.index:
            return self.fail('it reads %s before %s is defined' % (name, name))
        if names.counts[name] != 1:
            return self.fail('it reads %s, which the file binds more than once' % name)
        self.same_file.add(name)
        return True

    def literal(self, node):
        if isinstance(node, ast.Constant):
            return True
        if isinstance(node, ast.Tuple):
            return all(self.literal(e) for e in node.elts)
        return isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)) and isinstance(node.operand, ast.Constant)

    def expr(self, node, in_class=False):
        """Pure: literals, displays, lambdas, stable reads, module attributes, type expressions, allowlisted calls."""
        if isinstance(node, ast.Constant):
            return True
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            return isinstance(node.operand, ast.Constant) and isinstance(node.operand.value, (int, float, complex)) or self.fail('an operator runs code')
        if isinstance(node, ast.JoinedStr):
            return all(isinstance(v, ast.Constant) for v in node.values) or self.fail('an f-string with fields runs code')
        if isinstance(node, (ast.Tuple, ast.List)):
            return all(not isinstance(e, ast.Starred) and self.expr(e, in_class) for e in node.elts) or self.fail('unpacking runs code')
        if isinstance(node, ast.Set):
            return all(self.literal(e) for e in node.elts) or self.fail('a set item that is not a literal runs __hash__')
        if isinstance(node, ast.Dict):
            if not all(k is not None and self.literal(k) for k in node.keys):
                return self.fail('a dict key that is not a literal runs __hash__')
            return all(self.expr(v, in_class) for v in node.values)
        if isinstance(node, ast.Lambda):
            return all(self.expr(d, in_class) for d in node.args.defaults + [d for d in node.args.kw_defaults if d is not None])
        if isinstance(node, ast.Name):
            return self.read(node.id)
        if isinstance(node, ast.Attribute):
            return self.attribute(node)
        if isinstance(node, (ast.Subscript, ast.BinOp)):
            return self.type_expr(node)
        if isinstance(node, ast.Call):
            return self.call(node, in_class)
        return self.fail('its definition runs code (%s)' % type(node).__name__)

    def attribute(self, node):
        if isinstance(node.value, ast.Name) and node.value.id in self.names.lead_modules and self.names.counts.get(node.value.id) == 1:
            self.attr_reads.add((self.names.canon(node.value) or node.value.id, node.attr))
            return True
        return self.fail('it reads the attribute %s, which may run code' % ast.unparse(node))

    def type_expr(self, node):
        """Subscripts of builtin generics or typing names, and `|` between types, None and stable class names."""
        if isinstance(node, ast.BinOp):
            if not isinstance(node.op, ast.BitOr):
                return self.fail('an operator runs code')
            return self.type_part(node.left) and self.type_part(node.right)
        value = node.value
        target = self.names.canon(value)
        generic = isinstance(value, ast.Name) and value.id in GENERICS and target == 'builtins.' + value.id
        if not (generic or (target and target.startswith(TYPING)) or (target or '').startswith('collections.abc.')):
            return self.fail('a subscript of %s runs code' % ast.unparse(value))
        if target and not generic:
            self.rely(target)
        if not (self.attribute(value) if isinstance(value, ast.Attribute) else self.expr(value)):
            return False
        args = node.slice.elts if isinstance(node.slice, ast.Tuple) else [node.slice]
        return all(self.type_part(a) for a in args)

    def type_part(self, node):
        if isinstance(node, ast.Constant):
            return True
        if isinstance(node, ast.List):
            return all(self.type_part(e) for e in node.elts)
        if isinstance(node, ast.Tuple):
            return all(self.type_part(e) for e in node.elts)
        return self.expr(node)

    def call(self, node, in_class):
        target = self.names.canon(node.func)
        allowed = PURE_CALLS | (CLASS_CALLS if in_class else frozenset())
        if target not in allowed:
            return self.fail('it calls %s' % ast.unparse(node.func))
        self.rely(target)
        if target == 'builtins.object' and (node.args or node.keywords):
            return self.fail('it calls object() with arguments')
        if target == 're.compile' and not (node.args and isinstance(node.args[0], ast.Constant)):
            return self.fail('re.compile needs a literal pattern')
        if any(isinstance(a, ast.Starred) for a in node.args) or any(k.arg is None for k in node.keywords):
            return self.fail('a call with * or ** runs code')
        flags = node.args[1:] if target == 're.compile' else []
        if any(not self.flags(f) for f in flags):
            return False
        rest = node.args if target != 're.compile' else node.args[:1]
        return all(self.expr(a, in_class) for a in rest) and all(self.expr(k.value, in_class) for k in node.keywords)

    def flags(self, node):
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            return self.flags(node.left) and self.flags(node.right)
        return self.expr(node)

    def decorator(self, node, allowed):
        call = isinstance(node, ast.Call)
        target = self.names.canon(node.func if call else node)
        if target not in allowed:
            return self.fail('it has the decorator %s' % ast.unparse(node))
        self.rely(target)
        if call and (target not in CALLABLE_DECORATORS or node.args and target == 'dataclasses.dataclass'
                     or not all(self.literal(a) for a in node.args) or not all(k.arg and self.literal(k.value) for k in node.keywords)):
            return self.fail('its decorator %s takes arguments that are not literals' % ast.unparse(node))
        return True


def function_pure(p, ann, fn, allowed, decorators=None):
    """A def is pure when its decorators are allowed and its defaults pure; its annotations decide `ann` (deferrable)."""
    for d in fn.decorator_list if decorators is None else decorators:
        if not p.decorator(d, allowed):
            return False
    if not all(p.expr(d) for d in defaults(fn)):
        return False
    for node in annotation_nodes(fn):
        ann.type_part(node)
    return True


def class_pure(p, ann, cls, nested=False):
    """Bases, keywords, decorators and body under the design's class rules."""
    for d in cls.decorator_list:
        if not p.decorator(d, TOP_CLASS):
            return False
    for base in cls.bases:
        target = p.names.canon(base.value if isinstance(base, ast.Subscript) else base)
        if isinstance(base, ast.Subscript):
            if target not in SUBSCRIPT_BASES:
                return p.fail('its base %s is not on the allowed list' % ast.unparse(base))
            p.rely(target)
            if not p.type_expr(base):
                return False
        elif target and (target in STD_BASES or target[len('builtins.'):] in BUILTIN_CLASSES and target.startswith('builtins.')):
            p.rely(target)
        elif isinstance(base, ast.Name) and target is None and p.read(base.id) and base.id in p.same_file:
            continue
        else:
            return p.fail('its base %s may run code when the class is defined' % ast.unparse(base))
    for k in cls.keywords:
        if not (k.arg == 'metaclass' and p.names.canon(k.value) == 'abc.ABCMeta'):
            return p.fail('its keyword %s runs code' % ast.unparse(k))
    local = set()
    props = set()
    for stmt in cls.body:
        if isinstance(stmt, ast.Pass) or isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant):
            continue
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            plain = []
            for d in stmt.decorator_list:
                if isinstance(d, ast.Attribute) and isinstance(d.value, ast.Name) and d.value.id in props and d.attr in ('setter', 'getter', 'deleter'):
                    continue
                if isinstance(d, ast.Name) and d.id in local:
                    return p.fail('its class body binds %s' % d.id)
                plain.append(d)
            if not function_pure(p, ann, stmt, IN_CLASS, plain):
                return False
            if any(p.names.canon(d) == 'builtins.property' for d in stmt.decorator_list):
                props.add(stmt.name)
            local.add(stmt.name)
        elif isinstance(stmt, ast.ClassDef):
            if not class_pure(p, ann, stmt, True):
                return False
            local.add(stmt.name)
        elif isinstance(stmt, ast.Assign) and all(isinstance(t, ast.Name) for t in stmt.targets):
            if not p.expr(stmt.value, True):
                return False
            local.update(t.id for t in stmt.targets)
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            if not p.type_part(stmt.annotation) or stmt.value is not None and not p.expr(stmt.value, True):
                return False
            local.add(stmt.target.id)
        else:
            return p.fail('its class body runs code (%s)' % type(stmt).__name__)
    return True


def names_of(lead, groups, tree):
    """The file's bindings: leading-block targets, statement counts (a compound statement counts once), first definitions."""
    canon, modules, counts, defined = {}, set(), {}, {}
    for stmt in lead:
        for name in binds(stmt):
            counts[name] = counts.get(name, 0) + 1
            canon[name] = None
        if isinstance(stmt, ast.Import):
            for a in stmt.names:
                local = a.asname or a.name.split('.')[0]
                canon[local] = a.name if a.asname else local
                modules.add(local)
        elif isinstance(stmt, ast.ImportFrom) and stmt.module != '__future__':
            for a in stmt.names:
                canon[a.asname or a.name] = '%s.%s' % (stmt.module, a.name) if not stmt.level else None
    for index, stmts in enumerate(groups):
        for name in set().union(*[binds(s) for s in stmts]):
            counts[name] = counts.get(name, 0) + 1
            defined.setdefault(name, index)
    for name in global_assignments(tree):
        counts[name] = counts.get(name, 0) + 1
    return Names(canon, modules, counts, defined)
````


- [ ] **Step 4: Run the tests.**

Run (each installed Python from 3.9 to 3.14; here `/usr/bin/python3` is 3.9.6):

```bash
(cd resources/pyast && for py in /usr/bin/python3 /opt/anaconda3/bin/python3.12 python3.13 python3.14; do
  PYTHONDONTWRITEBYTECODE=1 $py -m unittest test_pyfacts 2>&1 | tail -1; done)
```

Expected:

```text
OK (skipped=1)
OK
OK
OK
```


- [ ] **Step 5: Commit.**

```bash
git add resources/pyast/my_editor_pyreads.py resources/pyast/my_editor_pyfacts.py resources/pyast/test_pyfacts.py
git commit -m "Python helper: global reads, bindings and purity"
```


## Chunk 3: The parser helper, part 2, and the import check

### Task 3: One file's JSON: byte facts, the leading block and declarations

**Files:**
- Create: `resources/pyast/my_editor_pyast.py`, `resources/pyast/test_pyast.py`

`python -I -S my_editor_pyast.py <file>` prints the facts the host needs. `-I` drops the script's folder from `sys.path`, so the script adds its own folder before importing its siblings. Byte offsets are UTF-8 (`col_offset` is a byte column in CPython; `tokenize` columns are characters and are converted). A declaration's span starts at its attached comments (none for the file's first statement, which keeps the file header), and an attribute docstring and an `@overload` group join their owner.


- [ ] **Step 1: Write the failing tests.**

Create `resources/pyast/test_pyast.py`:

````python
"""Tests for my_editor's Python parser helper (one file's JSON). Run: python3 -m unittest -v (in this folder)."""
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

import my_editor_pyast as pa

HERE = os.path.dirname(os.path.abspath(__file__))


def facts(source):
    return pa.analyze(textwrap.dedent(source).encode('utf-8'))


def decl(source, name):
    return next(d for d in facts(source)['decls'] if name in d['names'])


def text(source, name):
    raw = textwrap.dedent(source).encode('utf-8')
    d = decl(source, name)
    return raw[d['start']:d['end']].decode('utf-8')


class Spans(unittest.TestCase):
    def test_attached_comment_moves_and_detached_one_stays(self):
        src = 'import os\n\n# Detached.\n\n# Attached.\ndef f():\n    pass  # trailing\n'
        self.assertEqual(text(src, 'f'), '# Attached.\ndef f():\n    pass  # trailing')
        self.assertEqual(decl(src, 'f')['docText'], '# Attached.')

    def test_attribute_docstring_moves_with_its_constant(self):
        src = 'X = 1\n"""The X."""\ndef f():\n    pass\n'
        self.assertEqual(text(src, 'X'), 'X = 1\n"""The X."""')
        self.assertEqual(len(facts(src)['decls']), 2)

    def test_a_statement_sharing_a_line_is_not_its_own(self):
        self.assertEqual([d['own'] for d in facts('import os\nX = 1; Y = 2\n')['decls']], [False, False])

    def test_overloads_are_one_declaration(self):
        src = ('from typing import overload\n\n@overload\ndef f(x: int) -> int: ...\n@overload\ndef f(x: str) -> str: ...\n'
               'def f(x):\n    return x\n')
        found = facts(src)['decls']
        self.assertEqual((len(found), found[0]['pure'], found[0]['lines']), (1, True, 6))

    def test_offsets_are_utf8_bytes(self):
        self.assertEqual(text('import os\nNAME = "café ünïcode"\nY = 1\n', 'Y'), 'Y = 1')

    def test_the_file_header_comment_stays_and_a_comment_after_it_attaches(self):
        self.assertEqual(text('# Copyright.\nX = 1\n', 'X'), 'X = 1')
        self.assertEqual(facts('# Copyright.\n\nX = 1\n')['facadeAt'], len('# Copyright.\n\n'))
        new = '# Split from report.py by my_editor.\n\n\n# How amounts are shown.\nCURRENCY = "EUR"\n'
        self.assertEqual(text(new, 'CURRENCY'), '# How amounts are shown.\nCURRENCY = "EUR"')
        self.assertEqual(facts(new)['facadeAt'], new.index('# How'))


class LeadingBlock(unittest.TestCase):
    def test_kinds(self):
        found = facts('"""Doc."""\nfrom __future__ import annotations\nimport os\nfrom typing import TYPE_CHECKING\nif TYPE_CHECKING:\n'
                      '    from json import dumps\ntry:\n    import yaml\nexcept ImportError:\n    yaml = None\nimport sys\n'
                      'if sys.version_info >= (3, 11):\n    import tomllib\nelse:\n    import tomli as tomllib\nX = 1\n')
        self.assertEqual([i['kind'] for i in found['lead']], ['doc', 'future', 'import', 'import', 'typecheck', 'compound', 'import', 'compound'])
        self.assertEqual(found['lead'][-1]['needs'], ['sys'])
        typed = facts('from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from a import b\nelse:\n    from c import b\n')
        self.assertEqual(typed['lead'][1]['kind'], 'compound')
        self.assertTrue(found['future'])
        self.assertEqual(found['decls'][0]['names'], ['X'])

    def test_a_handler_with_other_code_ends_the_block(self):
        found = facts('import os\ntry:\n    import yaml\nexcept ImportError:\n    import warnings\n    warnings.warn("no yaml")\nimport json\n')
        self.assertEqual(([i['kind'] for i in found['lead']], found['lateImport']), (['import'], 3))

    def test_alias_spans(self):
        src = 'from m import (\n    a,\n    b as c,  # why\n)\n'
        imp = facts(src)['lead'][0]['imports'][0]
        self.assertEqual([(x['name'], x['asname'], src.encode()[x['start']:x['end']].decode()) for x in imp['aliases']],
                         [('a', None, 'a'), ('b', 'c', 'b as c')])


class Declarations(unittest.TestCase):
    def test_module_names_and_file(self):
        self.assertTrue(decl('X = 1\ndef f():\n    global X\n    X = 2\n', 'f')['globalStmt'])
        self.assertEqual(decl('def f():\n    return __name__, __doc__\n', 'f')['dunders'], ['__doc__', '__name__'])
        self.assertEqual(decl('import os\ndef f():\n    return os.path.dirname(__file__)\n', 'f')['fileUse'], 'folder')

    def test_doctest_warnings_and_class_hooks(self):
        self.assertTrue(decl('def f():\n    """\n    >>> f()\n    """\n', 'f')['doctest'])
        self.assertTrue(decl('import warnings\ndef f():\n    warnings.warn("old", DeprecationWarning)\n', 'f')['warns'])
        src = 'class B:\n    def __init_subclass__(cls):\n        pass\nclass C(B):\n    pass\n'
        self.assertEqual((decl(src, 'C')['baseNames'], decl(src, 'B')['defines']), (['B'], ['__init_subclass__']))

    def test_reads_and_import_check_facts(self):
        found = decl('import lib\nfrom typing import Optional\nX = 1\ndef f(m=lib.heavy, x=X) -> Optional[int]:\n    return "Row"\n', 'f')
        self.assertEqual((found['sameFile'], found['attrReads'], found['annReads']), (['X'], [['lib', 'heavy']], ['Optional', 'int']))
        self.assertEqual(found['relies'], ['typing'])

    def test_bindings_count_every_statement_and_global_assignment(self):
        found = facts('import os\nX = 1\nX = 2\ndef f():\n    global X\n    X = 3\n')
        self.assertEqual((found['bindings']['X'], found['globalAssigned']), (3, ['X']))


class Quiet(unittest.TestCase):
    """Early binding: only allowlisted stdlib calls with literal arguments are quiet (reviewer probes p1 and p2, reviewer point 3)."""

    def quiet(self, src):
        return facts('import atexit\nimport importlib\nimport logging\nimport threading\nimport warnings\n' + src)['decls'][0]['quiet']

    def test_not_quiet(self):
        for src in ['register()\n', 'app = Flask(__name__)\n', 'threading.Thread(target=print).start()\n', 'atexit.register(print)\n',
                    "importlib.import_module('pkg.plug')\n", 'logging.raiseExceptions = False\n', "logging.getLogger('x').error('%s', 1)\n",
                    "warnings.filterwarnings('ignore', category=DeprecationWarning)\n", 'logging.getLogger(name)\n',
                    "warnings.filterwarnings(__name__)\n", 'try:\n    CONFIG = 1\nexcept Exception:\n    CONFIG = 2\n']:
            self.assertFalse(self.quiet(src), src)

    def test_quiet(self):
        for src in ['logger = logging.getLogger(__name__)\n', "warnings.filterwarnings('ignore')\n", '"""Doc."""\n', 'pass\n',
                    "warnings.simplefilter('default')\n"]:
            self.assertTrue(self.quiet(src), src)


class FileFacts(unittest.TestCase):
    def test_namespace_and_entry_facts(self):
        self.assertEqual(facts('exec("x = 1")\n')['namespace'], 'exec()')
        self.assertTrue(facts('from os.path import *\n')['starImport'])
        self.assertTrue(facts('if __name__ == "__main__":\n    pass\n')['mainGuard'])
        self.assertTrue(facts('#!/usr/bin/env python\nX = 1\n')['shebang'])
        self.assertEqual(facts('def __getattr__(name):\n    return CACHE[name]\nCACHE = {}\n')['namespace'],
                         'a module __getattr__ or __dir__ that reads module names')

    def test_bytes_and_tool_comments(self):
        self.assertTrue(pa.analyze(b'\xef\xbb\xbfX = 1\n')['bom'])
        self.assertTrue(pa.analyze(b'X = 1\r\n')['crlf'])
        self.assertEqual(pa.analyze(b'# -*- coding: latin-1 -*-\nX = 1\n')['cookie'], 'latin-1')
        self.assertEqual(facts('# type: ignore\nX = 1\n')['toolComment'], '# type: ignore')
        self.assertEqual(facts('X = 1\n# mypy: strict\n')['toolComment'], '# mypy: strict')
        self.assertIsNone(facts('X = 1  # type: ignore\n')['toolComment'])
        self.assertTrue(facts('# %%\nX = 1\n')['cells'])

    def test_a_parse_error_is_reported(self):
        self.assertTrue(facts('def (:\n')['error'].startswith('SyntaxError'))

    def test_the_command_line_prints_json_isolated(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'm.py')
            with open(path, 'w') as handle:
                handle.write('import os\nX = 1\n')
            out = subprocess.run([sys.executable, '-I', '-S', '-B', os.path.join(HERE, 'my_editor_pyast.py'), path], capture_output=True, text=True, cwd=folder)
            self.assertEqual(json.loads(out.stdout)['decls'][0]['names'], ['X'])


if __name__ == '__main__':
    unittest.main()
````


- [ ] **Step 2: Run them to see them fail.**

Run: `(cd resources/pyast && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest test_pyast 2>&1 | grep -m1 '^ModuleNotFoundError')`

Expected:

```text
ModuleNotFoundError: No module named 'my_editor_pyast'
```


- [ ] **Step 3: Implement.**

Create `resources/pyast/my_editor_pyast.py`:

````python
"""my_editor's Python parser helper: one file's leading block, declarations, spans, reads and skip facts as JSON.

Usage: python -I -S -B my_editor_pyast.py <file>. Stdlib only, Python 3.9 syntax; offsets are UTF-8 bytes.
"""
import ast
import io
import json
import os
import re
import sys
import tokenize

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import my_editor_pyfacts as pf  # noqa: E402
import my_editor_pyreads as pr  # noqa: E402
from my_editor_pyreads import is_import  # noqa: E402

COOKIE = re.compile(rb'^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)')
TOOL = re.compile(r'^#\s*(?:(?:mypy|pyright|pytype)\s*:|type:\s*ignore\s*$)')
CELLS = re.compile(r'^# (?:%%|COMMAND -{10})|^# jupyter:', re.M)
FALLBACK_ERRORS = frozenset(['ImportError', 'ModuleNotFoundError'])


def line_starts(raw):
    starts = [0]
    for i, byte in enumerate(raw):
        if byte == 10:
            starts.append(i + 1)
    return starts


def comment_lines(text):
    """Line number -> comment text, for lines that hold only a comment."""
    found = {}
    try:
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type == tokenize.COMMENT and not tok.line[:tok.start[1]].strip():
                found[tok.start[0]] = tok.string
    except (tokenize.TokenError, SyntaxError):
        pass
    return found


def only_imports(body):
    return bool(body) and all(is_import(s) for s in body)


def is_typecheck(test):
    return (isinstance(test, ast.Name) and test.id == 'TYPE_CHECKING'
            or isinstance(test, ast.Attribute) and test.attr == 'TYPE_CHECKING' and isinstance(test.value, ast.Name))


def sys_attr(node, attr):
    if isinstance(node, ast.Subscript):
        node = node.value
    return isinstance(node, ast.Attribute) and node.attr == attr and isinstance(node.value, ast.Name) and node.value.id == 'sys'


def is_platform_test(test):
    """`sys.version_info` against a tuple of ints, `sys.platform` against or `.startswith` a string."""
    if isinstance(test, ast.Compare) and len(test.comparators) == 1:
        right = test.comparators[0]
        if sys_attr(test.left, 'version_info'):
            return isinstance(right, ast.Tuple) and all(isinstance(e, ast.Constant) and isinstance(e.value, int) for e in right.elts)
        return sys_attr(test.left, 'platform') and isinstance(right, ast.Constant) and isinstance(right.value, str)
    return (isinstance(test, ast.Call) and isinstance(test.func, ast.Attribute) and test.func.attr == 'startswith'
            and sys_attr(test.func.value, 'platform') and len(test.args) == 1 and isinstance(test.args[0], ast.Constant))


def if_of_imports(node, test):
    if not (test(node.test) and only_imports(node.body)):
        return False
    rest = node.orelse
    return not rest or only_imports(rest) or len(rest) == 1 and isinstance(rest[0], ast.If) and if_of_imports(rest[0], test)


def fallback_handler(handler):
    names = handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
    if handler.name or not all(isinstance(n, ast.Name) and n.id in FALLBACK_ERRORS for n in names):
        return False
    return all(is_import(s) or isinstance(s, ast.Pass) or isinstance(s, ast.Assign) and all(isinstance(t, ast.Name) for t in s.targets)
               and isinstance(s.value, ast.Constant) for s in handler.body)


def lead_kind(stmt, first):
    """The leading-block kind of a statement, or None when the block ends before it."""
    if first and isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
        return 'doc'
    if isinstance(stmt, ast.ImportFrom) and stmt.module == '__future__':
        return 'future'
    if is_import(stmt):
        return None if any(a.name == '*' for a in stmt.names) else 'import'
    if isinstance(stmt, ast.If) and not stmt.orelse and if_of_imports(stmt, is_typecheck):
        return 'typecheck'
    if isinstance(stmt, ast.If) and if_of_imports(stmt, lambda test: is_platform_test(test) or is_typecheck(test)):
        return 'compound'
    if (isinstance(stmt, ast.Try) and only_imports(stmt.body) and stmt.handlers and not stmt.finalbody
            and (not stmt.orelse or only_imports(stmt.orelse)) and all(fallback_handler(h) for h in stmt.handlers)):
        return 'compound'
    return None


class Source:
    """The file's bytes with line offsets, for byte spans from line and column numbers."""

    def __init__(self, raw):
        self.raw = raw
        self.starts = line_starts(raw)
        self.lines = raw.split(b'\n')

    def at(self, line, col=0):
        return self.starts[line - 1] + col

    def line_end(self, line):
        return self.starts[line] - 1 if line < len(self.starts) else len(self.raw)

    def char_col(self, line, chars):
        """Byte column of a character column (tokenize counts characters)."""
        return len(self.lines[line - 1].decode('utf-8', 'replace')[:chars].encode('utf-8'))


def first_line(stmt):
    return min([stmt.lineno] + [d.lineno for d in getattr(stmt, 'decorator_list', [])])


def alias_spans(src, stmt):
    """Each alias of an import statement as (name, asname, start, end) bytes, found by tokenizing the statement."""
    text = src.raw[src.at(stmt.lineno):src.line_end(stmt.end_lineno)].decode('utf-8')
    tokens = [t for t in tokenize.generate_tokens(io.StringIO(text + '\n').readline)
              if t.type in (tokenize.NAME, tokenize.OP) and t.string not in '()']
    at = next(i for i, t in enumerate(tokens) if t.string == 'import') + 1
    found = []
    while at < len(tokens):
        begin = tokens[at]
        name = begin.string
        at += 1
        while at < len(tokens) and tokens[at].string == '.':
            name += '.' + tokens[at + 1].string
            at += 2
        end = tokens[at - 1]
        asname = None
        if at < len(tokens) and tokens[at].string == 'as':
            asname = tokens[at + 1].string
            end = tokens[at + 1]
            at += 2
        line = stmt.lineno + begin.start[0] - 1
        last = stmt.lineno + end.end[0] - 1
        found.append({'name': name, 'asname': asname, 'start': src.at(line, src.char_col(line, begin.start[1])),
                      'end': src.at(last, src.char_col(last, end.end[1]))})
        at += 1
    return found


def import_facts(src, stmt):
    out = []
    for node in ast.walk(stmt):
        if is_import(node):
            out.append({'kind': 'from' if isinstance(node, ast.ImportFrom) else 'import',
                        'module': getattr(node, 'module', None) or '', 'level': getattr(node, 'level', 0) or 0,
                        'line': node.lineno, 'start': src.at(node.lineno, node.col_offset), 'end': src.at(node.end_lineno, node.end_col_offset),
                        'lineStart': src.at(node.lineno), 'aliases': alias_spans(src, node)})
    return out


def leading_block(src, body):
    lead = []
    for index, stmt in enumerate(body):
        kind = lead_kind(stmt, index == 0)
        if kind is None:
            break
        needs = sorted({n.id for n in ast.walk(stmt.test) if isinstance(n, ast.Name)}) if isinstance(stmt, ast.If) else []
        lead.append({'kind': kind, 'start': src.at(stmt.lineno), 'end': src.line_end(stmt.end_lineno), 'line': stmt.lineno,
                     'endLine': stmt.end_lineno, 'binds': sorted(pr.binds(stmt)), 'needs': needs, 'imports': import_facts(src, stmt),
                     'stmtEnd': src.at(stmt.end_lineno, stmt.end_col_offset)})
    return lead


def group(stmts, names):
    """Top-level statements after the leading block as declarations: overloads and attribute docstrings join their owner."""
    groups = []
    for stmt in stmts:
        prev = groups[-1] if groups else None
        if (prev and isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str)
                and isinstance(prev[-1], (ast.Assign, ast.AnnAssign)) and stmt.lineno == prev[-1].end_lineno + 1):
            prev.append(stmt)
            continue
        if (prev and isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)) and isinstance(prev[-1], type(stmt))
                and prev[-1].name == stmt.name and any(names.canon(d) == 'typing.overload' for d in prev[-1].decorator_list)):
            prev.append(stmt)
            continue
        groups.append([stmt])
    return groups


def target_names(stmt):
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [stmt.name]
    if isinstance(stmt, ast.Assign):
        return [n.id for t in stmt.targets for n in ast.walk(t) if isinstance(n, ast.Name)]
    if isinstance(stmt, ast.AnnAssign):
        return [stmt.target.id] if isinstance(stmt.target, ast.Name) else []
    if type(stmt).__name__ == 'TypeAlias':
        return [stmt.name.id]
    return sorted(pr.binds(stmt))


def kind_of(stmt):
    if isinstance(stmt, ast.AsyncFunctionDef):
        return 'async def'
    if isinstance(stmt, ast.FunctionDef):
        return 'def'
    if isinstance(stmt, ast.AnnAssign):
        return 'annassign' if stmt.value is not None else 'annotation'
    if type(stmt).__name__ == 'TypeAlias':
        return 'type'
    return 'class' if isinstance(stmt, ast.ClassDef) else type(stmt).__name__.lower()


def quiet_call(stmt, names):
    """A statement that only calls the quiet stdlib allowlist with literal arguments (and `__name__` for getLogger)."""
    if isinstance(stmt, ast.Pass) or isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant):
        return True
    if isinstance(stmt, ast.If) and is_typecheck(stmt.test) and not stmt.orelse:
        return True
    call = stmt.value if isinstance(stmt, ast.Expr) or isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 \
        and isinstance(stmt.targets[0], ast.Name) else None
    if not isinstance(call, ast.Call):
        return False
    target = names.canon(call.func)
    if target not in pf.QUIET_CALLS:
        return False
    args = call.args + [k.value for k in call.keywords if k.arg]
    if len(args) != len(call.args) + len(call.keywords):
        return False
    return all(isinstance(a, ast.Constant) or target == 'logging.getLogger' and isinstance(a, ast.Name) and a.id == '__name__' for a in args)


def purity(stmts, names, index):
    """(definition-time purity, annotation purity) of one declaration."""
    p, ann = pf.Purity(names, index), pf.Purity(names, index)
    stmt = stmts[0]
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
        all(pf.function_pure(p, ann, s, pf.TOP_FUNC) for s in stmts)
    elif isinstance(stmt, ast.ClassDef):
        pf.class_pure(p, ann, stmt)
    elif isinstance(stmt, ast.Assign):
        if len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
            p.expr(stmt.value)
        else:
            p.fail('it unpacks or assigns more than one target')
    elif isinstance(stmt, ast.AnnAssign) and stmt.value is not None and isinstance(stmt.target, ast.Name):
        ann.type_part(stmt.annotation)
        p.expr(stmt.value)
    elif type(stmt).__name__ != 'TypeAlias':
        p.fail('it is not a definition, or it runs code')
    return p, ann


def declaration(src, stmts, index, names, tables, comments, floor, future):
    stmt, last = stmts[0], stmts[-1]
    top = first_line(stmt)
    start_line = top
    while start_line - 1 > floor and start_line - 1 in comments:
        start_line -= 1
    if start_line == 1:
        start_line = top  # comments from the first line on are the file's header (shebang, license), not this declaration's
    end_line = last.end_lineno
    before = src.lines[top - 1][:min(stmt.col_offset, *[d.col_offset - 1 for d in getattr(stmt, 'decorator_list', [])] or [stmt.col_offset])]
    after = src.lines[end_line - 1][last.end_col_offset:].strip()
    p, ann = purity(stmts, names, index)
    def_reads, ann_reads = [], []
    for s in stmts:
        d, a = pr.definition_reads(s)
        def_reads += d
        ann_reads += a
    later = [n for line, found, _ in tables if top <= line <= end_line for n in found]
    strings = [n for s in stmts for n in pr.forward_refs(s)] + [n for s in stmts if isinstance(s, ast.AnnAssign) for n in pr.strings_in(s.annotation)]
    docs = pr.docstrings(stmts)
    attached = [comments[line] for line in range(start_line, top)]
    walk = [n for s in stmts for n in ast.walk(s)]
    doc = ast.get_docstring(stmt, clean=True) if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) else None
    return {
        'id': index, 'kind': kind_of(stmt), 'names': target_names(stmt), 'start': src.at(start_line), 'end': src.line_end(end_line),
        'line': start_line, 'lines': end_line - start_line + 1, 'own': not before.strip() and (not after or after.startswith(b'#')),
        'doc': (doc or '').strip().split('\n')[0], 'docText': '\n'.join(attached + docs[:1]),
        'pure': p.reason is None, 'impure': p.reason, 'annImpure': ann.reason, 'quiet': quiet_call(stmt, names),
        'sameFile': sorted(p.same_file), 'annSameFile': sorted(ann.same_file),
        'attrReads': sorted([list(r) for r in p.attr_reads | ann.attr_reads]), 'relies': sorted(p.relies | ann.relies),
        'defReads': sorted(set(def_reads)), 'annReads': sorted(set(ann_reads)), 'reads': sorted(set(def_reads + ann_reads + later + strings)),
        'globalStmt': any(isinstance(n, (ast.Global, ast.Nonlocal)) for n in walk),
        'dunders': sorted({n.id for n in walk if isinstance(n, ast.Name) and n.id in pr.MODULE_DUNDERS}),
        'fileUse': pr.file_use(stmts), 'doctest': any('>>>' in d for d in docs),
        'warns': any(isinstance(n, ast.Call) and (names.canon(n.func) in ('warnings.warn', 'warnings.warn_explicit') or isinstance(n.func, ast.Attribute)
                     and n.func.attr == 'warn' and isinstance(n.func.value, ast.Name) and n.func.value.id == 'warnings') for n in walk),
        'defines': [s.name for s in stmt.body if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))] if isinstance(stmt, ast.ClassDef) else [],
        'baseNames': [b.id for b in stmt.bases if isinstance(b, ast.Name) and b.id in p.same_file] if isinstance(stmt, ast.ClassDef) else [],
    }


def byte_facts(raw, text):
    cookie = next((m.group(1).decode() for m in (COOKIE.match(line) for line in raw.split(b'\n')[:2]) if m), None)
    return {'bom': raw.startswith(b'\xef\xbb\xbf'), 'crlf': b'\r\n' in raw, 'cookie': cookie, 'shebang': raw.startswith(b'#!'),
            'size': len(raw), 'longLine': any(len(line) > 1000 for line in text.split('\n')), 'cells': bool(CELLS.search(text))}


def analyze(raw, filename='<file>'):
    """Everything the host needs about one file, as a JSON-ready dict."""
    text = raw.decode('utf-8', 'replace')
    out = dict(byte_facts(raw, text), python=list(sys.version_info[:3]), error=None)
    try:
        tree = ast.parse(raw, filename)
        table = pr.module_table(text, filename)
    except (SyntaxError, ValueError) as error:
        out['error'] = '%s: %s' % (type(error).__name__, error)
        return out
    src = Source(raw)
    comments = comment_lines(text)
    first = tree.body[0].lineno if tree.body else len(src.starts)
    lead = leading_block(src, tree.body)
    groups = group(tree.body[len(lead):], pf.Names({}, set(), {}, {}))
    names = pf.names_of(tree.body[:len(lead)], groups, tree)
    groups = group(tree.body[len(lead):], names)
    tables = pr.table_reads(table)
    decls = []
    floor = lead[-1]['endLine'] if lead else 0
    future = any(isinstance(s, ast.ImportFrom) and s.module == '__future__' and any(a.name == 'annotations' for a in s.names) for s in tree.body)
    for index, stmts in enumerate(groups):
        decls.append(declaration(src, stmts, index, names, tables, comments, groups[index - 1][-1].end_lineno if index else floor, future))
    has_getattr, getattr_reads = pr.module_getattr(tree, table, names.counts)
    tool = [c for line, c in comments.items() if TOOL.match(c) and (line < first or not c.startswith('# type:'))]
    out.update({
        'future': future, 'firstComment': next(iter(sorted(comments.items())), (0, ''))[1], 'toolComment': tool[0] if tool else None,
        'namespace': pr.namespace_use(tree, names) or ('a module __getattr__ or __dir__ that reads module names' if getattr_reads else None),
        'mainGuard': pr.main_guard(tree), 'starImport': any(is_import(n) and any(a.name == '*' for a in n.names) for n in ast.walk(tree)),
        'lateImport': pr.late_import(tree.body[len(lead):]), 'moduleGetattr': has_getattr, 'lead': lead,
        'facadeAt': src.line_end(lead[-1]['endLine']) + 1 if lead else decls[0]['start'] if decls else len(raw),
        'decls': decls, 'bindings': names.counts, 'globalAssigned': pr.global_assignments(tree),
    })
    return out


if __name__ == '__main__':
    with open(sys.argv[1], 'rb') as handle:
        print(json.dumps(analyze(handle.read(), sys.argv[1])))
````


- [ ] **Step 4: Run the tests.**

Run (each installed Python from 3.9 to 3.14; here `/usr/bin/python3` is 3.9.6):

```bash
(cd resources/pyast && for py in /usr/bin/python3 /opt/anaconda3/bin/python3.12 python3.13 python3.14; do
  PYTHONDONTWRITEBYTECODE=1 $py -m unittest test_pyfacts test_pyast 2>&1 | tail -1; done)
```

Expected:

```text
OK (skipped=1)
OK
OK
OK
```


- [ ] **Step 5: Commit.**

```bash
git add resources/pyast/my_editor_pyast.py resources/pyast/test_pyast.py
git commit -m "Python helper: leading block, declarations and file facts"
```


### Task 4: The import check

**Files:**
- Create: `resources/pyast/my_editor_pycheck.py`, `resources/pyast/test_pycheck.py`

`python -m my_editor_pycheck pkg.report`, from the project folder with the helper folder and the import roots on `PYTHONPATH`: runs the original's leading block statement by statement in a plain dict (never `sys.modules`), records failed fallback imports, checks what the new modules copy, imports the original, and checks object identity against both the original and the scratch run. Its tests write temporary packages and run it in a fresh interpreter; reviewer probes p3, p6 and p7 and reviewer points 1 and 2 are named cases.


- [ ] **Step 1: Write the failing tests.**

Create `resources/pyast/test_pycheck.py`:

````python
"""Tests for my_editor's import check, on temporary packages run in a fresh interpreter. Run: python3 -m unittest -v."""
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
HEADER = '# Split from report.py by my_editor.\n\n'


def run(files, module='pkg.report'):
    """Writes the files into a temporary folder and runs the check there; returns (exit code, output)."""
    with tempfile.TemporaryDirectory() as root:
        for name, text in files.items():
            path = os.path.join(root, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w') as handle:
                handle.write(textwrap.dedent(text))
        env = dict(os.environ, PYTHONPATH=os.pathsep.join([HERE, root]), PYTHONDONTWRITEBYTECODE='1')
        result = subprocess.run([sys.executable, '-m', 'my_editor_pycheck', module], cwd=root, env=env, capture_output=True, text=True)
        return result.returncode, result.stdout + result.stderr


SPLIT = {
    'pkg/__init__.py': '',
    'pkg/report.py': 'import json\nfrom .rows import parse as parse\n\n\ndef report(x):\n    return parse(x)\n',
    'pkg/rows.py': HEADER + 'import json\n\n\ndef parse(x):\n    return json.loads(x)\n',
}


class ImportCheck(unittest.TestCase):
    def test_a_clean_split_passes(self):
        code, out = run(SPLIT)
        self.assertEqual(code, 0, out)
        self.assertIn('share every object', out)

    def test_the_baseline_passes_without_new_modules(self):
        self.assertEqual(run({'pkg/__init__.py': '', 'pkg/report.py': 'import json\nX = 1\n'})[0], 0)

    def test_a_module_getattr_returning_new_objects_fails(self):
        files = dict(SPLIT, **{
            'lazy.py': 'def __getattr__(name):\n    return object()\n',
            'pkg/report.py': 'import lazy\nfrom lazy import thing\nfrom .rows import parse as parse\n',
            'pkg/rows.py': HEADER + 'from lazy import thing\n\n\ndef parse():\n    return thing\n'})
        code, out = run(files)
        self.assertEqual(code, 1)
        self.assertIn('imports thing from lazy, which only its __getattr__ provides', out)

    def test_a_lazy_package_import_needs_getattr_again(self):
        """Reviewer probe p6: copying `from pkg import old_api` would run the package's __getattr__ (and its warning) again."""
        files = {'pkg/__init__.py': 'import warnings\ndef __getattr__(name):\n    warnings.warn("old", DeprecationWarning)\n    return len\n',
                 'pkg/report.py': 'from pkg import old_api\nfrom .rows import f as f\n',
                 'pkg/rows.py': HEADER + 'from pkg import old_api\n\n\ndef f():\n    return old_api\n'}
        code, out = run(files)
        self.assertEqual(code, 1)
        self.assertIn('which only its __getattr__ provides', out)

    def test_an_attribute_read_when_defined_must_already_be_set(self):
        """Reviewer probe p7: `def f(m=lib.heavy)` would trigger a lazy submodule import at the facade."""
        files = {'lib/__init__.py': 'import importlib\ndef __getattr__(name):\n    return importlib.import_module("lib." + name)\n',
                 'lib/heavy.py': 'X = 1\n', 'pkg/__init__.py': '',
                 'pkg/report.py': 'import lib\nfrom .rows import f as f\n',
                 'pkg/rows.py': HEADER + 'import lib\n\n\ndef f(m=lib.heavy):\n    return m\n'}
        code, out = run(files)
        self.assertEqual(code, 1)
        self.assertIn('reads lib.heavy when defined', out)

    def test_a_fallback_that_failed_half_way_fails(self):
        """Reviewer probe p3: `_speed` runs its top half and then fails, so copying the fallback would run that half again."""
        fallback = 'try:\n    from ._speed import fast\nexcept ImportError:\n    fast = None\n'
        files = {'pkg/__init__.py': '', 'pkg/_speed.py': 'print("top half")\nfrom json import not_here\ndef fast():\n    return 1\n',
                 'pkg/report.py': fallback + 'from .rows import parse as parse\nCHUNK = 10\n',
                 'pkg/rows.py': HEADER + fallback + '\n\ndef parse():\n    return fast\n'}
        code, out = run(files)
        self.assertEqual(code, 1, out)
        self.assertIn('copies a fallback import of pkg._speed that failed with ImportError', out)

    def test_clean_fallbacks_pass(self):
        """A missing module, and a loaded module that lacks the name (reviewer point 1: `from yaml import CSafeLoader`)."""
        fallback = ('try:\n    from not_installed_anywhere import thing\nexcept ImportError:\n    thing = None\n'
                    'try:\n    from json import CSafeLoader\nexcept ImportError:\n    CSafeLoader = None\n')
        files = {'pkg/__init__.py': '', 'pkg/report.py': fallback + 'from .rows import parse as parse\n',
                 'pkg/rows.py': HEADER + fallback + '\n\ndef parse():\n    return thing, CSafeLoader\n'}
        code, out = run(files)
        self.assertEqual(code, 0, out)

    def test_an_import_that_patches_a_module_between_fails(self):
        files = {'pkg/__init__.py': '', 'patcher.py': 'import os\nos.sep = "patched"\n',
                 'pkg/report.py': 'from os import sep\nimport patcher\nfrom .rows import f as f\n',
                 'pkg/rows.py': HEADER + 'from os import sep\n\n\ndef f():\n    return sep\n'}
        code, out = run(files)
        self.assertEqual(code, 1, out)
        self.assertIn('sep in rows.py is not what the original\'s imports bound', out)

    def test_a_leading_import_cycle_fails_safely(self):
        """Reviewer point 2 and probe p3's cycle: the scratch run is never registered as the original, so a leading import
        that comes back to it imports the real module, and the check fails instead of reading a half-loaded one."""
        files = {'pkg/__init__.py': '', 'pkg/_speed.py': 'from pkg.report import CHUNK\n',
                 'pkg/report.py': 'try:\n    from ._speed import fast\nexcept ImportError:\n    fast = None\nCHUNK = 10\n'}
        code, out = run(files)
        self.assertEqual(code, 1)
        self.assertIn('imports pkg.report back (an import cycle)', out)

    def test_a_module_that_does_not_import_fails_with_its_error(self):
        code, out = run({'pkg/__init__.py': '', 'pkg/report.py': 'import json\nraise RuntimeError("needs settings")\n'})
        self.assertEqual(code, 1)
        self.assertIn('importing pkg.report failed: RuntimeError: needs settings', out)


if __name__ == '__main__':
    unittest.main()
````


- [ ] **Step 2: Run them to see them fail.**

Run: `(cd resources/pyast && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest test_pycheck 2>&1 | tail -1)`

Expected:

```text
FAILED (failures=10)
```


- [ ] **Step 3: Implement.**

Create `resources/pyast/my_editor_pycheck.py`:

````python
"""my_editor's import check: the original module and the modules split from it import, and share every object.

Usage: python -m my_editor_pycheck <module>, from the project folder, with this folder and the import roots on PYTHONPATH.
It runs the original's leading imports alone in a scratch namespace (never registered in sys.modules), checks what
the new modules copy from them, imports the original, and checks object identity. Stdlib only, Python 3.9 syntax.
"""
import ast
import builtins
import importlib
import importlib.util
import os
import sys

import my_editor_pyast as pa


def absolute(module, level, package):
    if not level:
        return module
    base = package.rsplit('.', level - 1)[0] if level > 1 else package
    return '%s.%s' % (base, module) if module else base


def loaded_cleanly(name):
    """A module that finished loading and has no module `__getattr__`, so a failed `from` import of it fails the same way again."""
    mod = sys.modules.get(name)
    return mod is not None and not getattr(getattr(mod, '__spec__', None), '_initializing', False) and '__getattr__' not in vars(mod)


def clean_failure(error, module):
    """A fallback import failed without running half a module: it (or a parent) is missing, or it is loaded and lacks the name."""
    if isinstance(error, ModuleNotFoundError):
        parts = module.split('.')
        return error.name in ['.'.join(parts[:i]) for i in range(1, len(parts) + 1)]
    return type(error) is ImportError and error.name == module and loaded_cleanly(module)


class Scratch:
    """Runs the leading block statement by statement in a plain dict namespace, recording failed fallback imports."""

    def __init__(self, name, package, origin):
        self.namespace = {'__name__': name, '__package__': package, '__file__': origin, '__builtins__': builtins, '__spec__': None}
        self.package = package
        self.origin = origin
        self.failures = {}

    def run(self, stmt):
        exec(compile(ast.Module(body=[stmt], type_ignores=[]), self.origin, 'exec'), self.namespace)

    def statement(self, stmt, text):
        if not isinstance(stmt, ast.Try):
            self.run(stmt)
            return
        for inner in stmt.body:
            try:
                self.run(inner)
            except ImportError as error:
                module = absolute(getattr(inner, 'module', None) or inner.names[0].name, getattr(inner, 'level', 0), self.package)
                self.failures[text] = (error, module)
                handler = next((h for h in stmt.handlers if any(isinstance(error, getattr(builtins, n.id)) for n in (
                    h.type.elts if isinstance(h.type, ast.Tuple) else [h.type]))), None)
                if handler is None:
                    raise
                for s in handler.body:
                    self.run(s)
                return
        for s in stmt.orelse:
            self.run(s)


def split_modules(facts, origin):
    """New modules named by the facade: level-1 imports of siblings whose first line is this original's split header."""
    header = '# Split from %s by my_editor.' % os.path.basename(origin)
    found = []
    for item in facts['lead']:
        for imp in item['imports']:
            path = os.path.join(os.path.dirname(origin), '%s.py' % imp['module'])
            if imp['kind'] == 'from' and imp['level'] == 1 and imp['module'] and os.path.isfile(path):
                with open(path, 'rb') as handle:
                    raw = handle.read()
                if raw.split(b'\n', 1)[0].decode('utf-8', 'replace') == header:
                    found.append((imp['module'], path, pa.analyze(raw, path), item))
    return found


def check(name):
    """Plain lines naming each failure; empty when the module passes."""
    spec = importlib.util.find_spec(name)
    if spec is None or not spec.origin or not os.path.isfile(spec.origin):
        return ['%s cannot be found from this folder.' % name]
    origin = spec.origin
    root = os.path.realpath(os.getcwd())
    if not os.path.realpath(origin).startswith(root + os.sep):
        return ['%s resolves to %s, outside this folder, so the check would test other code.' % (name, origin)]
    package = name if os.path.basename(origin) == '__init__.py' else name.rpartition('.')[0]
    with open(origin, 'rb') as handle:
        raw = handle.read()
    facts = pa.analyze(raw, origin)
    if facts['error']:
        return ['%s does not parse: %s' % (name, facts['error'])]
    news = split_modules(facts, origin)
    facade = [item for _, _, _, item in news]
    tree = ast.parse(raw, origin)
    scratch = Scratch(name, package, origin)
    for item, stmt in zip(facts['lead'], tree.body):
        text = raw[item['start']:item['end']].decode('utf-8')
        if item['kind'] != 'doc' and item not in facade:
            scratch.statement(stmt, text)
    if name in sys.modules:
        return ['A leading import of %s imports %s back (an import cycle), so its imports cannot be checked on their own.' % (name, name)]
    problems = []
    for stem, path, new, _ in news:
        where = os.path.basename(path)
        with open(path, 'rb') as handle:
            new_raw = handle.read()
        for item in new['lead']:
            text = new_raw[item['start']:item['end']].decode('utf-8')
            if item['kind'] == 'compound' and text in scratch.failures:
                error, module = scratch.failures[text]
                if not clean_failure(error, module):
                    problems.append('%s copies a fallback import of %s that failed with %s: %s' % (where, module, type(error).__name__, error))
                continue
            for imp in item['imports']:
                module = absolute(imp['module'], imp['level'], package)
                if imp['kind'] != 'from' or module == '__future__' or imp['level'] == 1 and imp['module'] in [s for s, _, _, _ in news]:
                    continue
                mod = sys.modules.get(module)
                if mod is None:
                    if item['kind'] == 'import':
                        problems.append('%s imports from %s, which the original\'s imports did not load.' % (where, module))
                    continue
                for alias in imp['aliases']:
                    if alias['name'] not in vars(mod):
                        problems.append('%s imports %s from %s, which only its __getattr__ provides.' % (where, alias['name'], module))
        for decl in new['decls']:
            for module, attr in decl['attrReads']:
                mod = sys.modules.get(module)
                if mod is None or attr not in vars(mod):
                    problems.append('%s reads %s.%s when defined, which is not set right after the imports.' % (where, module, attr))
    if problems:
        return problems
    original = importlib.import_module(name)
    for stem, path, new, _ in news:
        module = sys.modules.get('%s.%s' % (package, stem))
        if module is None:
            problems.append('%s.%s was not imported by %s.' % (package, stem, name))
            continue
        bound = {n for item in new['lead'] if item['kind'] != 'future' for n in item['binds']}
        moved = {n for decl in new['decls'] for n in decl['names']}
        for n in sorted(bound | moved):
            if n not in vars(module) or n not in vars(original) or vars(module)[n] is not vars(original)[n]:
                problems.append('%s in %s is not the same object as in %s.' % (n, os.path.basename(path), name))
            elif n in bound and n in scratch.namespace and vars(module)[n] is not scratch.namespace[n]:
                problems.append('%s in %s is not what the original\'s imports bound: an import between them changed it.' % (n, os.path.basename(path)))
    return problems


def main(argv):
    if len(argv) != 2:
        print('usage: python -m my_editor_pycheck <module>')
        return 2
    try:
        problems = check(argv[1])
    except Exception as error:  # noqa: BLE001 - any failure of the project's import-time code is the answer
        problems = ['importing %s failed: %s: %s' % (argv[1], type(error).__name__, error)]
    for line in problems:
        print('my_editor_pycheck: %s' % line)
    if not problems:
        print('my_editor_pycheck: %s imports; its split modules share every object.' % argv[1])
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
````


- [ ] **Step 4: Run the tests.**

Run (each installed Python from 3.9 to 3.14; here `/usr/bin/python3` is 3.9.6):

```bash
(cd resources/pyast && for py in /usr/bin/python3 /opt/anaconda3/bin/python3.12 python3.13 python3.14; do
  PYTHONDONTWRITEBYTECODE=1 $py -m unittest test_pyfacts test_pyast test_pycheck 2>&1 | tail -1; done)
```

Expected:

```text
OK (skipped=1)
OK
OK
OK
```


- [ ] **Step 5: Commit.**

```bash
git add resources/pyast/my_editor_pycheck.py resources/pyast/test_pycheck.py
git commit -m "Python helper: the import check"
```


## Chunk 4: The interpreter and the helper's JSON in TypeScript

### Task 5: Choosing, probing and gating the project's Python

**Files:**
- Create: `src/aiready/pyAst.ts`, `src/aiready/pyInterpreter.ts`, `test/pyFixture.ts`, `test/aiReadyPyInterpreter.test.ts`

Candidates are a venv in the folder (`.venv`, `venv`, `env` with `pyvenv.cfg`), Poetry, Pipenv or Hatch when configured (asked once, without a shell), and pyenv versions named by `.python-version` (the concrete interpreter, never a shim). The pick is remembered per folder in global storage. The probe runs with `-I` (site on, no project code). Paths are never resolved through symlinks. Fake interpreters in the tests are shell scripts that print the probe's JSON.


- [ ] **Step 1: Write the failing tests.**

Create `test/pyFixture.ts`:

````ts
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findTool } from '../src/aiready/projectCommands';
import { probePython, PyInterpreter } from '../src/aiready/pyInterpreter';

/** The shipped helper folder, from `out-test/test`. */
export const HELPER = path.resolve(__dirname, '../../resources/pyast');

let probed: PyInterpreter | null | undefined;

/** The machine's python3, probed once; undefined when there is none (the Python tests then skip themselves). */
export function python(): PyInterpreter | undefined {
	if (probed === undefined) {
		const file = findTool('python3');
		const found = file ? probePython(file) : undefined;
		probed = typeof found === 'object' ? found : null;
	}
	return probed ?? undefined;
}

/** For `test(name, { skip: noPython() }, …)`. */
export function noPython(): string | false {
	return python() ? false : 'python3 is not installed';
}

/** A temporary project folder with these files; with `git`, a repository with one commit. */
export function pyProjectFiles(files: Record<string, string>, git = false): { root: string; tracked: string[] } {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-py-project-'));
	for (const [file, text] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		writeFileSync(path.join(root, file), text);
	}
	if (git) {
		const run = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
		run('init', '--quiet');
		run('config', 'user.email', 'test@example.com');
		run('config', 'user.name', 'Test');
		run('add', '.');
		run('commit', '--quiet', '-m', 'first');
	}
	return { root, tracked: Object.keys(files).sort() };
}

/** A fake interpreter: a script that prints the probe's JSON for this version and implementation. */
export function fakePython(dir: string, version: [number, number, number], implementation = 'cpython'): string {
	const file = path.join(dir, 'python');
	mkdirSync(dir, { recursive: true });
	const tools = { pytest: false, randomly: false, mypy: false, black: false, pytestDjango: false };
	const probe = { version, implementation, prefix: dir, venv: false, stdlib: ['json', 'os'], installed: [], tools };
	writeFileSync(file, `#!/bin/sh\necho '${JSON.stringify(probe)}'\n`, { mode: 0o755 });
	return file;
}
````

Create `test/aiReadyPyInterpreter.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { pyFileFacts } from '../src/aiready/pyAst';
import { interpreterProblem, probePython, pythonApprovalNote, pythonCandidates, pythonEnv, pythonFor, PyInterpreter } from '../src/aiready/pyInterpreter';
import { fakePython, HELPER, noPython, python } from './pyFixture';

const temp = () => mkdtempSync(path.join(os.tmpdir(), 'my-editor-python-'));

function venv(root: string, dir = '.venv'): string {
	mkdirSync(path.join(root, dir, 'bin'), { recursive: true });
	writeFileSync(path.join(root, dir, 'pyvenv.cfg'), 'home = /usr/bin\n');
	symlinkSync(python()!.path, path.join(root, dir, 'bin', 'python'));
	return path.join(root, dir, 'bin', 'python');
}

test('a .venv in the project is a candidate, and its symlinked python is not resolved', { skip: noPython() }, () => {
	const root = temp();
	const file = venv(root);
	assert.deepEqual(pythonCandidates(root), [file]);
	const probed = probePython(file);
	assert.ok(typeof probed === 'object');
	assert.equal(probed.path, file);
	assert.equal(interpreterProblem(probed), undefined);
});

test('a Poetry project asks `poetry env info --executable`, and two candidates both reach the chooser', { skip: noPython() }, async () => {
	const root = temp();
	const bin = temp();
	writeFileSync(path.join(root, 'pyproject.toml'), '[tool.poetry]\nname = "x"\n');
	const poetryPython = venv(bin, 'poetry-env');
	writeFileSync(path.join(bin, 'poetry'), `#!/bin/sh\n[ "$1 $2 $3" = "env info --executable" ] && echo ${poetryPython}\n`, { mode: 0o755 });
	const own = venv(root);
	const saved = process.env.PATH;
	process.env.PATH = `${bin}${path.delimiter}${saved}`;
	try {
		assert.deepEqual(pythonCandidates(root), [own, poetryPython]);
		const seen: (readonly string[])[] = [];
		const storage = temp();
		const chosen = await pythonFor(root, storage, async candidates => { seen.push(candidates); return candidates[1]; });
		assert.equal(typeof chosen === 'object' && chosen.path, poetryPython);
		assert.deepEqual(seen, [[own, poetryPython]]);
		const again = await pythonFor(root, storage, async () => assert.fail('the pick is remembered'));
		assert.equal(typeof again === 'object' && again.path, poetryPython);
	} finally {
		process.env.PATH = saved;
	}
});

test('the version gate: 3.15 and 3.8 stop, PyPy stops, a pyenv shim is rejected', async () => {
	const dir = temp();
	const check = (version: [number, number, number], implementation = 'cpython') => {
		const probed = probePython(fakePython(path.join(dir, `${version.join('-')}-${implementation}`), version, implementation)) as PyInterpreter;
		return interpreterProblem(probed);
	};
	assert.equal(check([3, 15, 0]), 'Python splitting needs Python 3.9 to 3.14 for now.');
	assert.match(check([3, 8, 18]) ?? '', /needs Python 3\.9 to 3\.14; .* is 3\.8\.18/);
	assert.match(check([3, 11, 0], 'pypy') ?? '', /needs CPython/);
	assert.equal(check([3, 14, 0]), undefined);
	const shim = fakePython(path.join(dir, '.pyenv', 'shims'), [3, 12, 0]);
	assert.match(interpreterProblem(probePython(shim) as PyInterpreter) ?? '', /version-manager shim/);
	assert.match(await pythonFor(temp(), temp(), async () => fakePython(path.join(dir, 'new'), [3, 15, 1])) as string, /3\.9 to 3\.14 for now/);
	assert.match(await pythonFor(temp(), temp(), async () => undefined) as string, /No Python interpreter was chosen/);
});

test('a .python-version names a concrete pyenv interpreter, never the shim', () => {
	const root = temp();
	const home = temp();
	const saved = process.env.HOME;
	process.env.HOME = home;
	try {
		const file = fakePython(path.join(home, '.pyenv', 'versions', '3.12.4', 'bin'), [3, 12, 4]);
		writeFileSync(path.join(root, '.python-version'), '3.12.4\n');
		assert.deepEqual(pythonCandidates(root), [file]);
	} finally {
		process.env.HOME = saved;
	}
});

test('the command env puts the interpreter first, sets the venv and import roots, and keeps caches out of the worktree', () => {
	const probed: PyInterpreter = { path: '/p/my project/.venv/bin/python', version: [3, 12, 2], implementation: 'cpython', prefix: '/p/my project/.venv',
		venv: true, stdlib: [], installed: [], tools: { pytest: true, randomly: false, mypy: false, black: false, pytestDjango: false } };
	const env = pythonEnv(probed, ['/w', '/w/src'], '/store', '/w');
	assert.ok(env.PATH.startsWith(`/p/my project/.venv/bin${path.delimiter}`));
	assert.equal(env.VIRTUAL_ENV, '/p/my project/.venv');
	assert.equal(env.PYTHONPATH, ['/w', '/w/src'].join(path.delimiter));
	assert.deepEqual([env.PYTHONDONTWRITEBYTECODE, env.PYTHONHASHSEED, env.NO_COLOR, env.PY_COLORS], ['1', '0', '1', '0']);
	assert.ok(env.MYPY_CACHE_DIR.startsWith('/store/mypy-cache/'));
	const note = pythonApprovalNote(probed, '>=3.9', env);
	assert.match(note, /Python: \/p\/my project\/\.venv\/bin\/python \(3\.12\.2, sys\.prefix \/p\/my project\/\.venv\); the project asks for Python >=3\.9/);
});

test('pyFileFacts runs the helper isolated and reports a parse error as facts', { skip: noPython() }, async () => {
	const dir = temp();
	writeFileSync(path.join(dir, 'ok.py'), 'import os\nX = 1\n');
	writeFileSync(path.join(dir, 'bad.py'), 'def (:\n');
	const ok = await pyFileFacts(python()!.path, HELPER, path.join(dir, 'ok.py'), dir);
	assert.deepEqual(ok.decls.map(d => d.names), [['X']]);
	assert.equal(ok.lead[0].kind, 'import');
	const bad = await pyFileFacts(python()!.path, HELPER, path.join(dir, 'bad.py'), dir);
	assert.match(bad.error ?? '', /^SyntaxError/);
	assert.deepEqual(bad.decls, []);
});
````


- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/aiReadyPyInterpreter.test.ts(6,29): error TS2307: Cannot find module '../src/aiready/pyAst' or its corresponding type declarations.
```


- [ ] **Step 3: Implement.**

Create `src/aiready/pyAst.ts`:

````ts
import * as path from 'path';
import { runTool } from './projectCommands';

/** One alias of an import statement, with its UTF-8 byte span. */
export interface PyAlias {
	readonly name: string;
	readonly asname: string | null;
	readonly start: number;
	readonly end: number;
}

export interface PyImport {
	readonly kind: 'import' | 'from';
	/** For `from` imports, the module after the dots; empty for `import` statements. */
	readonly module: string;
	readonly level: number;
	readonly line: number;
	readonly start: number;
	readonly end: number;
	/** The start of its first line (its indentation included). */
	readonly lineStart: number;
	readonly aliases: readonly PyAlias[];
}

/** One statement of the leading block: the docstring, `__future__` imports, imports, and import-only compound statements. */
export interface PyLead {
	readonly kind: 'doc' | 'future' | 'import' | 'typecheck' | 'compound';
	/** Whole lines: from the start of its first line to the end of its last (no newline). */
	readonly start: number;
	readonly end: number;
	readonly line: number;
	readonly endLine: number;
	readonly binds: readonly string[];
	/** Names its condition reads (`sys`, `TYPE_CHECKING`). */
	readonly needs: readonly string[];
	readonly imports: readonly PyImport[];
}

/** One top-level statement after the leading block, as the helper sees it. */
export interface PyDecl {
	readonly id: number;
	readonly kind: string;
	readonly names: readonly string[];
	readonly start: number;
	readonly end: number;
	readonly line: number;
	readonly lines: number;
	readonly own: boolean;
	readonly doc: string;
	readonly docText: string;
	readonly pure: boolean;
	readonly impure: string | null;
	/** Why its annotations are not pure; they only count when annotations are evaluated. */
	readonly annImpure: string | null;
	/** For statements that are not definitions: only quiet stdlib calls, a docstring, `pass`, an `if TYPE_CHECKING:` block. */
	readonly quiet: boolean;
	/** Names defined earlier in the file that its definition-time code reads; they must move to the same file, earlier. */
	readonly sameFile: readonly string[];
	readonly annSameFile: readonly string[];
	/** `m.attr` read when defined, for the import check. */
	readonly attrReads: readonly (readonly [string, string])[];
	/** Stdlib top-level modules its purity relied on (a tracked file shadowing one refuses). */
	readonly relies: readonly string[];
	readonly defReads: readonly string[];
	readonly annReads: readonly string[];
	/** Every global name it reads, at definition time or later, forward-reference strings included. */
	readonly reads: readonly string[];
	readonly globalStmt: boolean;
	readonly dunders: readonly string[];
	readonly fileUse: null | 'folder' | 'other';
	readonly doctest: boolean;
	readonly warns: boolean;
	readonly defines: readonly string[];
	readonly baseNames: readonly string[];
}

/** The helper's JSON for one file; only the byte facts and `error` when it does not parse. */
export interface PyFacts {
	readonly python: readonly number[];
	readonly error: string | null;
	readonly bom: boolean;
	readonly crlf: boolean;
	readonly cookie: string | null;
	readonly shebang: boolean;
	readonly size: number;
	readonly longLine: boolean;
	readonly cells: boolean;
	readonly future: boolean;
	readonly firstComment: string;
	readonly toolComment: string | null;
	readonly namespace: string | null;
	readonly mainGuard: boolean;
	readonly starImport: boolean;
	readonly lateImport: number | null;
	readonly moduleGetattr: boolean;
	readonly lead: readonly PyLead[];
	/** Where the facade goes: the start of the line after the leading block. */
	readonly facadeAt: number;
	readonly decls: readonly PyDecl[];
	readonly bindings: Readonly<Record<string, number>>;
	readonly globalAssigned: readonly string[];
}

const EMPTY = { future: false, firstComment: '', toolComment: null, namespace: null, mainGuard: false, starImport: false, lateImport: null,
	moduleGetattr: false, lead: [], facadeAt: 0, decls: [], bindings: {}, globalAssigned: [] };

/** The folder of the shipped helpers (`resources/pyast`). */
export function pyHelperDir(extensionPath: string): string {
	return path.join(extensionPath, 'resources', 'pyast');
}

/** Parses one file with the project's interpreter, isolated (`-I -S`: no site, no `.pth`, no project code; `-B`: no `__pycache__` in the helper folder). */
export async function pyFileFacts(python: string, helperDir: string, file: string, cwd: string): Promise<PyFacts> {
	const result = await runTool(python, ['-I', '-S', '-B', path.join(helperDir, 'my_editor_pyast.py'), path.resolve(file)], cwd);
	if (result.code !== 0) { throw new Error(`${path.basename(file)} could not be parsed: ${result.stderr.trim().split('\n').pop() ?? 'no output'}`); }
	try { return { ...EMPTY, ...JSON.parse(result.stdout) } as PyFacts; }
	catch { throw new Error(`${path.basename(file)} could not be parsed: the helper printed no JSON.`); }
}
````

Create `src/aiready/pyInterpreter.ts`:

````ts
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findTool } from './projectCommands';

/** The project's Python, as probed with `-I` (site on, no project code). */
export interface PyInterpreter {
	/** As found: a venv's `bin/python` is a symlink, and resolving it would lose the venv. */
	readonly path: string;
	readonly version: readonly [number, number, number];
	readonly implementation: string;
	readonly prefix: string;
	readonly venv: boolean;
	readonly stdlib: readonly string[];
	/** Top-level modules installed in its site-packages. */
	readonly installed: readonly string[];
	readonly tools: { readonly pytest: boolean; readonly randomly: boolean; readonly mypy: boolean; readonly black: boolean; readonly pytestDjango: boolean };
}

const PROBE = [
	'import importlib.util, json, pkgutil, sys',
	'site = [p for p in sys.path if p.endswith(("site-packages", "dist-packages"))]',
	'mods = list(pkgutil.iter_modules())',
	'own = sorted({m.name for m in mods if getattr(m.module_finder, "path", "") in site})',
	'std = sorted(getattr(sys, "stdlib_module_names", None) or set(sys.builtin_module_names)',
	'  | {m.name for m in mods if getattr(m.module_finder, "path", "") not in site})',
	'has = lambda n: importlib.util.find_spec(n) is not None',
	'print(json.dumps({"version": list(sys.version_info[:3]), "implementation": sys.implementation.name, "prefix": sys.prefix,',
	'  "venv": sys.prefix != getattr(sys, "base_prefix", sys.prefix), "stdlib": std, "installed": own, "tools": {"pytest": has("pytest"),',
	'  "randomly": has("pytest_randomly"), "mypy": has("mypy"), "black": has("black"), "pytestDjango": has("pytest_django")}}))',
].join('\n');

const SHIM = /(^|\/)(\.pyenv\/shims|\.asdf\/shims|mise\/shims|\.local\/share\/mise\/shims)\//;

/** Runs the probe; a plain message when the file does not run as Python. */
export function probePython(file: string): PyInterpreter | string {
	const result = spawnSync(file, ['-I', '-c', PROBE], { encoding: 'utf8', timeout: 30_000, cwd: os.tmpdir() });
	try {
		const probed = JSON.parse(result.stdout) as Omit<PyInterpreter, 'path'>;
		return { ...probed, path: file };
	} catch {
		return `${file} did not run as Python: ${(result.stderr || result.error?.message || 'no output').trim().split('\n').pop()}`;
	}
}

/** Why this interpreter cannot be used for splits, or undefined. */
export function interpreterProblem(python: PyInterpreter): string | undefined {
	const [major, minor] = python.version;
	if (SHIM.test(python.path)) {
		return `${python.path} is a version-manager shim, which picks a Python per folder at each run. Choose the interpreter it points to.`;
	}
	if (python.implementation !== 'cpython') { return `Python splitting needs CPython; ${python.path} is ${python.implementation}.`; }
	if (major === 3 && minor >= 15) { return 'Python splitting needs Python 3.9 to 3.14 for now.'; }
	if (major !== 3 || minor < 9) { return `Python splitting needs Python 3.9 to 3.14; ${python.path} is ${python.version.join('.')}.`; }
	return undefined;
}

/** The first line a read-only tool prints, or undefined (never through a shell). */
function ask(tool: string, args: readonly string[], cwd: string): string | undefined {
	const bin = findTool(tool, [path.join(os.homedir(), '.local', 'bin')]);
	if (!bin) { return undefined; }
	const result = spawnSync(bin, [...args], { cwd, encoding: 'utf8', timeout: 30_000 });
	return result.status === 0 ? result.stdout.trim().split('\n').pop() : undefined;
}

const EXE = process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');

/** Interpreters for a project: a venv in its folder, Poetry, Pipenv or Hatch when configured, and pyenv versions it names. */
export function pythonCandidates(folder: string): string[] {
	const root = path.resolve(folder);
	const found: string[] = [];
	for (const dir of ['.venv', 'venv', 'env']) {
		if (existsSync(path.join(root, dir, 'pyvenv.cfg')) && existsSync(path.join(root, dir, EXE))) { found.push(path.join(root, dir, EXE)); }
	}
	const has = (file: string) => existsSync(path.join(root, file));
	const pyproject = has('pyproject.toml') ? readFileSync(path.join(root, 'pyproject.toml'), 'utf8') : '';
	if (has('poetry.lock') || /^\[tool\.poetry\]/m.test(pyproject)) { found.push(ask('poetry', ['env', 'info', '--executable'], root) ?? ''); }
	if (has('Pipfile')) { found.push(ask('pipenv', ['--py'], root) ?? ''); }
	if (has('hatch.toml') || /^\[tool\.hatch[.\]]/m.test(pyproject)) {
		const env = ask('hatch', ['env', 'find'], root);
		found.push(env ? path.join(env, EXE) : '');
	}
	if (has('.python-version')) {
		for (const version of readFileSync(path.join(root, '.python-version'), 'utf8').split(/\s+/).filter(Boolean)) {
			found.push(path.join(os.homedir(), '.pyenv', 'versions', version, 'bin', 'python'));
		}
	}
	return [...new Set(found.filter(file => file && existsSync(file)))];
}

/** The user's pick per project folder, in global storage. */
function picks(storageDir: string): Record<string, string> {
	try { return JSON.parse(readFileSync(path.join(storageDir, 'python-interpreters.json'), 'utf8')) as Record<string, string>; } catch { return {}; }
}

export function rememberPython(storageDir: string, root: string, file: string | undefined): void {
	const all = picks(storageDir);
	if (file) { all[root] = file; } else { delete all[root]; }
	mkdirSync(storageDir, { recursive: true });
	writeFileSync(path.join(storageDir, 'python-interpreters.json'), `${JSON.stringify(all, null, '\t')}\n`);
}

/** Asks the user: confirm one candidate, pick among several, or pick a file; undefined when they decline. */
export type ChoosePython = (candidates: readonly string[]) => Promise<string | undefined>;

/**
 * The project's interpreter: the remembered pick, else the user's choice among the candidates, probed and checked
 * against the version gate. A plain message when there is none to use.
 */
export async function pythonFor(root: string, storageDir: string, choose: ChoosePython): Promise<PyInterpreter | string> {
	let file = picks(storageDir)[root];
	if (!file || !existsSync(file)) {
		file = await choose(pythonCandidates(root)) ?? '';
		if (!file) { return 'No Python interpreter was chosen, so nothing was changed. Run **AI-Ready: Choose Python Interpreter** to pick one.'; }
	}
	const python = probePython(file);
	if (typeof python === 'string') { return python; }
	const problem = interpreterProblem(python);
	if (problem) { return problem; }
	rememberPython(storageDir, root, file);
	return python;
}

/**
 * The env for every approved command: the interpreter's folder first on PATH, the venv, the import roots on
 * PYTHONPATH (so tests import the branch, not an editable install of the user's folder), and no caches in the worktree.
 */
export function pythonEnv(python: PyInterpreter, roots: readonly string[], storageDir: string, worktree: string): Record<string, string> {
	const cache = path.join(storageDir, 'mypy-cache', createHash('sha1').update(worktree).digest('hex').slice(0, 12));
	return {
		PATH: `${path.dirname(python.path)}${path.delimiter}${process.env.PATH ?? ''}`,
		...(python.venv ? { VIRTUAL_ENV: python.prefix } : {}),
		PYTHONPATH: roots.join(path.delimiter), PYTHONDONTWRITEBYTECODE: '1', PYTHONHASHSEED: '0', NO_COLOR: '1', PY_COLORS: '0', MYPY_CACHE_DIR: cache,
	};
}

/** What the approval modal says about the interpreter, so a wrong pick is visible before anything runs. */
export function pythonApprovalNote(python: PyInterpreter, requiresPython: string | undefined, env: Readonly<Record<string, string>>): string {
	const shown = ['PYTHONPATH', 'VIRTUAL_ENV', 'PYTHONDONTWRITEBYTECODE', 'PYTHONHASHSEED'].filter(key => env[key]).map(key => `${key}=${env[key]}`);
	return `Python: ${python.path} (${python.version.join('.')}, sys.prefix ${python.prefix}); the project asks for `
		+ `${requiresPython ? `Python ${requiresPython}` : 'no Python version'}. Commands run with ${shown.join(', ')}, the interpreter's folder first on PATH. `;
}
````


- [ ] **Step 4: Run the tests.**

Run: `npx tsc --noEmit -p ./ && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 293
ℹ fail 0
```


- [ ] **Step 5: Commit.**

```bash
git add src/aiready/pyAst.ts src/aiready/pyInterpreter.ts test/pyFixture.ts test/aiReadyPyInterpreter.test.ts
git commit -m "Python adapter: the project interpreter and the helper JSON"
```


## Chunk 5: Reading the project

### Task 6: Tool config, tracked-file scans, import roots, commands and `ready`

**Files:**
- Create: `src/aiready/pyConfig.ts`, `src/aiready/pyScan.ts`, `src/aiready/pyProject.ts`, `test/aiReadyPyProject.test.ts`

`pyConfig.ts` reads TOML and INI line by line (sections, keys, multi-line values; enough for these settings, not a full TOML parser). `pyScan.ts` scans tracked text by pattern: `.py`/`.pyi` code for pickling, `__module__` readers, folder scans, patches and reloads, and every text file for `python <path>`/`python -m <module>` and `!!python/` tags. `pyProject.ts` puts them together per module. `importRootProblem` runs `find_spec` (which imports nothing for a top-level package) under the command env and stops Python splits when a package resolves outside the worktree.


- [ ] **Step 1: Write the failing tests.**

Create `test/aiReadyPyProject.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { configEntries, dependencyNames, PICKLING_LIBRARIES, pyToolConfig } from '../src/aiready/pyConfig';
import type { PyInterpreter } from '../src/aiready/pyInterpreter';
import { checkCommands, importRootProblem, moduleOf, modulePatches, projectSkip, pyProject, warningFilter } from '../src/aiready/pyProject';
import { HELPER, noPython, python, pyProjectFiles } from './pyFixture';

const FAKE: PyInterpreter = { path: '/env/bin/python3.12', version: [3, 12, 2], implementation: 'cpython', prefix: '/env', venv: true,
	stdlib: ['json', 'os', 're', 'sys'], installed: ['requests'], tools: { pytest: true, randomly: true, mypy: true, black: false, pytestDjango: false } };

function load(files: Record<string, string>, interpreter: PyInterpreter = FAKE) {
	const { root, tracked } = pyProjectFiles({ 'pkg/__init__.py': '', 'pkg/report.py': 'X = 1\n', ...files });
	return pyProject(root, interpreter, HELPER, mkdtempSync(path.join(os.tmpdir(), 'store-')), tracked);
}

const skipOf = (files: Record<string, string>, file = 'pkg/report.py', module = 'pkg.report') => projectSkip(load(files), file, module, 'pkg');

test('config: requires-python decides deferred annotations; line length, pytest settings and dependencies are read', () => {
	const config = pyToolConfig(new Map([
		['pyproject.toml', '[project]\nrequires-python = ">=3.14"\ndependencies = [\n  "Celery>=5",\n  "requests",\n]\n\n[tool.black]\nline-length = 100\n\n'
			+ '[tool.pytest.ini_options]\naddopts = "-p myplugin --strict-markers"\npython_files = ["check_*.py"]\npythonpath = ["lib"]\n'],
		['requirements-dev.txt', '# tools\ncloud_pickle==3\n-e .\n'],
	]));
	assert.deepEqual([config.deferredAnnotations, config.lineLength, config.formatter], [true, 100, 'black']);
	assert.deepEqual([config.pythonFiles, config.pythonPath, config.plugins], [['check_*.py'], ['lib'], ['myplugin']]);
	assert.deepEqual(config.dependencies, ['celery', 'requests', 'cloud-pickle']);
	assert.equal(pyToolConfig(new Map([['setup.cfg', '[options]\npython_requires = >=3.9\n']])).deferredAnnotations, false);
	assert.equal(pyToolConfig(new Map()).deferredAnnotations, false);
	assert.deepEqual(configEntries('setup.cfg', '[options]\ninstall_requires =\n    dill\n    numpy\n').map(e => e.value), ['\n    dill\n    numpy']);
});

test('reviewer point 4: a declared dependency on a pickling library narrows the project to constants', () => {
	assert.ok(PICKLING_LIBRARIES.includes('cloudpickle') && PICKLING_LIBRARIES.includes('celery'));
	assert.deepEqual(dependencyNames(configEntries('setup.cfg', '[options]\ninstall_requires =\n    dill>=0.3\n    numpy\n'), []), ['dill', 'numpy']);
	assert.match(load({ 'pyproject.toml': '[project]\ndependencies = ["joblib"]\n' }).constantsOnly ?? '', /depends on joblib/);
	assert.match(load({ 'requirements.txt': 'Ray[default]==2\n' }).constantsOnly ?? '', /depends on ray/);
	assert.equal(load({ 'requirements.txt': 'requests\n' }).constantsOnly, undefined);
});

test('reviewer probe p5: multiprocessing, process pools, torch.save, PyYAML python tags and __module__ readers narrow to constants', () => {
	for (const [file, text] of [['run.py', 'import multiprocessing as mp\n'], ['jobs.py', 'from concurrent.futures import ProcessPoolExecutor\n'],
		['ml.py', 'import torch\ntorch.save(model, "m.pt")\n'], ['conf.yaml', 'x: !!python/object:pkg.report.Row {}\n'],
		['tasks2.py', 'from celery import Celery\n'], ['state.py', 'class C:\n    def __reduce__(self):\n        return (C, ())\n']]) {
		assert.match(load({ [file]: text }).constantsOnly ?? '', /may pickle by reference/, file);
	}
	assert.match(load({ 'reg.py': 'def owner(f):\n    return f.__module__\n' }).constantsOnly ?? '',
		/looks at where things are defined: reg\.py:2 reads __module__/);
});

test('module names: flat and src layouts, a namespace package and a top-level module', () => {
	const project = load({ 'src/lib/__init__.py': '', 'src/lib/core.py': '', 'ns/inner.py': '', 'top.py': '' });
	assert.deepEqual(moduleOf(project, 'pkg/report.py'), { module: 'pkg.report', package: 'pkg' });
	assert.deepEqual(moduleOf(project, 'pkg/__init__.py'), { module: 'pkg', package: 'pkg' });
	assert.deepEqual(moduleOf(project, 'src/lib/core.py'), { module: 'lib.core', package: 'lib' });
	assert.match((moduleOf(project, 'ns/inner.py') as { skip: string }).skip, /namespace package/);
	assert.match((moduleOf(project, 'top.py') as { skip: string }).skip, /top-level module/);
	assert.deepEqual([project.roots, project.packages], [['.', 'src'], ['lib', 'pkg']]);
});

test('reviewer probe p6: a package whose __init__.py defines __getattr__ skips its modules', () => {
	assert.match(skipOf({ 'pkg/__init__.py': 'def __getattr__(name):\n    return name\n' }) ?? '', /lazy package/);
});

test('tool config naming the file or module skips it', () => {
	const cases: Record<string, string>[] = [
		{ 'pyproject.toml': '[tool.ruff.lint.per-file-ignores]\n"pkg/report.py" = ["E501"]\n' },
		{ 'setup.cfg': '[mypy-pkg.report]\nignore_errors = True\n' },
		{ 'pyproject.toml': '[[tool.mypy.overrides]]\nmodule = "pkg.report"\nignore_errors = true\n' },
		{ 'pyrightconfig.json': '{ "strict": ["pkg/report.py"] }\n' },
		{ '.coveragerc': '[run]\nomit =\n    pkg/report.py\n' },
		{ 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "--cov=pkg.report"\n' },
		{ 'pyproject.toml': '[tool.setuptools]\npy-modules = ["pkg/report.py"]\n' },
	];
	for (const files of cases) { assert.match(skipOf(files) ?? '', /names|treatment/, JSON.stringify(files)); }
	assert.equal(skipOf({ 'pyproject.toml': '[project.scripts]\nreport = "pkg.report:main"\n' }), undefined);
	assert.equal(skipOf({ 'README.md': 'See pkg/report.py and pkg.report.parse_row.\n' }), undefined);
});

test('scripts, plugins, folder scans, reloads, sys.modules edits, star imports and stubs skip a module', () => {
	assert.match(skipOf({ Makefile: 'run:\n\tpython -m pkg.report --fast\n' }) ?? '', /runs it as a script \(python -m pkg\.report\)/);
	assert.match(skipOf({ '.github/workflows/ci.yml': 'run: python pkg/report.py\n' }) ?? '', /runs it as a script/);
	assert.match(skipOf({ 'pyproject.toml': '[project.entry-points.pytest11]\nmine = "pkg.report"\n' }) ?? '', /pytest loads it as a plugin/);
	assert.match(skipOf({ 'pkg/__init__.py': 'import pkgutil\nfor m in pkgutil.iter_modules(__path__):\n    pass\n' }) ?? '', /lists the files of pkg\//);
	assert.match(skipOf({ 'pkg/loader.py': 'import os\nNAMES = os.listdir(os.path.dirname(__file__))\n' }) ?? '', /lists the files of pkg\//);
	assert.match(skipOf({ 'app.py': 'import importlib\ndef load(n):\n    return importlib.import_module(f"pkg.{n}")\n' }) ?? '', /by name/);
	assert.match(skipOf({ 'tests/test_r.py': 'import importlib\nfrom pkg import report\nimportlib.reload(report)\n' }) ?? '', /reloads report/);
	assert.match(skipOf({ 'tests/test_r.py': 'import sys\ndel sys.modules["pkg.report"]\n' }) ?? '', /changes sys\.modules/);
	assert.match(skipOf({ 'tests/test_r.py': 'import sys\nsys.modules[name] = None\n' }) ?? '', /changes sys\.modules/);
	assert.equal(skipOf({ 'tests/test_r.py': 'import sys\nfrom unittest.mock import patch\npatch.dict(sys.modules, {"yaml": None})\n' }), undefined);
	assert.match(skipOf({ 'use.py': 'from pkg import *\n' }) ?? '', /no __all__/);
	assert.equal(skipOf({ 'use.py': 'from pkg import *\n', 'pkg/__init__.py': '__all__ = ["x"]\n' }), undefined);
	assert.match(skipOf({ 'pkg/report.pyi': 'X: int\n' }) ?? '', /\.pyi or \.pxd/);
	assert.match(skipOf({ 'setup.py': 'from Cython.Build import cythonize\nsetup(ext_modules=cythonize("pkg/report.py"))\n' }) ?? '', /Cython/);
});

test('patches: strings, patch.object with and without a literal name, assignments and computed targets', () => {
	const project = load({
		'tests/test_a.py': 'from unittest.mock import patch\nfrom pkg import report\nimport pkg.report as r2\n'
			+ '@patch("pkg.report.helper")\ndef test_a(h):\n    pass\n'
			+ 'def test_b(monkeypatch):\n    monkeypatch.setattr(report, "json", None)\n    r2.CACHE = {}\n'
			+ 'def test_c():\n    patch.object(report, NAME)\n    target = f"pkg.report.{NAME}"\n',
	});
	const found = modulePatches(project, 'pkg.report');
	assert.deepEqual([...found.strings.keys()], ['helper']);
	assert.deepEqual([...found.named.keys()], ['json']);
	assert.deepEqual([...found.assigned.keys()], ['CACHE']);
	assert.equal(found.objectUse, 'tests/test_a.py:8');
	assert.equal(found.prefix, 'tests/test_a.py:12');
});

test('reviewer probe p4: a warnings filter naming the module is found in config and code', () => {
	const config = '[tool.pytest.ini_options]\nfilterwarnings = ["ignore::DeprecationWarning:pkg.report"]\n';
	assert.match(warningFilter(load({ 'pyproject.toml': config }), 'pkg.report') ?? '', /filters warnings by pkg\.report/);
	assert.ok(warningFilter(load({ 'conftest.py': 'import warnings\nwarnings.filterwarnings("ignore", module=r"pkg\\.report")\n' }), 'pkg.report'));
	assert.equal(warningFilter(load({}), 'pkg.report'), undefined);
});

test('check commands: the import check with the helper on PYTHONPATH, mypy, then pytest without plugins that reorder', () => {
	const project = load({ 'tests/test_report.py': 'def test_x():\n    pass\n', 'mypy.ini': '[mypy]\nstrict = True\n' });
	const checks = checkCommands(project, 'pkg.report');
	assert.deepEqual(checks.map(c => c.command), ['python3.12 -m my_editor_pycheck pkg.report', 'python3.12 -m mypy --no-error-summary --no-color-output pkg',
		'python3.12 -m pytest -q -rA -p no:cacheprovider -p no:randomly']);
	assert.equal(checks[0].verifies, true);
	assert.equal(checks[0].env?.PYTHONPATH, [HELPER, project.root].join(path.delimiter));
	const plain = load({ 'tests/test_report.py': '', 'manage.py': '' }, { ...FAKE, tools: { ...FAKE.tools, pytest: false } });
	assert.deepEqual(checkCommands(plain, 'pkg.report').map(c => c.command),
		['python3.12 -m my_editor_pycheck pkg.report', 'python3.12 manage.py test --verbosity 2']);
	const unit = load({ 'tests/test_report.py': '' }, { ...FAKE, tools: { ...FAKE.tools, pytest: false, mypy: false } });
	assert.deepEqual(checkCommands(unit, 'pkg.report').map(c => c.command).slice(1), ['python3.12 -m unittest discover -v']);
});

test('reviewer probe p7: PYTHONPATH makes an editable install resolve to the worktree; a .pth that puts the user folder first stops the run',
	{ skip: noPython() }, () => {
		const env = mkdtempSync(path.join(os.tmpdir(), 'venv-'));
		execFileSync(python()!.path, ['-m', 'venv', '--without-pip', env]);
		const user = pyProjectFiles({ 'src/mylib/__init__.py': 'WHERE = "user"\n' }).root;
		const site = path.join(env, 'lib', readdirSync(path.join(env, 'lib'))[0], 'site-packages');
		const venvPython = { ...python()!, path: path.join(env, 'bin', 'python'), prefix: env, venv: true };
		const worktree = (files: Record<string, string>) => {
			const { root, tracked } = pyProjectFiles({ 'src/mylib/__init__.py': 'WHERE = "worktree"\n', ...files });
			return pyProject(root, venvPython, HELPER, mkdtempSync(path.join(os.tmpdir(), 'store-')), tracked);
		};
		writeFileSync(path.join(site, '__editable__.mylib.pth'), `${path.join(user, 'src')}\n`);
		assert.equal(importRootProblem(worktree({})), undefined);
		writeFileSync(path.join(site, 'zz_first.pth'), `import sys; sys.path.insert(0, ${JSON.stringify(path.join(user, 'src'))})\n`);
		assert.match(importRootProblem(worktree({})) ?? '', /The package mylib imports from .*, not from the working copy/);
	});
````


- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/aiReadyPyProject.test.ts(7,82): error TS2307: Cannot find module '../src/aiready/pyConfig' or its corresponding type declarations.
```


- [ ] **Step 3: Implement.**

Create `src/aiready/pyConfig.ts`:

````ts
import * as path from 'path';

/** One `key = value` of a TOML or INI file, under its section (`tool.pytest.ini_options`, `mypy-pkg.mod`). */
export interface ConfigEntry {
	readonly file: string;
	readonly section: string;
	readonly key: string;
	readonly value: string;
}

/** Python tool config files whose text the adapter reads. */
export const CONFIG_FILES = new RegExp(`(^|/)(${['pyproject.toml', 'setup.cfg', 'tox.ini', 'pytest.ini', 'mypy.ini', '.mypy.ini', '.flake8', '.coveragerc',
	'ruff.toml', '.ruff.toml', 'pyrightconfig.json'].map(name => name.replace(/\./g, '\\.')).join('|')})$`);

/**
 * Sections and keys of TOML and INI files, line by line: a value goes on while brackets or triple quotes are open, or
 * (INI) while lines are indented. Enough for the settings below; not a full TOML parser.
 */
export function configEntries(file: string, text: string): ConfigEntry[] {
	const out: ConfigEntry[] = [];
	let section = '';
	let current: { key: string; value: string } | undefined;
	let open = 0;
	const flush = () => { if (current) { out.push({ file, section, ...current }); } current = undefined; };
	for (const raw of text.split('\n')) {
		const line = raw.replace(/\r$/, '');
		if (current && (open > 0 || (/^[ \t]+\S/.test(line) && !file.endsWith('.toml')))) {
			current.value += `\n${line}`;
			open += depth(line);
			continue;
		}
		const header = /^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/.exec(line);
		if (header) { flush(); section = header[1].trim().replace(/^"|"$/g, ''); open = 0; continue; }
		const pair = /^\s*("[^"]*"|'[^']*'|[\w.\- ]+?)\s*[=:]\s*(.*)$/.exec(line);
		if (pair && !line.trim().startsWith('#')) {
			flush();
			current = { key: pair[1].replace(/["']/g, '').trim(), value: pair[2] };
			open = depth(pair[2]);
		}
	}
	flush();
	return out;
}

function depth(text: string): number {
	const code = text.replace(/"(?:[^"\\]|\\.)*"|'[^']*'|#.*$/g, '');
	return (code.match(/[[{]/g)?.length ?? 0) - (code.match(/[\]}]/g)?.length ?? 0) + ((text.match(/"""|'''/g)?.length ?? 0) % 2);
}

/** Every quoted string in a value; for an unquoted INI value, its comma, space or newline separated words. */
export function words(value: string): string[] {
	const quoted = [...value.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(m => m[1] ?? m[2]);
	return quoted.length ? quoted : value.split(/[\s,]+/).filter(Boolean);
}

export function entry(entries: readonly ConfigEntry[], section: RegExp, key: string): ConfigEntry | undefined {
	return entries.find(e => section.test(e.section) && e.key === key);
}

/** The lowest Python minor version a `requires-python` spec allows, when it names one (`>=3.10` → 10). */
export function lowestMinor(spec: string | undefined): number | undefined {
	const found = [...(spec ?? '').matchAll(/(>=|~=|==|>)\s*3\.(\d+)/g)].map(m => Number(m[2]) + (m[1] === '>' ? 1 : 0));
	return found.length ? Math.max(...found) : undefined;
}

/** PEP 503 normalized names of the project's declared dependencies. */
export function dependencyNames(entries: readonly ConfigEntry[], requirements: readonly string[]): string[] {
	const name = (spec: string) => /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1]?.toLowerCase().replace(/[-_.]+/g, '-');
	const listed = entries.flatMap(e => {
		if (/^project$/.test(e.section) && e.key === 'dependencies') { return words(e.value); }
		if (/^project\.optional-dependencies$/.test(e.section)) { return words(e.value); }
		if (/^tool\.poetry(\.group\.[^.]+)?\.(dev-)?dependencies$/.test(e.section)) { return [e.key]; }
		if (/^options$/.test(e.section) && ['install_requires', 'tests_require'].includes(e.key)) { return e.value.split('\n'); }
		return [];
	});
	const lines = requirements.flatMap(text => text.split('\n').filter(line => !/^\s*(#|-)/.test(line)));
	return [...new Set([...listed, ...lines].map(name).filter((n): n is string => !!n && n !== 'python'))];
}

/** Libraries that pickle functions and classes by module and qualified name (reviewer point 4): a dependency on one narrows to constants. */
export const PICKLING_LIBRARIES = ['dill', 'cloudpickle', 'joblib', 'jsonpickle', 'celery', 'rq', 'dramatiq', 'ray', 'dask', 'distributed', 'torch',
	'multiprocess', 'pathos', 'loky', 'huey', 'arq'];

/** The project's settings for Python tools, from its tracked config files. */
export interface PyToolConfig {
	readonly requiresPython?: string;
	/** Annotations count as deferred when the lowest allowed Python is 3.14 or later. */
	readonly deferredAnnotations: boolean;
	readonly lineLength: number;
	readonly formatter?: 'black' | 'ruff';
	/** `files` from the mypy config, when mypy is configured. */
	readonly mypy?: readonly string[];
	readonly pyright?: 'pyright' | 'basedpyright';
	readonly pythonFiles: readonly string[];
	readonly pythonPath: readonly string[];
	/** Modules loaded as pytest plugins: `-p` in addopts and the `pytest11` entry-point group. */
	readonly plugins: readonly string[];
	readonly dependencies: readonly string[];
	/** Why `.py` files are compiled (Cython or mypyc), if they are. */
	readonly compiled?: string;
	readonly entries: readonly ConfigEntry[];
}

const PYTEST = /^(tool\.pytest\.ini_options|pytest|tool:pytest)$/;

/** Reads the settings from `files` (path → text) of tracked config files, requirements files and setup.py. */
export function pyToolConfig(files: ReadonlyMap<string, string>): PyToolConfig {
	const entries = [...files].filter(([file]) => CONFIG_FILES.test(file) && !file.endsWith('.json') && !file.includes('/'))
		.flatMap(([file, text]) => configEntries(file, text));
	const requirements = [...files].filter(([file]) => /(^|\/)requirements[^/]*\.txt$/.test(file)).map(([, text]) => text);
	const requiresPython = entry(entries, /^project$/, 'requires-python')?.value ?? entry(entries, /^options$/, 'python_requires')?.value;
	const spec = requiresPython ? words(requiresPython)[0] : undefined;
	const minor = lowestMinor(spec);
	const length = entry(entries, /^tool\.(black|ruff)$|^$/, 'line-length')?.value;
	const mypyConfigured = entries.some(e => /^(tool\.mypy|mypy)$/.test(e.section)) || files.has('mypy.ini') || files.has('.mypy.ini');
	const mypyFiles = entry(entries, /^(tool\.mypy|mypy)$/, 'files');
	const pyrightConfig = entries.find(e => /^tool\.(pyright|basedpyright)$/.test(e.section))?.section;
	const addopts = entries.filter(e => PYTEST.test(e.section) && e.key === 'addopts').flatMap(e => words(e.value).join(' ').split(/\s+/));
	const plugins = [...addopts.flatMap((word, i) => (word === '-p' ? [addopts[i + 1]] : word.startsWith('-p') && word.length > 2 ? [word.slice(2)] : [])),
		...entries.filter(e => e.key === 'pytest11').flatMap(e => [...e.value.matchAll(/=\s*([\w.]+)/g)].map(m => m[1])),
		...entries.filter(e => /pytest11/.test(e.section)).flatMap(e => words(e.value).map(w => w.split(':')[0]))].filter(Boolean);
	const setup = files.get('setup.py') ?? '';
	const pyproject = files.get('pyproject.toml') ?? '';
	const compiled = /cythonize\s*\([^)]*\.py\b/.test(setup) ? 'setup.py builds .py files with Cython'
		: /\bmypycify\b/.test(setup) || /^\[tool\.mypyc\]|hatch-mypyc/m.test(pyproject) ? 'the project compiles .py files with mypyc' : undefined;
	return {
		requiresPython: spec, deferredAnnotations: minor !== undefined && minor >= 14, lineLength: length ? Number(words(length)[0]) || 88 : 88,
		formatter: entries.some(e => e.section === 'tool.black') ? 'black'
			: entries.some(e => /^tool\.ruff\.format$|^format$/.test(e.section)) ? 'ruff' : undefined,
		mypy: mypyConfigured ? (mypyFiles ? words(mypyFiles.value) : []) : undefined,
		pyright: files.has('pyrightconfig.json') || pyrightConfig === 'tool.pyright' ? 'pyright' : pyrightConfig ? 'basedpyright' : undefined,
		pythonFiles: (() => { const e = entry(entries, PYTEST, 'python_files'); return e ? words(e.value) : ['test_*.py', '*_test.py']; })(),
		pythonPath: (() => {
			const e = entry(entries, PYTEST, 'pythonpath');
			return e ? words(e.value).map(p => path.posix.normalize(p).replace(/\/$/, '')) : [];
		})(),
		plugins: [...new Set(plugins)], dependencies: dependencyNames(entries, requirements), compiled, entries,
	};
}

const TOOL_SECTION = /mypy|pyright|coverage|ruff|flake8|pytest|isort|pylint|bandit/;

/**
 * Where tracked tool config names the file by exact path or dotted module name (per-file ignores, mypy overrides,
 * pyright and coverage lists, `--cov=`), or where a packaging list names the file; undefined otherwise.
 */
export function configNaming(config: PyToolConfig, files: ReadonlyMap<string, string>, file: string, module: string): string | undefined {
	const exactPath = new RegExp(`(^|[\\s"'=,\\[:])(\\./)?${escape(file)}(?=$|[\\s"',\\]:])`, 'm');
	const dotted = new RegExp(`(^|[\\s"'=,\\[]|mypy-|--cov=)${escape(module)}(?=$|[\\s"',\\]])`, 'm');
	for (const e of config.entries) {
		if (exactPath.test(e.value) || exactPath.test(e.key)) { return `${e.file} names it in [${e.section}] ${e.key}`; }
		if ((TOOL_SECTION.test(e.section) || /addopts|module|omit|include|source/.test(e.key)) && (dotted.test(e.value) || dotted.test(e.section))) {
			return `${e.file} names ${module} in [${e.section}] ${e.key}`;
		}
	}
	const headers = config.entries.map(e => e.section).filter(s => s === `mypy-${module}`);
	if (headers.length) { return `a mypy config section [mypy-${module}] names it`; }
	const json = files.get('pyrightconfig.json') ?? '';
	return exactPath.test(json) ? 'pyrightconfig.json names it' : undefined;
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
````

Create `src/aiready/pyScan.ts`:

````ts
import * as path from 'path';

/** Where a tracked file does something a rule cares about: `file:line`. */
type Where = string;

/** How tracked code patches or assigns one module's attributes, for *Patches that would stop working*. */
export interface PyPatches {
	/** `'<module>.X'` string literals (patch targets), by X. */
	readonly strings: ReadonlyMap<string, Where>;
	/** `patch.object`, `monkeypatch.setattr`, `setattr`, `delattr`… on the module with a literal name, by name. */
	readonly named: ReadonlyMap<string, Where>;
	/** `<module>.X = …` and `del <module>.X`, by X. */
	readonly assigned: ReadonlyMap<string, Where>;
	/** Any of those calls on the module at all (a non-literal name included). */
	readonly objectUse?: Where;
	/** A string built with the module's dotted name as a prefix (an f-string or concatenation). */
	readonly prefix?: Where;
}

/** Project-wide facts from the text of tracked files. */
export interface PyScan {
	/** Why the project may pickle by reference (a tracked file's use), if it may. */
	readonly pickles?: string;
	/** Why the project looks at where things are defined (`__module__`, `inspect.getmodule`…), if it does. */
	readonly moduleReaders?: string;
	readonly scriptPaths: ReadonlySet<string>;
	readonly scriptModules: ReadonlySet<string>;
	readonly folderScans: readonly { readonly file: string; readonly literal?: string; readonly own?: boolean; readonly below?: boolean }[];
	readonly migrationWords: ReadonlySet<string>;
	readonly pytestPlugins: ReadonlySet<string>;
	readonly starImports: readonly { readonly file: string; readonly module: string }[];
	readonly warningLines: readonly { readonly file: string; readonly text: string }[];
}

const PICKLERS = ['pickle', 'cPickle', '_pickle', 'dill', 'cloudpickle', 'joblib', 'shelve', 'jsonpickle', 'copyreg', 'multiprocessing', 'celery', 'rq',
	'dramatiq', 'ray', 'dask'];
const PICKLE_IMPORT = new RegExp(`^\\s*(?:import|from)\\s+(${PICKLERS.join('|')})\\b`, 'm');
const PICKLE_USE = /\bProcessPoolExecutor\b|\btorch\.(?:save|load)\s*\(|\byaml\.(?:unsafe_load|Loader|UnsafeLoader)\b|\bdef\s+__reduce(?:_ex)?__\b/;
const MODULE_READ = /\b__module__\b|\binspect\.(?:getmodule|getmembers)\b|\b(?:getmodule|getmembers)\s*\(|\bpyclbr\b/;
const SCRIPT = /\bpython(?:3(?:\.\d+)?)?\s+(?:-[A-Za-z]+\s+)*(?:-m\s+([\w.]+)|([\w./-]+\.py)\b)/g;
const FOLDER_CALL = new RegExp([/\b(?:pkgutil\.)?(?:iter_modules|walk_packages)\s*\(/, /\bos\.(?:listdir|scandir|walk)\s*\(/, /\bglob\.i?glob\s*\(/,
	/\.r?glob\s*\(/, /\.iterdir\s*\(/, /\bresources\.files\s*\(/].map(re => re.source).join('|'), 'g');

function lineAt(text: string, index: number): number {
	return text.slice(0, index).split('\n').length;
}

/** The text of a call's arguments (and the line before it, for a receiver like `Path(__file__).parent.glob(`). */
function callText(text: string, index: number, length: number): string {
	const start = text.lastIndexOf('\n', index) + 1;
	let depth = 0;
	let end = index + length;
	for (; end < text.length && end < index + 400; end++) {
		if (text[end] === '(') { depth++; } else if (text[end] === ')') { if (depth === 0) { break; } depth--; }
	}
	return text.slice(start, end);
}

/** Scans tracked files: `.py`/`.pyi` code for uses, and every text file for script references and `!!python/` tags. */
export function pyScan(texts: ReadonlyMap<string, string>): PyScan {
	let pickles: string | undefined;
	let moduleReaders: string | undefined;
	const scriptPaths = new Set<string>();
	const scriptModules = new Set<string>();
	const folderScans: PyScan['folderScans'][number][] = [];
	const migrationWords = new Set<string>();
	const pytestPlugins = new Set<string>();
	const starImports: { file: string; module: string }[] = [];
	const warningLines: { file: string; text: string }[] = [];
	for (const [file, text] of texts) {
		const code = /\.pyi?$/.test(file);
		if (!code) {
			if (!pickles && text.includes('!!python/')) { pickles = `${file} uses a PyYAML !!python/ tag`; }
		}
		for (const m of text.matchAll(SCRIPT)) {
			if (m[1]) { scriptModules.add(m[1]); } else { scriptPaths.add(path.posix.normalize(m[2])); }
		}
		for (const line of text.split('\n').filter(l => /filterwarnings|simplefilter|-W\s*\S|PYTHONWARNINGS/.test(l))) { warningLines.push({ file, text: line }); }
		if (!code) { continue; }
		const pickle = PICKLE_IMPORT.exec(text) ?? PICKLE_USE.exec(text);
		if (!pickles && pickle) { pickles = `${file}:${lineAt(text, pickle.index)} uses ${(pickle[1] ?? pickle[0]).trim()}`; }
		const reader = MODULE_READ.exec(text);
		if (!moduleReaders && reader) { moduleReaders = `${file}:${lineAt(text, reader.index)} reads ${reader[0].replace(/\s*\($/, '')}`; }
		for (const m of text.matchAll(FOLDER_CALL)) {
			const call = callText(text, m.index!, m[0].length);
			const literal = [...call.matchAll(/["']([\w./-]+)["']/g)].map(l => l[1]).find(l => !l.includes('*'));
			if (/\w\.__path__/.test(call)) { folderScans.push({ file, below: true }); }
			else if (/__file__|__path__/.test(call)) { folderScans.push({ file, own: true }); }
			else if (literal) { folderScans.push({ file, literal }); }
			else { folderScans.push({ file, below: true }); }
		}
		for (const m of text.matchAll(/\bimport_module\s*\(\s*(?:f["']([\w.]+)\{|["']([\w.]+)["']\s*\+)/g)) {
			folderScans.push({ file, literal: (m[1] ?? m[2]).replace(/\.$/, '') });
		}
		if (/(^|\/)migrations\//.test(file)) { for (const w of text.match(/\b[A-Za-z_]\w*\b/g) ?? []) { migrationWords.add(w); } }
		for (const m of text.matchAll(/^pytest_plugins\s*=\s*([^\n]*(?:\n[ \t][^\n]*)*)/gm)) {
			for (const w of m[1].matchAll(/["']([\w.]+)["']/g)) { pytestPlugins.add(w[1]); }
		}
		for (const m of text.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import\s+\*/gm)) { starImports.push({ file, module: m[1] }); }
	}
	return { pickles, moduleReaders, scriptPaths, scriptModules, folderScans, migrationWords, pytestPlugins, starImports, warningLines };
}

/** Whether a scan finds the folder `dir` (relative, `.` for the top) holding `file`: by `__file__`/`__path__`, a literal, or below a non-literal. */
export function folderScanned(scan: PyScan, dir: string, roots: readonly string[]): string | undefined {
	const under = (folder: string) => dir === folder || folder === '.' || dir.startsWith(`${folder}/`);
	for (const s of scan.folderScans) {
		const own = path.posix.dirname(s.file);
		if (s.own && own === dir) { return `${s.file} lists the files of ${dir}/`; }
		if (s.below && under(own)) { return `${s.file} lists files in a folder it computes, which may be ${dir}/`; }
		if (s.literal) {
			const candidates = [s.literal, path.posix.join(own, s.literal), ...roots.map(r => path.posix.join(r, s.literal!.replace(/\./g, '/')))];
			if (candidates.map(c => path.posix.normalize(c).replace(/\/$/, '')).includes(dir)) { return `${s.file} lists the files of ${dir}/ by name`; }
		}
	}
	return undefined;
}

/** Local names (or dotted chains) that a file binds to `module`, from its import lines. */
export function moduleAliases(text: string, module: string, filePackage: string): string[] {
	const [parent, leaf] = module.includes('.') ? [module.slice(0, module.lastIndexOf('.')), module.slice(module.lastIndexOf('.') + 1)] : ['', module];
	const found = new Set<string>();
	for (const m of text.matchAll(/^[ \t]*import\s+([^\n#]+)/gm)) {
		for (const part of m[1].split(',').map(p => p.trim())) {
			const [name, alias] = part.split(/\s+as\s+/);
			if (name === module) { found.add(alias ?? module); }
		}
	}
	for (const m of text.matchAll(/^[ \t]*from\s+(\.*)([\w.]*)\s+import\s+(\([^)]*\)|[^\n]*)/gm)) {
		const base = m[1] ? resolveRelative(filePackage, m[1].length, m[2]) : m[2];
		if (base !== parent) { continue; }
		for (const part of m[3].replace(/#[^\n]*/g, '').replace(/[()]/g, '').split(',').map(p => p.trim()).filter(Boolean)) {
			const [name, alias] = part.split(/\s+as\s+/);
			if (name === leaf) { found.add(alias ?? leaf); }
		}
	}
	return [...found];
}

export function resolveRelative(pkg: string, level: number, module: string): string {
	const base = pkg.split('.').slice(0, Math.max(0, pkg.split('.').length - (level - 1))).join('.');
	return module ? (base ? `${base}.${module}` : module) : base;
}

function esc(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How tracked `.py`/`.pyi` files patch, assign or name attributes of `module` (dotted). */
export function patchFacts(texts: ReadonlyMap<string, string>, module: string, packageOf: (file: string) => string): PyPatches {
	const strings = new Map<string, Where>();
	const named = new Map<string, Where>();
	const assigned = new Map<string, Where>();
	let objectUse: Where | undefined;
	let prefix: Where | undefined;
	const m = esc(module);
	for (const [file, text] of texts) {
		if (!/\.pyi?$/.test(file)) { continue; }
		const at = (index: number) => `${file}:${lineAt(text, index)}`;
		for (const s of text.matchAll(new RegExp(`["']${m}\\.(\\w+)`, 'g'))) { if (!strings.has(s[1])) { strings.set(s[1], at(s.index!)); } }
		const built = new RegExp(`\\bf["']${m}\\.|["']${m}\\.["']\\s*\\+|["']${m}["']\\s*\\+\\s*["']\\.|%\\s*\\(\\s*["']${m}["']`).exec(text);
		if (built && !prefix) { prefix = at(built.index); }
		const chains = [...new Set([...moduleAliases(text, module, packageOf(file)), module])].map(esc);
		for (const chain of chains) {
			const call = `\\b(?:patch\\.object|patch\\.multiple|monkeypatch\\.setattr|monkeypatch\\.delattr|setattr|delattr)\\s*\\(\\s*${chain}`;
			for (const c of text.matchAll(new RegExp(`${call}\\s*,\\s*(["'](\\w+)["'])?`, 'g'))) {
				objectUse ??= at(c.index!);
				if (c[2] && !named.has(c[2])) { named.set(c[2], at(c.index!)); }
			}
			for (const a of text.matchAll(new RegExp(`(?:^|[^\\w.])(?:del\\s+)?${chain}\\.(\\w+)\\s*(?:[-+*/|&]?=(?!=)|$)`, 'gm'))) {
				if (/del\s/.test(a[0]) || /=/.test(a[0])) { if (!assigned.has(a[1])) { assigned.set(a[1], at(a.index!)); } }
			}
		}
	}
	return { strings, named, assigned, objectUse, prefix };
}

/** Where tracked code reloads `module` or a name it cannot resolve, or edits `sys.modules` for it, its package or a computed key. */
export function replacedModule(texts: ReadonlyMap<string, string>, module: string, packageOf: (file: string) => string): string | undefined {
	const pkg = module.includes('.') ? module.slice(0, module.lastIndexOf('.')) : module;
	const names = (key: string) => key === module || key === pkg || module.startsWith(`${key}.`);
	for (const [file, text] of texts) {
		if (!/\.py$/.test(file)) { continue; }
		const aliases = new Set(moduleAliases(text, module, packageOf(file)));
		const imported = new Set([...text.matchAll(/^[ \t]*(?:from\s+\S+\s+)?import\s+([^\n#]+)/gm)].flatMap(m => m[1].replace(/[()]/g, '').split(',')
			.map(p => (p.trim().split(/\s+as\s+/)[1] ?? p.trim().split('.')[0]).trim())));
		for (const r of text.matchAll(/\b(?:importlib\.|imp\.)?reload\s*\(\s*([\w.]+)\s*\)/g)) {
			if (aliases.has(r[1]) || r[1] === module || !imported.has(r[1].split('.')[0])) { return `${file}:${lineAt(text, r.index!)} reloads ${r[1]}`; }
		}
		const edits = new RegExp([/\bsys\.modules\s*(?:\[\s*([^\]]+?)\s*\]\s*(?:=(?!=)|$)|\.(?:pop|update|setdefault|clear)\s*\(([^)]*))/,
			/\bdel\s+sys\.modules\s*\[\s*([^\]]+)\]/].map(re => re.source).join('|'), 'gm');
		for (const s of text.matchAll(edits)) {
			const key = (s[1] ?? s[2] ?? s[3] ?? '').trim();
			const literal = /^["']([\w.]+)["']/.exec(key)?.[1];
			if (!literal || names(literal)) { return `${file}:${lineAt(text, s.index!)} changes sys.modules[${key || '…'}]`; }
		}
		for (const p of text.matchAll(/\bpatch\.dict\s*\(\s*(?:sys\.modules|["']sys\.modules["'])\s*,\s*(\{[^}]*\}|[^,)]+)/g)) {
			const keys = [...p[1].matchAll(/["']([\w.]+)["']\s*:/g)].map(k => k[1]);
			if (!p[1].trim().startsWith('{') || keys.some(names)) { return `${file}:${lineAt(text, p.index!)} patches sys.modules`; }
		}
	}
	return undefined;
}
````

Create `src/aiready/pyProject.ts`:

````ts
import { spawnSync } from 'child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'fs';
import * as path from 'path';
import type { CheckCommand } from './language';
import { configNaming, PICKLING_LIBRARIES, pyToolConfig, PyToolConfig } from './pyConfig';
import type { PyInterpreter } from './pyInterpreter';
import { pythonEnv } from './pyInterpreter';
import { folderScanned, patchFacts, PyPatches, pyScan, PyScan, replacedModule, resolveRelative } from './pyScan';
import { globRegExp } from './tsScan';

/** Everything the Python adapter knows about a project, read once from its tracked files. */
export interface PyProject {
	readonly root: string;
	readonly python: PyInterpreter;
	readonly helperDir: string;
	readonly storageDir: string;
	readonly tracked: readonly string[];
	/** Tracked text files under 1 MB, by path. */
	readonly texts: ReadonlyMap<string, string>;
	readonly config: PyToolConfig;
	readonly scan: PyScan;
	/** Import roots, `.` for the top folder: it, `src` when packages live there, and pytest's `pythonpath`. */
	readonly roots: readonly string[];
	/** Top-level packages at the roots (folders with `__init__.py`), not tests, builds or environments. */
	readonly packages: readonly string[];
	readonly django: boolean;
	readonly hasTests: boolean;
	/** Stdlib module names a tracked file shadows at an import root. */
	readonly shadowed: ReadonlySet<string>;
	readonly generated: readonly RegExp[];
	/** Why functions and classes may not move (the project pickles by reference or reads `__module__`), if so. */
	readonly constantsOnly?: string;
}

const BINARY = /\.(png|jpe?g|gif|ico|pdf|zip|gz|tgz|whl|so|dylib|dll|exe|pyc|woff2?|ttf|sqlite3?|db|pkl|npy|npz|parquet|bin)$/i;
const NOT_PACKAGE = /^(tests?|testing|docs?|build|dist|venv|\.venv|env|site-packages|node_modules|vendor|_vendor|third_party)$/;

function readTexts(root: string, tracked: readonly string[]): Map<string, string> {
	const texts = new Map<string, string>();
	for (const file of tracked.filter(f => !BINARY.test(f))) {
		try {
			const buffer = readFileSync(path.join(root, file));
			if (buffer.length <= 1024 * 1024 && !buffer.includes(0)) { texts.set(file, buffer.toString('utf8')); }
		} catch { /* A tracked file deleted in the folder is not read. */ }
	}
	return texts;
}

/** Files a `.gitattributes` marks `linguist-generated`. */
function generatedPatterns(texts: ReadonlyMap<string, string>): RegExp[] {
	return [...texts].filter(([file]) => file.endsWith('.gitattributes')).flatMap(([file, text]) => {
		const dir = path.posix.dirname(file);
		return text.split('\n').filter(line => /\blinguist-generated(?!=false)\b/.test(line) && !/-linguist-generated/.test(line)).map(line => {
			const pattern = line.trim().split(/\s+/)[0].replace(/^\//, '');
			return globRegExp(`${dir === '.' ? '' : `${dir}/`}${pattern.includes('/') ? pattern : `**/${pattern}`}`);
		});
	});
}

/** Reads the project: tool config, scans of tracked files, import roots and packages. */
export function pyProject(root: string, python: PyInterpreter, helperDir: string, storageDir: string, tracked: readonly string[]): PyProject {
	const texts = readTexts(root, tracked);
	const config = pyToolConfig(texts);
	const scan = pyScan(texts);
	const set = new Set(tracked);
	const roots = ['.', ...(tracked.some(f => /^src\/[^/]+\/__init__\.py$/.test(f)) ? ['src'] : []), ...config.pythonPath.filter(p => p !== '.' && p !== 'src')];
	const packages = [...new Set(roots.flatMap(r => tracked.filter(f => path.posix.dirname(path.posix.dirname(f)) === r && f.endsWith('/__init__.py'))
		.map(f => path.posix.basename(path.posix.dirname(f)))))].filter(name => !NOT_PACKAGE.test(name)).sort();
	const shadows = (name: string) => roots.some(r => set.has(path.posix.join(r, `${name}.py`)) || set.has(path.posix.join(r, name, '__init__.py')));
	const shadowed = new Set(python.stdlib.filter(shadows));
	const dependency = config.dependencies.find(name => PICKLING_LIBRARIES.includes(name));
	const pickles = scan.pickles ?? (dependency ? `the project depends on ${dependency}` : undefined);
	return {
		root, python, helperDir, storageDir, tracked, texts, config, scan, roots, packages, shadowed, generated: generatedPatterns(texts),
		django: set.has('manage.py'), hasTests: tracked.some(f => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f)),
		constantsOnly: pickles ? `the project may pickle by reference: ${pickles}`
			: scan.moduleReaders ? `the project looks at where things are defined: ${scan.moduleReaders}` : undefined,
	};
}

const IDENTIFIER = /^[A-Za-z_]\w*$/;

/** A file's dotted module name and package, or why it is not a module in a regular package. */
export function moduleOf(project: PyProject, file: string): { module: string; package: string } | { skip: string } {
	const set = new Set(project.tracked);
	let found = false;
	for (const root of [...project.roots].sort((a, b) => b.length - a.length)) {
		const rel = root === '.' ? file : file.startsWith(`${root}/`) ? file.slice(root.length + 1) : undefined;
		if (rel === undefined) { continue; }
		const parts = rel.replace(/\.py$/, '').split('/');
		const dirs = parts.slice(0, -1);
		if (!dirs.length) { continue; }
		found = true;
		const regular = dirs.every((_, i) => set.has(path.posix.join(root, ...dirs.slice(0, i + 1), '__init__.py')));
		if (!regular || !parts.every(p => IDENTIFIER.test(p))) { continue; }
		const isInit = parts[parts.length - 1] === '__init__';
		const module = (isInit ? dirs : parts).join('.');
		return { module, package: isInit ? module : dirs.join('.') };
	}
	return { skip: found ? 'it is in a namespace package or a folder that is not a package (no __init__.py)' : 'a top-level module, not in a package' };
}

/** The package of any tracked file, for resolving its relative imports. */
export function packageOf(project: PyProject, file: string): string {
	const found = moduleOf(project, file);
	return 'skip' in found ? '' : found.package;
}

/** Project-level reasons a module is never split, beyond its own text. */
export function projectSkip(project: PyProject, file: string, module: string, pkg: string): string | undefined {
	const { config, scan, texts, root } = project;
	const dir = path.posix.dirname(file);
	const stem = file.replace(/\.py$/, '');
	const init = texts.get(path.posix.join(dir, '__init__.py')) ?? '';
	if (config.compiled) { return config.compiled; }
	if (project.tracked.includes(`${stem}.pyi`) || project.tracked.includes(`${stem}.pxd`)) {
		return 'a sibling .pyi or .pxd file goes with it, and new modules would need their own';
	}
	try { if (lstatSync(path.join(root, file)).isSymbolicLink()) { return 'it is a symlink'; } } catch { /* Missing files are caught when parsed. */ }
	if (/^(?:async\s+)?def\s+__(?:getattr|dir)__\s*\(|^__(?:getattr|dir)__\s*=/m.test(init)) {
		return 'its package __init__.py defines __getattr__ or __dir__ (a lazy package), which can run code when a sibling is looked up';
	}
	if (config.plugins.includes(module) || scan.pytestPlugins.has(module)) { return 'pytest loads it as a plugin'; }
	const scriptPath = [...scan.scriptPaths].find(p => p === file || file.endsWith(`/${p}`));
	if (scriptPath || scan.scriptModules.has(module)) { return `a tracked file runs it as a script (python ${scriptPath ?? `-m ${module}`})`; }
	const named = configNaming(config, texts, file, module);
	if (named) { return `${named}, and new files would not get the same treatment`; }
	const listed = scanned(project, dir);
	if (listed) { return listed; }
	const replaced = replacedModule(texts, module, f => packageOf(project, f));
	if (replaced) { return `${replaced}, which would not re-create moved definitions`; }
	const star = scan.starImports.find(s => (s.module.startsWith('.') ? resolveRelative(packageOf(project, s.file), s.module.match(/^\.*/)![0].length,
		s.module.replace(/^\.*/, '')) : s.module) === pkg);
	if (star && !/^__all__\s*[:=]/m.test(init)) {
		return `${star.file} does \`from ${star.module} import *\` and ${pkg}/__init__.py has no __all__, so new modules would be exported`;
	}
	if (project.generated.some(re => re.test(file))) { return 'generated code (linguist-generated)'; }
	if (path.posix.basename(file) === '_version.py' && /setuptools[_-]scm|versioneer/i.test(texts.get(file) ?? '')) { return 'generated code (a version file)'; }
	return undefined;
}

function scanned(project: PyProject, dir: string): string | undefined {
	return folderScanned(project.scan, dir, project.roots);
}

/** Tracked code patching or assigning the module's attributes. */
export function modulePatches(project: PyProject, module: string): PyPatches {
	return patchFacts(project.texts, module, f => packageOf(project, f));
}

/** Where tracked code or config filters warnings by this module, if anywhere. */
export function warningFilter(project: PyProject, module: string): string | undefined {
	const line = project.scan.warningLines.find(l => l.text.replace(/\\/g, '').includes(module));
	return line ? `${line.file} filters warnings by ${module}` : undefined;
}

/** The env of every approved command. */
export function pyCommandEnv(project: PyProject): Record<string, string> {
	return pythonEnv(project.python, project.roots.map(r => path.join(project.root, r)), project.storageDir, project.root);
}

/** Build (the import check), type checker and test commands for a module, in order. */
export function checkCommands(project: PyProject, module: string): CheckCommand[] {
	const { python, config } = project;
	const exe = path.basename(python.path);
	const helperPath = [project.helperDir, ...project.roots.map(r => path.join(project.root, r))].join(path.delimiter);
	const checks: CheckCommand[] = [{ label: 'build', command: `${exe} -m my_editor_pycheck ${module}`, verifies: true, env: { PYTHONPATH: helperPath } }];
	if (config.mypy && python.tools.mypy) {
		checks.push({ label: 'vet', command: `${exe} -m mypy --no-error-summary --no-color-output ${config.mypy.length ? '' : project.packages.join(' ')}`.trim() });
	}
	if (config.pyright && existsSync(path.join(path.dirname(python.path), config.pyright))) { checks.push({ label: 'vet', command: config.pyright }); }
	if (!project.hasTests) { return checks; }
	if (project.django && !python.tools.pytestDjango) { checks.push({ label: 'test', command: `${exe} manage.py test --verbosity 2` }); }
	else if (python.tools.pytest) {
		checks.push({ label: 'test', command: `${exe} -m pytest -q -rA -p no:cacheprovider${python.tools.randomly ? ' -p no:randomly' : ''}` });
	}
	else { checks.push({ label: 'test', command: `${exe} -m unittest discover -v` }); }
	return checks;
}

/** Why tests would not run the worktree's code: a top-level package that still resolves outside it (an editable install). */
export function importRootProblem(project: PyProject): string | undefined {
	if (!project.packages.length) { return undefined; }
	const code = 'import importlib.util, json, sys\nprint(json.dumps({n: getattr(importlib.util.find_spec(n), "origin", None) for n in sys.argv[1:]}))';
	const result = spawnSync(project.python.path, ['-c', code, ...project.packages], {
		cwd: project.root, encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...pyCommandEnv(project) },
	});
	let origins: Record<string, string | null>;
	try { origins = JSON.parse(result.stdout) as Record<string, string | null>; }
	catch { return `Could not check where the project's packages import from: ${(result.stderr || 'no output').trim().split('\n').pop()}`; }
	const root = realpathSync(project.root);
	for (const [name, origin] of Object.entries(origins)) {
		const at = origin && existsSync(origin) ? realpathSync(origin) : origin;
		if (!at || !at.startsWith(`${root}${path.sep}`)) {
			return `The package ${name} imports from ${at ?? 'nowhere'}, not from the working copy, so tests would check other code. `
				+ 'An editable install or a .pth file may point at your folder; Python splits stop for this run.';
		}
	}
	return undefined;
}
````


- [ ] **Step 4: Run the tests.**

Run: `npx tsc --noEmit -p ./ && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 304
ℹ fail 0
```


- [ ] **Step 5: Commit.**

```bash
git add src/aiready/pyConfig.ts src/aiready/pyScan.ts src/aiready/pyProject.ts test/aiReadyPyProject.test.ts
git commit -m "Python adapter: project config, scans, import roots and commands"
```


## Chunk 6: Rules and applying a split

### Task 7: Skip reasons, movability, the quiet window and new module names

**Files:**
- Create: `src/aiready/pyRules.ts`, `test/aiReadyPyRules.test.ts`
- Modify: `test/pyFixture.ts`

A moved name needs a **quiet window**: every top-level statement between the leading block and its old place must be a pure definition, a docstring, `pass`, an `if TYPE_CHECKING:` block, or an allowlisted call with literal arguments. The neutral view marks where the facade goes (an empty import region right after the leading block), or the facade itself once the original's siblings carry its split header.


- [ ] **Step 1: Write the failing tests.**

Give the fixture the helper-backed view:

In `test/pyFixture.ts`, replace:

````ts
import { findTool } from '../src/aiready/projectCommands';
import { probePython, PyInterpreter } from '../src/aiready/pyInterpreter';
````

with:

````ts
import { findTool } from '../src/aiready/projectCommands';
import { pyFileFacts, PyFacts } from '../src/aiready/pyAst';
import { probePython, PyInterpreter } from '../src/aiready/pyInterpreter';
import { PyFileContext, PyFileInfo, pyFileInfoView, pySkipReason } from '../src/aiready/pyRules';
````

Append to `test/pyFixture.ts`:

````ts

const work = mkdtempSync(path.join(os.tmpdir(), 'my-editor-pyast-test-'));
let count = 0;

/** The helper's facts for one source text. */
export async function facts(text: string): Promise<PyFacts> {
	const file = path.join(work, `m${count++}.py`);
	writeFileSync(file, text);
	return pyFileFacts(python()!.path, HELPER, file, work);
}

/** A file context with nothing special about the project. */
export function context(over: Partial<PyFileContext> = {}): PyFileContext {
	return {
		module: 'pkg.report', package: 'pkg', deferred: false, django: false, migrationWords: new Set(), shadowed: new Set(), splitSiblings: [],
		patches: { strings: new Map(), named: new Map(), assigned: new Map() }, ...over,
	};
}

/** The neutral view of a source text as `file`, with the real helper. */
export async function pyInfo(file: string, text: string, over: Partial<PyFileContext> = {}): Promise<PyFileInfo> {
	const found = await facts(text);
	const ctx = context(over);
	return pyFileInfoView(file, Buffer.from(text), found, ctx, pySkipReason(file, found, ctx));
}
````

Create `test/aiReadyPyRules.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PyNameContext, pyFileNameProblems } from '../src/aiready/pyRules';
import { noPython, pyInfo } from './pyFixture';

const skip = noPython();

/** Each declaration's names and why it may not move ('' when it may); the first declaration of a name wins. */
async function reasons(text: string, over = {}): Promise<Record<string, string>> {
	const info = await pyInfo('pkg/report.py', text, over);
	return Object.fromEntries(info.declarations.map(d => [d.names.join(','), d.reason ?? '']).reverse());
}

test('skipped files: paths, bytes, entry scripts, tool comments, namespace access and late imports', { skip }, async () => {
	const cases: [string, string, RegExp, object?][] = [
		['pkg/report.py', '#!/usr/bin/env python\nX = 1\n', /entry script/],
		['pkg/report.py', 'X = 1\nif __name__ == "__main__":\n    print(X)\n', /entry script/],
		['pkg/conftest.py', 'X = 1\n', /test or test-support/],
		['tests/helpers.py', 'X = 1\n', /test or test-support/],
		['pkg/models.py', 'X = 1\n', /Django module/, { django: true }],
		['pkg/management/commands/x.py', 'X = 1\n', /framework file/],
		['pkg/report.py', 'X = 1\r\n', /CRLF/],
		['pkg/report.py', '﻿X = 1\n', /byte-order mark/],
		['pkg/report.py', '# -*- coding: latin-1 -*-\nX = 1\n', /encoding is latin-1/],
		['pkg/report.py', '# type: ignore\nX = 1\n', /file-level comment `# type: ignore`/],
		['pkg/report.py', 'X = 1\nexec("Y = 2")\n', /own namespace \(exec\(\)\)/],
		['pkg/report.py', 'def f():\n    return globals()\n', /own namespace \(globals\(\)\)/],
		['pkg/report.py', 'from os.path import *\nX = 1\n', /import \*/],
		['pkg/report.py', 'import os\nX = 1\nimport json\n', /an import on line 3 comes after other code/],
		['pkg/report.py', 'import os\ntry:\n    import yaml\nexcept ImportError:\n    import warnings\n    warnings.warn("x")\n', /an import on line 3/],
		['pkg/report.py', '# @generated by protoc\nX = 1\n', /generated code/],
		['pkg/report.py', 'X = 1\n', /namespace package/, { skip: 'it is in a namespace package or a folder that is not a package (no __init__.py)' }],
	];
	for (const [file, text, reason, over] of cases) {
		const info = await pyInfo(file, text, over);
		assert.match(info.skip ?? '', reason, `${file}: ${JSON.stringify(text)}`);
		assert.ok(info.declarations.every(d => !d.movable));
	}
});

test('movability: plain functions, stdlib decorators bound to the stdlib, exceptions and pure classes move', { skip }, async () => {
	const found = await reasons('import re\nfrom dataclasses import dataclass\nfrom functools import lru_cache\nfrom .util import cache\n\n'
		+ 'PATTERN = re.compile(r"x", re.I)\n\n\ndef plain(x):\n    return x\n\n\n@lru_cache(maxsize=32)\ndef cached():\n    return 1\n\n\n'
		+ 'class RowError(Exception):\n    pass\n\n\n@dataclass\nclass Row:\n    name: str = ""\n\n\n@cache\ndef local():\n    return 1\n');
	assert.deepEqual(found, { PATTERN: '', plain: '', cached: '', local: 'it has the decorator cache', RowError: '', Row: '' });
});

test('movability refusals: bases, metaclasses, class bodies, names, dunders and __file__', { skip }, async () => {
	const found = await reasons('import os\nfrom pydantic import BaseModel\nfrom .meta import Meta\n\n__version__ = "1"\nX = 1\nX = 2\n'
		+ 'def g():\n    global X\n    X = 3\nclass M(BaseModel):\n    a: int = 1\nclass C(metaclass=Meta):\n    pass\n'
		+ 'def name():\n    return __name__\ndef doc():\n    return __doc__\ndef folder():\n    return os.path.dirname(__file__)\n'
		+ 'def file():\n    return open(__file__)\ndel_me = 1\ndel del_me\n');
	assert.equal(found.__version__, '__version__ is module protocol or metadata');
	assert.equal(found.X, 'X is bound more than once in the file');
	assert.equal(found.g, 'it uses global or nonlocal');
	assert.match(found.M, /its base BaseModel may run code/);
	assert.match(found.C, /its keyword metaclass=Meta runs code/);
	assert.equal(found.name, 'it reads __name__, which names the module');
	assert.equal(found.doc, 'it reads __doc__, which names the module');
	assert.equal(found.file, 'it reads __file__ for more than its folder');
	assert.equal(found.del_me, 'del_me is bound more than once in the file');
	assert.equal((await reasons('import os\n\n\ndef folder():\n    return os.path.dirname(__file__)\n')).folder, '');
});

test('a name assigned from a test, a doctest, and a leading import bound twice refuse', { skip }, async () => {
	const assigned = { patches: { strings: new Map(), named: new Map(), assigned: new Map([['CACHE', 'tests/test_a.py:3']]) } };
	assert.equal((await reasons('CACHE = {}\n', assigned)).CACHE, 'CACHE is assigned from outside the module (tests/test_a.py:3)');
	assert.match((await reasons('def f():\n    """\n    >>> f()\n    """\n')).f, /doctest/);
	assert.equal((await reasons('import os\nimport os.path\n\ndef f():\n    return os.sep\n')).f, 'it uses os, which the file binds more than once');
});

test('reviewer probe p1: nothing defined after a call that can import or read the module moves', { skip }, async () => {
	const found = await reasons('import importlib\nimport logging\nimportlib.import_module("pkg.plug")\nlogging.raiseExceptions = False\n'
		+ 'class Lazy:\n    def __str__(self):\n        return _f()\ndef _f():\n    return str(_CONST)\ntry:\n    CONFIG = _f()\nexcept Exception:\n'
		+ '    CONFIG = "fallback"\nlogging.getLogger("x").error("%s", Lazy())\nHELPER = 1\n_CONST = 3\n');
	for (const name of ['Lazy', '_f', 'HELPER', '_CONST']) { assert.match(found[name], /code runs before it in the file \(line 3\)/, name); }
});

test('reviewer probe p2 and the quiet window: a thread or registry call blocks what follows; logging and literal filters do not', { skip }, async () => {
	const after = async (statement: string) => (await reasons(`import atexit\nimport importlib\nimport logging\nimport threading\nimport warnings\n`
		+ `def early():\n    return 1\n${statement}\ndef late():\n    return 2\n`));
	for (const statement of ['register()', 'app = Flask(__name__)', 't = threading.Thread(target=print)\nt.start()', 'atexit.register(print)',
		'importlib.import_module("x")']) {
		const found = await after(statement);
		assert.equal(found.early, '', statement);
		assert.match(found.late, /code runs before it/, statement);
	}
	for (const statement of ['logger = logging.getLogger(__name__)', 'warnings.filterwarnings("ignore")']) {
		assert.equal((await after(statement)).late, '', statement);
	}
});

test('reviewer probes p4 and p5: warnings.warn with a module filter, and a pickling project, narrow what moves', { skip }, async () => {
	const warns = await reasons('import warnings\ndef old():\n    warnings.warn("old", DeprecationWarning)\n',
		{ warningFilter: 'pyproject.toml filters warnings by pkg.report' });
	assert.equal(warns.old, 'it calls warnings.warn, and pyproject.toml filters warnings by pkg.report');
	const info = await pyInfo('pkg/report.py', 'X = 1\ndef work(x):\n    return x\n',
		{ constantsOnly: 'the project may pickle by reference: run.py:1 uses multiprocessing' });
	assert.deepEqual(info.declarations.map(d => d.movable), [true, false]);
	assert.equal(info.narrowed, 'only constants may move (the project may pickle by reference: run.py:1 uses multiprocessing)');
});

test('reviewer probe p7: a default reading a module attribute moves statically and is left to the import check', { skip }, async () => {
	const info = await pyInfo('pkg/report.py', 'import lib\nprint("staying statement")\ndef f(m=lib.heavy):\n    return m\n');
	assert.match(info.declarations[1].reason ?? '', /code runs before it/);
	const moved = await pyInfo('pkg/report.py', 'import lib\n\n\ndef f(m=lib.heavy):\n    return m\n');
	assert.deepEqual([moved.declarations[0].movable, moved.declarations[0].py.attrReads], [true, [['lib', 'heavy']]]);
});

test('annotations count as evaluated without requires-python, and as deferred from 3.14', { skip }, async () => {
	const text = 'from .types import Row\n\n\ndef f(x: Row.Cell) -> int:\n    return 1\n';
	assert.match((await reasons(text)).f, /its annotations run code when defined/);
	assert.equal((await reasons(text, { deferred: true })).f, '');
	assert.equal((await reasons(`from __future__ import annotations\n${text}`, { deferred: true })).f, '');
});

test('the neutral view: an empty import region where the facade goes, and the facade once siblings exist', { skip }, async () => {
	const text = '"""Doc."""\nimport os\n\n\ndef f():\n    return os\n';
	const before = await pyInfo('pkg/report.py', text);
	assert.deepEqual(before.importRegion, { start: text.indexOf('\n\n\ndef') + 1, end: text.indexOf('\n\n\ndef') + 1 });
	const after = 'import os\nfrom .rows import g as g\n\n\ndef f():\n    return os\n';
	const info = await pyInfo('pkg/report.py', after, { splitSiblings: ['rows'] });
	assert.deepEqual(info.facade, [1]);
	assert.deepEqual(info.importRegion, { start: after.indexOf('from .rows'), end: after.indexOf('\n\n\n') });
	const fresh = await pyInfo('pkg/rows.py', '# Split from report.py by my_editor.\n\nimport os\n\n\ndef g():\n    return os\n');
	assert.deepEqual(fresh.prelude, { start: 0, end: '# Split from report.py by my_editor.\n\n'.length });
});

test('new module names', () => {
	const ctx: PyNameContext = { entries: ['report.py', 'util', '__init__.py'], packageNames: ['rows'], stdlib: ['json'], installed: ['requests'],
		testGlobs: ['test_*.py', '*_test.py'] };
	const problems = (name: string) => pyFileNameProblems(name, 'pkg/report.py', ctx).join('; ');
	assert.equal(problems('row_parsing.py'), '');
	assert.match(problems('rows.py'), /the package already binds rows/);
	assert.match(problems('Util.py'), /lowercase/);
	assert.match(problems('util.py'), /util already uses the name util/);
	assert.match(problems('json.py'), /standard or installed module/);
	assert.match(problems('requests.py'), /standard or installed module/);
	assert.match(problems('test_x.py'), /test pattern test_\*\.py/);
	assert.match(problems('tasks.py'), /tools and frameworks give a meaning/);
	assert.match(problems('class.py'), /not a keyword/);
});
````


- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/aiReadyPyRules.test.ts(3,51): error TS2307: Cannot find module '../src/aiready/pyRules' or its corresponding type declarations.
```


- [ ] **Step 3: Implement.**

Create `src/aiready/pyRules.ts`:

````ts
import * as path from 'path';
import type { Declaration, FileInfo } from './language';
import type { PyDecl, PyFacts } from './pyAst';
import type { PyPatches } from './pyScan';
import { globRegExp } from './tsScan';

/** Project facts about one file that its skip reason and movability need (pure inputs). */
export interface PyFileContext {
	readonly module: string;
	readonly package: string;
	/** Why the file is not a module of a regular package, or another project-level reason it is never split. */
	readonly skip?: string;
	/** Why only constants may move in this project. */
	readonly constantsOnly?: string;
	/** Annotations are deferred project-wide (`requires-python` from 3.14); a file's `from __future__ import annotations` also defers its own. */
	readonly deferred: boolean;
	readonly django: boolean;
	readonly patches: PyPatches;
	readonly migrationWords: ReadonlySet<string>;
	readonly warningFilter?: string;
	readonly shadowed: ReadonlySet<string>;
	/** The first line of each sibling whose split header names this file: those siblings are the facade's targets. */
	readonly splitSiblings: readonly string[];
}

export interface PyDeclaration extends Declaration {
	readonly py: PyDecl;
}

/** A parsed Python file: the language-neutral view plus the helper's facts. */
export interface PyFileInfo extends FileInfo {
	readonly declarations: readonly PyDeclaration[];
	readonly facts: PyFacts;
	readonly context: PyFileContext;
	/** Leading-block items that are the facade (imports of this file's split siblings), by index. */
	readonly facade: readonly number[];
	/** Each declaration's bytes, by id (rule 4's `__all__`, rule 6's identity). */
	readonly spans: readonly string[];
}

const TEST = /(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$|(^|\/)(tests?|testing)\//;
const CONFIG = /(^|\/)(setup|noxfile|fabfile|tasks|dodo|manage|wsgi|asgi|settings|conf|celeryconfig|__main__)\.py$|\.conf\.py$|(^|\/)settings\//;
const FRAMEWORK = /(^|\/)(migrations|versions|management\/commands|templatetags)\/|(^|\/)env\.py$/;
const DJANGO = /(^|\/)(models|admin|apps|urls|signals)\.py$/;
const BUILD = /(^|\/)(\.venv|venv|site-packages|build|dist|\.tox|\.nox|\.eggs|[^/]*\.egg-info|node_modules|vendor|_vendor|third_party)\//;
const GENERATED_NAME = /(_pb2|_pb2_grpc|_rc)\.py$/;
const GENERATED_TEXT = /@generated|DO NOT EDIT|auto-generated|Generated by/i;
const DEFINITIONS = new Set(['def', 'async def', 'class', 'assign', 'annassign', 'type']);
const CLASS_HOOKS = ['__init_subclass__', '__class_getitem__', '__set_name__'];

/** Why a Python file is never split, or undefined. */
export function pySkipReason(file: string, facts: PyFacts, context: PyFileContext): string | undefined {
	if (TEST.test(file)) { return 'a test or test-support file'; }
	if (CONFIG.test(file)) { return 'a config, entry or settings file'; }
	if (FRAMEWORK.test(file)) { return 'a framework file found by its folder (migrations, management commands, template tags, Alembic)'; }
	if (context.django && DJANGO.test(file)) { return 'a Django module found by its name'; }
	if (BUILD.test(file)) { return 'build output, an environment or vendored code'; }
	if (GENERATED_NAME.test(file) || GENERATED_TEXT.test(facts.firstComment ?? '')) { return 'generated code'; }
	if (facts.bom) { return 'it starts with a byte-order mark'; }
	if (facts.crlf) { return 'it has CRLF line endings'; }
	if (facts.cookie && !/^utf[-_]?8$/i.test(facts.cookie)) { return `its encoding is ${facts.cookie}`; }
	if (facts.size > 512 * 1024 || facts.longLine) { return 'it is over 512 KB or has a line over 1,000 characters'; }
	if (facts.error) { return `the project's Python does not parse it (${facts.error.split('\n')[0]})`; }
	if (context.skip) { return context.skip; }
	if (facts.shebang || facts.mainGuard) { return 'an entry script (a shebang or `if __name__ == "__main__":`)'; }
	if (facts.cells) { return 'a notebook-style file with cell markers'; }
	if (facts.toolComment) { return `it has the file-level comment \`${facts.toolComment}\`, which new files would need`; }
	if (facts.namespace) { return `it reads or replaces its own namespace (${facts.namespace})`; }
	if (facts.starImport) { return 'it has `from … import *`'; }
	if (facts.lateImport) { return `an import on line ${facts.lateImport} comes after other code, outside the leading imports`; }
	return undefined;
}

/** Whether a statement before a moved name runs nothing that could see the name early (*Early binding*). */
export function quiet(decl: PyDecl, deferred: boolean): boolean {
	return DEFINITIONS.has(decl.kind) ? (decl.pure && (!decl.annImpure || deferred)) || decl.quiet : decl.quiet;
}

/** Why one declaration may not move; undefined when it may (plan-time name rules come later). */
export function pyUnmovable(decl: PyDecl, facts: PyFacts, context: PyFileContext): string | undefined {
	const bindings = facts.bindings;
	if (!DEFINITIONS.has(decl.kind)) { return decl.kind === 'annotation' ? 'a bare annotation binds nothing' : 'it is not a definition, or it runs code'; }
	if (!decl.own) { return 'it shares a line with other code'; }
	const dunder = decl.names.find(n => /^__\w+__$/.test(n));
	if (dunder) { return `${dunder} is module protocol or metadata`; }
	const twice = decl.names.find(n => (bindings[n] ?? 0) > 1);
	if (twice) { return `${twice} is bound more than once in the file`; }
	const outside = decl.names.find(n => context.patches.assigned.has(n) || context.patches.named.has(n));
	if (outside) { return `${outside} is assigned from outside the module (${context.patches.assigned.get(outside) ?? context.patches.named.get(outside)})`; }
	if (decl.globalStmt) { return 'it uses global or nonlocal'; }
	if (decl.dunders.length) { return `it reads ${decl.dunders[0]}, which names the module`; }
	if (decl.fileUse === 'other') { return 'it reads __file__ for more than its folder'; }
	const migrated = decl.names.find(n => context.migrationWords.has(n));
	if (migrated) { return `a Django migration names ${migrated}`; }
	if (decl.doctest) { return 'its docstring has a doctest (>>>), which is collected from the defining module'; }
	if (decl.warns && context.warningFilter) { return `it calls warnings.warn, and ${context.warningFilter}`; }
	if (context.constantsOnly && decl.kind !== 'assign' && decl.kind !== 'annassign') { return `only constants may move: ${context.constantsOnly}`; }
	if (!decl.pure) { return decl.impure ?? 'its definition runs code'; }
	if (decl.annImpure && !context.deferred && !facts.future) { return `its annotations run code when defined (${decl.annImpure})`; }
	const shadowed = decl.relies.find(m => context.shadowed.has(m));
	if (shadowed) { return `a project file shadows the standard module ${shadowed}`; }
	const leadNames = new Set(facts.lead.flatMap(item => item.binds));
	const unstable = decl.reads.find(n => leadNames.has(n) && ((bindings[n] ?? 0) !== 1 || facts.globalAssigned.includes(n)));
	if (unstable) { return `it uses ${unstable}, which the file binds more than once`; }
	const loud = facts.decls.slice(0, decl.id).find(d => !quiet(d, context.deferred || facts.future));
	if (loud) { return `code runs before it in the file (line ${loud.line}), so it would be defined earlier than now`; }
	return undefined;
}

/** The facade: trailing leading-block imports `from .x import a as a` of siblings whose split header names this file. */
function facadeItems(facts: PyFacts, context: PyFileContext): number[] {
	const out: number[] = [];
	for (let i = facts.lead.length - 1; i >= 0; i--) {
		const imp = facts.lead[i].imports[0];
		if (facts.lead[i].kind !== 'import' || imp?.kind !== 'from' || imp.level !== 1 || !context.splitSiblings.includes(imp.module)
			|| !imp.aliases.every(a => a.asname === a.name)) { break; }
		out.unshift(i);
	}
	return out;
}

/** The language-neutral view of a parsed Python file. */
export function pyFileInfoView(file: string, text: Buffer, facts: PyFacts, context: PyFileContext, skip: string | undefined): PyFileInfo {
	const leadKeys = new Map(facts.lead.flatMap(item => item.binds.map(name => [name, `${name} ${item.imports[0]?.module ?? ''}`] as const)));
	const declarations: PyDeclaration[] = facts.decls.map(decl => {
		const reason = skip ?? pyUnmovable(decl, facts, context);
		return {
			id: decl.id, kind: decl.kind, names: decl.names, span: { start: decl.start, end: decl.end }, lines: decl.lines, doc: decl.doc, docText: decl.docText,
			uses: [...new Set(decl.reads.filter(n => leadKeys.has(n)).map(n => leadKeys.get(n)!))], movable: !reason, reason, py: decl,
		};
	});
	const facade = facadeItems(facts, context);
	const firstLine = text.indexOf(10);
	const comment = text[0] === 0x23 && firstLine > 0;
	const prelude = comment ? { start: 0, end: firstLine + 1 + (text[firstLine + 1] === 10 ? 1 : 0) } : { start: 0, end: 0 };
	const region = facade.length
		? { start: facts.lead[facade[0]].start, end: facts.lead[facade[facade.length - 1]].end } : { start: facts.facadeAt, end: facts.facadeAt };
	return {
		path: file, declarations, facts, context, facade, skip, spans: facts.decls.map(d => text.subarray(d.start, d.end).toString('utf8')),
		narrowed: !skip && context.constantsOnly ? `only constants may move (${context.constantsOnly})` : undefined,
		importRegion: region, prelude,
		frame: [prelude, ...facts.lead.map(item => ({ start: item.start, end: item.end }))],
		imports: [...leadKeys.values()],
	};
}

const KEYWORDS = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
	'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
	'while', 'with', 'yield', 'match', 'case', 'type']);
const RESERVED = new Set(['__init__', '__main__', 'conftest', 'setup', 'manage', 'settings', 'models', 'admin', 'apps', 'urls', 'views', 'signals',
	'tasks', 'serializers', 'wsgi', 'asgi']);

/** What a new file's name may not collide with. */
export interface PyNameContext {
	/** Files and folders already in the original's folder. */
	readonly entries: readonly string[];
	/** Names bound in the package's `__init__.py`/`.pyi` (and in the original when it is `__init__.py`). */
	readonly packageNames: readonly string[];
	readonly stdlib: readonly string[];
	readonly installed: readonly string[];
	readonly testGlobs: readonly string[];
}

/** Why a new module split from `original` may not have this name. */
export function pyFileNameProblems(name: string, original: string, ctx: PyNameContext): string[] {
	const problems: string[] = [];
	const stem = name.replace(/\.py$/, '');
	if (!/^[a-z_][a-z0-9_]*\.py$/.test(name) || KEYWORDS.has(stem)) { problems.push('use a lowercase Python identifier (not a keyword) with .py'); }
	const taken = ctx.entries.find(entry => entry !== name && entry.replace(/\.[^.]*$/, '').toLowerCase() === stem.toLowerCase());
	if (taken) { problems.push(`${taken} already uses the name ${stem}`); }
	if (ctx.packageNames.includes(stem)) { problems.push(`the package already binds ${stem}, and the new submodule would replace it`); }
	if (ctx.stdlib.includes(stem) || ctx.installed.includes(stem)) { problems.push(`${stem} is also a standard or installed module`); }
	if (RESERVED.has(stem)) { problems.push(`${stem} is a name tools and frameworks give a meaning`); }
	const relative = path.posix.join(path.posix.dirname(original), name);
	const glob = ctx.testGlobs.find(g => globRegExp(g).test(name) || globRegExp(g).test(relative));
	if (glob) { problems.push(`the project's test pattern ${glob} matches it`); }
	return problems;
}

/** Definitions the class rules forbid as a base in the same new file: classes with a subclass hook. */
export function hookOf(decl: PyDecl): string | undefined {
	return CLASS_HOOKS.find(hook => decl.defines.includes(hook));
}
````


- [ ] **Step 4: Run the tests.**

Run: `npx tsc --noEmit -p ./ && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 315
ℹ fail 0
```


- [ ] **Step 5: Commit.**

```bash
git add src/aiready/pyRules.ts test/pyFixture.ts test/aiReadyPyRules.test.ts
git commit -m "Python adapter: skip reasons, movability and file names"
```


### Task 8: Name rules, patches, new modules and the facade

**Files:**
- Create: `src/aiready/pyImports.ts`, `src/aiready/pySplit.ts`, `test/aiReadyPySplit.test.ts`
- Modify: `test/pyFixture.ts`

`buildPySplit` throws with every problem at once (the core reports the message to the model's retry). A file that is never split (the add-tests fix dropping failing tests) only loses its spans.


- [ ] **Step 1: Write the failing tests.**

Add the shared module text to the fixture:

Append to `test/pyFixture.ts`:

````ts

/** A module with every kind of leading import a split copies. IDs: 0 RowError, 1 parse_row, 2 _row_cache, 3 helper, 4 caller, 5 dump, 6 check, 7 report. */
export const REPORT = `"""Rows."""
from __future__ import annotations

import json
import numpy as np
import os.path
from typing import (
    TYPE_CHECKING,
    Optional,
)

if TYPE_CHECKING:
    from collections import OrderedDict
    from decimal import Decimal

try:
    import yaml
except ImportError:
    yaml = None


class RowError(Exception):
    """A bad row."""


def parse_row(line: str) -> Optional[dict]:
    return json.loads(line)


def _row_cache():
    return np


def helper():
    return os.path.sep


def caller():
    return helper()


def dump(x: "Decimal"):
    return yaml


def check(row: RowError) -> bool:
    return True


def report(lines):
    return [parse_row(line) for line in lines]
`;
````

Create `test/aiReadyPySplit.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SplitPlan } from '../src/aiready/language';
import { facadeLine, filteredImport } from '../src/aiready/pyImports';
import type { PyFileContext } from '../src/aiready/pyRules';
import { buildPySplit } from '../src/aiready/pySplit';
import { facts, noPython, pyInfo, REPORT } from './pyFixture';

const skip = noPython();

const OPTIONS = { lineLength: 88, deferred: false };

async function split(plan: SplitPlan, text = REPORT, over: Partial<PyFileContext> = {}) {
	const info = await pyInfo('pkg/report.py', text, over);
	const result = buildPySplit(Buffer.from(text), info, plan, OPTIONS);
	return { original: result.original.toString('utf8'), files: Object.fromEntries(result.files.map(f => [f.name, f.text.toString('utf8')])) };
}

async function rejected(plan: SplitPlan, text = REPORT, over: Partial<PyFileContext> = {}): Promise<string> {
	const info = await pyInfo('pkg/report.py', text, over);
	try { buildPySplit(Buffer.from(text), info, plan, OPTIONS); } catch (error) { return (error as Error).message; }
	return '';
}

test('name rules: a staying helper or a type-only use of a staying class is rejected with both IDs; moving both passes', { skip }, async () => {
	assert.equal(await rejected([{ file: 'rows.py', declarations: [4] }]),
		'declaration 4 (caller) uses helper (3), which stays. Move it to the same file or leave both.');
	assert.equal(await rejected([{ file: 'checks.py', declarations: [6] }]),
		'declaration 6 (check) uses RowError (0), which stays. Move it to the same file or leave both.');
	assert.equal(await rejected([{ file: 'rows.py', declarations: [3, 4] }]), '');
});

test('sibling new files import each other one way; a cycle and a definition-time read across files are rejected', { skip }, async () => {
	const { original, files } = await split([{ file: 'calls.py', declarations: [4] }, { file: 'helpers.py', declarations: [3] }]);
	assert.match(files['calls.py'], /^# Split from report\.py by my_editor\.\n\nfrom __future__ import annotations\nfrom \.helpers import helper\n\n\ndef caller/);
	assert.ok(original.indexOf('from .helpers import helper as helper') < original.indexOf('from .calls import caller as caller'));
	const ping = 'import os\n\n\ndef ping():\n    return pong()\n\n\ndef pong():\n    return ping()\n';
	assert.match(await rejected([{ file: 'a.py', declarations: [0] }, { file: 'b.py', declarations: [1] }], ping), /would import each other/);
	const early = 'import os\n\nX = 1\n\n\ndef f(x=X):\n    return x\n';
	assert.match(await rejected([{ file: 'a.py', declarations: [0] }, { file: 'b.py', declarations: [1] }], early),
		/declaration 1 \(f\) reads X \(0\) when it is defined, so both must move to the same file/);
	const hooked = 'import os\n\n\nclass Base:\n    def __init_subclass__(cls):\n        pass\n\n\nclass Sub(Base):\n    pass\n';
	assert.match(await rejected([{ file: 'bases.py', declarations: [0, 1] }], hooked), /subclasses Base, which defines __init_subclass__/);
});

test('patches that would stop working reject the plan; a patched helper with only staying callers moves', { skip }, async () => {
	const patches = (strings: [string, string][], objectUse?: string): Partial<PyFileContext> =>
		({ patches: { strings: new Map(strings), named: new Map(), assigned: new Map(), objectUse } });
	assert.match(await rejected([{ file: 'rows.py', declarations: [3, 4] }], REPORT, patches([['helper', 'tests/test_r.py:3']])),
		/tests\/test_r\.py:3 patches pkg\.report\.helper, which moved code reads/);
	assert.match(await rejected([{ file: 'rows.py', declarations: [1] }], REPORT, patches([['json', 'tests/test_r.py:9']])),
		/patches pkg\.report\.json/);
	assert.match(await rejected([{ file: 'rows.py', declarations: [1] }], REPORT, patches([], 'tests/test_r.py:4')), /by a computed name or object/);
	assert.equal(await rejected([{ file: 'helpers.py', declarations: [3] }], REPORT, patches([['helper', 'tests/test_r.py:3']])), '');
});

test('imports: filtered copies keep their layout and aliases, TYPE_CHECKING is filtered, fallbacks are copied whole, __future__ first', { skip }, async () => {
	const { files } = await split([{ file: 'rows.py', declarations: [1, 2] }, { file: 'dumping.py', declarations: [5] }, { file: 'paths.py', declarations: [3] }]);
	assert.equal(files['rows.py'], '# Split from report.py by my_editor.\n\nfrom __future__ import annotations\nimport json\nimport numpy as np\n'
		+ 'from typing import (\n    Optional,\n)\n\n\ndef parse_row(line: str) -> Optional[dict]:\n    return json.loads(line)\n\n\n'
		+ 'def _row_cache():\n    return np\n');
	assert.equal(files['dumping.py'], '# Split from report.py by my_editor.\n\nfrom __future__ import annotations\nfrom typing import (\n    TYPE_CHECKING,\n)\n'
		+ 'if TYPE_CHECKING:\n    from decimal import Decimal\ntry:\n    import yaml\nexcept ImportError:\n    yaml = None\n\n\n'
		+ 'def dump(x: "Decimal"):\n    return yaml\n');
	assert.match(files['paths.py'], /\nimport os\.path\n\n\ndef helper/);
	const one = await facts('from m import a, b as c, d\n');
	assert.equal(filteredImport(Buffer.from('from m import a, b as c, d\n'), one.lead[0].imports[0], new Set(['a', 'd'])), 'from m import a, d');
});

test('the original keeps every byte but the moved spans, with two blank lines, and a facade naming every moved name', { skip }, async () => {
	const { original } = await split([{ file: 'rows.py', declarations: [0, 1, 2] }]);
	const lead = REPORT.slice(0, REPORT.indexOf('\n\n\nclass RowError'));
	assert.ok(original.startsWith(`${lead}\nfrom .rows import RowError as RowError, parse_row as parse_row, _row_cache as _row_cache\n\n\ndef helper():`));
	assert.ok(original.includes('    return helper()\n\n\ndef dump('));
	assert.equal(facadeLine('rows', ['a_long_name', 'another_long_name'], 40),
		'from .rows import (\n    a_long_name as a_long_name,\n    another_long_name as another_long_name,\n)');
});

test('a file that is never split (a test file losing failing tests) only loses the spans, without a facade', { skip }, async () => {
	const text = 'import pytest\n\n\ndef test_a():\n    assert 1\n\n\ndef test_b():\n    assert 0\n';
	const info = await pyInfo('tests/test_report_ai.py', text);
	const result = buildPySplit(Buffer.from(text), info, [{ file: 'dropped.go', declarations: [1] }], OPTIONS);
	assert.equal(result.original.toString('utf8'), 'import pytest\n\n\ndef test_a():\n    assert 1\n');
	assert.deepEqual(result.files, []);
});
````


- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/aiReadyPySplit.test.ts(4,44): error TS2307: Cannot find module '../src/aiready/pyImports' or its corresponding type declarations.
```


- [ ] **Step 3: Implement.**

Create `src/aiready/pyImports.ts`:

````ts
import { collapse } from './moveCheck';
import type { PyImport, PyLead } from './pyAst';

/** The name an alias binds: `as` name, else the first part for `import a.b`, else the name. */
export function boundName(imp: PyImport, alias: PyImport['aliases'][number]): string {
	return alias.asname ?? (imp.kind === 'import' ? alias.name.split('.')[0] : alias.name);
}

/**
 * An import statement's text with only the aliases that bind `keep`, every piece copied as written. When each alias
 * sits alone on its line (a parenthesized list), dropped aliases lose their lines; otherwise the kept aliases are joined
 * with `, ` between the statement's own text before the first alias and after the last. Undefined when none is kept.
 */
export function filteredImport(source: Buffer, imp: PyImport, keep: ReadonlySet<string>): string | undefined {
	const kept = imp.aliases.filter(a => keep.has(boundName(imp, a)));
	const text = (start: number, end: number) => source.subarray(start, end).toString('utf8');
	if (!kept.length) { return undefined; }
	if (kept.length === imp.aliases.length) { return text(imp.start, imp.end); }
	const first = imp.aliases[0];
	const last = imp.aliases[imp.aliases.length - 1];
	const lineOf = (offset: number) => source.lastIndexOf(10, offset - 1) + 1;
	const own = imp.aliases.every((a, i) => i === 0 || lineOf(a.start) !== lineOf(imp.aliases[i - 1].start)) && lineOf(first.start) !== lineOf(imp.start);
	if (own) {
		const lines = imp.aliases.map(a => {
			const start = lineOf(a.start);
			return { alias: a, start, end: source.indexOf(10, a.end) + 1 };
		});
		return text(imp.start, lines[0].start) + lines.filter(l => kept.includes(l.alias)).map(l => text(l.start, l.end)).join('')
			+ text(lines[lines.length - 1].end, imp.end);
	}
	return text(imp.start, first.start) + kept.map(a => text(a.start, a.end)).join(', ') + text(last.end, imp.end);
}

/** An `if TYPE_CHECKING:` block with its header line and only the import lines that keep a name, each filtered. */
export function filteredTypeCheck(source: Buffer, item: PyLead, keep: ReadonlySet<string>): string | undefined {
	const parts = item.imports.map(imp => {
		const text = filteredImport(source, imp, keep);
		return text === undefined ? undefined : source.subarray(imp.lineStart, imp.start).toString('utf8') + text;
	}).filter((t): t is string => t !== undefined);
	if (!parts.length) { return undefined; }
	return `${source.subarray(item.start, item.imports[0].lineStart).toString('utf8')}${parts.join('\n')}`;
}

/** The text a new file copies from one leading-block item for the names it uses; undefined when it needs none of them. */
export function copiedLead(source: Buffer, item: PyLead, keep: ReadonlySet<string>): string | undefined {
	if (item.kind === 'future' || item.kind === 'compound') { return source.subarray(item.start, item.end).toString('utf8'); }
	if (item.kind === 'typecheck') { return filteredTypeCheck(source, item, keep); }
	if (item.kind === 'import') { return filteredImport(source, item.imports[0], keep); }
	return undefined;
}

/** `from .rows import a as a, b as b`, wrapped one name per line the way black does when it is longer than `lineLength`. */
export function facadeLine(stem: string, names: readonly string[], lineLength: number): string {
	const line = `from .${stem} import ${names.map(n => `${n} as ${n}`).join(', ')}`;
	return line.length <= lineLength ? line : `from .${stem} import (\n${names.map(n => `    ${n} as ${n},\n`).join('')})`;
}

/**
 * The original after the move: its old lines minus the moved spans, blank runs around them collapsed to the longer
 * bordering run (at most two), and the facade lines inserted where the leading block ends (`facadeAt`).
 */
export function rebuildOriginal(source: Buffer, removed: readonly { start: number; end: number }[], facadeAt: number, facade: readonly string[]): Buffer {
	const items: (string | undefined)[] = [];
	let offset = 0;
	const text = source.toString('utf8');
	const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
	for (const line of lines) {
		const start = offset;
		const end = offset + Buffer.byteLength(line);
		offset = end + 1;
		if (start === facadeAt) { items.push(...facade.flatMap(f => f.split('\n'))); }
		items.push(removed.some(span => start >= span.start && end <= span.end) ? undefined : line);
	}
	if (facadeAt >= offset) { items.push(...facade.flatMap(f => f.split('\n'))); }
	const out = collapse(items, 'longest');
	return Buffer.from(out.length ? `${out.join('\n')}\n` : '');
}
````

Create `src/aiready/pySplit.ts`:

````ts
import * as path from 'path';
import type { NewFile, SplitPlan, SplitResult } from './language';
import { copiedLead, facadeLine, rebuildOriginal } from './pyImports';
import { hookOf, PyDeclaration, PyFileInfo } from './pyRules';

/** The exact first lines of a module split from `file`. */
export function pySplitHeader(file: string): string {
	return `# Split from ${path.posix.basename(file)} by my_editor.\n\n`;
}

const stem = (file: string) => file.replace(/\.py$/, '');

/** `declaration 7 (parse_row)`. */
function named(d: PyDeclaration): string {
	return `declaration ${d.id} (${d.names.join(', ')})`;
}

/** Plan problems from the name rules, the class rules and the patches tracked code makes; empty when the plan may be built. */
export function pyPlanProblems(info: PyFileInfo, plan: SplitPlan, deferred: boolean): { problems: string[]; edges: Map<number, Set<number>> } {
	const byId = new Map(info.declarations.map(d => [d.id, d]));
	const groupOf = new Map(plan.flatMap((group, g) => group.declarations.map(id => [id, g] as const)));
	const owner = new Map<string, PyDeclaration>();
	for (const d of info.declarations) { for (const n of d.names) { if (!owner.has(n)) { owner.set(n, d); } } }
	const problems: string[] = [];
	const edges = new Map(plan.map((_, g) => [g, new Set<number>()]));
	const own = new Set<string>();
	for (const [id, g] of groupOf) {
		const d = byId.get(id)!;
		const early = new Set([...d.py.sameFile, ...(deferred ? [] : d.py.annSameFile), ...d.py.baseNames]);
		for (const name of d.py.reads) {
			const e = owner.get(name);
			if (info.facts.lead.some(item => item.binds.includes(name))) { own.add(name); continue; }
			if (e) { own.add(name); }
			if (!e || e.id === d.id) { continue; }
			const eg = groupOf.get(e.id);
			if (eg === undefined) { problems.push(`${named(d)} uses ${name} (${e.id}), which stays. Move it to the same file or leave both.`); }
			else if (eg !== g && early.has(name)) { problems.push(`${named(d)} reads ${name} (${e.id}) when it is defined, so both must move to the same file.`); }
			else if (eg !== g) { edges.get(g)!.add(eg); }
		}
		for (const base of d.py.baseNames) {
			const hook = owner.get(base) && hookOf(owner.get(base)!.py);
			if (hook) { problems.push(`${named(d)} subclasses ${base}, which defines ${hook}, so defining it runs project code.`); }
		}
	}
	if (cyclic(edges)) { problems.push('Two new files would import each other; group the declarations that use each other in one file.'); }
	const patches = info.context.patches;
	const module = info.context.module;
	for (const name of [...own].sort()) {
		const where = patches.strings.get(name) ?? patches.named.get(name) ?? patches.assigned.get(name);
		if (where) { problems.push(`${where} patches ${module}.${name}, which moved code reads; the patch would no longer reach it.`); }
	}
	if (groupOf.size && (patches.prefix || patches.objectUse)) {
		problems.push(`${patches.prefix ?? patches.objectUse} patches ${module} by a computed name or object, which may stop reaching moved code.`);
	}
	return { problems, edges };
}

function cyclic(edges: ReadonlyMap<number, ReadonlySet<number>>): boolean {
	const state = new Map<number, number>();
	const visit = (n: number): boolean => {
		if (state.get(n) === 1) { return true; }
		if (state.get(n) === 2) { return false; }
		state.set(n, 1);
		const found = [...(edges.get(n) ?? [])].some(visit);
		state.set(n, 2);
		return found;
	};
	return [...edges.keys()].some(visit);
}

/** Plan groups in an order where a file comes after the files it imports. */
function ordered(count: number, edges: ReadonlyMap<number, ReadonlySet<number>>): number[] {
	const out: number[] = [];
	const add = (g: number) => {
		if (out.includes(g)) { return; }
		[...(edges.get(g) ?? [])].sort((a, b) => a - b).forEach(add);
		out.push(g);
	};
	for (let g = 0; g < count; g++) { add(g); }
	return out;
}

export interface PySplitOptions {
	readonly lineLength: number;
	readonly deferred: boolean;
}

/**
 * New modules and the new original. Each new module: the split header, the original's `__future__` imports, filtered
 * copies of the leading-block statements its spans use (compound ones whole, with the imports their conditions read),
 * imports of sibling new modules, then the moved spans byte for byte, two blank lines apart. The original keeps every
 * byte except the moved spans and gains the facade after its leading block. Throws with every problem when the plan
 * breaks a rule. A file that is never split (a test file whose failing tests are dropped) only loses the spans.
 */
export function buildPySplit(source: Buffer, info: PyFileInfo, plan: SplitPlan, options: PySplitOptions): SplitResult {
	const byId = new Map(info.declarations.map(d => [d.id, d]));
	const removed = plan.flatMap(group => group.declarations.map(id => byId.get(id)!.span));
	if (info.skip) { return { original: rebuildOriginal(source, removed, -1, []), files: [] }; }
	const { problems, edges } = pyPlanProblems(info, plan, options.deferred || info.facts.future);
	if (problems.length) { throw new Error(problems.join(' ')); }
	const lead = info.facts.lead;
	const names = (g: number) => [...plan[g].declarations].sort((a, b) => a - b).flatMap(id => byId.get(id)!.names);
	const files: NewFile[] = plan.map((group, g) => {
		const decls = [...group.declarations].sort((a, b) => a - b).map(id => byId.get(id)!);
		const used = new Set(decls.flatMap(d => d.py.reads));
		for (const item of lead) {
			if (item.kind !== 'import' && item.binds.some(n => used.has(n))) { item.needs.forEach(n => used.add(n)); }
		}
		const imports = lead.map(item => (item.kind === 'future' || item.binds.some(n => used.has(n)) ? copiedLead(source, item, used) : undefined))
			.filter((t): t is string => t !== undefined);
		const siblings = [...edges.get(g)!].sort((a, b) => a - b).map(eg => {
			const wanted = names(eg).filter(n => used.has(n));
			return `from .${stem(plan[eg].file)} import ${wanted.join(', ')}`;
		});
		const head = [...imports, ...siblings];
		const body = decls.map(d => source.subarray(d.span.start, d.span.end).toString('utf8')).join('\n\n\n');
		const header = pySplitHeader(info.path);
		return { name: group.file, text: Buffer.from(`${header}${head.length ? `${head.join('\n')}\n\n\n` : '\n'}${body}\n`) };
	});
	const facade = ordered(plan.length, edges).map(g => facadeLine(stem(plan[g].file), names(g), options.lineLength));
	return { original: rebuildOriginal(source, removed, info.facts.facadeAt, facade), files };
}
````


- [ ] **Step 4: Run the tests.**

Run: `npx tsc --noEmit -p ./ && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 321
ℹ fail 0
```


- [ ] **Step 5: Commit.**

```bash
git add src/aiready/pyImports.ts src/aiready/pySplit.ts test/pyFixture.ts test/aiReadyPySplit.test.ts
git commit -m "Python adapter: name rules, patches, new modules and the facade"
```


## Chunk 7: Test output, prompts, the move check and the adapter

### Task 9: pytest and unittest output, test files and the prompts

**Files:**
- Create: `src/aiready/pyTests.ts`, `src/aiready/pyPrompts.ts`, `test/aiReadyPyTests.test.ts`


- [ ] **Step 1: Write the failing tests.**

Create `test/aiReadyPyTests.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { compareWithBaseline, unverified } from '../src/aiready/baseline';
import { parsePyTests, pyTestFileName, pyTestNames, pyTestProblems } from '../src/aiready/pyTests';
import { noPython, pyInfo } from './pyFixture';

const PYTEST = `F..sx.
=========================== short test summary info ============================
PASSED tests/test_x.py::test_pass
PASSED tests/test_x.py::test_param[1]
PASSED tests/test_x.py::test_param[b c]
PASSED tests/test_x.py::TestRows::test_parse
SKIPPED [1] tests/test_x.py:4: r
XFAIL tests/test_x.py::test_xfail
FAILED tests/test_x.py::test_fail - assert 0
ERROR tests/test_broken.py - ImportError: cannot import name 'x'
1 failed, 4 passed, 1 skipped, 1 xfailed, 1 error in 0.02s
`;

test('pytest -rA: keys are file and Class/test/[param], with parent keys like Go subtests and collection errors', () => {
	const run = parsePyTests(PYTEST)!;
	assert.deepEqual(run.tests, {
		'tests/test_x.py test_pass': 'pass', 'tests/test_x.py test_param': 'pass', 'tests/test_x.py test_param/[1]': 'pass',
		'tests/test_x.py test_param/[b c]': 'pass', 'tests/test_x.py TestRows': 'pass', 'tests/test_x.py TestRows/test_parse': 'pass',
		'tests/test_x.py test_xfail': 'skip', 'tests/test_x.py test_fail': 'fail', 'tests/test_broken.py (collection)': 'fail',
	});
	assert.deepEqual(run.packages, { 'tests/test_x.py': 'fail', 'tests/test_broken.py': 'fail' });
	assert.deepEqual(parsePyTests('no tests ran in 0.01s\n'), { tests: {}, packages: {} });
	assert.equal(parsePyTests('Traceback (most recent call last):\nboom\n'), undefined);
});

test('unittest -v: both the 3.11+ and the older form, with a docstring line between', () => {
	const now = 'test_a (pkg.tests.test_a.TestA.test_a)\nChecks a. ... ok\ntest_b (pkg.tests.test_a.TestA.test_b) ... FAIL\n'
		+ "test_c (pkg.tests.test_a.TestA.test_c) ... skipped 'r'\ntest_d (pkg.tests.test_a.TestA.test_d) ... expected failure\n\nRan 4 tests in 0.001s\n";
	const old = now.replace(/\.(test_[a-d])\)/g, ')');
	const expected = { 'pkg.tests.test_a TestA': 'fail', 'pkg.tests.test_a TestA/test_a': 'pass', 'pkg.tests.test_a TestA/test_b': 'fail',
		'pkg.tests.test_a TestA/test_c': 'skip', 'pkg.tests.test_a TestA/test_d': 'skip' };
	assert.deepEqual(parsePyTests(now)?.tests, expected);
	assert.deepEqual(parsePyTests(old)?.tests, expected);
});

test('parent keys let the core verify new test classes and parametrized tests by their top-level name', () => {
	const run = parsePyTests('PASSED tests/test_r_ai.py::TestAiRows::test_a\nPASSED tests/test_r_ai.py::test_ai_param[1]\n'
		+ 'FAILED tests/test_r_ai.py::TestAiBad::test_b - assert 0\n')!;
	assert.deepEqual(unverified(['TestAiRows', 'test_ai_param', 'TestAiBad'], run), ['TestAiBad']);
	const base = { command: 'pytest', code: 0, failures: [], tail: '', log: '', tests: { tests: {}, packages: {} } };
	const now = { ...base, code: 1, tests: run };
	assert.deepEqual(compareWithBaseline([base, base], now, ['TestAiRows', 'test_ai_param', 'TestAiBad']).newFailing.sort(),
		['tests/test_r_ai.py TestAiBad', 'tests/test_r_ai.py TestAiBad/test_b']);
});

test('test names, problems and the test file name', { skip: noPython() }, async () => {
	const text = 'import json\nimport unittest\nfrom pkg.report import parse\n\n\ndef test_ai_parse():\n    assert parse("1")\n\n\n'
		+ 'class TestAiRows(unittest.TestCase):\n    def test_a(self):\n        pass\n\n\ndef helper():\n    return 1\n';
	const info = await pyInfo('tests/test_report_ai.py', text);
	assert.deepEqual(pyTestNames(info), ['test_ai_parse', 'TestAiRows']);
	assert.deepEqual(pyTestProblems(text, info, 'pkg.report', ['json', 'unittest']), []);
	const bad = 'import socket\nimport requests\nfrom pkg import other\nimport asyncio\nURL = "https://api.example.net/x"\n'
		+ 'def test_x():\n    asyncio.create_subprocess_exec("ls")\n';
	assert.deepEqual(pyTestProblems(bad, await pyInfo('tests/test_report_ai.py', bad), 'pkg.report', ['asyncio', 'socket']), [
		'it imports socket', 'it imports requests, which is not in the standard library', 'it imports pkg.other; only pkg.report is under test',
		'it starts a subprocess', 'it names a remote URL']);
	assert.equal(pyTestFileName('pkg/report.py', ['tests/test_x.py'], '.'), 'tests/test_report_ai.py');
	assert.equal(pyTestFileName('src/pkg/report.py', ['tests/pkg/test_x.py'], 'src'), 'tests/pkg/test_report_ai.py');
	assert.equal(pyTestFileName('pkg/__init__.py', ['pkg/test_util.py'], '.'), 'pkg/test_pkg_ai.py');
});
````


- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/aiReadyPyTests.test.ts(4,75): error TS2307: Cannot find module '../src/aiready/pyTests' or its corresponding type declarations.
```


- [ ] **Step 3: Implement.**

Create `src/aiready/pyTests.ts`:

````ts
import * as path from 'path';
import type { Outcome, TestRun } from './baseline';
import type { FileInfo } from './language';
import type { PyFileInfo } from './pyRules';

const PYTEST = /^(PASSED|FAILED|ERROR|XFAIL|XPASS) (\S[^\n]*?)(?: - [^\n]*)?$/gm;
const PYTEST_OUTCOME: Record<string, Outcome> = { PASSED: 'pass', FAILED: 'fail', ERROR: 'fail', XFAIL: 'skip', XPASS: 'pass' };
const UNITTEST = /^(\w+) \(([\w.]+)\)(?:\n[^\n]*?)? \.\.\. (ok|FAIL|ERROR|skipped|expected failure|unexpected success)\b/gm;
const UNITTEST_OUTCOME: Record<string, Outcome> = {
	ok: 'pass', FAIL: 'fail', ERROR: 'fail', skipped: 'skip', 'expected failure': 'skip', 'unexpected success': 'pass',
};

const worse = (a: Outcome | undefined, b: Outcome): Outcome => (a === 'fail' || b === 'fail' ? 'fail' : a === 'pass' || b === 'pass' ? 'pass' : 'skip');

/** Adds a test and, like Go's parent tests, every prefix of its path (`Class`, `Class/test`), with the worst outcome below it. */
function add(run: { tests: Record<string, Outcome>; packages: Record<string, Outcome> }, file: string, parts: readonly string[], outcome: Outcome): void {
	for (let i = 1; i <= parts.length; i++) {
		const key = `${file} ${parts.slice(0, i).join('/')}`;
		run.tests[key] = i === parts.length && !(key in run.tests) ? outcome : worse(run.tests[key], outcome);
	}
	run.packages[file] = worse(run.packages[file], outcome);
}

/**
 * Per-test outcomes from pytest's `-rA` summary or unittest's `-v` lines; undefined for any other output (compared by
 * exit code then). pytest keys are `<file> <Class>/<test>/[<param>]`, unittest keys `<module> <Class>/<test>`; a pytest
 * collection error is `<file> (collection)`. `SKIPPED` summary lines carry no test ID and are not keyed.
 */
export function parsePyTests(output: string): TestRun | undefined {
	const run = { tests: {} as Record<string, Outcome>, packages: {} as Record<string, Outcome> };
	for (const m of output.matchAll(PYTEST)) {
		const [file, ...rest] = m[2].split('::');
		if (!/\.py$/.test(file)) { continue; }
		if (!rest.length) { add(run, file, ['(collection)'], 'fail'); continue; }
		const last = rest.pop()!;
		const param = /^([^[]+)(\[.*\])$/.exec(last);
		add(run, file, [...rest, ...(param ? [param[1], param[2]] : [last])], PYTEST_OUTCOME[m[1]]);
	}
	if (Object.keys(run.tests).length || /^(?:=+ )?no tests ran\b/m.test(output)) { return run; }
	for (const m of output.matchAll(UNITTEST)) {
		const dotted = m[2].endsWith(`.${m[1]}`) ? m[2].slice(0, -(m[1].length + 1)) : m[2];
		const cut = dotted.lastIndexOf('.');
		add(run, dotted.slice(0, Math.max(0, cut)) || dotted, [dotted.slice(cut + 1), m[1]], UNITTEST_OUTCOME[m[3]]);
	}
	return Object.keys(run.tests).length || /^Ran \d+ tests? in /m.test(output) ? run : undefined;
}

/** Top-level `test_*` functions and `Test*` classes a test file declares. */
export function pyTestNames(info: FileInfo): string[] {
	return info.declarations.filter(d => (/def$/.test(d.kind) && /^test/.test(d.names[0] ?? '')) || (d.kind === 'class' && /^Test/.test(d.names[0] ?? '')))
		.map(d => d.names[0]);
}

const BLOCKED = new Set(['socket', 'ssl', 'http', 'urllib', 'subprocess', 'ftplib', 'smtplib', 'poplib', 'imaplib', 'nntplib', 'telnetlib', 'xmlrpc',
	'socketserver', 'webbrowser', 'multiprocessing', 'ctypes']);
const REMOTE_URL = /\bhttps?:\/\/(?!(?:localhost|127\.0\.0\.1|\[::1\]|example\.(?:com|org|net))(?:[:/"'`]|$))/;

/**
 * Why a generated test file may not be used: it imports something other than the module under test, pytest, unittest
 * and the standard library minus network and process modules, starts subprocesses through asyncio, names a remote URL,
 * or declares no tests.
 */
export function pyTestProblems(text: string, info: PyFileInfo, module: string, stdlib: readonly string[]): string[] {
	const problems: string[] = [];
	if (!pyTestNames(info).length) { problems.push('it declares no test_ functions or Test classes'); }
	const top = module.split('.')[0];
	const parent = module.slice(0, Math.max(0, module.lastIndexOf('.')));
	const leaf = module.slice(module.lastIndexOf('.') + 1);
	const imports = [...text.matchAll(/^[ \t]*(?:from\s+(\.*[\w.]*)\s+import\s+(\([^)]*\)|[^\n#]*)|import\s+([\w., \t]+))/gm)].flatMap(m => (m[3] !== undefined
		? m[3].split(',').map(p => ({ name: p.trim().split(/\s+/)[0], names: [] as string[] }))
		: [{ name: m[1], names: m[2].replace(/[()]/g, '').split(',').map(p => p.trim().split(/\s+/)[0]).filter(Boolean) }]));
	for (const { name, names } of imports) {
		const first = name.split('.')[0];
		if (name.startsWith('.')) { problems.push(`it uses the relative import ${name}`); }
		else if (BLOCKED.has(first)) { problems.push(`it imports ${name}`); }
		else if (first === top) {
			const other = name === parent ? names.find(n => n !== leaf) : name !== module && !module.startsWith(`${name}.`) ? name : undefined;
			if (other) { problems.push(`it imports ${name === parent ? `${parent}.${other}` : other}; only ${module} is under test`); }
		} else if (!['pytest', 'unittest'].includes(first) && !stdlib.includes(first)) { problems.push(`it imports ${name}, which is not in the standard library`); }
	}
	if (/\bcreate_subprocess_(?:exec|shell)\b/.test(text)) { problems.push('it starts a subprocess'); }
	if (REMOTE_URL.test(text)) { problems.push('it names a remote URL'); }
	return [...new Set(problems)];
}

/** `tests/…/test_<stem>_ai.py` when the project keeps tests in a top-level folder (mirroring the package path when it does), else next to the source. */
export function pyTestFileName(file: string, tracked: readonly string[], root: string): string {
	const base = path.posix.basename(file) === '__init__.py' ? path.posix.basename(path.posix.dirname(file)) : path.posix.basename(file, '.py');
	const name = `test_${base}_ai.py`;
	const folder = ['tests', 'test'].find(dir => tracked.some(f => f.startsWith(`${dir}/`)));
	if (!folder) { return path.posix.join(path.posix.dirname(file), name); }
	const rel = path.posix.dirname(root === '.' ? file : file.slice(root.length + 1));
	const mirrored = path.posix.join(folder, rel);
	return path.posix.join(tracked.some(f => f.startsWith(`${mirrored}/`)) ? mirrored : folder, name);
}
````

Create `src/aiready/pyPrompts.ts`:

````ts
import * as path from 'path';
import { redact } from '../records/redact';
import type { Prompt } from './language';
import type { PyFileInfo } from './pyRules';

const MAX_SOURCE_CHARS = 60_000;

const SPLIT_SYSTEM = `You plan how to split one long Python module into focused modules in the same package folder.
The host moves whole top-level definitions byte for byte, writes every import itself and leaves a re-export line in the original,
so no caller changes; you only choose groups.
Rules:
- Refer to declarations only by their numeric "id". Never move one marked "movable": false.
- "needs" lists the ids a declaration uses. Put a declaration in the same new module as every id it needs that would otherwise stay
  in the original; it may use an id that moves to another new module, but two new modules must not need each other.
- "readsWhenDefined" lists ids it reads while it is being defined (defaults, decorators, base classes, values): those must move to
  the same new module and come before it.
- Names starting with _ are private but may move; the original re-imports every moved name.
- Every new module and the original must end up at 400 lines or fewer. Leave the definitions that belong to the original's main job in it.
- New module names: lowercase letters, digits and underscores ending in .py; not the name of a file, folder or name already in the
  package, not a standard or installed module, not test_*, *_test, conftest, setup, models, views, urls, tasks or settings.
Reply with only a JSON array, for example: [{"file":"rows.py","declarations":[3,7]}]`;

const TEST_SYSTEM = `You write a Python test file that pins how one module behaves today, so later refactors can be checked.
Rules:
- Import only the module under test (by its dotted name), pytest or unittest and unittest.mock, and the standard library.
  No network, sockets, http, urllib, subprocess, multiprocessing or ctypes; no remote URLs.
- Test what the code does now, even if it looks wrong. Prefer pure functions and simple classes; skip anything that needs a database,
  the network, other programs, environment variables or real time.
- Write unittest.TestCase classes named TestAi<Something> (pytest runs them too) so they do not collide with existing tests.
  No files outside a temporary folder, no global state that leaks between tests.
Reply with the whole test file in one \`\`\`python code block and nothing else.`;

/** The model's input for a Python split plan: declarations by id with what they need, and the folder's names. */
export function pySplitPrompt(info: PyFileInfo, totalLines: number, folder: readonly string[]): Prompt {
	const owner = new Map<string, number>();
	for (const d of info.declarations) { d.names.forEach(name => { if (!owner.has(name)) { owner.set(name, d.id); } }); }
	const ids = (names: readonly string[], self: number) => [...new Set(names.flatMap(n => (owner.has(n) && owner.get(n) !== self ? [owner.get(n)!] : [])))];
	const declarations = info.declarations.map(d => {
		const needs = ids(d.py.reads, d.id);
		const early = ids([...d.py.sameFile, ...(info.context.deferred || info.facts.future ? [] : d.py.annSameFile), ...d.py.baseNames], d.id);
		return {
			id: d.id, kind: d.kind, names: d.names, lines: d.lines, ...(d.doc ? { firstDocLine: d.doc } : {}),
			...(needs.length ? { needs } : {}), ...(early.length ? { readsWhenDefined: early } : {}),
			...(d.movable ? {} : { movable: false, reason: d.reason }),
		};
	});
	return {
		system: SPLIT_SYSTEM,
		text: `Module: ${info.context.module} (${info.path}, ${totalLines} lines)\nFiles and folders already in its folder: ${folder.join(', ')}\n`
			+ `Declarations:\n${declarations.map(d => JSON.stringify(d)).join('\n')}\n\n`
			+ `Plan new modules so ${path.posix.basename(info.path)} and every new module are at most 400 lines.`,
	};
}

/** The model's input for an add-tests fix. */
export function pyTestPrompt(file: string, source: string, module: string, testFile: string, runner: string): Prompt {
	return {
		system: TEST_SYSTEM,
		text: `Write ${testFile} for ${file} (import it as ${module}); the project runs tests with ${runner}.\n\n`
			+ `=== ${file} ===\n${redact(source).slice(0, MAX_SOURCE_CHARS)}`,
	};
}
````


- [ ] **Step 4: Run the tests.**

Run: `npx tsc --noEmit -p ./ && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 325
ℹ fail 0
```


- [ ] **Step 5: Commit.**

```bash
git add src/aiready/pyTests.ts src/aiready/pyPrompts.ts test/aiReadyPyTests.test.ts
git commit -m "Python adapter: test output, test files and prompts"
```


### Task 10: Move rules 2, 4 and 6, and the adapter

**Files:**
- Create: `src/aiready/pyMoveCheck.ts`, `src/aiready/pyAdapter.ts`, `test/aiReadyPyMoveCheck.test.ts`

The move-check tests split through the adapter, write the files, change them on purpose, and re-parse them from disk, as the core's step does.


- [ ] **Step 1: Write the failing tests.**

Create `test/aiReadyPyMoveCheck.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import type { SplitPlan } from '../src/aiready/language';
import { checkMove } from '../src/aiready/moveCheck';
import { createPyAdapter } from '../src/aiready/pyAdapter';
import { pySameDeclarations } from '../src/aiready/pyMoveCheck';
import { HELPER, noPython, python, pyProjectFiles, REPORT } from './pyFixture';

const skip = noPython();

/** Splits pkg/report.py with the adapter, lets `edit` change what was written, and runs move rules 1–6 on the files re-parsed from disk. */
async function splitIn(plan: SplitPlan, edit: (texts: Record<string, string>) => void = () => undefined, text = REPORT): Promise<string[]> {
	const { root, tracked } = pyProjectFiles({ 'pkg/__init__.py': '', 'pkg/report.py': text });
	const adapter = createPyAdapter(root, python()!, { helperDir: HELPER, storageDir: root }, tracked);
	const file = 'pkg/report.py';
	const source = readFileSync(path.join(root, file));
	const info = await adapter.parse(file);
	const unitBefore = await Promise.all((await adapter.unitFiles(file)).map(f => adapter.parse(f)));
	const result = adapter.buildSplit(source, info, plan);
	const texts: Record<string, string> = { [file]: result.original.toString('utf8') };
	for (const f of result.files) { texts[`pkg/${f.name}`] = f.text.toString('utf8'); }
	edit(texts);
	for (const [name, body] of Object.entries(texts)) { writeFileSync(path.join(root, name), body); }
	const read = async (name: string) => ({ text: readFileSync(path.join(root, name)), info: await adapter.parse(name) });
	const unitAfter = await Promise.all((await adapter.unitFiles(file)).map(f => adapter.parse(f)));
	return [
		...checkMove({ before: { text: source, info }, after: await read(file), files: await Promise.all(result.files.map(f => read(`pkg/${f.name}`))), plan,
			header: adapter.splitHeader(file), importProblems: adapter.importProblems, blankLines: adapter.blankLines }),
		...adapter.sameDeclarations(unitBefore, unitAfter),
	];
}

const PLAN: SplitPlan = [{ file: 'rows.py', declarations: [0, 1, 2] }, { file: 'calls.py', declarations: [3, 4, 5, 6] }];

test('move check: a clean split passes rules 1 to 6', { skip }, async () => {
	assert.deepEqual(await splitIn(PLAN), []);
	assert.deepEqual(await splitIn([{ file: 'rows.py', declarations: [3] }, { file: 'calls.py', declarations: [4] }]), []);
});

test('move check: a commented constant moves into a new module that needs no imports', { skip }, async () => {
	const text = 'import os\n\n# How amounts are shown.\nCURRENCY = "EUR"\n\n\ndef f():\n    return os\n';
	assert.deepEqual(await splitIn([{ file: 'money.py', declarations: [0] }], () => undefined, text), []);
	assert.deepEqual(await splitIn([{ file: 'money.py', declarations: [0] }], () => undefined, `# Copyright.\n\n${text.slice('import os\n\n'.length)}`
		.replace('return os', 'return 1')), []);
});

test('move check: an edited body, a dropped facade name, a new import and a facade naming another file fail', { skip }, async () => {
	const edited = await splitIn(PLAN, t => { t['pkg/rows.py'] = t['pkg/rows.py'].replace('return np', 'return None'); });
	assert.match(edited.join(' '), /Rule 1: rows\.py does not hold exactly its moved declarations/);
	const dropped = await splitIn(PLAN, t => { t['pkg/report.py'] = t['pkg/report.py'].replace(', _row_cache as _row_cache', ''); });
	assert.match(dropped.join(' '), /Rule 2: the facade line for rows\.py names RowError, parse_row, not exactly its moved names/);
	const gained = await splitIn(PLAN, t => { t['pkg/rows.py'] = t['pkg/rows.py'].replace('import json\n', 'import json\nimport pickle\n'); });
	assert.match(gained.join(' '), /Rule 3: pkg\/rows\.py has `import pickle`, which is not a filtered copy of an import of the original/);
	const other = await splitIn(PLAN, t => { t['pkg/report.py'] = t['pkg/report.py'].replace('from .calls import', 'from .other import'); });
	assert.match(other.join(' '), /Rule 2: the leading imports of pkg\/report\.py changed|the facade does not import every new file/);
});

test('move check: a changed __all__ and a binding that resolves elsewhere (rule 6) fail', { skip }, async () => {
	const withAll = REPORT.replace('\n\nclass RowError', '\n\n__all__ = ["report"]\n\n\nclass RowError');
	const plan: SplitPlan = [{ file: 'rows.py', declarations: [1, 2, 3] }];
	assert.deepEqual(await splitIn(plan, () => undefined, withAll), []);
	const changed = await splitIn(plan, t => { t['pkg/report.py'] = t['pkg/report.py'].replace('__all__ = ["report"]', '__all__ = ["report", "x"]'); }, withAll);
	assert.match(changed.join(' '), /__all__ in pkg\/report\.py changed/);
	const { root, tracked } = pyProjectFiles({ 'pkg/__init__.py': '', 'pkg/report.py': 'import json\n\n\ndef f():\n    return json\n',
		'pkg/rows.py': '# Split from report.py by my_editor.\n\nimport simplejson as json\n\n\ndef f():\n    return json\n' });
	const adapter = createPyAdapter(root, python()!, { helperDir: HELPER, storageDir: root }, tracked);
	const before = [await adapter.parse('pkg/report.py')];
	writeFileSync(path.join(root, 'pkg/report.py'), 'import json\nfrom .rows import f as f\n');
	const after = await Promise.all(['pkg/report.py', 'pkg/rows.py'].map(f => adapter.parse(f)));
	assert.match(pySameDeclarations(before, after).join(' '), /Rule 6: \d+ name bindings? differ after the move \(json\)/);
});
````


- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/aiReadyPyMoveCheck.test.ts(7,33): error TS2307: Cannot find module '../src/aiready/pyAdapter' or its corresponding type declarations.
```


- [ ] **Step 3: Implement.**

Create `src/aiready/pyMoveCheck.ts`:

````ts
import { createHash } from 'crypto';
import * as path from 'path';
import type { FileInfo, ParsedFile } from './language';
import { declarationProblems } from './moveCheck';
import type { PyLead } from './pyAst';
import { boundName, copiedLead } from './pyImports';
import type { PyFileInfo } from './pyRules';
import { resolveRelative } from './pyScan';

const stem = (file: string) => path.posix.basename(file).replace(/\.py$/, '');
const firstLine = (text: string) => `\`${text.split('\n')[0].trim()}\``;

/**
 * Move rule 2's import part for Python. The original: its leading block byte-identical, then only the facade, which
 * names exactly the plan's new files and, per file, exactly its moved names, each as `name as name`. A new file: only
 * `__future__` copies, filtered copies of leading-block statements, whole copies of compound ones, and imports of
 * names its sibling new files define.
 */
export function pyImportProblems(before: ParsedFile, after: ParsedFile, files: readonly ParsedFile[]): string[] {
	const was = before.info as PyFileInfo;
	const now = after.info as PyFileInfo;
	const text = (file: ParsedFile, item: PyLead) => file.text.subarray(item.start, item.end).toString('utf8');
	const problems: string[] = [];
	const oldLead = was.facts.lead.filter((_, i) => !was.facade.includes(i)).map(item => text(before, item));
	const kept = now.facts.lead.filter((_, i) => !now.facade.includes(i)).map(item => text(after, item));
	if (kept.length !== oldLead.length || kept.some((t, i) => t !== oldLead[i])) { problems.push(`Rule 2: the leading imports of ${was.path} changed.`); }
	const stems = files.map(f => stem(f.info.path));
	const facade = now.facade.map(i => now.facts.lead[i].imports[0]);
	for (const imp of facade) {
		const index = stems.indexOf(imp.module);
		if (index < 0) { problems.push(`Rule 2: the facade imports .${imp.module}, which is not a new file of this split.`); continue; }
		const moved = files[index].info.declarations.flatMap(d => d.names).sort().join(', ');
		const listed = imp.aliases.map(a => a.name).sort().join(', ');
		if (moved !== listed) { problems.push(`Rule 2: the facade line for ${imp.module}.py names ${listed || 'nothing'}, not exactly its moved names (${moved}).`); }
	}
	if (facade.length !== stems.length || stems.some(s => !facade.some(imp => imp.module === s))) {
		problems.push('Rule 2: the facade does not import every new file exactly once.');
	}
	files.forEach((file, index) => {
		const info = file.info as PyFileInfo;
		for (const item of info.facts.lead) {
			const t = text(file, item);
			const imp = item.imports[0];
			if (item.kind === 'doc') { problems.push(`Rule 3: ${info.path} has a docstring.`); continue; }
			if (item.kind === 'import' && imp.kind === 'from' && imp.level === 1 && stems.includes(imp.module) && stems.indexOf(imp.module) !== index) {
				const other = files[stems.indexOf(imp.module)].info.declarations.flatMap(d => d.names);
				if (imp.aliases.some(a => a.asname || !other.includes(a.name))) {
					problems.push(`Rule 3: ${info.path} imports from ${imp.module}.py a name it does not define.`);
				}
				continue;
			}
			const keep = new Set(item.binds);
			if (!was.facts.lead.some(o => o.kind === item.kind && copiedLead(before.text, o, keep) === t)) {
				problems.push(`Rule 3: ${info.path} has ${firstLine(t)}, which is not a filtered copy of an import of the original.`);
			}
		}
	});
	return problems;
}

const hash = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12);

/** What a global name in a file resolves to: a declaration (by its bytes), an import (absolute module and name), or a builtin. */
function target(infos: readonly PyFileInfo[], info: PyFileInfo, name: string, depth = 0): string {
	const decl = info.declarations.find(d => d.names.includes(name));
	if (decl && info.facts.bindings[name] === 1) { return `decl ${hash(info.spans[decl.id])}`; }
	const item = info.facts.lead.find(l => l.binds.includes(name));
	if (!item) { return name in info.facts.bindings ? `statement ${name}` : `builtin ${name}`; }
	const imp = item.imports.find(i => i.aliases.some(a => boundName(i, a) === name));
	const alias = imp?.aliases.find(a => boundName(imp, a) === name);
	if (!imp || !alias || item.kind === 'compound') {
		const parts = item.imports.map(i => `${resolveRelative(info.context.package, i.level, i.module)}:${i.aliases.map(a => `${a.name}>${a.asname}`)}`);
		return `${item.kind} ${parts.join(';')}`;
	}
	if (imp.kind === 'from' && imp.level === 1 && depth < 5) {
		const sibling = infos.find(i => i.path === path.posix.join(path.posix.dirname(info.path), `${imp.module}.py`));
		if (sibling && sibling !== info && sibling.declarations.some(d => d.names.includes(alias.name))) { return target(infos, sibling, alias.name, depth + 1); }
	}
	return imp.kind === 'from' ? `import ${resolveRelative(info.context.package, imp.level, imp.module)}:${alias.name}`
		: `module ${alias.asname ? alias.name : alias.name.split('.')[0]}`;
}

/** Every (declaration bytes, name read, target) of a unit's files, counted. */
function bindingKeys(infos: readonly PyFileInfo[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const info of infos) {
		for (const d of info.declarations) {
			for (const name of d.py.reads) {
				const key = `${hash(info.spans[d.id])}|${name}|${target(infos, info, name)}`;
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}
	}
	return counts;
}

/**
 * Move rule 4 and rule 6 for Python: the same declarations (kind, names, attached comments and docstring) across the
 * unit; the original binds the same names and keeps `__all__` byte for byte; each new file binds only its moved names
 * and its imports; and every global name read anywhere resolves to the same declaration, import or builtin.
 */
export function pySameDeclarations(before: readonly FileInfo[], after: readonly FileInfo[]): string[] {
	const was = before as readonly PyFileInfo[];
	const now = after as readonly PyFileInfo[];
	const problems = declarationProblems(before, after);
	const original = was[0];
	const current = now.find(info => info.path === original.path);
	if (!current) { return [...problems, `Rule 4: ${original.path} is missing after the move.`]; }
	const names = (info: PyFileInfo) => Object.keys(info.facts.bindings).sort();
	const lost = names(original).filter(n => !names(current).includes(n));
	const gained = names(current).filter(n => !names(original).includes(n));
	if (lost.length || gained.length) { problems.push(`Rule 4: ${original.path} binds different names after the move (${[...lost, ...gained].join(', ')}).`); }
	const all = (info: PyFileInfo) => info.declarations.filter(d => d.names.includes('__all__')).map(d => info.spans[d.id]).join('\n');
	if (all(original) !== all(current)) { problems.push(`Rule 4: __all__ in ${original.path} changed.`); }
	for (const info of now.filter(n => !was.some(w => w.path === n.path))) {
		const allowed = new Set([...info.declarations.flatMap(d => d.names), ...info.facts.lead.flatMap(l => l.binds)]);
		const extra = Object.keys(info.facts.bindings).filter(n => !allowed.has(n));
		if (extra.length) { problems.push(`Rule 4: ${info.path} also binds ${extra.join(', ')}.`); }
	}
	const a = bindingKeys(was);
	const b = bindingKeys(now);
	const changed = [...new Set([...a.keys(), ...b.keys()])].filter(key => (a.get(key) ?? 0) !== (b.get(key) ?? 0));
	if (changed.length) {
		problems.push(`Rule 6: ${changed.length} name binding${changed.length === 1 ? '' : 's'} differ after the move (${changed[0].split('|')[1]}).`);
	}
	return problems;
}
````

Create `src/aiready/pyAdapter.ts`:

````ts
import { existsSync, readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import type { LanguageAdapter, LanguageInfo } from './language';
import { runTool } from './projectCommands';
import { pyFileFacts } from './pyAst';
import { PyInterpreter, pythonApprovalNote } from './pyInterpreter';
import { pyImportProblems, pySameDeclarations } from './pyMoveCheck';
import {
	checkCommands, importRootProblem, moduleOf, modulePatches, projectSkip, pyCommandEnv, PyProject, pyProject, warningFilter,
} from './pyProject';
import { pySplitPrompt, pyTestPrompt } from './pyPrompts';
import { PyFileContext, PyFileInfo, pyFileInfoView, pyFileNameProblems, pySkipReason } from './pyRules';
import type { PyPatches } from './pyScan';
import { buildPySplit, pySplitHeader } from './pySplit';
import { parsePyTests, pyTestFileName, pyTestNames, pyTestProblems } from './pyTests';

/** Python as the core sees it before an adapter exists. */
export const PY_LANGUAGE: LanguageInfo = {
	label: 'Python', extensions: ['.py'], fixes: ['split', 'tests'],
	mayDiffer: 'For moved classes and functions the module part of their full name differs: `__module__`, the `repr` of a class, the last line '
		+ 'of a traceback, error-tracker grouping, logging\'s `%(module)s`, `%(filename)s` and `%(lineno)d`, and Sphinx `automodule` listings. '
		+ 'Pickles written by this branch name the new module and do not load in code from before the split (projects that pickle moved only '
		+ 'constants). The original\'s `__annotations__` no longer lists moved annotated constants, the order of its `__dict__` changes, and the '
		+ 'package gains the new modules as attributes. Under Python 3.15\'s global lazy-import mode, which people running the program can turn '
		+ 'on, imports load when first used instead of in order; the checks here ran on the project\'s interpreter only. A module whose leading '
		+ 'imports come back to it (an import cycle) fails the import check and was not split.',
};

const NO_PATCHES: PyPatches = { strings: new Map(), named: new Map(), assigned: new Map() };

/** Names a module binds at its top level, from its text (enough to keep a new submodule from replacing one). */
function topLevelNames(text: string): string[] {
	const names = [...text.matchAll(/^(?:async\s+def|def|class)\s+(\w+)|^(\w+)\s*(?::[^=\n]*)?=(?!=)|^import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm)]
		.map(m => m[1] ?? m[2] ?? m[4] ?? m[3].split('.')[0]);
	for (const m of text.matchAll(/^from\s+\S+\s+import\s+(\([^)]*\)|[^\n]*)/gm)) {
		names.push(...m[1].replace(/[()]|#[^\n]*/g, '').split(',').map(p => p.trim().split(/\s+as\s+/).pop()!).filter(Boolean));
	}
	return names;
}

/**
 * The Python language adapter for one root (the user's folder for the picker, the worktree for fixes), with the
 * project's interpreter. All analysis is host-side: the shipped helper parses with the project's Python, isolated, and
 * the model only proposes groups of declaration IDs.
 */
export function createPyAdapter(root: string, python: PyInterpreter, dirs: { helperDir: string; storageDir: string }, tracked: readonly string[]):
	LanguageAdapter {
	let project: PyProject | undefined;
	const patches = new Map<string, PyPatches>();
	const facts = () => (project ??= pyProject(root, python, dirs.helperDir, dirs.storageDir, tracked));
	const entries = (file: string) => { try { return readdirSync(path.join(root, path.posix.dirname(file))); } catch { return []; } };
	const siblings = (file: string) => entries(file).filter(name => name.endsWith('.py') && name !== path.posix.basename(file)).filter(name => {
		try { return readFileSync(path.join(root, path.posix.dirname(file), name), 'utf8').split('\n')[0] === pySplitHeader(file).split('\n')[0]; }
		catch { return false; }
	});
	const context = (file: string): PyFileContext => {
		const p = facts();
		const found = moduleOf(p, file);
		const module = 'skip' in found ? '' : found.module;
		const pkg = 'skip' in found ? '' : found.package;
		if (module && !patches.has(module)) { patches.set(module, modulePatches(p, module)); }
		return {
			module, package: pkg, skip: 'skip' in found ? found.skip : projectSkip(p, file, module, pkg), constantsOnly: p.constantsOnly,
			deferred: p.config.deferredAnnotations, django: p.django, patches: patches.get(module) ?? NO_PATCHES, migrationWords: p.scan.migrationWords,
			warningFilter: module ? warningFilter(p, module) : undefined, shadowed: p.shadowed, splitSiblings: siblings(file).map(n => n.replace(/\.py$/, '')),
		};
	};
	const moduleName = (file: string) => { const found = moduleOf(facts(), file); return 'skip' in found ? undefined : found.module; };
	const testFileName = (file: string) => pyTestFileName(file, tracked, facts().roots.find(r => r !== '.' && file.startsWith(`${r}/`)) ?? '.');
	const runner = () => checkCommands(facts(), 'x').find(c => c.label === 'test')?.command.split(' ').slice(1, 3).join(' ') ?? 'pytest';
	return {
		id: 'py',
		...PY_LANGUAGE,
		blankLines: 'longest',
		testOutput: 'both',
		get commandEnv() { return pyCommandEnv(facts()); },
		get approvalNote() { return pythonApprovalNote(python, facts().config.requiresPython, pyCommandEnv(facts())); },
		async parse(file) {
			const text = readFileSync(path.join(root, file));
			const pyFacts = await pyFileFacts(python.path, dirs.helperDir, path.join(root, file), dirs.storageDir);
			const ctx = context(file);
			return pyFileInfoView(file, text, pyFacts, ctx, pySkipReason(file, pyFacts, ctx));
		},
		fileNameProblems(name, original) {
			const dir = path.posix.dirname(original);
			const init = [path.posix.join(dir, '__init__.py'), path.posix.join(dir, '__init__.pyi')].filter(f => existsSync(path.join(root, f)));
			return pyFileNameProblems(name, original, {
				entries: entries(original), packageNames: init.flatMap(f => topLevelNames(readFileSync(path.join(root, f), 'utf8'))),
				stdlib: python.stdlib, installed: python.installed, testGlobs: facts().config.pythonFiles,
			});
		},
		splitHeader: pySplitHeader,
		buildSplit: (source, info, plan) => buildPySplit(source, info as PyFileInfo, plan,
			{ lineLength: facts().config.lineLength, deferred: facts().config.deferredAnnotations }),
		importProblems: pyImportProblems,
		sameDeclarations: pySameDeclarations,
		unitFiles: async file => [file, ...siblings(file).map(name => path.posix.join(path.posix.dirname(file), name))],
		async unformatted(files) {
			const formatter = facts().config.formatter;
			const bin = formatter && path.join(path.dirname(python.path), formatter);
			if (!files.length || !bin || !existsSync(bin)) { return []; }
			const result = await runTool(bin, formatter === 'ruff' ? ['format', '--check', ...files] : ['--check', ...files], root, pyCommandEnv(facts()));
			return `${result.stdout}\n${result.stderr}`.split('\n').map(line => /^(?:would reformat|Would reformat:) (.+)$/.exec(line.trim())?.[1] ?? '')
				.map(name => path.relative(root, path.resolve(root, name)).split(path.sep).join('/')).filter(name => files.includes(name));
		},
		checks: file => { const module = moduleName(file); return module ? checkCommands(facts(), module) : []; },
		ready: () => importRootProblem(facts()),
		parseTests: parsePyTests,
		testFileName,
		testNames: pyTestNames,
		testProblems: (text, info, source) => pyTestProblems(text, info as PyFileInfo, (source as PyFileInfo).context.module, python.stdlib),
		splitPrompt: (info, lines) => pySplitPrompt(info as PyFileInfo, lines, entries(info.path)),
		testPrompt: (file, source, info) => pyTestPrompt(file, source, (info as PyFileInfo).context.module, testFileName(file), runner()),
	};
}
````


- [ ] **Step 4: Run the tests.**

Run: `npx tsc --noEmit -p ./ && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 329
ℹ fail 0
```


- [ ] **Step 5: Commit.**

```bash
git add src/aiready/pyMoveCheck.ts src/aiready/pyAdapter.ts test/aiReadyPyMoveCheck.test.ts
git commit -m "Python adapter: move rules and the adapter"
```


## Chunk 8: Wiring

### Task 11: Register Python, the interpreter pick and its command

**Files:**
- Create: `src/aiready/pyPick.ts`, `test/aiReadyPyAdapter.test.ts`
- Modify: `src/aiready/languages.ts`, `src/aiready/fixRun.ts`, `src/extension.ts`, `package.json`, `tsconfig.test.json`, `test/aiReadyRunText.test.ts`, `test/aiReadyTsSteps.test.ts`

`languages.ts` picks Python when the top folder has `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements*.txt`, `Pipfile` or `manage.py` and neither `go.mod` nor a TS marker. The interpreter is asked through `AdapterHost.choosePython`, so `languages.ts` stays free of `vscode`. The adapter tests run real splits and an add-tests fix on temporary repositories with the machine's `python3` (unittest, no pytest needed).


- [ ] **Step 1: Write the failing tests.**

Create `test/aiReadyPyAdapter.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CheckResult, failureLines, flakyTests, runBaseline } from '../src/aiready/baseline';
import type { LanguageAdapter } from '../src/aiready/language';
import { adapterFor, fixableFinding } from '../src/aiready/languages';
import { runCommand, tail } from '../src/aiready/projectCommands';
import { createPyAdapter } from '../src/aiready/pyAdapter';
import { runAddTests, runSplit, StepContext } from '../src/aiready/steps';
import { fakePython, HELPER, noPython, python, pyProjectFiles } from './pyFixture';

const skip = noPython();
const EXT = path.resolve(__dirname, '../..');
const store = () => mkdtempSync(path.join(os.tmpdir(), 'my-editor-py-store-'));

const REPORT = '"""Rows."""\nimport json\n\nLIMIT = 10\n\n\ndef parse(line):\n    return json.loads(line)\n\n\ndef clamp(x):\n    return min(x, LIMIT)\n\n\n'
	+ 'def report(lines):\n    return [clamp(parse(line)) for line in lines]\n';
const TESTS = 'import unittest\n\nfrom pkg import report\n\n\nclass TestReport(unittest.TestCase):\n    def test_report(self):\n'
	+ '        self.assertEqual(report.report(["3", "30"]), [3, 10])\n';

test('Python projects get the Python adapter; its findings are fixable; the version gate stops a 3.15 interpreter', async () => {
	assert.ok(fixableFinding('pkg/report.py', 'too-long') && fixableFinding('pkg/report.py', 'untested'));
	const { root } = pyProjectFiles({ 'pyproject.toml': '[project]\nname = "x"\n' });
	const late = fakePython(path.join(store(), 'bin'), [3, 15, 0]);
	assert.equal(await adapterFor(root, { extensionPath: EXT, storageDir: store(), version: 't', appRoot: '', choosePython: async () => late }),
		'Python splitting needs Python 3.9 to 3.14 for now.');
	const { root: plain } = pyProjectFiles({ 'README.md': 'x\n' });
	assert.match(await adapterFor(plain, { extensionPath: EXT, storageDir: store(), version: 't', appRoot: '' }) as string,
		/`requirements\.txt`, `Pipfile` or `manage\.py`/);
});

test('commands start with the interpreter file name; a path with spaces stays in the env, never in the command text', { skip }, async () => {
	const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'my editor-')), '.venv', 'bin');
	mkdirSync(dir, { recursive: true });
	symlinkSync(python()!.path, path.join(dir, 'python'));
	const { root, tracked } = pyProjectFiles({ 'requirements.txt': '', 'pkg/__init__.py': '', 'pkg/report.py': REPORT, 'tests/__init__.py': '',
		'tests/test_report.py': TESTS });
	const factory = await adapterFor(root,
		{ extensionPath: EXT, storageDir: store(), version: 't', appRoot: '', choosePython: async () => path.join(dir, 'python') });
	assert.ok(typeof factory === 'function');
	const adapter = factory(root, tracked);
	assert.deepEqual(adapter.checks('pkg/report.py').map(c => c.command), ['python -m my_editor_pycheck pkg.report', 'python -m unittest discover -v']);
	assert.ok(adapter.commandEnv!.PATH.startsWith(`${dir}${path.delimiter}`));
	assert.match(adapter.approvalNote ?? '', /^Python: .*my editor-.*\/\.venv\/bin\/python \(3\./);
	const out = await runCommand('python -m my_editor_pycheck pkg.report', { cwd: root, approved: ['python -m my_editor_pycheck pkg.report'], timeoutMs: 60_000,
		logFile: path.join(store(), 'log'), env: { ...adapter.commandEnv, ...adapter.checks('pkg/report.py')[0].env } });
	assert.equal(out.code, 0, out.output);
});

/** A step context on a repository with the real interpreter, the baseline recorded, and the model replaced by fixed replies. */
async function context(files: Record<string, string>, replies: string[]): Promise<{ ctx: StepContext; root: string; adapter: LanguageAdapter }> {
	const { root, tracked } = pyProjectFiles(files, true);
	const adapter = createPyAdapter(root, python()!, { helperDir: HELPER, storageDir: store() }, tracked);
	const approved = adapter.checks('pkg/report.py').map(c => c.command);
	const check = async (command: string, label: string, env?: Readonly<Record<string, string>>): Promise<CheckResult> => {
		const out = await runCommand(command,
			{ cwd: root, approved, timeoutMs: 120_000, logFile: path.join(store(), 'log'), env: { ...adapter.commandEnv, ...env } });
		return { command, label, code: out.code, failures: label === 'test' ? [] : failureLines(out.output), tail: tail(out.output), log: '',
			tests: label === 'test' ? adapter.parseTests(adapter.testOutput === 'both' ? out.output : out.stdout) : undefined };
	};
	const outcome = await runBaseline(adapter.checks('pkg/report.py'), { check, cancelled: () => false, progress: () => undefined });
	assert.ok('baseline' in outcome);
	const flaky = Object.values(outcome.baseline).flatMap(([a, b]) => flakyTests(a.tests, b.tests));
	let asked = 0;
	const ctx: StepContext = { adapter, worktree: root, baseline: outcome.baseline, flaky, check, cancelled: () => false, progress: () => undefined,
		ask: async () => replies[Math.min(asked++, replies.length - 1)] };
	return { ctx, root, adapter };
}

const PROJECT = { '.gitignore': '__pycache__/\n', 'setup.cfg': '[metadata]\nname = pkg\n', 'pkg/__init__.py': '', 'pkg/report.py': REPORT,
	'tests/__init__.py': '', 'tests/test_report.py': TESTS };

test('a split runs end to end: plan, move check, the import check and the tests, then one commit', { skip }, async () => {
	const { ctx, root } = await context(PROJECT, [JSON.stringify([{ file: 'limits.py', declarations: [0, 2] }])]);
	const step = await runSplit(ctx, { file: 'pkg/report.py', kind: 'split', lines: 0 });
	assert.equal(step !== 'stopped' && step.status, 'committed', JSON.stringify(step));
	assert.equal(readFileSync(path.join(root, 'pkg/report.py'), 'utf8'),
		'"""Rows."""\nimport json\nfrom .limits import LIMIT as LIMIT, clamp as clamp\n\n\ndef parse(line):\n    return json.loads(line)\n\n\n'
		+ 'def report(lines):\n    return [clamp(parse(line)) for line in lines]\n');
	assert.equal(readFileSync(path.join(root, 'pkg/limits.py'), 'utf8'),
		'# Split from report.py by my_editor.\n\n\nLIMIT = 10\n\n\ndef clamp(x):\n    return min(x, LIMIT)\n');
});

test('a plan using a staying helper is refused after its retry', { skip }, async () => {
	const { ctx } = await context(PROJECT, [JSON.stringify([{ file: 'limits.py', declarations: [2] }])]);
	const step = await runSplit(ctx, { file: 'pkg/report.py', kind: 'split', lines: 0 });
	assert.equal(step !== 'stopped' && step.status, 'refused');
	assert.match(step !== 'stopped' ? step.reason ?? '' : '', /declaration 2 \(clamp\) uses LIMIT \(0\), which stays/);
});

test('add tests: a failing generated test class is dropped by its span and the rest is committed', { skip }, async () => {
	const reply = '```python\nimport unittest\n\nfrom pkg import report\n\n\nclass TestAiGood(unittest.TestCase):\n    def test_clamp(self):\n'
		+ '        self.assertEqual(report.clamp(99), 10)\n\n\nclass TestAiBad(unittest.TestCase):\n    def test_parse(self):\n'
		+ '        self.assertEqual(report.parse("1"), 2)\n```';
	const { ctx, root } = await context(PROJECT, [reply]);
	const step = await runAddTests(ctx, { file: 'pkg/report.py', kind: 'tests', lines: 0 });
	assert.equal(step !== 'stopped' && step.status, 'committed', JSON.stringify(step));
	assert.deepEqual(step !== 'stopped' && step.dropped, ['TestAiBad']);
	const written = readFileSync(path.join(root, 'tests/test_report_ai.py'), 'utf8');
	assert.ok(written.includes('class TestAiGood') && !written.includes('TestAiBad') && !written.includes('from .dropped'));
});
````

Two existing assertions used `.py` as the example of a language without fixes; use `.rs`:

In `test/aiReadyRunText.test.ts`, replace:

````ts
	assert.ok(fixableFinding('src/a.ts', 'too-long') && fixableFinding('src/a.mjs', 'too-long') && fixableFinding('a.go', 'untested'));
	assert.ok(!fixableFinding('src/a.ts', 'untested') && !fixableFinding('a.py', 'too-long') && !fixableFinding('a.go', 'design'));
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-mixed-'));
````

with:

````ts
	assert.ok(fixableFinding('src/a.ts', 'too-long') && fixableFinding('src/a.mjs', 'too-long') && fixableFinding('a.go', 'untested'));
	assert.ok(!fixableFinding('src/a.ts', 'untested') && !fixableFinding('a.rs', 'too-long') && !fixableFinding('a.go', 'design'));
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-mixed-'));
````

In `test/aiReadyTsSteps.test.ts`, replace:

````ts
	assert.ok(!existsSync(path.join(locked.root, 'node_modules')));
	assert.ok(fixableFinding('src/a.ts', 'too-long') && fixableFinding('a.go', 'untested') && !fixableFinding('src/a.ts', 'untested') && !fixableFinding('a.py', 'too-long'));
});
````

with:

````ts
	assert.ok(!existsSync(path.join(locked.root, 'node_modules')));
	assert.ok(fixableFinding('src/a.ts', 'too-long') && fixableFinding('a.go', 'untested') && !fixableFinding('src/a.ts', 'untested') && !fixableFinding('a.rs', 'too-long'));
});
````


- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/aiReadyPyAdapter.test.ts(27,108): error TS2353: Object literal may only specify known properties, and 'choosePython' does not exist in type 'AdapterHost'.
```


- [ ] **Step 3: Implement.**

Create `src/aiready/pyPick.ts`:

````ts
import * as vscode from 'vscode';
import { interpreterProblem, probePython, pythonCandidates, rememberPython } from './pyInterpreter';

const BROWSE = 'Choose a file…';

/** Asks for the project's Python: confirm the only candidate, pick among several, or choose a file. */
export async function choosePython(candidates: readonly string[]): Promise<string | undefined> {
	if (candidates.length === 1) {
		const answer = await vscode.window.showInformationMessage('Use this Python for fixes on a local branch?', { modal: true, detail: candidates[0] },
			'Use it', BROWSE);
		if (answer !== BROWSE) { return answer === 'Use it' ? candidates[0] : undefined; }
	} else if (candidates.length > 1) {
		const pick = await vscode.window.showQuickPick([...candidates, BROWSE], { title: 'Python for fixes on a local branch' });
		if (pick !== BROWSE) { return pick; }
	}
	const files = await vscode.window.showOpenDialog({ title: 'The project\'s Python interpreter', canSelectMany: false, openLabel: 'Use this Python' });
	return files?.[0]?.fsPath;
}

/** **AI-Ready: Choose Python Interpreter**: pick again, check it, and remember it for this folder. */
export async function choosePythonCommand(storageDir: string): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) { void vscode.window.showInformationMessage('Open a project folder first.'); return; }
	const file = await choosePython(pythonCandidates(root));
	if (!file) { return; }
	const probed = probePython(file);
	const problem = typeof probed === 'string' ? probed : interpreterProblem(probed);
	if (problem || typeof probed === 'string') { void vscode.window.showWarningMessage(problem ?? 'That file is not a Python interpreter.'); return; }
	rememberPython(storageDir, root, file);
	void vscode.window.showInformationMessage(`Fixes in this folder use ${file} (Python ${probed.version.join('.')}).`);
}
````

In `src/aiready/languages.ts`, replace:

````ts
import { existsSync } from 'fs';
import * as path from 'path';
````

with:

````ts
import { existsSync, readdirSync } from 'fs';
import * as path from 'path';
````

In `src/aiready/languages.ts`, replace:

````ts
import type { LanguageAdapter } from './language';
import { createTsAdapter, TS_LANGUAGE } from './tsAdapter';
````

with:

````ts
import type { LanguageAdapter } from './language';
import { createPyAdapter, PY_LANGUAGE } from './pyAdapter';
import { pyHelperDir } from './pyAst';
import { ChoosePython, pythonFor } from './pyInterpreter';
import { createTsAdapter, TS_LANGUAGE } from './tsAdapter';
````

In `src/aiready/languages.ts`, replace:

````ts
	readonly appRoot: string;
}
````

with:

````ts
	readonly appRoot: string;
	/** Asks the user for the project's Python when none is remembered (a quick pick in the editor). */
	readonly choosePython?: ChoosePython;
}
````

In `src/aiready/languages.ts`, replace:

````ts
/** Every language with an adapter, in the order a folder's language is chosen. */
const LANGUAGES = [GO_LANGUAGE, TS_LANGUAGE];
const TS_MARKERS = ['package.json', 'tsconfig.json', 'jsconfig.json'];

````

with:

````ts
/** Every language with an adapter, in the order a folder's language is chosen. */
const LANGUAGES = [GO_LANGUAGE, TS_LANGUAGE, PY_LANGUAGE];
const TS_MARKERS = ['package.json', 'tsconfig.json', 'jsconfig.json'];
const PY_MARKERS = ['pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'manage.py'];

/** Whether the top folder looks like a Python project. */
export function pythonProject(root: string): boolean {
	let names: string[] = [];
	try { names = readdirSync(root); } catch { return false; }
	return names.some(name => PY_MARKERS.includes(name) || /^requirements[^/]*\.txt$/.test(name));
}

````

In `src/aiready/languages.ts`, replace:

````ts
/**
 * The adapter for the project's language, or a plain message. Go and TS/JS so far (a mixed repository stays Go-first);
 * Python, C#, Rust and C/C++ follow, each in its own `<language>Adapter.ts` registered here.
 */
````

with:

````ts
/**
 * The adapter for the project's language, or a plain message. Go, TS/JS and Python so far (a mixed repository keeps that
 * order); C#, Rust and C/C++ follow, each in its own `<language>Adapter.ts` registered here.
 */
````

In `src/aiready/languages.ts`, replace:

````ts
	}
	return 'Fixing on a branch works for Go, TypeScript and JavaScript projects (a `go.mod`, `package.json` or `tsconfig.json` in the top folder). '
		+ 'Python, C#, Rust and C/C++ come next.';
}
````

with:

````ts
	}
	if (pythonProject(root)) {
		const python = await pythonFor(root, host.storageDir, host.choosePython ?? (async () => undefined));
		if (typeof python === 'string') { return python; }
		const dirs = { helperDir: pyHelperDir(host.extensionPath), storageDir: host.storageDir };
		return (dir, tracked) => createPyAdapter(dir, python, dirs, tracked);
	}
	return 'Fixing on a branch works for Go, TypeScript, JavaScript and Python projects (a `go.mod`, `package.json`, `tsconfig.json`, '
		+ '`pyproject.toml`, `setup.py`, `setup.cfg`, `requirements.txt`, `Pipfile` or `manage.py` in the top folder). C#, Rust and C/C++ come next.';
}
````

In `src/aiready/fixRun.ts`, replace:

````ts
import { adapterFor, languageNote } from './languages';
import { runAddTests, runSplit, StepContext } from './steps';
````

with:

````ts
import { adapterFor, languageNote } from './languages';
import { choosePython } from './pyPick';
import { runAddTests, runSplit, StepContext } from './steps';
````

In `src/aiready/fixRun.ts`, replace:

````ts
		extensionPath: context.extensionUri.fsPath, storageDir: storage, version: String(context.extension.packageJSON.version ?? 'dev'), appRoot: vscode.env.appRoot,
	});
````

with:

````ts
		extensionPath: context.extensionUri.fsPath, storageDir: storage, version: String(context.extension.packageJSON.version ?? 'dev'), appRoot: vscode.env.appRoot,
		choosePython,
	});
````

In `src/extension.ts`, replace:

````ts
import { fixOnBranch, FixOptions } from './aiready/fixRun';
import { buildBrain, updateBrainFile } from './brain/brain';
````

with:

````ts
import { fixOnBranch, FixOptions } from './aiready/fixRun';
import { choosePythonCommand } from './aiready/pyPick';
import { buildBrain, updateBrainFile } from './brain/brain';
````

In `src/extension.ts`, replace:

````ts
			(sink, token) => fixOnBranch(context, keys, sink, token, options))),
		vscode.commands.registerCommand('myEditor.buildBrain', () => vscode.window.withProgress(
````

with:

````ts
			(sink, token) => fixOnBranch(context, keys, sink, token, options))),
		vscode.commands.registerCommand('myEditor.aiReadyPython', () => choosePythonCommand(context.globalStorageUri.fsPath)),
		vscode.commands.registerCommand('myEditor.buildBrain', () => vscode.window.withProgress(
````

In `package.json`, replace:

````json
        "title": "Fix on a Local Branch",
        "category": "my_editor"
````

with:

````json
        "title": "Fix on a Local Branch",
        "category": "my_editor"
      },
      {
        "command": "myEditor.aiReadyPython",
        "title": "AI-Ready: Choose Python Interpreter",
        "category": "my_editor"
````

List the new pure modules with the others:

In `tsconfig.test.json`, replace:

````json
    "src/aiready/tsPrompts.ts",
    "src/aiready/tsAdapter.ts"
  ]
````

with:

````json
    "src/aiready/tsPrompts.ts",
    "src/aiready/tsAdapter.ts",
    "src/aiready/pyInterpreter.ts",
    "src/aiready/pyAst.ts",
    "src/aiready/pyConfig.ts",
    "src/aiready/pyScan.ts",
    "src/aiready/pyProject.ts",
    "src/aiready/pyRules.ts",
    "src/aiready/pyImports.ts",
    "src/aiready/pySplit.ts",
    "src/aiready/pyMoveCheck.ts",
    "src/aiready/pyTests.ts",
    "src/aiready/pyPrompts.ts",
    "src/aiready/pyAdapter.ts"
  ]
````


- [ ] **Step 4: Run the tests.**

Run: `npx tsc --noEmit -p ./ && npm run -s compile >/dev/null 2>&1 && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 334
ℹ fail 0
```


- [ ] **Step 5: Commit.**

```bash
git add src/aiready/pyPick.ts src/aiready/languages.ts src/aiready/fixRun.ts src/extension.ts package.json tsconfig.test.json test/aiReadyPyAdapter.test.ts test/aiReadyRunText.test.ts test/aiReadyTsSteps.test.ts
git commit -m "AI-ready: register the Python adapter and the interpreter command"
```


## Chunk 9: Dry run on fixture projects, and verification

### Task 12: The whole pipeline without VS Code

**Files:** none in the repository. Everything runs in a scratch folder on generated fixture repositories; the model is replaced by ID plans.

Three repositories, each a Git repository with one commit and an untracked `.venv` made with `--system-site-packages` from a Python that has pytest (here Anaconda's 3.12.2): **plain** (`shop/report.py`, 603 lines: constants, an exception, a `@dataclass`, 72 functions and a staying `logger`, with pytest tests), **pool** (the same plus a tracked file that uses `multiprocessing`), and **refuse** (a doctest, a `warnings.warn` with a pytest `filterwarnings` entry naming the module, a test that patches `shop.report.pick1`, and a `lazy` package whose `__init__.py` defines `__getattr__`).

- [ ] **Step 1: Write the scripts and generate the fixtures.**

```bash
EXT=$PWD   # overlay/extensions/my-editor-core
W=$(mktemp -d) && mkdir -p "$W/check/logs" && cd "$W/check"
(cd "$EXT" && npm test >/dev/null 2>&1)             # fills out-test/ with the compiled modules
```

Create `$W/check/gen-fixtures.py`:

````python
"""Writes the dry-run fixture projects, each a Git repository with one commit and an untracked .venv.
Usage: python3 gen-fixtures.py <out folder> <python with pytest>"""
import os
import subprocess
import sys

out, base_python = sys.argv[1], sys.argv[2]


def group(i):
    return f'''

def pick{i}(sales):
    """Sales of group {i}."""
    return [sale for sale in sales if sale.amount > {i}]


def total{i}(sales):
    """Totals group {i}, clamped."""
    total = 0
    for sale in pick{i}(sales):
        total += clamp(sale.amount, 0, {i * 100})
    return total


def describe{i}(sales):
    """Describes group {i}."""
    total = total{i}(sales)
    lines = [
        "group {i}",
        "count %d" % len(pick{i}(sales)),
        "total %s" % format_amount(total),
    ]
    return "; ".join(lines)
'''


REPORT = '''"""Sales reports."""
import json
import logging
import re
from dataclasses import dataclass
from typing import List, Optional

logger = logging.getLogger(__name__)

# How amounts are shown.
CURRENCY = "EUR"
DIGITS = 2
PATTERN = re.compile(r"\\d+")


class ReportError(Exception):
    """A report could not be made."""


@dataclass
class Sale:
    """One sale."""

    id: str
    amount: int
    region: Optional[str] = None


def clamp(value, low, high):
    """Clamps a value."""
    return min(high, max(low, value))


def format_amount(amount):
    """Formats an amount in the currency."""
    return "%.*f %s" % (DIGITS, amount, CURRENCY)


def parse_sales(text: str) -> List[Sale]:
    """Parses sales from JSON."""
    try:
        rows = json.loads(text)
    except ValueError as error:
        raise ReportError(str(error))
    return [Sale(str(row["id"]), int(row["amount"])) for row in rows]
''' + ''.join(group(i) for i in range(1, 24)) + '''

def report(sales):
    """The whole report, one line per group."""
    logger.debug("reporting %d sales", len(sales))
    return "\\n".join([''' + ', '.join(f'describe{i}(sales)' for i in range(1, 24)) + '''])
'''

TEST = '''import pytest

from shop import report as r


SALES = [r.Sale("a", 5), r.Sale("b", 50)]


def test_report_lists_every_group():
    assert len(r.report(SALES).split("\\n")) == 23


def test_totals_are_clamped():
    assert r.total1(SALES) == 55


def test_describe_uses_the_currency():
    assert "total 50.00 EUR" in r.describe7(SALES)


def test_parse_and_errors():
    assert r.parse_sales('[{"id": 1, "amount": 3}]') == [r.Sale("1", 3)]
    with pytest.raises(r.ReportError):
        r.parse_sales("nope")


@pytest.mark.parametrize("amount", [1, 2])
def test_format(amount):
    assert r.format_amount(amount).endswith("EUR")


class TestClasses:
    def test_sale_is_a_dataclass(self):
        assert r.Sale("x", 1).region is None
'''

PYPROJECT = '''[project]
name = "shop"
version = "0.1"
requires-python = ">=3.9"

[tool.pytest.ini_options]
testpaths = ["tests"]
'''


def repo(name, files):
    root = os.path.join(out, name)
    for path, text in files.items():
        os.makedirs(os.path.dirname(os.path.join(root, path)) or root, exist_ok=True)
        with open(os.path.join(root, path), 'w') as handle:
            handle.write(text)
    run = lambda *args: subprocess.run(args, cwd=root, check=True, capture_output=True)
    run('git', 'init', '--quiet')
    run('git', 'config', 'user.email', 'dry@example.com')
    run('git', 'config', 'user.name', 'Dry Run')
    run('git', 'add', '.')
    run('git', 'commit', '--quiet', '-m', 'first')
    run(base_python, '-m', 'venv', '--system-site-packages', '.venv')
    with open(os.path.join(root, 'shop', 'report.py')) as handle:
        print('%s: %d lines in shop/report.py' % (name, len(handle.read().splitlines())))


common = {'.gitignore': '.venv/\n__pycache__/\n', 'pyproject.toml': PYPROJECT, 'shop/__init__.py': '', 'shop/report.py': REPORT,
          'tests/test_report.py': TEST}
repo('plain', common)
repo('pool', dict(common, **{'shop/workers.py': 'import multiprocessing\n\n\ndef run(f, items):\n    with multiprocessing.Pool(2) as pool:\n        return pool.map(f, items)\n'}))
lazy = 'import importlib\n\n\ndef __getattr__(name):\n    return importlib.import_module("lazy." + name)\n'
refuse_report = REPORT.replace('    """Parses sales from JSON."""', '    """Parses sales from JSON.\n\n    >>> parse_sales("[]")\n    []\n    """')
refuse_report = refuse_report.replace('def format_amount(amount):\n    """Formats an amount in the currency."""\n',
                                      'def format_amount(amount):\n    """Formats an amount in the currency."""\n    warnings.warn("old", DeprecationWarning)\n')
refuse_report = refuse_report.replace('import re\n', 'import re\nimport warnings\n')
refuse_test = TEST + '''

def test_patched_pick():
    from unittest.mock import patch
    with patch("shop.report.pick1", return_value=[]):
        assert r.total1(SALES) == 0
'''
repo('refuse', dict(common, **{
    'shop/report.py': refuse_report, 'tests/test_report.py': refuse_test,
    'pyproject.toml': PYPROJECT + 'filterwarnings = ["ignore::DeprecationWarning:shop.report"]\n',
    'lazy/__init__.py': lazy, 'lazy/big.py': REPORT}))
````

Create `$W/check/pipeline-check.js`:

````js
// Runs the real Python step pipeline without VS Code on a fixture repository: interpreter pick (the fixture's .venv),
// worktree and branch, ready(), the baseline twice, one split per argument (the model replaced by a plan file; each
// plan is sent twice, so a rejected one is refused after its retry), the change note, and worktree removal.
// Usage: EXT=<extension> node pipeline-check.js <project> <file>=<plan.json> [<file>=<plan.json> …]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const EXT = process.env.EXT;
const [root, ...fixes] = process.argv.slice(2);
const m = name => require(path.join(EXT, 'out-test/src/aiready', name));
const { adapterFor } = m('languages');
const { runSplit } = m('steps');
const { failureLines, flakyTests, runBaseline, runSetup } = m('baseline');
const { runCommand, tail } = m('projectCommands');
const { prepare, trackedFiles, commit, remove, changedFiles } = m('worktree');
const { renderChangeNote, noteFileName } = m('changeNote');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
(async () => {
	const user = () => JSON.stringify([git('branch', '--show-current'), git('rev-parse', 'HEAD'), git('status', '--porcelain')]);
	const userBefore = user();
	const storageDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pystore-'));
	const factory = await adapterFor(root, { extensionPath: EXT, storageDir, version: 'check', appRoot: '', choosePython: async c => c[0] });
	if (typeof factory === 'string') { console.log(`refused: ${factory}`); return; }
	const local = factory(root, git('ls-files').split('\n'));
	const plans = fixes.map(arg => { const [file, plan] = arg.split('='); return { file, plan: fs.readFileSync(plan, 'utf8') }; });
	for (const { file } of plans) {
		const info = await local.parse(file);
		console.log(`${file}: ${info.declarations.length} declarations, ${info.declarations.filter(d => d.movable).length} movable, skip: ${info.skip ?? 'no'}`
			+ `${info.narrowed ? `, narrowed: ${info.narrowed}` : ''}`);
	}
	const checks = [...new Map(plans.flatMap(p => local.checks(p.file)).map(c => [c.command, c])).values()];
	const approved = checks.map(c => c.command);
	const wt = await prepare(root);
	console.log(`worktree ${path.basename(wt.path)} on ${wt.branch}; approved: ${approved.join(' | ')}`);
	let n = 0;
	const runner = adapter => ({
		check: async (command, label, env) => {
			const out = await runCommand(command, { cwd: wt.path, approved, timeoutMs: 600_000, env: { ...adapter.commandEnv, ...env }, logFile: path.join(__dirname, 'logs', `${n++}-${label}.log`) });
			return { command, label, code: out.code, failures: label === 'test' ? [] : failureLines(out.output), tests: label === 'test' ? adapter.parseTests(adapter.testOutput === 'both' ? out.output : out.stdout) : undefined, tail: tail(out.output), log: '' };
		},
		cancelled: () => false, progress: () => undefined,
	});
	const adapter = factory(wt.path, await trackedFiles(wt.path));
	const ready = await runSetup([], runner(adapter), () => changedFiles(wt.path), () => adapter.ready && adapter.ready());
	console.log(`ready: ${ready ?? 'yes'}`);
	if (ready) { await remove(root, wt.path); git('branch', '-D', wt.branch); return; }
	const outcome = await runBaseline(checks, runner(adapter));
	const baseline = outcome.baseline;
	for (const [command, [run]] of Object.entries(baseline)) {
		console.log(`baseline \`${command}\`: exit ${run.code}${run.tests ? `, ${Object.keys(run.tests.tests).length} test keys` : ''}`);
	}
	const flaky = Object.values(baseline).flatMap(([a, b]) => flakyTests(a.tests, b.tests));
	const steps = [];
	for (const { file, plan } of plans) {
		const ctx = { adapter, worktree: wt.path, baseline, flaky, ask: async () => plan, check: runner(adapter).check, cancelled: () => false, progress: () => undefined };
		const step = await runSplit(ctx, { file, kind: 'split', lines: 0 });
		console.log(`split ${file}: ${step.status}${step.commit ? ' <sha>' : ''}${step.reason ? ` (${step.reason})` : ''}`);
		if (step.checks) { console.log(`  checks: ${step.checks}`); }
		for (const note of step.notes ?? []) { console.log(`  note: ${note}`); }
		steps.push(step);
	}
	const fixesDone = plans.map(p => ({ file: p.file, kind: 'split', lines: 0 }));
	const state = { version: 1, root, language: adapter.label, worktree: wt, startedAt: new Date().toISOString(), approved, fixes: fixesDone, next: fixesDone.length, steps, baseline, skippedFiles: [] };
	const at = new Date();
	const note = noteFileName(at);
	fs.mkdirSync(path.dirname(path.join(wt.path, note)), { recursive: true });
	fs.writeFileSync(path.join(wt.path, note), renderChangeNote(state, at, adapter.mayDiffer));
	await commit(wt.path, [note], 'my_editor: change note for the AI-ready fixes', 'Check run.');
	console.log(git('log', '--format=%h %s', `${wt.base}..${wt.branch}`).replace(/^[0-9a-f]{7,} /gm, '<sha> '));
	for (const line of git('diff', '--stat', `${wt.base}..${wt.branch}`, '--', 'shop').split('\n')) { console.log(`  ${line.trim()}`); }
	const leftovers = execFileSync('find', [wt.path, '-name', '__pycache__', '-o', '-name', '.pytest_cache', '-o', '-name', '.mypy_cache'], { encoding: 'utf8' }).trim();
	console.log(`caches in the worktree: ${leftovers ? leftovers.split('\n').length : 0}`);
	await remove(root, wt.path);
	console.log(`user folder unchanged: ${user() === userBefore}; worktree removed: ${!fs.existsSync(wt.path)}`);
})().catch(error => { console.error(error); process.exit(1); });
````

Create `$W/check/ids.js`:

````js
// Prints a file's declarations by ID (what the model sees). Usage: EXT=<extension> node ids.js <project> <file>
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const m = name => require(path.join(process.env.EXT, 'out-test/src/aiready', name));
const [root, file] = process.argv.slice(2);
(async () => {
	const factory = await m('languages').adapterFor(root, { extensionPath: process.env.EXT, storageDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pyids-')),
		version: 'check', appRoot: '', choosePython: async c => c[0] });
	if (typeof factory === 'string') { console.log(factory); return; }
	const info = await factory(root, execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)).parse(file);
	console.log(`skip: ${info.skip ?? 'no'}${info.narrowed ? `; narrowed: ${info.narrowed}` : ''}`);
	for (const d of info.declarations) { console.log(`${d.id} ${d.kind} ${d.names.join(',')} ${d.lines}${d.movable ? '' : ` — ${d.reason}`}`); }
})();
````

Then:

```bash
python3 gen-fixtures.py fx /opt/anaconda3/bin/python3.12
node -e "
const r = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i), w = (f, p) => require('fs').writeFileSync(f, JSON.stringify(p));
w('plain-plan.json', [{ file: 'money.py', declarations: r(1, 8) }, { file: 'groups_a.py', declarations: r(9, 44) }, { file: 'groups_b.py', declarations: r(45, 77) }]);
w('consts-plan.json', [{ file: 'money.py', declarations: [1, 2, 3] }]);
w('doctest-plan.json', [{ file: 'parsing.py', declarations: [8] }]);
w('patch-plan.json', [{ file: 'picks.py', declarations: [6, 9, 10] }]);
w('warn-plan.json', [{ file: 'money.py', declarations: [7] }]);
w('lazy-plan.json', [{ file: 'consts.py', declarations: [1] }]);"
export EXT
node ids.js fx/plain shop/report.py | sed -n '1,5p;$p'
```

Expected:

```text
plain: 603 lines in shop/report.py
pool: 603 lines in shop/report.py
refuse: 609 lines in shop/report.py
skip: no
0 assign logger 1 — it reads __name__, which names the module
1 assign CURRENCY 2
2 assign DIGITS 1
3 assign PATTERN 1
78 def report 4
```

- [ ] **Step 2: plain: constants, an exception, a dataclass and 69 functions move; the import check and pytest pass on the branch.**

```bash
node pipeline-check.js "$PWD/fx/plain" shop/report.py=plain-plan.json
git -C fx/plain show my_editor/ai-ready~1:shop/report.py | sed -n '1,8p'
git -C fx/plain show my_editor/ai-ready~1:shop/groups_b.py | sed -n '1,4p'
git -C fx/plain status --short
```

Expected:

```text
shop/report.py: 79 declarations, 78 movable, skip: no
worktree plain.ai-ready on my_editor/ai-ready; approved: python -m my_editor_pycheck shop.report | python -m pytest -q -rA -p no:cacheprovider
ready: yes
baseline `python -m my_editor_pycheck shop.report`: exit 0
baseline `python -m pytest -q -rA -p no:cacheprovider`: exit 0, 9 test keys
split shop/report.py: committed <sha>
  checks: `python -m my_editor_pycheck shop.report`: passed; `python -m pytest -q -rA -p no:cacheprovider`: passed (9 of 9 tests passing).
<sha> my_editor: change note for the AI-ready fixes
<sha> my_editor: split into 3 files (shop/report.py)
  shop/groups_a.py | 291 ++++++++++++++++++++++++
  shop/groups_b.py | 267 ++++++++++++++++++++++
  shop/money.py    |  48 ++++
  shop/report.py   | 672 +++++++------------------------------------------------
  4 files changed, 689 insertions(+), 589 deletions(-)
caches in the worktree: 0
user folder unchanged: true; worktree removed: true
"""Sales reports."""
import json
import logging
import re
from dataclasses import dataclass
from typing import List, Optional
from .money import (
    CURRENCY as CURRENCY,
# Split from report.py by my_editor.

from .money import clamp, format_amount
```

- [ ] **Step 3: pool: a tracked file uses `multiprocessing`, so only constants move.** The first plan moves functions and classes and is refused after its retry; the second moves three constants and is committed, with a note that the rest may not move.

```bash
node pipeline-check.js "$PWD/fx/pool" shop/report.py=plain-plan.json shop/report.py=consts-plan.json
```

Expected:

```text
shop/report.py: 79 declarations, 3 movable, skip: no, narrowed: only constants may move (the project may pickle by reference: shop/workers.py:1 uses multiprocessing)
shop/report.py: 79 declarations, 3 movable, skip: no, narrowed: only constants may move (the project may pickle by reference: shop/workers.py:1 uses multiprocessing)
worktree pool.ai-ready on my_editor/ai-ready; approved: python -m my_editor_pycheck shop.report | python -m pytest -q -rA -p no:cacheprovider
ready: yes
baseline `python -m my_editor_pycheck shop.report`: exit 0
baseline `python -m pytest -q -rA -p no:cacheprovider`: exit 0, 9 test keys
split shop/report.py: refused (The split plan was rejected twice: Declaration 4 (class ReportError) may not move: only constants may move: the project may pickle by reference: shop/workers.py:1 uses multiprocessing. Declaration 5 (class Sale) may not move: only constants may move: the project may pickle by reference: shop/workers.py:1 uses multiprocessing. Declaration 6 (def clamp) may not move: only constants may move: the project may pickle by reference: shop/workers.py:1 uses multiprocessing. Declaration 7 (def format_amount) may not move: only constants may move: the project may pickle by reference: shop/workers.py:1 uses multiprocessing. Declaration 8 (def parse_sales) may not move: only constants may move: the project may pickle by reference: shop/workers.py:1 uses multiprocessing.)
split shop/report.py: committed <sha>
  checks: `python -m my_editor_pycheck shop.report`: passed; `python -m pytest -q -rA -p no:cacheprovider`: passed (9 of 9 tests passing).
  note: shop/report.py stays at 599 lines: the rest may not move (it reads __name__, which names the module).
<sha> my_editor: change note for the AI-ready fixes
<sha> my_editor: split into 1 file (shop/report.py)
  shop/money.py  | 13 +++++++++++++
  shop/report.py |  6 +-----
  2 files changed, 14 insertions(+), 5 deletions(-)
caches in the worktree: 0
user folder unchanged: true; worktree removed: true
```

- [ ] **Step 4: refusals: a doctest, a `patch` string, a warnings filter, and a lazy `__getattr__` package.**

```bash
node pipeline-check.js "$PWD/fx/refuse" shop/report.py=doctest-plan.json shop/report.py=patch-plan.json shop/report.py=warn-plan.json lazy/big.py=lazy-plan.json
```

Expected:

```text
shop/report.py: 79 declarations, 76 movable, skip: no
shop/report.py: 79 declarations, 76 movable, skip: no
shop/report.py: 79 declarations, 76 movable, skip: no
lazy/big.py: 79 declarations, 0 movable, skip: its package __init__.py defines __getattr__ or __dir__ (a lazy package), which can run code when a sibling is looked up
worktree refuse.ai-ready on my_editor/ai-ready; approved: python -m my_editor_pycheck shop.report | python -m pytest -q -rA -p no:cacheprovider | python -m my_editor_pycheck lazy.big
ready: yes
baseline `python -m my_editor_pycheck shop.report`: exit 0
baseline `python -m pytest -q -rA -p no:cacheprovider`: exit 0, 10 test keys
baseline `python -m my_editor_pycheck lazy.big`: exit 0
split shop/report.py: refused (The split plan was rejected twice: Declaration 8 (def parse_sales) may not move: its docstring has a doctest (>>>), which is collected from the defining module.)
split shop/report.py: refused (The split plan was rejected twice: tests/test_report.py:39 patches shop.report.pick1, which moved code reads; the patch would no longer reach it.)
split shop/report.py: refused (The split plan was rejected twice: Declaration 7 (def format_amount) may not move: it calls warnings.warn, and pyproject.toml filters warnings by shop.report.)
split lazy/big.py: skipped (Never split: its package __init__.py defines __getattr__ or __dir__ (a lazy package), which can run code when a sibling is looked up.)
<sha> my_editor: change note for the AI-ready fixes
  
caches in the worktree: 0
user folder unchanged: true; worktree removed: true
```

- [ ] **Step 5: Throw the scratch folder away.** `rm -rf "$W"`. Nothing to commit.

### Task 13: Final verification

- [ ] **Step 1: Everything, from `overlay/extensions/my-editor-core`.**

```bash
npx tsc --noEmit -p ./ && npm run -s compile >/dev/null 2>&1 && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'
(cd resources/goast && GOTOOLCHAIN=local go test ./...)
(cd resources/pyast && for py in /usr/bin/python3 /opt/anaconda3/bin/python3.12 python3.13 python3.14; do PYTHONDONTWRITEBYTECODE=1 $py -m unittest 2>&1 | tail -1; done)
wc -l src/aiready/py*.ts resources/pyast/*.py src/chat/view.ts | sort -n | tail -4
git status --short
```

Expected:

```text
ℹ pass 334
ℹ fail 0
ok  	goast	…
OK (skipped=1)
OK
OK
OK
     297 resources/pyast/my_editor_pyreads.py
     344 resources/pyast/my_editor_pyast.py
     399 src/chat/view.ts
    3546 total
```

and a clean tree (every task committed).

- [ ] **Step 2: Live check (after the user confirms my_editor is closed):** `scripts/install.sh`, open a Python project with a committed `pyproject.toml`, a `.venv` and a clean tree, run **Check AI-Readiness**, then **Fix on a local branch** → the interpreter question names `.venv/bin/python`; the modal shows the import check, the type checker and the test command, then the interpreter's path, version and `sys.prefix`; afterwards `git status` and the current branch of the project are unchanged and `git log my_editor/ai-ready` has one commit per split plus the change note. Do not push.

## Dry run of this plan

Applied task by task to a fresh copy of `overlay/extensions/my-editor-core` at `4dc2584` (`rsync` without `node_modules`, `dist` and `out-test`, the extension's `node_modules` linked in, and a local `git init` so each Step 5 commit ran): each Step 2 failed with the line shown, each Step 4 passed with the count shown (280 before, then 287, 293, 304, 315, 321, 325, 329 and 334), the helper tests passed under Python 3.9.6, 3.12.2, 3.13.5 and 3.14.7 (3.9 skips the `type` statement test), `npx tsc --noEmit -p ./` stayed clean, `go test` in `resources/goast` stayed `ok`, the tree after Task 11 was byte-identical to the implementation this plan was generated from, and Task 12's outputs are the ones above (pytest from Anaconda's Python 3.12.2 in each fixture's `.venv`; the TS tests used Homebrew's `python3`, 3.14.7, without pytest, so their end-to-end steps ran `unittest`).

Related: [Python design](2026-10-10-ai-ready-python-design.md), [TS/JS plan](2026-10-09-ai-ready-ts-plan.md), [Go plan](2026-10-09-ai-ready-stage2-go-plan.md).
