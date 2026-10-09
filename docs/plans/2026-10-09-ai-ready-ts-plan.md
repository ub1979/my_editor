# AI-ready Stage 2b (TS/JS splits on a local branch) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AI-ready fixer splits oversized TypeScript and JavaScript files on its local branch, exactly within the design's *Version 1 scope*: whole top-level declarations move byte for byte into new files in the same folder, the original keeps a re-export facade, and each split is committed only after a host-side move check, the project's `tsc` and its tests match the baseline.

**Architecture:** One more `LanguageAdapter` (`src/aiready/tsAdapter.ts`), registered in `languages.ts`. All analysis is host-side with the TypeScript compiler API that ships with the editor (`vscode.env.appRoot + '/extensions/node_modules/typescript'`), loaded at run time by `tsLoad.ts` and passed in as a parameter, so unit tests run under `node --test` with the dev dependency or with `MY_EDITOR_TS=<path>`. The model only proposes groups of declaration IDs. The core gets a few optional, language-neutral hooks (`setup`, `ready`, `importProblems`, `fixes`, and the original's path in `fileNameProblems`) and never imports a TS module.

**Tech Stack:** TypeScript (strict, CommonJS), the TypeScript compiler API 5.x/6.x (types from the dev dependency, code from the editor), `node:test`, esbuild, Git worktrees, the project's own npm/pnpm/yarn/bun install.

**Spec:** [TS/JS design](2026-10-09-ai-ready-ts-design.md), section *Version 1 scope* and everything it refers to. Context: [general design](2026-10-07-ai-ready-design.md); model for detail and style: [Go plan](2026-10-09-ai-ready-stage2-go-plan.md).

**Base:** branch `ai-ready-go` at `55e672f`, where `npm test` reports `ℹ pass 191` with Go installed. The plan was dry-run task by task on a copy of that commit (see *Dry run* at the end).

---

## How the design's components map to files

The design's table has nine units; several would pass 400 lines, so they are split by job. Same jobs, these files:

| Design unit | Built as | Why |
|---|---|---|
| `tsLoad.ts` | same: `loadTypeScript(dir)`, `bundledTypeScript(appRoot)` | The caller passes the folder, so tests need no `vscode` |
| `tsProject.ts` | `tsConfig.ts` (tsconfig with `extends`, holder, emit format, JSX), `tsProject.ts` (package.json files, lockfile and install, transform tools, Jest, type stripping, workspaces, scope, commands), `tsScan.ts` (path strings and globs, framework folders), `tsGraph.ts` (module graph and cycles) | One job each, all under 400 lines |
| `tsAst.ts` | `tsAst.ts` (statements, spans, imports, overloads, facts per declaration) and `tsRefs.ts` (binder references, value/type uses, definition-time reads, purity, writes, module-relative code) | `tsAst.ts` alone is 393 lines |
| `tsRules.ts` | same: skip reasons, movability and the quiet window, the neutral view, file names, specifier style | |
| `tsSplit.ts` | same: name rules, new files, import filtering, the original's import block and the facade | |
| `tsMoveCheck.ts` | `tsMoveCheck.ts` (rule 2 imports, rule 4 surface and new-file exports, rule 6 comparison) and `tsUnit.ts` (the unit program: unit files, export surface and every binding) | The unit program is its own job |
| `tsTests.ts` | same: Jest/Vitest JSON, Mocha JSON, `node --test` TAP | Add-tests for TS/JS is a separate plan (design *Add-tests fix*) |
| `tsPrompts.ts` | same: the split prompt with `needs`, `typeNeeds` and `readsWhenDefined` | |
| `tsAdapter.ts` | `createTsAdapter(root, ts, tracked)` | The project facts are read lazily inside, from `tracked` |

## Decisions made while planning

Where the code had to differ from the design's words, this is what it does and why. Each was found by the dry run or by a probe.

- **`npx --no -- tsc …`, not `npx --no tsc …`.** npx parses `-p` itself (`npx --no tsc --noEmit -p tsconfig.json` fails with *missing packages: tsconfig.json*); `--` hands everything after it to `tsc`. `--no` still never downloads. A `tsc` package already in the npx cache would run, print its warning and exit 1, so the baseline fails and the core's verifying-check rule skips the split with that message. Stage 1's detected command (`commandDetect.ts`) has no `-p` and becomes `npx --no tsc --noEmit`.
- **`node --test` prints TAP through `NODE_OPTIONS=--test-reporter=tap`.** A flag appended after `--` lands after the script's file arguments, where Node ignores it. Node prints no file for a passing test, so TAP keys are `node:test <describe › test>` (with `#2` for repeats).
- **No `env` field on `CheckCommand`.** The adapter's existing `commandEnv` carries `CI=1`, `NO_COLOR=1` and, when a test script is `node --test`, the `NODE_OPTIONS` above, for every command (install and `tsc` ignore them).
- **Plain JS with no test command is skipped,** not "offered but not pre-selected": the core since `6765b8c` refuses a split without a passing verifying check, and for plain JS the test command is the verifying check. The change note does not yet say when a test script was compared by exit code only.
- **The 400-line rule is generalized in the core:** a file may stay over 400 lines when nothing left in it may move (before: only when one declaration alone was over 400). A types-only project needs this to move its types at all; Go files whose rest is unmovable now split too, with a note.
- **Load-order rule 3, made precise:** when a value specifier's last value use moves and other specifiers remain, the plan is rejected unless a remaining specifier still has a value use in staying code (then the module still loads there under both readings, which is the design's reason for the rule).
- **Extra optional hooks:** `ready()` (the workspace-link check after install), `fixes` (TS offers splits only), and `fixableFinding` in `languages.ts` (the report offers the fix for Go and TS/JS findings). Continue runs the install again, because a working copy checked out again has no `node_modules`.
- **The change note's "may still differ" line is chosen by the run's language** (`MAY_DIFFER` in `changeNote.ts`); the Go text named panics and `runtime.Caller`.
- **A move check tolerates blank lines right after the import region,** and an empty `importRegion` marks where the facade goes in a file without imports (`moveCheck.ts`). The facade is inserted right after the last import, followed by one blank line.
- **Every tsconfig that builds a file counts,** not only the nearest: a CommonJS build beside the ESM one (a dual-format library) narrows the file to types, and each of them is type-checked. A config that another one extends and that is not a plain `tsconfig.json` is a base, not a build. A config that cannot be read fully (an `extends` that does not resolve) skips the files it holds, since options from the base would be missing.
- **A gap in the design, closed:** a staying statement that reads a moved name while it is defined (`class S { static s = y }` before `export var y = 1`) is refused when the name comes later in the file; otherwise it would see `y` set instead of `undefined`, and every check would still pass. Found by plan review.
- **Mixed repositories stay Go-first** (`go.mod` wins), as the design says. A project without a lockfile, or with lockfiles of two managers, gets a plain message from `adapterFor` before anything runs.

## Ground rules for every task

- Work in `overlay/extensions/my-editor-core/` unless a path says otherwise. Paths are relative to it.
- Tabs, one short `/** … */` line on exported functions, the surrounding comment density. No file over 400 lines; `src/chat/view.ts` stays at 399 and is not touched.
- Pure modules must not import `vscode` and are listed in `tsconfig.test.json`. Only `fixSetup.ts`, `fixRun.ts` and `healthRun.ts` import `vscode`. TS modules import only types from `typescript` (`import type * as TS from 'typescript'`); the code arrives as the `ts` parameter.
- `npm test` compiles to `out-test/` and runs every test; the counts below assume Go is installed (the Go-backed tests skip themselves otherwise). Run it a second time with the editor's TypeScript: `MY_EDITOR_TS=/Applications/my_editor.app/Contents/Resources/app/extensions/node_modules/typescript node --test out-test/test/*.test.js` (6.0.3; the dev dependency is 5.9.3). Both must pass.
- Commits stay **local**. Never run `git push`, `git fetch` or any remote command.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/aiready/language.ts` | modify | `ParsedFile` moves here; `install` label; optional `fixes`, `setup`, `ready`, `importProblems`; `fileNameProblems(name, original)` |
| `src/aiready/moveCheck.ts` | modify | Empty import region marks the facade; blank lines after the region are not compared; the adapter's `importProblems` replaces the generic import checks |
| `src/aiready/baseline.ts` | modify | `tsc`'s `file(line,col):` positions; `runSetup` (install once, tracked files unchanged, `ready`) |
| `src/aiready/splitPlan.ts` | modify | Passes the original to `fileNameProblems`; the generalized 400-line rule and its note |
| `src/aiready/commandDetect.ts` | modify | `npx --no tsc --noEmit` |
| `src/aiready/fixText.ts` | modify | The approval text names the install and its scripts |
| `src/aiready/changeNote.ts` | modify | "May still differ" per language |
| `src/aiready/tsLoad.ts` | new, no vscode | Load the editor's TypeScript once; version gate 5 or 6 |
| `src/aiready/tsConfig.ts` | new, pure | tsconfigs with `extends`, the holder, emit format, JSX mode and roots, analysis options |
| `src/aiready/tsProject.ts` | new, no vscode | package.json files, lockfile and install, transform tools, Jest, type stripping, workspaces, test globs, scope per file, commands, `commandEnv`, workspace links |
| `src/aiready/tsScan.ts` | new, no vscode | Path strings and globs that find a folder; framework convention folders; `globRegExp` |
| `src/aiready/tsGraph.ts` | new, no vscode | The module graph (static, `require`, `import()`, `jest.requireActual`, workspace names) and its cycles |
| `src/aiready/tsRefs.ts` | new, pure | Binder references, value/type uses, definition-time reads, purity, writes, module-relative code |
| `src/aiready/tsAst.ts` | new, pure | One file's facts: statements, UTF-8 spans, imports and their pieces, overloads, per-declaration facts |
| `src/aiready/tsRules.ts` | new, pure | Skip reasons, movability, the quiet window, the neutral view, file names, specifier style |
| `src/aiready/tsSplit.ts` | new, pure | Name rules, new files, filtered imports, the original's import block, the facade |
| `src/aiready/tsUnit.ts` | new, no vscode | Unit files; the unit program's export surface and bindings (rules 4 and 6) |
| `src/aiready/tsMoveCheck.ts` | new, pure | Rule 2's import part; rules 4 and 6 on parsed files |
| `src/aiready/tsTests.ts` | new, pure | Jest/Vitest JSON, Mocha JSON and TAP to per-test results |
| `src/aiready/tsPrompts.ts` | new, pure | The split prompt |
| `src/aiready/tsAdapter.ts` | new, no vscode | The TS/JS `LanguageAdapter` |
| `src/aiready/languages.ts` | modify | Register the TS adapter; `appRoot`; `fixableFinding` |
| `src/aiready/fixSetup.ts`, `fixRun.ts`, `healthRun.ts`, `steps.ts` | modify | Run `setup` before the baseline and on Continue; offer only the adapter's fix kinds; offer the fix for TS/JS; pass `importProblems` |
| `test/aiReadyCore.test.ts`, `test/tsFixture.ts`, `test/aiReadyTs*.test.ts` | new | Core changes; TS fixtures; project, parse, rules, split, adapter and step tests (each reviewer probe p1–p5 is a named case) |

## Chunk 1: Language-neutral core changes

### Task 1: Core hooks for adapters that add imports and install dependencies

**Files:**
- Modify: `src/aiready/language.ts`, `src/aiready/moveCheck.ts`, `src/aiready/baseline.ts`, `src/aiready/splitPlan.ts`, `src/aiready/commandDetect.ts`, `src/aiready/fixText.ts`, `src/aiready/changeNote.ts`
- Create: `test/aiReadyCore.test.ts`
- Modify: `test/aiReadyHealth.test.ts`, `test/aiReadyNote.test.ts`

Go keeps working unchanged: every new hook is optional, and the Go adapter's `fileNameProblems(name)` still fits the new `(name, original)` signature.

- [ ] **Step 1: Write the failing tests.**

Create `test/aiReadyCore.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CheckResult, failureLines, runSetup } from '../src/aiready/baseline';
import { detectCommands } from '../src/aiready/commandDetect';
import { approvalDetail } from '../src/aiready/fixText';
import type { Declaration, FileInfo, LanguageAdapter, ParsedFile, Span } from '../src/aiready/language';
import { checkMove } from '../src/aiready/moveCheck';
import { oversizeNotes, planProblems } from '../src/aiready/splitPlan';

const HEADER = '// Split from x.ts by my_editor.\n\n';

/** A span from the first byte of `from` to the byte before `to` (or the end), both found in `text`. */
function span(text: string, from: string, to?: string): Span {
	const start = text.indexOf(from);
	return { start, end: to === undefined ? text.length - 1 : text.indexOf(to, start) };
}

function decl(id: number, name: string, at: Span): Declaration {
	return { id, kind: 'function', names: [name], span: at, lines: 1, doc: '', docText: '', uses: [], movable: true };
}

function parsed(text: string, info: Omit<FileInfo, 'path' | 'frame' | 'imports'> & Partial<FileInfo>): ParsedFile {
	return { text: Buffer.from(text), info: { path: 'x.ts', frame: [], imports: [], ...info } };
}

test('move check: an empty import region marks where the facade goes, after a directive and with no imports', () => {
	const before = "'use strict';\n\n/** A. */\nexport function a() {}\n\nexport function b() {}\n";
	const after = "'use strict';\n\nexport { a } from './a.js';\n\nexport function b() {}\n";
	const moved = `${HEADER}/** A. */\nexport function a() {}\n`;
	const at = before.indexOf('/** A.');
	const input = {
		before: parsed(before, { declarations: [decl(0, 'a', span(before, '/** A.', '\n\nexport function b')), decl(1, 'b', span(before, 'export function b'))], importRegion: { start: at, end: at } }),
		after: parsed(after, { declarations: [decl(0, 'b', span(after, 'export function b'))], importRegion: span(after, 'export { a }', '\n\nexport function b') }),
		files: [parsed(moved, { declarations: [decl(0, 'a', span(moved, '/** A.'))], frame: [{ start: 0, end: HEADER.length }], prelude: { start: 0, end: HEADER.length } })],
		plan: [{ file: 'a.ts', declarations: [0] }], header: HEADER,
	};
	assert.deepEqual(checkMove(input), []);
	const extra = after.replace('\nexport function b', '\nconsole.log(1);\nexport function b');
	assert.match(checkMove({ ...input, after: parsed(extra, { declarations: [], importRegion: span(extra, 'export { a }', '\n\nconsole') }) }).join(' '), /Rule 2/);
});

test('move check: blank lines right after the import region are not compared, and the adapter may check imports itself', () => {
	const before = "import { x } from 'x';\n\nexport function a() { return x; }\n\nexport const c = 1;\n";
	const after = "import { x } from 'x';\nexport { a } from './a.js';\n\nexport const c = 1;\n";
	const moved = `${HEADER}import { x } from 'x';\n\nexport function a() { return x; }\n`;
	const input = {
		before: parsed(before, { declarations: [decl(0, 'a', span(before, 'export function a', '\n\nexport const')), decl(1, 'c', span(before, 'export const'))],
			importRegion: span(before, 'import', '\n\nexport function'), imports: ['x x'] }),
		after: parsed(after, { declarations: [decl(0, 'c', span(after, 'export const'))], importRegion: span(after, 'import', '\n\nexport const'), imports: ['x x', 'a ./a.js'] }),
		files: [parsed(moved, { declarations: [decl(0, 'a', span(moved, 'export function a'))], imports: ['x x'],
			frame: [{ start: 0, end: HEADER.length }, span(moved, 'import', '\n\nexport')], prelude: { start: 0, end: HEADER.length } })],
		plan: [{ file: 'a.ts', declarations: [0] }], header: HEADER,
	};
	assert.match(checkMove(input).join(' '), /gained the import a \.\/a\.js/);
	assert.deepEqual(checkMove({ ...input, importProblems: () => [] }), []);
	assert.deepEqual(checkMove({ ...input, importProblems: () => ['Imports: the facade names b.ts.'] }), ['Imports: the facade names b.ts.']);
});

test('tsc error lines lose their path(line,col) position like Go lines lose path:line:col', () => {
	assert.deepEqual(failureLines("src/a.ts(3,14): error TS2322: Type 'string' is not assignable to type 'number'.\n./b.go:4:2: undefined: x\n"),
		["error TS2322: Type 'string' is not assignable to type 'number'.", 'undefined: x']);
	assert.deepEqual(failureLines("src/rows.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'."),
		failureLines("src/report.ts(40,2): error TS2322: Type 'string' is not assignable to type 'number'."));
});

test('the detected type check never downloads a package named tsc', () => {
	assert.deepEqual(detectCommands({ names: ['package.json', 'tsconfig.json'] }).checks, ['npx --no tsc --noEmit']);
});

test('a plan file name is checked against the original it is split from', () => {
	const seen: string[] = [];
	const adapter = { fileNameProblems: (name: string, original: string) => { seen.push(`${name} ${original}`); return ['no']; } } as unknown as LanguageAdapter;
	const info: FileInfo = { path: 'src/report.ts', declarations: [decl(0, 'a', { start: 0, end: 5 })], frame: [], imports: [] };
	assert.deepEqual(planProblems(adapter, { source: Buffer.from('a();\n'), info, existing: [] }, [{ file: 'rows.ts', declarations: [0] }]), ['rows.ts: no']);
	assert.deepEqual(seen, ['rows.ts src/report.ts']);
});

test('setup runs once before the baseline: a failed install or a changed tracked file stops the run', async () => {
	const result = (code: number | undefined): CheckResult => ({ command: 'npm ci', code, failures: [], tail: 'npm ERR! missing lockfile', log: '' });
	const runner = (code: number | undefined) => ({ check: async () => result(code), cancelled: () => false, progress: () => undefined });
	const install = [{ label: 'install' as const, command: 'npm ci' }];
	assert.equal(await runSetup(install, runner(0), async () => [], () => undefined), undefined);
	assert.match(await runSetup(install, runner(1), async () => [], () => undefined) ?? '', /`npm ci` failed \(exit 1\): npm ERR! missing lockfile/);
	assert.match(await runSetup(install, runner(0), async () => ['src/gen.ts'], () => undefined) ?? '', /changed tracked files: src\/gen\.ts/);
	assert.match(await runSetup(install, runner(0), async () => [], () => 'pkg-a resolves outside the working copy') ?? '', /pkg-a resolves outside/);
	assert.equal(await runSetup(install, { ...runner(0), cancelled: () => true }, async () => [], () => undefined), 'stopped');
	assert.equal(await runSetup([], runner(1), async () => ['x'], () => 'no'), undefined);
});

test('the approval modal says when the first command installs dependencies and runs their install scripts', () => {
	assert.match(approvalDetail('/p/w', ['npm ci', 'npm test'], 'TypeScript/JavaScript', 1, true), /npm ci installs the dependencies from the lockfile, which runs their install scripts\./);
	assert.doesNotMatch(approvalDetail('/p/w', ['go build ./...'], 'Go'), /install scripts/);
});

test('a file may stay over 400 lines when nothing left in it may move (a types-only project keeps its run-time code)', () => {
	const stuck = Array.from({ length: 450 }, (_, i) => ({ ...decl(i + 1, `f${i}`, { start: 0, end: 0 }), movable: false, reason: 'only interfaces and type aliases may move here' }));
	const info: FileInfo = { path: 'src/big.ts', declarations: [decl(0, 'T', { start: 0, end: 0 }), ...stuck], frame: [], imports: [] };
	const original = Buffer.from('x();\n'.repeat(450));
	const adapter = { fileNameProblems: () => [], buildSplit: () => ({ original, files: [{ name: 't.ts', text: Buffer.from('type T = 1;\n') }] }) } as unknown as LanguageAdapter;
	const plan = [{ file: 't.ts', declarations: [0] }];
	assert.deepEqual(planProblems(adapter, { source: original, info, existing: [] }, plan), []);
	assert.deepEqual(oversizeNotes(adapter.buildSplit(original, info, plan), info, plan), ['src/big.ts stays at 450 lines: the rest may not move (only interfaces and type aliases may move here).']);
	const movable: FileInfo = { ...info, declarations: [...info.declarations, decl(451, 'g', { start: 0, end: 0 })] };
	assert.match(planProblems(adapter, { source: original, info: movable, existing: [] }, plan).join(' '), /would still have 450 lines/);
});
````

In `test/aiReadyHealth.test.ts`, replace:

````ts
	assert.deepEqual(detectCommands({ names: ['package.json', 'tsconfig.json'], packageJson: '{"scripts":{"test":"node --test"}}' }),
		{ languages: ['JavaScript/TypeScript'], checks: ['npx tsc --noEmit'], tests: ['npm test'] });
	assert.deepEqual(detectCommands({ names: ['package.json'], packageJson: '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }).tests, []);
````

with:

````ts
	assert.deepEqual(detectCommands({ names: ['package.json', 'tsconfig.json'], packageJson: '{"scripts":{"test":"node --test"}}' }),
		{ languages: ['JavaScript/TypeScript'], checks: ['npx --no tsc --noEmit'], tests: ['npm test'] });
	assert.deepEqual(detectCommands({ names: ['package.json'], packageJson: '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }).tests, []);
````

In `test/aiReadyNote.test.ts`, replace:

````ts
	assert.match(renderChangeNote(state('/p/shop'), new Date('2026-10-09T12:34:00Z')), /already failed before the run is marked "not a check" on its commit: it proves nothing about that commit/);
});
````

with:

````ts
	assert.match(renderChangeNote(state('/p/shop'), new Date('2026-10-09T12:34:00Z')), /already failed before the run is marked "not a check" on its commit: it proves nothing about that commit/);
});

test('the change note names what may differ in the run\'s language', () => {
	const ts = renderChangeNote({ ...state('/p/shop'), language: 'TypeScript/JavaScript' }, new Date('2026-10-09T12:34:00Z'));
	assert.match(ts, /stack traces, `console\.trace` and logger caller fields/);
	assert.doesNotMatch(ts, /runtime\.Caller/);
	assert.match(renderChangeNote(state('/p/shop'), new Date('2026-10-09T12:34:00Z')), /runtime\.Caller/);
});
````

- [ ] **Step 2: Run them and see them fail.** `npm test 2>&1 | grep -m1 'error TS'` → `test/aiReadyCore.test.ts(3,37): error TS2305: Module '"../src/aiready/baseline"' has no exported member 'runSetup'.`

- [ ] **Step 3: Implement.** `language.ts` (the shared types and the optional hooks):

In `src/aiready/language.ts`, replace:

````ts

export interface NewFile {
````

with:

````ts

/** A file's bytes with the adapter's parse of them. */
export interface ParsedFile {
	readonly text: Buffer;
	readonly info: FileInfo;
}

export interface NewFile {
````

In `src/aiready/language.ts`, replace:

````ts
export interface CheckCommand {
	readonly label: 'build' | 'vet' | 'test';
	readonly command: string;
````

with:

````ts
export interface CheckCommand {
	/** `install` runs once before the baseline (the adapter's `setup`); the others run for every step. */
	readonly label: 'install' | 'build' | 'vet' | 'test';
	readonly command: string;
````

In `src/aiready/language.ts`, replace:

````ts
	parse(file: string): Promise<FileInfo>;
	/** Why a new file may not have this name. */
	fileNameProblems(name: string): string[];
	/** The exact text a new file split from `file` starts with (Go: a comment naming the original and a blank line). */
````

with:

````ts
	parse(file: string): Promise<FileInfo>;
	/** The fix kinds it offers; both when absent. */
	readonly fixes?: readonly ('split' | 'tests')[];
	/** Why a new file split from `original` (relative) may not have this name. */
	fileNameProblems(name: string, original: string): string[];
	/** Commands run once in a new worktree, before the baseline and approved with the rest (TS: the lockfile's install). */
	setup?(): CheckCommand[];
	/** Why the worktree is not ready after `setup` (TS: a workspace package resolves outside it). */
	ready?(): string | undefined;
	/**
	 * Move rule 2's import part, for adapters that add imports by design (TS: the facade). When present it replaces the
	 * generic checks that the original gains no import and that new files only use the original's imports.
	 */
	importProblems?(before: ParsedFile, after: ParsedFile, files: readonly ParsedFile[]): string[];
	/** The exact text a new file split from `file` starts with (Go: a comment naming the original and a blank line). */
````

`moveCheck.ts` (an empty region marks the facade; blank lines after the region are ignored; the adapter's import check replaces the generic one):

In `src/aiready/moveCheck.ts`, replace:

````ts
import type { Declaration, FileInfo, Span, SplitPlan } from './language';

/** A file's bytes with the adapter's parse of them. */
export interface ParsedFile {
	readonly text: Buffer;
	readonly info: FileInfo;
}

````

with:

````ts
import type { Declaration, FileInfo, ParsedFile, Span, SplitPlan } from './language';

````

In `src/aiready/moveCheck.ts`, replace:

````ts
	readonly header: string;
}
````

with:

````ts
	readonly header: string;
	/** The adapter's own import check (`LanguageAdapter.importProblems`); replaces the generic import-key checks. */
	readonly importProblems?: (before: ParsedFile, after: ParsedFile, files: readonly ParsedFile[]) => string[];
}
````

In `src/aiready/moveCheck.ts`, replace:

````ts
		}
		for (const key of file.info.imports) {
			if (key.startsWith('_ ')) { problems.push(`Rule 3: ${group.file} has the blank import ${key}.`); }
````

with:

````ts
		}
		for (const key of input.importProblems ? [] : file.info.imports) {
			if (key.startsWith('_ ')) { problems.push(`Rule 3: ${group.file} has the blank import ${key}.`); }
````

In `src/aiready/moveCheck.ts`, replace:

````ts
	const moved = plan.flatMap(group => group.declarations.map(id => byId.get(id)!.span));
	const expected = collapse(marked(before, moved, !!after.info.importRegion));
	const actual = marked(after, [], true).map(item => item ?? '');
	if (expected.length !== actual.length || expected.some((line, i) => line !== actual[i])) {
````

with:

````ts
	const moved = plan.flatMap(group => group.declarations.map(id => byId.get(id)!.span));
	const expected = afterImports(collapse(marked(before, moved, !!after.info.importRegion)));
	const actual = afterImports(marked(after, [], true).map(item => item ?? ''));
	if (expected.length !== actual.length || expected.some((line, i) => line !== actual[i])) {
````

In `src/aiready/moveCheck.ts`, replace:

````ts
	}
	const count = (keys: readonly string[], key: string) => keys.filter(k => k === key).length;
````

with:

````ts
	}
	if (input.importProblems) { problems.push(...input.importProblems(before, after, files)); return [...new Set(problems)]; }
	const count = (keys: readonly string[], key: string) => keys.filter(k => k === key).length;
````

In `src/aiready/moveCheck.ts`, replace:

````ts

/** The file's lines, with the import region as one marker line and removed spans as gaps (undefined). */
function marked(file: ParsedFile, removed: readonly Span[], keepImports: boolean): (string | undefined)[] {
````

with:

````ts

/**
 * The file's lines, with the import region as one marker line and removed spans as gaps (undefined). An empty region
 * marks where imports would go (TS: the facade of a file without imports), before the line it starts.
 */
function marked(file: ParsedFile, removed: readonly Span[], keepImports: boolean): (string | undefined)[] {
````

In `src/aiready/moveCheck.ts`, replace:

````ts
		offset = end + 1;
		if (region && start >= region.start && end <= region.end) {
			if (start === region.start) { out.push(keepImports ? IMPORTS : undefined); }
````

with:

````ts
		offset = end + 1;
		if (region && region.start === region.end && start === region.start) { out.push(keepImports ? IMPORTS : undefined); }
		else if (region && start >= region.start && end <= region.end) {
			if (start === region.start) { out.push(keepImports ? IMPORTS : undefined); }
````

In `src/aiready/moveCheck.ts`, replace:

````ts
		out.push(removed.some(span => start >= span.start && end <= span.end) ? undefined : line.toString('utf8'));
	}
````

with:

````ts
		out.push(removed.some(span => start >= span.start && end <= span.end) ? undefined : line.toString('utf8'));
	}
	return out;
}

/** Blank lines right after the import marker are not compared: an added facade may bring or take one. */
function afterImports(items: readonly string[]): string[] {
	const out: string[] = [];
	for (const line of items) {
		if (line.trim() === '' && out[out.length - 1] === IMPORTS) { continue; }
		out.push(line);
	}
````

`baseline.ts` (`tsc` positions and the setup run):

In `src/aiready/baseline.ts`, replace:

````ts

const POSITION = /^(?:\.{0,2}\/)?[^\s:]+\.\w+:\d+(?::\d+)?:\s*/;

/** Non-empty output lines with leading `file:line:col:` positions removed, sorted and unique. */
export function failureLines(output: string): string[] {
````

with:

````ts

const POSITION = /^(?:\.{0,2}\/)?[^\s:(]+\.\w+(?::\d+(?::\d+)?:|\(\d+,\d+\):)\s*/;

/** Non-empty output lines with leading `file:line:col:` (Go) or `file(line,col):` (tsc) positions removed, sorted and unique. */
export function failureLines(output: string): string[] {
````

In `src/aiready/baseline.ts`, replace:

````ts

export type BaselineOutcome =
````

with:

````ts

/**
 * Runs the adapter's setup commands (an install) once in the new worktree. Undefined when it is ready; else a plain
 * message (a command failed, tracked files changed, or `ready` names a problem), or 'stopped'.
 */
export async function runSetup(commands: readonly CheckCommand[], runner: BaselineRunner, changed: () => Promise<string[]>,
	ready: () => string | undefined): Promise<string | 'stopped' | undefined> {
	if (!commands.length) { return undefined; }
	for (const { command, label } of commands) {
		runner.progress(`Preparing the working copy: \`${command}\`…`);
		const result = await runner.check(command, label);
		if (runner.cancelled()) { return 'stopped'; }
		if (result.code !== 0) {
			return `\`${command}\` ${result.code === undefined ? (result.timedOut ? 'timed out' : 'did not start') : `failed (exit ${result.code})`}: `
				+ `${result.tail.split('\n').filter(Boolean).slice(-1)[0] ?? 'no output'}. Fix it in your folder, then try again.`;
		}
	}
	const files = await changed();
	if (files.length) { return `Installing the dependencies changed tracked files: ${files.join(', ')}. This project cannot be fixed on a branch.`; }
	return ready();
}

export type BaselineOutcome =
````

`splitPlan.ts` (the original for file names; the generalized 400-line rule):

In `src/aiready/splitPlan.ts`, replace:

````ts
		}
		problems.push(...adapter.fileNameProblems(group.file).map(problem => `${group.file}: ${problem}`));
		if (existing.has(group.file.toLowerCase())) { problems.push(`${group.file} already exists in the folder.`); }
````

with:

````ts
		}
		problems.push(...adapter.fileNameProblems(group.file, input.info.path).map(problem => `${group.file}: ${problem}`));
		if (existing.has(group.file.toLowerCase())) { problems.push(`${group.file} already exists in the folder.`); }
````

In `src/aiready/splitPlan.ts`, replace:

````ts
/**
 * A file may exceed the limit only when one declaration in it is itself over the limit and nothing else in it could
 * move out: it holds that declaration plus unmovable ones only.
 */
````

with:

````ts
/**
 * A file may exceed the limit only when nothing else in it could move out: everything in it is unmovable, apart from
 * at most one declaration that is itself over the limit (TS: a types-only project leaves its run-time code in place).
 */
````

In `src/aiready/splitPlan.ts`, replace:

````ts
	const big = declarations.filter(d => d.lines > MAX_SOURCE_LINES);
	return big.length === 1 && declarations.every(d => d === big[0] || !d.movable);
}

/** Files left over the limit by a single long declaration, for the change note. */
export function oversizeNotes(result: SplitResult, info: FileInfo, plan: SplitPlan): string[] {
````

with:

````ts
	const big = declarations.filter(d => d.lines > MAX_SOURCE_LINES);
	return big.length <= 1 && declarations.every(d => d === big[0] || !d.movable);
}

/** Files left over the limit by a single long declaration or by code that may not move, for the change note. */
export function oversizeNotes(result: SplitResult, info: FileInfo, plan: SplitPlan): string[] {
````

In `src/aiready/splitPlan.ts`, replace:

````ts
		const big = declarations.find(d => d.lines > MAX_SOURCE_LINES);
		if (lines(text) > MAX_SOURCE_LINES && big) {
			notes.push(`${name} stays at ${lines(text)} lines: ${label(big)} alone is ${big.lines} lines and needs a real refactor.`);
		}
````

with:

````ts
		const big = declarations.find(d => d.lines > MAX_SOURCE_LINES);
		const stuck = declarations.find(d => !d.movable && d.reason);
		if (lines(text) > MAX_SOURCE_LINES && big) {
			notes.push(`${name} stays at ${lines(text)} lines: ${label(big)} alone is ${big.lines} lines and needs a real refactor.`);
		} else if (lines(text) > MAX_SOURCE_LINES && stuck) {
			notes.push(`${name} stays at ${lines(text)} lines: the rest may not move (${stuck.reason}).`);
		}
````

`commandDetect.ts`, `fixText.ts` and `changeNote.ts`:

In `src/aiready/commandDetect.ts`, replace:

````ts
		languages.push('JavaScript/TypeScript');
		if (has('tsconfig.json')) { checks.push('npx tsc --noEmit'); }
		if (npmTestScript(root.packageJson)) { tests.push('npm test'); }
````

with:

````ts
		languages.push('JavaScript/TypeScript');
		if (has('tsconfig.json')) { checks.push('npx --no tsc --noEmit'); }
		if (npmTestScript(root.packageJson)) { tests.push('npm test'); }
````

In `src/aiready/fixText.ts`, replace:

````ts
/** The approval modal's detail: where the commands run, the exact commands, and what they run. */
export function approvalDetail(folder: string, approved: readonly string[], language: string, fixCount = 0): string {
	const over = fixCount > MAX_FIXES_PER_RUN ? `${fixCount} fixes chosen: ${MAX_FIXES_PER_RUN} now; Continue does the rest.\n\n` : '';
	return `${over}In a new working copy at ${folder}, on a new branch:\n\n${approved.join('\n')}\n\n`
		+ 'They build the project and run its tests, which runs project code and tests written by the AI model. '
````

with:

````ts
/** The approval modal's detail: where the commands run, the exact commands, and what they run. */
export function approvalDetail(folder: string, approved: readonly string[], language: string, fixCount = 0, installs = false): string {
	const over = fixCount > MAX_FIXES_PER_RUN ? `${fixCount} fixes chosen: ${MAX_FIXES_PER_RUN} now; Continue does the rest.\n\n` : '';
	return `${over}In a new working copy at ${folder}, on a new branch:\n\n${approved.join('\n')}\n\n`
		+ (installs ? `${approved[0]} installs the dependencies from the lockfile, which runs their install scripts. ` : '')
		+ 'They build the project and run its tests, which runs project code and tests written by the AI model. '
````

In `src/aiready/changeNote.ts`, replace:

````ts

/** The change note committed on the branch at close (pure). */
````

with:

````ts

/** What may still differ for moved code, by adapter label. */
const MAY_DIFFER: Record<string, string> = {
	Go: 'File names and line numbers in panics, `runtime.Caller`, `log.Lshortfile`, `slog` source attributes and package-level closure names '
		+ '(`glob..funcN`) may differ for moved code. The program’s behavior does not.',
	'TypeScript/JavaScript': 'File names and line numbers in stack traces, `console.trace` and logger caller fields may differ for moved code, and so may '
		+ 'bundler chunk contents, hot-reload boundaries and source maps. Interfaces and type aliases moved in a types-only project change no emitted '
		+ 'JavaScript. The program’s behavior does not change.',
};

/** The change note committed on the branch at close (pure). */
````

In `src/aiready/changeNote.ts`, replace:

````ts
		...notes.map(note => `- ${note}`),
		'- File names and line numbers in panics, `runtime.Caller`, `log.Lshortfile`, `slog` source attributes and package-level closure names '
		+ '(`glob..funcN`) may differ for moved code. The program’s behavior does not.',
		'- Git hooks did not run for these commits. Run your usual checks when you review.',
````

with:

````ts
		...notes.map(note => `- ${note}`),
		`- ${MAY_DIFFER[state.language] ?? MAY_DIFFER.Go}`,
		'- Git hooks did not run for these commits. Run your usual checks when you review.',
````

- [ ] **Step 4: Run the tests.** `npx tsc --noEmit -p ./ && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 200`, `ℹ fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/language.ts src/aiready/moveCheck.ts src/aiready/baseline.ts src/aiready/splitPlan.ts src/aiready/commandDetect.ts src/aiready/fixText.ts src/aiready/changeNote.ts test/aiReadyCore.test.ts test/aiReadyHealth.test.ts test/aiReadyNote.test.ts
git commit -m "AI-ready core: hooks for adapters that add imports and install dependencies"
```

## Chunk 2: Loading TypeScript and reading the project

### Task 2: The editor's TypeScript, tsconfigs, scope, commands, path scans and the module graph

**Files:**
- Create: `src/aiready/tsLoad.ts`, `src/aiready/tsConfig.ts`, `src/aiready/tsProject.ts`, `src/aiready/tsScan.ts`, `src/aiready/tsGraph.ts`
- Create: `test/tsFixture.ts` (first part), `test/aiReadyTsProject.test.ts`
- Modify: `tsconfig.test.json`

Probe **p1** is the case `scope (probe p1)`: `tsc` emits a moved export under CommonJS as a getter defined at the facade line (`Object.defineProperty(exports, "f", { get … })` instead of `exports.f = f` at the top), so CommonJS output allows types-only moves. The same probe showed TS 6 and TS 5 default `module` differently, hence the skip when `module` or `moduleResolution` is unset.

- [ ] **Step 1: Write the failing test and the fixture helper.**

Create `test/tsFixture.ts`:

````ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadTypeScript, Ts } from '../src/aiready/tsLoad';

/** The TypeScript the tests use: `MY_EDITOR_TS` (the editor's shipped copy) or the dev dependency. */
export const TS_DIR = process.env.MY_EDITOR_TS ?? path.dirname(require.resolve('typescript/package.json'));
const loaded = loadTypeScript(TS_DIR);
if (typeof loaded === 'string') { throw new Error(loaded); }
export const ts: Ts = loaded;

/** Writes the files into a new temp folder; `tracked` lists them, as `git ls-files` would. */
export function project(files: Record<string, string | undefined>): { root: string; tracked: string[] } {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-ts-'));
	const tracked: string[] = [];
	for (const [file, text] of Object.entries(files)) {
		if (text === undefined) { continue; }
		tracked.push(file);
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		writeFileSync(path.join(root, file), text);
	}
	return { root, tracked: tracked.sort() };
}

/** An ES module package checked by `tsc` with `node --test`, locked by npm. */
export const ESM: Record<string, string> = {
	'package.json': '{"name":"shop","type":"module","scripts":{"test":"node --test"}}',
	'package-lock.json': '{}',
	'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', strict: true }, include: ['src'] }),
};
````

Create `test/aiReadyTsProject.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { splitCommand } from '../src/aiready/projectCommands';
import { cyclicFiles } from '../src/aiready/tsGraph';
import { loadTypeScript } from '../src/aiready/tsLoad';
import { checkCommands, commandEnv, fileScope, scopeReason, setupCommands, tsProject } from '../src/aiready/tsProject';
import { findsFolder, frameworkFolder, globRegExp, pathFinders } from '../src/aiready/tsScan';
import { ESM, project, ts } from './tsFixture';

const TSCONFIG = (options: Record<string, unknown>) => JSON.stringify({ compilerOptions: { target: 'es2022', strict: true, ...options }, include: ['src'] });

function scope(files: Record<string, string | undefined>, file = 'src/a.ts'): string {
	const { root, tracked } = project({ ...ESM, [file]: 'export const a = 1;\n', ...files });
	const result = fileScope(ts, tsProject(ts, root, tracked), file);
	return 'skip' in result ? `skip: ${result.skip}` : result.scope;
}

test('TypeScript loads once from a folder and only as major 5 or 6', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-ts7-'));
	writeFileSync(path.join(dir, 'package.json'), '{"main":"index.js"}');
	writeFileSync(path.join(dir, 'index.js'), 'module.exports = { version: "7.0.0", createProgram() {} };');
	assert.match(String(loadTypeScript(dir)), /needs the editor's TypeScript 5 or 6\. Found 7\.0\.0/);
	assert.match(String(loadTypeScript(path.join(dir, 'missing'))), /not found/);
	assert.match(ts.version, /^[56]\./);
});

test('scope: an ES module project checked only by tsc may move run-time declarations', () => {
	assert.equal(scope({}), 'runtime');
	assert.equal(scope({ 'tsconfig.json': TSCONFIG({ module: 'esnext', moduleResolution: 'bundler' }), 'package.json': '{"name":"x"}' }), 'runtime');
});

test('scope (probe p1): CommonJS output anywhere reduces a file to types-only moves', () => {
	assert.equal(scope({ 'tsconfig.json': TSCONFIG({ module: 'commonjs', moduleResolution: 'node10' }) }), 'types');
	assert.equal(scope({}, 'src/a.cts'), 'types');
	assert.equal(scope({ 'package.json': '{"name":"shop"}' }), 'types');
	assert.equal(scope({ 'package.json': '{"name":"shop","type":"module","devDependencies":{"jest":"29"}}' }), 'types');
});

test('scope: a transform tool or TS run without a compile step reduces a file to types-only moves', () => {
	for (const files of [{ '.babelrc': '{}' }, { '.swcrc': '{}' }, { 'build.config.mjs': 'export default { tsconfigRaw: {} };' },
		{ 'package.json': '{"type":"module","devDependencies":{"sucrase":"3"}}' }, { 'package.json': '{"type":"module","dependencies":{"react-native":"0.7"}}' },
		{ 'package.json': '{"type":"module","devDependencies":{"tsx":"4"}}' }, { 'package.json': '{"type":"module","scripts":{"start":"node src/main.ts"}}' },
		{ 'package.json': '{"type":"module","scripts":{"start":"node --experimental-strip-types src/main.mts"}}' },
		{ 'tsconfig.json': TSCONFIG({ module: 'nodenext', moduleResolution: 'nodenext', erasableSyntaxOnly: true }) }, { 'bun.lock': '' }, { 'deno.json': '{}' }]) {
		assert.equal(scope(files), 'types', JSON.stringify(files));
	}
});

test('scope: a tsconfig without module or moduleResolution skips; plain JS moves functions only as native ES modules', () => {
	assert.match(scope({ 'tsconfig.json': TSCONFIG({ module: 'esnext' }) }), /^skip: tsconfig.json does not set both "module" and "moduleResolution"/);
	assert.match(scope({ 'tsconfig.json': TSCONFIG({ moduleResolution: 'bundler' }) }), /^skip: tsconfig.json does not set both/);
	assert.match(scope({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.ts'), /^skip: no tsconfig includes it/);
	assert.equal(scope({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.mjs'), 'functions');
	assert.equal(scope({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.js'), 'functions');
	assert.match(scope({ 'tsconfig.json': '{"files":[]}', 'package.json': '{"name":"x"}' }, 'lib/a.js'), /^skip: plain JavaScript that does not run as an ES module/);
	assert.match(scope({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.cjs'), /^skip: CommonJS module/);
	assert.match(scope({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.jsx'), /^skip: JSX in plain JavaScript/);
	assert.match(scope({ 'tsconfig.json': '{"files":[]}', 'package.json': '{"type":"module","devDependencies":{"jest":"29"}}' }, 'lib/a.mjs'), /^skip: tests run under Jest/);
});

test('commands: the lockfile\'s install, tsc for the file\'s tsconfig with npx --no, and the nearest test script with its reporter', () => {
	const commands = (files: Record<string, string | undefined>, file = 'src/a.ts') => {
		const { root, tracked } = project({ ...ESM, [file]: 'export const a = 1;\n', ...files });
		const p = tsProject(ts, root, tracked);
		return { setup: setupCommands(p).map(c => c.command), checks: checkCommands(ts, p, file), env: commandEnv(p) };
	};
	const npm = commands({});
	assert.deepEqual(npm.setup, ['npm ci']);
	assert.deepEqual(npm.checks, [{ label: 'build', verifies: true, command: 'npx --no -- tsc --noEmit -p tsconfig.json --pretty false' }, { label: 'test', command: 'npm test' }]);
	assert.deepEqual(npm.env, { CI: '1', NO_COLOR: '1', NODE_OPTIONS: '--test-reporter=tap' });
	assert.equal(commands({ 'package.json': '{"type":"module","scripts":{"test":"jest --ci"}}' }).checks[1].command, 'npm test -- --json');
	assert.equal(commands({ 'package.json': '{"type":"module","scripts":{"test":"vitest run"}}' }).checks[1].command, 'npm test -- --reporter=json');
	assert.equal(commands({ 'package.json': '{"type":"module","scripts":{"test":"mocha"}}' }).checks[1].command, 'npm test -- --reporter json');
	assert.equal(commands({ 'package.json': '{"type":"module","scripts":{"test":"tsc && node --test"}}' }).checks[1].command, 'npm test');
	const pnpm = commands({ 'package-lock.json': undefined, 'pnpm-lock.yaml': '', 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
		'packages/a/package.json': '{"name":"a","type":"module","scripts":{"test":"vitest run"}}', 'packages/a/tsconfig.json': TSCONFIG({ module: 'nodenext', moduleResolution: 'nodenext' }) }, 'packages/a/src/x.ts');
	assert.deepEqual(pnpm.setup, ['pnpm install --frozen-lockfile']);
	assert.deepEqual(pnpm.checks.map(c => c.command), ['pnpm exec tsc --noEmit -p packages/a/tsconfig.json --pretty false', 'pnpm --filter ./packages/a test -- --reporter=json']);
	const yarn = commands({ 'package-lock.json': undefined, 'yarn.lock': '', '.yarnrc.yml': '', 'package.json': '{"type":"module","workspaces":["packages/*"]}',
		'packages/b/package.json': '{"name":"@x/b","type":"module","scripts":{"test":"node --test"}}', 'packages/b/tsconfig.json': TSCONFIG({ module: 'nodenext', moduleResolution: 'nodenext' }) }, 'packages/b/src/x.ts');
	assert.deepEqual(yarn.setup, ['yarn install --immutable']);
	assert.deepEqual(yarn.checks.map(c => c.command), ['yarn tsc --noEmit -p packages/b/tsconfig.json --pretty false', 'yarn workspace @x/b test']);
	assert.equal(commands({ 'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' }, include: ['src'], references: [{ path: './lib' }] }) }).checks[0].command,
		'npx --no -- tsc -b tsconfig.json --pretty false');
	assert.deepEqual(commands({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.mjs').checks, [{ label: 'test', command: 'npm test', verifies: true }]);
	const none = commands({ 'package-lock.json': undefined });
	assert.deepEqual([none.setup, none.checks], [[], []]);
	for (const command of [...npm.setup, ...npm.checks.map(c => c.command), ...pnpm.checks.map(c => c.command), ...yarn.checks.map(c => c.command)]) {
		assert.ok(splitCommand(command), command);
		assert.doesNotMatch(command, /\b(push|fetch|remote)\b/);
	}
});

test('folders found by path: readdirSync strings, import.meta.glob, ORM entity globs and computed readdir arguments', () => {
	const { root, tracked } = project({
		'src/load.ts': "import { readdirSync } from 'fs';\nexport const plugins = readdirSync('./src/plugins');\n",
		'src/routes.ts': "export const pages = import.meta.glob('./pages/*.ts');\n",
		'src/db.ts': "export const options = { entities: ['src/**/*.entity.ts'] };\n",
		'tools/scan.ts': "import { readdirSync } from 'fs';\nimport * as path from 'path';\nexport const all = readdirSync(path.join(__dirname, 'x'));\n",
	});
	const finders = pathFinders({ root, tracked } as never);
	const found = (file: string) => finders.some(f => findsFolder(f, path.posix.dirname(file), [file, `${path.posix.dirname(file)}/zzprobe.ts`]));
	assert.ok(found('src/plugins/a.ts'));
	assert.ok(found('src/pages/home.ts'));
	assert.ok(found('src/models/user.entity.ts'));
	assert.ok(found('tools/deep/x.ts'));
	assert.ok(!found('src/other/report.ts'));
	assert.ok(globRegExp('**/?(*.)+(spec|test).[jt]s?(x)').test('src/a.test.ts'));
	assert.ok(!globRegExp('src/*.ts').test('src/a/b.ts'));
});

test('framework convention folders are skipped when the dependency is present, and api/ always', () => {
	const at = (dep: string, file: string) => frameworkFolder({ dependencies: new Set([dep]) } as never, file);
	assert.match(at('nuxt', 'composables/useCart.ts') ?? '', /nuxt/);
	assert.match(at('next', 'src/app/page-helpers.ts') ?? '', /next/);
	assert.match(at('expo-router', 'app/home.tsx') ?? '', /expo-router/);
	assert.match(at('@sveltejs/kit', 'src/routes/cart.ts') ?? '', /sveltejs/);
	assert.match(at('astro', 'src/pages/a.ts') ?? '', /astro/);
	assert.equal(at('next', 'src/lib/a.ts'), undefined);
	assert.match(at('x', 'api/users.ts') ?? '', /serverless/);
});

test('cycles: static, require in a function, import(), jest.requireActual, a self-import, a workspace name and a computed require; type-only edges are not cycles', () => {
	const { root, tracked } = project({
		...ESM, 'package.json': '{"name":"shop","type":"module","workspaces":["packages/*"]}',
		'src/a.ts': "import { b } from './b.js';\nexport const a = () => b;\n", 'src/b.ts': "import { a } from './a.js';\nexport const b = () => a;\n",
		'src/c.ts': "export function c() { return require('./d.js'); }\n", 'src/d.ts': "import { c } from './c.js';\nexport const d = c;\n",
		'src/e.ts': "export const e = () => import('./f.js');\n", 'src/f.ts': "import { e } from './e.js';\nexport const f = e;\n",
		'src/g.ts': "jest.requireActual('./h.js');\nexport const g = 1;\n", 'src/h.ts': "import { g } from './g.js';\nexport const h = g;\n",
		'src/self.ts': "import './self.js';\nexport const s = 1;\n", 'src/dyn.ts': 'export const load = (name: string) => require(name);\n',
		'src/t1.ts': "import type { T2 } from './t2.js';\nexport interface T1 { b?: T2 }\n", 'src/t2.ts': "import type { T1 } from './t1.js';\nexport interface T2 { a?: T1 }\n",
		'packages/p/package.json': '{"name":"@shop/p"}', 'packages/p/src/index.ts': "import { w } from '@shop/q';\nexport const p = w;\n",
		'packages/q/package.json': '{"name":"@shop/q"}', 'packages/q/src/index.ts': "import { p } from '@shop/p';\nexport const w = () => p;\n",
		'src/plain.ts': "import { a } from './a.js';\nexport const plain = a;\n",
	});
	const cyclic = cyclicFiles(ts, tsProject(ts, root, tracked));
	assert.deepEqual([...cyclic].sort(), ['packages/p/src/index.ts', 'packages/q/src/index.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/dyn.ts',
		'src/e.ts', 'src/f.ts', 'src/g.ts', 'src/h.ts', 'src/self.ts']);
});

test('the analysis never reads node_modules or untracked configs', () => {
	const { root, tracked } = project({ ...ESM, 'src/a.ts': '' });
	mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
	writeFileSync(path.join(root, 'node_modules', 'x', 'tsconfig.json'), '{}');
	assert.deepEqual(tsProject(ts, root, tracked).configs.map(c => c.path), ['tsconfig.json']);
});

test('scope reads every config that builds a file: a CommonJS build beside the ESM one, base configs, and an extends that does not resolve', () => {
	const cjs = JSON.stringify({ extends: './tsconfig.json', compilerOptions: { module: 'commonjs', moduleResolution: 'node10', outDir: 'dist/cjs' } });
	const { root, tracked } = project({ ...ESM, 'src/a.ts': 'export const a = 1;\n', 'tsconfig.cjs.json': cjs });
	const dual = tsProject(ts, root, tracked);
	assert.equal(scopeReason(ts, dual, 'src/a.ts'), 'tsconfig.cjs.json emits it as CommonJS');
	assert.deepEqual(checkCommands(ts, dual, 'src/a.ts').map(c => c.command), ['npx --no -- tsc --noEmit -p tsconfig.cjs.json --pretty false',
		'npx --no -- tsc --noEmit -p tsconfig.json --pretty false', 'npm test']);
	const based = JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' }, include: ['src'] });
	assert.equal(scope({ 'tsconfig.base.json': '{"compilerOptions":{"strict":true}}', 'tsconfig.json': based }), 'runtime');
	const missing = JSON.stringify({ extends: '@tsconfig/strictest/tsconfig.json', compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' }, include: ['src'] });
	assert.match(scope({ 'tsconfig.json': missing }), /^skip: tsconfig\.json could not be read fully/);
	assert.equal(scope({ 'package.json': '{"type":"module","scripts":{"dev":"node --import ./reg.js src/main.ts"}}' }), 'types');
	const allowJs = JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', allowJs: true }, include: ['lib'] });
	assert.match(scope({ 'tsconfig.json': allowJs }, 'lib/a.js'), /^skip: tsconfig\.json compiles it to CommonJS/);
});

test('cycles also run through a .js file with a .d.ts beside it and through workspace packages found by "exports"; an unresolved workspace import counts as a cycle', () => {
	const { root, tracked } = project({
		'package.json': '{"name":"w","type":"module","workspaces":["packages/*"]}', 'package-lock.json': '{}',
		'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', allowJs: true }, include: ['src', 'packages'] }),
		'src/a.js': "import { b } from './b.js';\nexport const a = () => b;\n", 'src/b.js': "import { a } from './a.js';\nexport const b = () => a;\n",
		'src/b.d.ts': 'export declare const b: () => unknown;\n',
		'packages/p/package.json': '{"name":"@w/p","exports":"./lib/main.ts"}', 'packages/p/lib/main.ts': "import { q } from '@w/q';\nexport const p = () => q;\n",
		'packages/q/package.json': '{"name":"@w/q","exports":{".":"./lib/main.ts"}}', 'packages/q/lib/main.ts': "import { p } from '@w/p';\nexport const q = () => p;\n",
		'src/sub.ts': "import { x } from '@w/p/missing';\nexport const s = x;\n",
	});
	assert.deepEqual([...cyclicFiles(ts, tsProject(ts, root, tracked))].sort(), ['packages/p/lib/main.ts', 'packages/q/lib/main.ts', 'src/a.js', 'src/b.js', 'src/sub.ts']);
});

test('path strings are found in Vue, Svelte, Astro, HTML and YAML files too', () => {
	const { root, tracked } = project({ 'src/App.vue': "<script setup>\nconst pages = import.meta.glob('./components/*.ts', { eager: true });\n</script>\n" });
	const finders = pathFinders({ root, tracked } as never);
	assert.ok(finders.some(f => findsFolder(f, 'src/components', ['src/components/a.ts'])));
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `test/aiReadyTsProject.test.ts(7,29): error TS2307: Cannot find module '../src/aiready/tsGraph' or its corresponding type declarations.`

- [ ] **Step 3: Implement.**

Create `src/aiready/tsLoad.ts`:

````ts
import { createRequire } from 'module';
import * as path from 'path';
import type * as TS from 'typescript';

/** The TypeScript compiler module; only its types are imported, the code is loaded at run time. */
export type Ts = typeof TS;

const NEEDS = 'TypeScript splitting needs the editor\'s TypeScript 5 or 6.';
const loaded = new Map<string, Ts | string>();

/** Where the editor ships its TypeScript: `<appRoot>/extensions/node_modules/typescript`. */
export function bundledTypeScript(appRoot: string): string {
	return path.join(appRoot, 'extensions', 'node_modules', 'typescript');
}

/**
 * Loads TypeScript from a folder once, with a run-time `require` so esbuild leaves it out of the bundle. A plain
 * message when it is missing or not major 5 or 6 (TS 7, the native compiler, has a different API).
 */
export function loadTypeScript(dir: string): Ts | string {
	const cached = loaded.get(dir);
	if (cached) { return cached; }
	let result: Ts | string;
	try {
		const ts = createRequire(__filename)(dir) as Ts;
		const major = Number(String(ts.version ?? '').split('.')[0]);
		result = (major === 5 || major === 6) && typeof ts.createProgram === 'function' ? ts : `${NEEDS} Found ${ts.version ?? 'an unknown version'}.`;
	} catch {
		result = `${NEEDS} It was not found in ${dir}.`;
	}
	loaded.set(dir, result);
	return result;
}
````

Create `src/aiready/tsConfig.ts`:

````ts
import * as path from 'path';
import type * as TS from 'typescript';
import type { Ts } from './tsLoad';

/** One tsconfig or jsconfig, parsed with its `extends` chain. */
export interface TsConfig {
	/** Relative to the root, `/`-separated. */
	readonly path: string;
	readonly options: TS.CompilerOptions;
	/** The files it holds, relative. */
	readonly files: ReadonlySet<string>;
	/** It has `references` (built with `tsc -b`). */
	readonly references: boolean;
	/** Another tracked config extends it and it is not a plain `tsconfig.json` (a base, not a build of its own). */
	readonly base: boolean;
	/** Why it could not be read fully (say, an `extends` that does not resolve). */
	readonly error?: string;
}

const CONFIG = /(^|\/)(tsconfig[^/]*|jsconfig)\.json$/;

/** Every tracked tsconfig and jsconfig under the root (not in `node_modules`), parsed from disk. */
export function readConfigs(ts: Ts, root: string, tracked: readonly string[]): TsConfig[] {
	const files = tracked.filter(file => CONFIG.test(file) && !/(^|\/)node_modules\//.test(file));
	const extended = new Set(files.flatMap(file => {
		const raw = ts.readConfigFile(path.join(root, file), ts.sys.readFile).config as { extends?: string | string[] } | undefined;
		const names = typeof raw?.extends === 'string' ? [raw.extends] : Array.isArray(raw?.extends) ? raw!.extends : [];
		return names.filter(name => name.startsWith('.')).map(name => path.posix.join(path.posix.dirname(file), name.endsWith('.json') ? name : `${name}.json`));
	}));
	return files.flatMap(file => {
		const parsed = parseConfig(ts, root, file);
		return parsed ? [{ ...parsed, base: extended.has(file) && !/(^|\/)[jt]sconfig\.json$/.test(file) }] : [];
	});
}

/** One config, or undefined when it cannot be read. Its file list reflects the files on disk now. */
export function parseConfig(ts: Ts, root: string, file: string): TsConfig | undefined {
	const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined };
	let parsed: TS.ParsedCommandLine | undefined;
	try { parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, file), {}, host); } catch { parsed = undefined; }
	if (!parsed) { return undefined; }
	const files = new Set(parsed.fileNames.map(name => path.relative(root, name).split(path.sep).join('/')));
	const error = parsed.errors.find(e => e.code !== 18003);
	return { path: file, options: parsed.options, files, references: !!parsed.projectReferences?.length, base: false,
		...(error ? { error: ts.flattenDiagnosticMessageText(error.messageText, ' ') } : {}) };
}

/** The config that holds a file: the one nearest to it (deepest folder first, `tsconfig.json` before others). */
export function holder(configs: readonly TsConfig[], file: string): TsConfig | undefined {
	const depth = (config: TsConfig) => config.path.split('/').length;
	const plain = (config: TsConfig) => (/(^|\/)tsconfig\.json$/.test(config.path) ? 0 : 1);
	return configs.filter(config => config.files.has(file)).sort((a, b) => depth(b) - depth(a) || plain(a) - plain(b))[0];
}

/** Every config that builds a file: those holding it that no other config extends (or the bases, when only they hold it). */
export function builds(configs: readonly TsConfig[], file: string): TsConfig[] {
	const holding = configs.filter(config => config.files.has(file));
	const own = holding.filter(config => !config.base);
	return own.length ? own : holding;
}

/** How a file is emitted: ES modules or CommonJS. `packageType` is the nearest package.json `type`. */
export function emitFormat(ts: Ts, file: string, options: TS.CompilerOptions, packageType: string | undefined): 'esm' | 'cjs' {
	const ext = path.extname(file);
	if (ext === '.cts' || ext === '.cjs') { return 'cjs'; }
	if (ext === '.mts' || ext === '.mjs') { return 'esm'; }
	const kind = options.module ?? ts.ModuleKind.None;
	if (kind <= ts.ModuleKind.System) { return 'cjs'; }
	if (kind >= ts.ModuleKind.Node16 && kind <= ts.ModuleKind.NodeNext) { return packageType === 'module' ? 'esm' : 'cjs'; }
	return 'esm';
}

/** How JSX is compiled: `classic` needs the factory in scope, `automatic` needs nothing, `other` is left to another tool. */
export function jsxMode(ts: Ts, options: TS.CompilerOptions | undefined): 'classic' | 'automatic' | 'other' {
	const jsx = options?.jsx;
	if (jsx === ts.JsxEmit.React) { return 'classic'; }
	if (jsx === ts.JsxEmit.ReactJSX || jsx === ts.JsxEmit.ReactJSXDev) { return 'automatic'; }
	return 'other';
}

/** The root names classic JSX needs in scope: the factory's and the fragment factory's (`React` by default). */
export function jsxRoots(options: TS.CompilerOptions | undefined): string[] {
	const root = (name: string | undefined) => (name ?? 'React').split('.')[0];
	return [...new Set([root(options?.jsxFactory ?? options?.reactNamespace), root(options?.jsxFragmentFactory ?? options?.reactNamespace)])];
}

/** Options for the analysis programs: the project's, without libraries or global types, and allowing JS. */
export function analysisOptions(ts: Ts, options: TS.CompilerOptions | undefined): TS.CompilerOptions {
	return {
		...options, noLib: true, types: [], typeRoots: [], noEmit: true, allowJs: true, checkJs: false, skipLibCheck: true,
		composite: false, incremental: false, declaration: false, tsBuildInfoFile: undefined,
		module: options?.module ?? ts.ModuleKind.ESNext,
		moduleResolution: options?.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
		jsx: options?.jsx ?? ts.JsxEmit.Preserve,
	};
}
````

Create `src/aiready/tsProject.ts`:

````ts
import { existsSync, readFileSync, realpathSync } from 'fs';
import * as path from 'path';
import type { CheckCommand } from './language';
import { builds, emitFormat, holder, readConfigs, TsConfig } from './tsConfig';
import type { Ts } from './tsLoad';

/** The parts of a package.json the adapter reads. */
export interface PackageJson {
	readonly name?: string;
	readonly type?: string;
	readonly scripts?: Record<string, string>;
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
	readonly workspaces?: string[] | { packages?: string[] };
	readonly sideEffects?: boolean | string[];
	readonly exports?: unknown;
	readonly files?: string[];
	readonly packageManager?: string;
	readonly babel?: unknown;
	readonly jest?: { testMatch?: string[] };
	readonly prettier?: unknown;
}

export interface Manager {
	readonly name: 'npm' | 'pnpm' | 'yarn' | 'bun';
	readonly install: string;
	/** How to run a local binary: `npx --no -- tsc` (no download; `--` keeps `-p` from npx), `pnpm exec tsc`, `yarn tsc`. */
	readonly exec: string;
}

/** What may move in a file: run-time declarations, types only, or function declarations only (plain JS). */
export type Scope = 'runtime' | 'types' | 'functions';

/** Project-wide facts, read once per adapter. */
export interface TsProject {
	readonly root: string;
	readonly tracked: readonly string[];
	readonly configs: readonly TsConfig[];
	/** package.json files by folder (`.` for the root). */
	readonly packages: ReadonlyMap<string, PackageJson>;
	/** Undefined with no lockfile, or a plain reason when the lockfiles disagree. */
	readonly manager?: Manager | string;
	/** Why TS here is transformed by another tool or run without a compile step (types-only moves), if it is. */
	readonly typesOnly?: string;
	/** Tests run under Jest. */
	readonly jest: boolean;
	/** Workspace package names and their folders. */
	readonly workspaces: ReadonlyMap<string, string>;
	/** Every dependency name of every package.json. */
	readonly dependencies: ReadonlySet<string>;
	/** Test globs from Jest `testMatch` and Vitest `include`. */
	readonly testGlobs: readonly string[];
}

const LOCKFILES: readonly [string, Manager['name']][] = [['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'],
	['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun']];
const BABEL = /(^|\/)(\.babelrc(\.\w+)?|babel\.config\.\w+)$/;
const TRANSFORM_DEPS: readonly [string, RegExp][] = [['Babel', /^(@babel\/core|babel-loader|babel-jest|@babel\/register|@babel\/preset-typescript)$/],
	['swc', /^(@swc\/core|@swc\/jest|@swc\/register|@swc-node\/register|unplugin-swc)$/], ['Sucrase', /^(sucrase|@sucrase\/.+)$/],
	['Metro', /^(metro|react-native|expo)$/], ['tsx', /^tsx$/], ['esbuild-register', /^(esbuild-register|@esbuild-kit\/.+)$/]];
const STRIP_SCRIPT = /--experimental-(strip|transform)-types|\bnode\b[^&|;]*?\s[^\s&|;]+\.m?ts\b/;

function readJson(file: string): PackageJson | undefined {
	try { return JSON.parse(readFileSync(file, 'utf8')) as PackageJson; } catch { return undefined; }
}

function deps(pkg: PackageJson): string[] {
	return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];
}

/** Reads the project's package.json files, tsconfigs, lockfile, tools and workspaces. */
export function tsProject(ts: Ts, root: string, tracked: readonly string[]): TsProject {
	const packages = new Map<string, PackageJson>();
	for (const file of tracked.filter(f => /(^|\/)package\.json$/.test(f) && !/(^|\/)node_modules\//.test(f))) {
		const json = readJson(path.join(root, file));
		if (json) { packages.set(path.posix.dirname(file), json); }
	}
	const all = [...packages.values()];
	const dependencies = new Set(all.flatMap(deps));
	const has = (pattern: RegExp) => tracked.some(file => pattern.test(file));
	const scripts = all.flatMap(pkg => Object.values(pkg.scripts ?? {}));
	const transform = (has(BABEL) || all.some(pkg => pkg.babel) ? 'Babel' : undefined)
		?? (has(/(^|\/)\.swcrc$/) ? 'swc' : undefined)
		?? TRANSFORM_DEPS.find(([, pattern]) => [...dependencies].some(name => pattern.test(name)))?.[0]
		?? (has(/(^|\/)metro\.config\.\w+$/) ? 'Metro' : undefined)
		?? (scripts.some(script => /(^|[\s&|;])tsx\s/.test(script)) ? 'tsx' : undefined)
		?? (tracked.some(file => /\.(m?[jt]s|json)$/.test(file) && !/(^|\/)node_modules\//.test(file) && fileHas(root, file, 'tsconfigRaw')) ? 'esbuild tsconfigRaw' : undefined);
	const runtime = (has(/(^|\/)(bun\.lockb?|bunfig\.toml)$/) ? 'Bun' : undefined) ?? (has(/(^|\/)deno\.jsonc?$/) ? 'Deno' : undefined)
		?? (scripts.some(script => STRIP_SCRIPT.test(script)) ? 'Node\'s type stripping' : undefined);
	const typesOnly = transform ? `${transform} transforms the code` : runtime ? `${runtime} runs the TypeScript without a compile step` : undefined;
	const jest = dependencies.has('jest') || dependencies.has('ts-jest') || has(/(^|\/)jest\.config\.\w+$/) || scripts.some(script => /(^|[\s&|;])jest(\s|$)/.test(script));
	return {
		root, tracked, configs: readConfigs(ts, root, tracked), packages, manager: manager(root, packages.get('.')), typesOnly, jest,
		workspaces: workspaces(root, packages, tracked), dependencies, testGlobs: testGlobs(root, packages, tracked),
	};
}

function fileHas(root: string, file: string, text: string): boolean {
	try { return readFileSync(path.join(root, file), 'utf8').includes(text); } catch { return false; }
}

function manager(root: string, pkg: PackageJson | undefined): Manager | string | undefined {
	const found = [...new Set(LOCKFILES.filter(([file]) => existsSync(path.join(root, file))).map(([, name]) => name))];
	const declared = /^(npm|pnpm|yarn|bun)@/.exec(pkg?.packageManager ?? '')?.[1] as Manager['name'] | undefined;
	const name = declared && found.includes(declared) ? declared : found.length === 1 ? found[0] : undefined;
	if (!name) { return found.length > 1 ? `the lockfiles of ${found.join(' and ')} disagree on how to install` : undefined; }
	const berry = existsSync(path.join(root, '.yarnrc.yml'));
	const install = { npm: 'npm ci', pnpm: 'pnpm install --frozen-lockfile', yarn: berry ? 'yarn install --immutable' : 'yarn install --frozen-lockfile', bun: 'bun install --frozen-lockfile' }[name];
	const exec = { npm: 'npx --no --', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'npx --no --' }[name];
	return { name, install, exec };
}

/** Why the project's dependencies cannot be installed on the branch exactly as in the user's folder, or undefined. */
export function lockfileProblem(root: string): string | undefined {
	const found = manager(root, readJson(path.join(root, 'package.json')));
	if (typeof found === 'object') { return undefined; }
	return found ? `In this project ${found}. Keep one lockfile, then try again.`
		: 'This project has no lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lock), so its dependencies cannot be installed '
			+ 'on the branch exactly as in your folder. Commit a lockfile, then try again.';
}

function globPrefix(glob: string): RegExp {
	return new RegExp(`^${glob.replace(/\/+$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
}

/** Workspace packages (root `workspaces` or `pnpm-workspace.yaml`) by name, with their folders. */
function workspaces(root: string, packages: ReadonlyMap<string, PackageJson>, tracked: readonly string[]): Map<string, string> {
	const rootPkg = packages.get('.');
	const listed = Array.isArray(rootPkg?.workspaces) ? rootPkg!.workspaces as string[] : (rootPkg?.workspaces as { packages?: string[] } | undefined)?.packages ?? [];
	const yaml = tracked.includes('pnpm-workspace.yaml') ? readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8') : '';
	const globs = [...listed, ...[...yaml.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map(m => m[1])].filter(glob => !glob.startsWith('!'));
	const out = new Map<string, string>();
	for (const [dir, pkg] of packages) {
		if (dir !== '.' && pkg.name && globs.some(glob => globPrefix(glob).test(dir))) { out.set(pkg.name, dir); }
	}
	return out;
}

function testGlobs(root: string, packages: ReadonlyMap<string, PackageJson>, tracked: readonly string[]): string[] {
	const globs = [...packages.values()].flatMap(pkg => pkg.jest?.testMatch ?? []);
	for (const file of tracked.filter(f => /(^|\/)(jest|vitest|vite)\.config\.\w+$/.test(f))) {
		let text = '';
		try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
		for (const match of text.matchAll(/\b(?:testMatch|include)\s*:\s*\[([^\]]*)\]/g)) {
			globs.push(...[...match[1].matchAll(/(['"`])([^'"`]+)\1/g)].map(m => m[2]));
		}
	}
	return globs;
}

/** The nearest package.json at or above a file's folder, with its folder. */
export function nearestPackage(project: TsProject, file: string): { dir: string; pkg: PackageJson } | undefined {
	for (let dir = path.posix.dirname(file); ; dir = path.posix.dirname(dir)) {
		const pkg = project.packages.get(dir);
		if (pkg) { return { dir, pkg }; }
		if (dir === '.') { return undefined; }
	}
}

const JS = /\.(js|jsx|mjs|cjs)$/;

/**
 * What may move in a file under version 1, or why it is skipped. Every config that builds the file counts: CommonJS
 * output or type stripping in any of them narrows the scope; `config` is the nearest, the others are built too.
 */
export function fileScope(ts: Ts, project: TsProject, file: string): { scope: Scope; config?: TsConfig; configs: TsConfig[]; reason?: string } | { skip: string } {
	const configs = builds(project.configs, file);
	const config = holder(configs, file);
	const type = nearestPackage(project, file)?.pkg.type;
	const broken = configs.find(c => c.error);
	if (broken) { return { skip: `${broken.path} could not be read fully (${broken.error})` }; }
	const unset = configs.find(c => c.options.module === undefined || c.options.moduleResolution === undefined);
	if (unset) { return { skip: `${unset.path} does not set both "module" and "moduleResolution", so the editor's TypeScript could read it differently from yours` }; }
	const cjs = configs.find(c => emitFormat(ts, file, c.options, type) === 'cjs');
	if (JS.test(file)) {
		if (file.endsWith('.cjs')) { return { skip: 'CommonJS module' }; }
		if (!file.endsWith('.mjs') && type !== 'module') { return { skip: 'plain JavaScript that does not run as an ES module (no "type": "module" or .mjs)' }; }
		if (file.endsWith('.jsx')) { return { skip: 'JSX in plain JavaScript is compiled by another tool' }; }
		if (cjs) { return { skip: `${cjs.path} compiles it to CommonJS` }; }
		if (project.jest) { return { skip: 'tests run under Jest, which runs plain JavaScript as CommonJS' }; }
		if (project.typesOnly) { return { skip: `${project.typesOnly}` }; }
		return { scope: 'functions', config, configs };
	}
	if (!config) { return { skip: 'no tsconfig includes it' }; }
	const erasable = configs.find(c => c.options.erasableSyntaxOnly);
	const reason = cjs ? `${cjs.path} emits it as CommonJS` : project.jest ? 'tests run under Jest' : project.typesOnly
		?? (erasable ? `${erasable.path} sets erasableSyntaxOnly (Node type stripping)` : undefined);
	return reason ? { scope: 'types', config, configs, reason } : { scope: 'runtime', config, configs };
}

/** Why a file's scope is narrowed to types (for the prompt and the change note). */
export function scopeReason(ts: Ts, project: TsProject, file: string): string {
	const scope = fileScope(ts, project, file);
	return 'skip' in scope ? '' : scope.reason ?? '';
}

/** The install command, once per run. */
export function setupCommands(project: TsProject): CheckCommand[] {
	return typeof project.manager === 'object' ? [{ label: 'install', command: project.manager.install }] : [];
}

const RUNNER = /^\s*(?:npx\s+)?(jest|vitest|mocha|node\s+--test)\b[^&|;<>]*$/;

/** The test command of the nearest package.json with a test script, and the runner when it is one plain runner call. */
export function testCommand(project: TsProject, file: string): { command: string; runner?: string } | undefined {
	if (typeof project.manager !== 'object') { return undefined; }
	for (let dir = path.posix.dirname(file); ; dir = path.posix.dirname(dir)) {
		const pkg = project.packages.get(dir);
		const script = pkg?.scripts?.test;
		if (pkg && script && !/no test specified/.test(script)) {
			const runner = RUNNER.exec(script)?.[1].split(/\s/)[0];
			const flag = runner === 'jest' ? ' -- --json' : runner === 'vitest' ? ' -- --reporter=json' : runner === 'mocha' ? ' -- --reporter json' : '';
			const name = project.manager.name;
			const base = dir === '.' ? (name === 'npm' ? 'npm test' : name === 'bun' ? 'bun run test' : `${name} test`)
				: name === 'npm' ? `npm test -w ${dir}` : name === 'pnpm' ? `pnpm --filter ./${dir} test`
					: name === 'yarn' && pkg.name ? `yarn workspace ${pkg.name} test` : undefined;
			return base ? { command: `${base}${flag}`, runner } : undefined;
		}
		if (dir === '.') { return undefined; }
	}
}

/** Build and test commands for a file: `tsc` for each tsconfig that builds it (verifying), then its test script; plain JS gets only tests. */
export function checkCommands(ts: Ts, project: TsProject, file: string): CheckCommand[] {
	const scope = fileScope(ts, project, file);
	if ('skip' in scope || typeof project.manager !== 'object') { return []; }
	const tests = testCommand(project, file);
	const exec = project.manager.exec;
	const build = scope.scope === 'functions' ? [] : scope.configs.map(config => ({ label: 'build' as const, verifies: true,
		command: config.references ? `${exec} tsc -b ${config.path} --pretty false` : `${exec} tsc --noEmit -p ${config.path} --pretty false` }));
	return [...build, ...(tests ? [{ label: 'test' as const, command: tests.command, ...(build.length ? {} : { verifies: true }) }] : [])];
}

/** `NODE_OPTIONS` that makes `node --test` print TAP, when a test script is a plain `node --test` call. */
export function commandEnv(project: TsProject): Record<string, string> {
	const nodeTest = [...project.packages.values()].some(pkg => /^\s*node\s+--test\b/.test(pkg.scripts?.test ?? ''));
	return { CI: '1', NO_COLOR: '1', ...(nodeTest ? { NODE_OPTIONS: '--test-reporter=tap' } : {}) };
}

/** Why the worktree is not ready after install: a workspace package linked from outside it. */
export function workspaceLinkProblem(project: TsProject): string | undefined {
	const root = realpathSync(project.root);
	for (const name of project.workspaces.keys()) {
		const link = path.join(project.root, 'node_modules', name);
		if (!existsSync(link)) { continue; }
		const target = realpathSync(link);
		if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
			return `After installing, the workspace package ${name} resolves to ${target}, outside the working copy, so tests would run your folder's code.`;
		}
	}
	return undefined;
}
````

Create `src/aiready/tsScan.ts`:

````ts
import { readFileSync } from 'fs';
import * as path from 'path';
import type { TsProject } from './tsProject';

/** Something in a tracked file that finds files by path: a folder (and everything below it), or a glob. */
export interface PathFinder {
	readonly file: string;
	/** A folder below which every file is found (a non-literal `readdir` or glob argument). */
	readonly below?: string;
	/** Literal paths or globs, each relative to the root or to the file's folder. */
	readonly patterns?: readonly string[];
}

const CALL = /\b(readdirSync|readdir|opendirSync|opendir|globSync|glob|globby|fg|fastGlob|import\.meta\.glob|require\.context)\s*\(\s*(?:(['"`])([^'"`\n]*)\2)?/g;
const KEY = /\b(entities|migrations|subscribers|entry|entryPoints|input)\s*:\s*\[?((?:\s*(['"`])[^'"`\n]*\3\s*,?)+)/g;
const SCANNED = /\.(?:[cm]?[jt]sx?|json|vue|svelte|astro|html|ya?ml)$/;
const NOT_SCANNED = /(^|\/)(node_modules|dist|build|out|coverage|vendor)\/|(^|\/)(package(-lock)?\.json|[jt]sconfig[^/]*\.json|\.eslintrc[^/]*|eslint\.config\.\w+|\.prettierrc[^/]*|prettier\.config\.\w+)$|\.d\.[cm]?ts$/;

/** Every place in the tracked files that finds files by a path string (`readdirSync`, `import.meta.glob`, ORM entity globs, build entries). */
export function pathFinders(project: TsProject): PathFinder[] {
	const finders: PathFinder[] = [];
	for (const file of project.tracked.filter(f => SCANNED.test(f) && !NOT_SCANNED.test(f))) {
		let text = '';
		try { text = readFileSync(path.join(project.root, file), 'utf8'); } catch { continue; }
		if (text.length > 512 * 1024) { continue; }
		for (const match of text.matchAll(CALL)) {
			if (match[3] === undefined || match[3].includes('${')) { finders.push({ file, below: path.posix.dirname(file) }); }
			else { finders.push({ file, patterns: [match[3]] }); }
		}
		for (const match of text.matchAll(KEY)) {
			finders.push({ file, patterns: [...match[2].matchAll(/(['"`])([^'"`\n]*)\1/g)].map(m => m[2]) });
		}
	}
	return finders;
}

/** A glob as a regular expression over `/`-separated relative paths: `**`, `*`, `?`, `[…]`, `{a,b}` and `?(…)`/`+(…)`/`@(…)`/`*(…)`/`!(…)`. */
export function globRegExp(glob: string): RegExp {
	const escape = (text: string) => text.replace(/[.+^$()|[\]\\]/g, '\\$&');
	const convert = (part: string): string => {
		let out = '';
		for (let i = 0; i < part.length; i++) {
			const c = part[i];
			if ('?+@*!'.includes(c) && part[i + 1] === '(') {
				const end = part.indexOf(')', i);
				const inner = part.slice(i + 2, end).split('|').map(convert).join('|');
				out += c === '!' ? `(?!(?:${inner}))[^/]*` : `(?:${inner})${c === '@' ? '' : c === '+' ? '+' : c === '?' ? '?' : '*'}`;
				i = end;
			} else if (c === '*' && part[i + 1] === '*') {
				out += part[i + 2] === '/' ? '(?:.*/)?' : '.*';
				i += part[i + 2] === '/' ? 2 : 1;
			} else if (c === '[' && part.indexOf(']', i) > i) {
				out += part.slice(i, part.indexOf(']', i) + 1);
				i = part.indexOf(']', i);
			} else if (c === '*') { out += '[^/]*'; }
			else if (c === '?') { out += '[^/]'; }
			else if (c === '{') {
				const end = part.indexOf('}', i);
				out += end > i ? `(?:${part.slice(i + 1, end).split(',').map(convert).join('|')})` : '\\{';
				i = end > i ? end : i;
			} else { out += escape(c); }
		}
		return out;
	};
	return new RegExp(`^${convert(glob.replace(/^\.\//, ''))}$`);
}

/** Whether a finder finds files in a folder: a literal naming it or a parent, or a glob matching a file in it. */
export function findsFolder(finder: PathFinder, dir: string, probes: readonly string[]): boolean {
	const inside = (parent: string) => parent === '.' || dir === parent || dir.startsWith(`${parent}/`);
	if (finder.below !== undefined) { return inside(finder.below); }
	const bases = ['.', path.posix.dirname(finder.file)];
	for (const pattern of finder.patterns ?? []) {
		if (!pattern || /^[a-z]+:/i.test(pattern)) { continue; }
		for (const base of bases) {
			const full = path.posix.normalize(path.posix.join(base, pattern)).replace(/\/+$/, '');
			if (/[*?{]/.test(pattern)) {
				const re = globRegExp(full);
				if (probes.some(probe => re.test(probe))) { return true; }
			} else if (inside(full === '' ? '.' : full)) { return true; }
		}
	}
	return false;
}

const FRAMEWORKS: readonly [string, RegExp][] = [
	['next', /(^|\/)(app|pages)\//], ['nuxt', /(^|\/)(pages|plugins|composables|utils|layouts|components|middleware|store|server)\//],
	['expo-router', /(^|\/)app\//], ['@sveltejs/kit', /(^|\/)routes\/|(^|\/)\+[^/]*$/], ['astro', /(^|\/)pages\//],
];

/** A framework that finds files by their folder, when the dependency is present; any `api/` or `functions/` folder too. */
export function frameworkFolder(project: TsProject, file: string): string | undefined {
	for (const [name, pattern] of FRAMEWORKS) {
		if (project.dependencies.has(name) && pattern.test(file)) { return `${name} finds files in this folder by their path`; }
	}
	if (/(^|\/)(api|functions)\//.test(file)) { return 'serverless hosts find files in api/ and functions/ folders by their path'; }
	return undefined;
}
````

Create `src/aiready/tsGraph.ts`:

````ts
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import type * as TS from 'typescript';
import { analysisOptions, holder } from './tsConfig';
import type { Ts } from './tsLoad';
import type { TsProject } from './tsProject';

const CODE = /\.(?:[cm]?[jt]sx?)$/;

/** Source files the module graph covers: tracked TS/JS, not declarations and not in `node_modules`. */
export function graphFiles(tracked: readonly string[]): string[] {
	return tracked.filter(file => CODE.test(file) && !/\.d\.[cm]?ts$/.test(file) && !/(^|\/)node_modules\//.test(file));
}

/** A workspace package's source entry: `src/index.*`, `index.*`, or its `main`/`module` with a source extension. */
function workspaceEntry(project: TsProject, dir: string, files: ReadonlySet<string>): string | undefined {
	const pkg = project.packages.get(dir) as { main?: string; module?: string; source?: string; exports?: unknown } | undefined;
	const dot = (value: unknown): string | undefined => typeof value === 'string' ? value
		: value && typeof value === 'object' ? dot((value as Record<string, unknown>)['.'] ?? (value as Record<string, unknown>).import ?? (value as Record<string, unknown>).default) : undefined;
	const stems = ['src/index', 'index', ...[dot(pkg?.exports), pkg?.source, pkg?.module, pkg?.main].filter((v): v is string => !!v).map(v => v.replace(/^\.\//, '').replace(/\.[cm]?[jt]sx?$/, ''))];
	for (const stem of stems) {
		for (const ext of ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs']) {
			const file = `${dir}/${stem}${ext}`;
			if (files.has(file)) { return file; }
		}
	}
	return undefined;
}

/** Every module a file loads at run time, as written: static imports and re-exports, `require`, `import()` and `jest.requireActual` with a literal. */
export function runtimeSpecifiers(ts: Ts, file: string, text: string): { specifiers: string[]; dynamic: boolean } {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const specifiers: string[] = [];
	let dynamic = false;
	const literal = (node: TS.Node | undefined) => (node && ts.isStringLiteralLike(node) ? node.text : undefined);
	const visit = (node: TS.Node): void => {
		if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) { specifiers.push(literal(node.moduleSpecifier)!); }
		else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) { specifiers.push(literal(node.moduleSpecifier)!); }
		else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && !node.isTypeOnly) {
			specifiers.push(literal(node.moduleReference.expression) ?? '');
		} else if (ts.isCallExpression(node)) {
			const callee = node.expression;
			const named = (ts.isIdentifier(callee) && callee.text === 'require') || callee.kind === ts.SyntaxKind.ImportKeyword
				|| (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && /^(jest|vi)$/.test(callee.expression.text)
					&& /^(requireActual|requireMock|importActual|importMock)$/.test(callee.name.text));
			if (named) {
				const spec = literal(node.arguments[0]);
				if (spec === undefined) { dynamic = true; } else { specifiers.push(spec); }
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return { specifiers: specifiers.filter(Boolean), dynamic };
}

/**
 * Files in an import cycle (static, dynamic or `require`, any depth), plus files that import themselves or load a
 * module by a computed name. Type-only imports are not edges. Workspace package names resolve to their source entry.
 */
export function cyclicFiles(ts: Ts, project: TsProject): Set<string> {
	const files = graphFiles(project.tracked);
	const known = new Set(files);
	const edges = new Map<string, string[]>();
	const cyclic = new Set<string>();
	const entries = new Map([...project.workspaces].map(([name, dir]) => [name, workspaceEntry(project, dir, known)]));
	const cache = new Map<string, TS.ModuleResolutionCache>();
	for (const file of files) {
		const abs = path.join(project.root, file);
		let text = '';
		try { text = readFileSync(abs, 'utf8'); } catch { continue; }
		const { specifiers, dynamic } = runtimeSpecifiers(ts, file, text);
		if (dynamic) { cyclic.add(file); }
		const config = holder(project.configs, file);
		const options = analysisOptions(ts, config?.options);
		const key = config?.path ?? '';
		if (!cache.has(key)) { cache.set(key, ts.createModuleResolutionCache(project.root, name => name, options)); }
		edges.set(file, specifiers.flatMap(spec => {
			const bare = /^[^./]/.test(spec) ? [...entries].find(([name]) => spec === name || spec.startsWith(`${name}/`)) : undefined;
			if (bare && spec === bare[0] && bare[1]) { return [bare[1]]; }
			const resolved = ts.resolveModuleName(spec, abs, options, ts.sys, cache.get(key)).resolvedModule?.resolvedFileName;
			const relative = resolved && existsSync(resolved) ? source(path.relative(project.root, resolved).split(path.sep).join('/'), known) : undefined;
			if (relative && known.has(relative)) { return [relative]; }
			// A workspace import the graph cannot follow could hide a cycle.
			if (bare) { cyclic.add(file); }
			return [];
		}));
	}
	for (const component of components(files, edges)) {
		if (component.length > 1 || edges.get(component[0])?.includes(component[0])) { component.forEach(file => cyclic.add(file)); }
	}
	return cyclic;
}

/** The source a resolved declaration file stands for: `b.d.ts` next to a tracked `b.js` is `b.js`. */
function source(file: string, known: ReadonlySet<string>): string {
	const match = /^(.*)\.d\.([cm]?)ts$/.exec(file);
	if (!match) { return file; }
	return [`.${match[2]}js`, '.jsx', `.${match[2]}ts`, '.tsx'].map(ext => `${match[1]}${ext}`).find(candidate => known.has(candidate)) ?? file;
}

/** Strongly connected components (Tarjan), iterative so deep graphs do not overflow the stack. */
function components(nodes: readonly string[], edges: ReadonlyMap<string, readonly string[]>): string[][] {
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const out: string[][] = [];
	let next = 0;
	for (const start of nodes) {
		if (index.has(start)) { continue; }
		const work: { node: string; i: number }[] = [{ node: start, i: 0 }];
		index.set(start, next); low.set(start, next); next++; stack.push(start); onStack.add(start);
		while (work.length) {
			const frame = work[work.length - 1];
			const targets = edges.get(frame.node) ?? [];
			if (frame.i < targets.length) {
				const to = targets[frame.i++];
				if (!index.has(to)) {
					index.set(to, next); low.set(to, next); next++; stack.push(to); onStack.add(to);
					work.push({ node: to, i: 0 });
				} else if (onStack.has(to)) { low.set(frame.node, Math.min(low.get(frame.node)!, index.get(to)!)); }
				continue;
			}
			work.pop();
			if (work.length) { const parent = work[work.length - 1].node; low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!)); }
			if (low.get(frame.node) === index.get(frame.node)) {
				const component: string[] = [];
				let member: string;
				do { member = stack.pop()!; onStack.delete(member); component.push(member); } while (member !== frame.node);
				out.push(component);
			}
		}
	}
	return out;
}
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/steps.ts"
````

with:

````json
    "src/aiready/steps.ts",
    "src/aiready/tsLoad.ts",
    "src/aiready/tsConfig.ts",
    "src/aiready/tsProject.ts",
    "src/aiready/tsScan.ts",
    "src/aiready/tsGraph.ts"
````

- [ ] **Step 4: Run the tests with both TypeScripts.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 213`, `ℹ fail 0`; then `MY_EDITOR_TS=/Applications/my_editor.app/Contents/Resources/app/extensions/node_modules/typescript node --test out-test/test/aiReadyTsProject.test.js 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 13`, `ℹ fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/tsLoad.ts src/aiready/tsConfig.ts src/aiready/tsProject.ts src/aiready/tsScan.ts src/aiready/tsGraph.ts test/tsFixture.ts test/aiReadyTsProject.test.ts tsconfig.test.json
git commit -m "TS/JS adapter: the editor's TypeScript and project facts"
```

## Chunk 3: Parsing one file

### Task 3: Statements, spans, imports, references and purity

**Files:**
- Create: `src/aiready/tsRefs.ts`, `src/aiready/tsAst.ts`, `test/aiReadyTsAst.test.ts`
- Modify: `tsconfig.test.json`

Every fact comes from a program over the one file's text (`noResolve`, `noLib`, `types: []`): the binder resolves imports, top-level names, `typeof X` in types, shorthand `{ a }` and JSX tags, and globals resolve to nothing. Spans are UTF-16 in the facts and converted to UTF-8 once, through `utf8Table`.

- [ ] **Step 1: Write the failing test.**

Create `test/aiReadyTsAst.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { keepBindings, tsFileFacts, utf8Table } from '../src/aiready/tsAst';
import { analysisOptions } from '../src/aiready/tsConfig';
import { ts } from './tsFixture';

const OPTIONS = analysisOptions(ts, { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
const facts = (text: string, file = 'src/a.ts') => tsFileFacts(ts, file, text, OPTIONS);

test('facts: statements with attached comments to the end of their line, overloads grouped, imports apart', () => {
	const text = "import { x } from './x.js';\n\n// detached\n\n/** Doc. */\nexport function a(): number { return x; } // why\nexport function f(a: string): void;\nexport function f(a: unknown) {}\nconst k = 1; const m = 2;\n";
	const f = facts(text);
	assert.deepEqual(f.decls.map(d => [d.kind, d.names, text.slice(d.start, d.end), d.own]), [
		['function', ['a'], '/** Doc. */\nexport function a(): number { return x; } // why', true],
		['function', ['f'], 'export function f(a: string): void;\nexport function f(a: unknown) {}', true],
		['const', ['k'], 'const k = 1; const m = 2;', false],
		['const', ['m'], 'const k = 1; const m = 2;', false],
	]);
	assert.deepEqual(f.imports.map(i => [i.kind, i.specifier, i.bindings.map(b => b.local)]), [['import', "'./x.js'", ['x']]]);
	assert.equal(f.decls[0].docText, '/** Doc. */');
	assert.deepEqual([f.importsAtTop, f.module, f.parseErrors], [true, true, 0]);
});

test('UTF-16 offsets map to UTF-8 bytes through one table', () => {
	const text = "const s = 'é😀';\nx";
	const bytes = utf8Table(text);
	assert.equal(bytes(text.indexOf('x')), Buffer.byteLength(text.slice(0, text.indexOf('x'))));
	assert.equal(bytes(text.length), Buffer.byteLength(text));
});

test('an import is rebuilt from its own pieces, keeping as, type, default, quotes, layout and semicolons', () => {
	const f = facts('import D, { a as b, type T, c } from "./m.js"\nimport {\n\tp,\n\tq,\n\tr,\n} from \'./n.js\';\nexport const z = [D, b, c, p, q, r] as T[];\n');
	const [m, n] = f.imports;
	assert.equal(keepBindings(m, new Set(['b', 'T'])), 'import { a as b, type T } from "./m.js"');
	assert.equal(keepBindings(m, new Set(['D'])), 'import D from "./m.js"');
	assert.equal(keepBindings(m, new Set(['D', 'c'])), 'import D, { c } from "./m.js"');
	assert.equal(keepBindings(n, new Set(['p', 'r'])), "import {\n\tp,\n\tr,\n} from './n.js';");
	assert.equal(keepBindings(n, new Set()), undefined);
	assert.deepEqual(m.bindings.map(b => [b.local, b.imported, b.typeOnly]), [['D', 'default', false], ['b', 'a', false], ['T', 'T', true], ['c', 'c', false]]);
});

test('uses are split into values and types; definition-time reads, purity and quietness come from the binder', () => {
	const f = facts("import { Base, make } from './b.js';\nimport type { Opt } from './o.js';\n\nexport class K extends Base { m(o: Opt) { return make(o); } }\n"
		+ 'export const w = window;\nexport let n = 0;\nexport function bump() { n++; return this; }\nexport const t = () => this;\n');
	const [k, w, n, bump, t] = f.decls;
	assert.deepEqual([k.valueUses.sort(), k.typeUses, k.defReads, k.pure, k.quiet], [['Base', 'make'], ['Opt'], ['Base'], true, true]);
	assert.deepEqual([w.pure, w.quiet], [false, false]);
	assert.deepEqual([n.assigned, bump.problems, t.problems], [['n'], [], ['it uses `this` at module level, which differs per module']]);
});

test('a shorthand { __filename } names the module, and a for-of destructuring target is a write', () => {
	const f = facts('export function where() { return { __filename }; }\nexport let x = 1;\nexport function loop() { for ([x] of [[2]]) { void 0; } }\n');
	assert.deepEqual(f.decls[0].problems, ['it uses `__filename`, which names its module or file']);
	assert.deepEqual(f.decls[1].assigned, ['x']);
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `test/aiReadyTsAst.test.ts(3,54): error TS2307: Cannot find module '../src/aiready/tsAst' or its corresponding type declarations.`

- [ ] **Step 3: Implement.**

Create `src/aiready/tsRefs.ts`:

````ts
import type * as TS from 'typescript';
import type { Ts } from './tsLoad';

/** Resolves identifiers to this file's module-scope names (top-level declarations and imports) with the file's checker. */
export interface Scope {
	readonly ts: Ts;
	readonly checker: TS.TypeChecker;
	readonly source: TS.SourceFile;
}

const IMPORT_KINDS = new Set(['ImportSpecifier', 'ImportClause', 'NamespaceImport', 'ImportEqualsDeclaration']);

/** The top-level statement a node is in. */
export function topStatement(ts: Ts, node: TS.Node): TS.Node {
	let at = node;
	while (at.parent && !ts.isSourceFile(at.parent)) { at = at.parent; }
	return at;
}

/** Whether a declaration node is module scope: an import binding or a top-level declaration (variables included). */
function moduleScope(ts: Ts, decl: TS.Declaration): boolean {
	if (IMPORT_KINDS.has(ts.SyntaxKind[decl.kind])) { return true; }
	if (ts.isVariableDeclaration(decl)) { return !!decl.parent?.parent && ts.isVariableStatement(decl.parent.parent) && ts.isSourceFile(decl.parent.parent.parent); }
	if (ts.isBindingElement(decl)) {
		let at: TS.Node = decl;
		while (at && !ts.isVariableDeclaration(at)) { at = at.parent; }
		return !!at && moduleScope(ts, at as TS.VariableDeclaration);
	}
	return !!decl.parent && ts.isSourceFile(decl.parent);
}

/** The module-scope name an identifier refers to, or undefined (a local, a member, a global or nothing). */
export function moduleName(scope: Scope, id: TS.Identifier): string | undefined {
	const { ts, checker } = scope;
	const parent = id.parent;
	const symbol = parent && ts.isShorthandPropertyAssignment(parent) && parent.name === id
		? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(id);
	const decls = symbol?.declarations ?? [];
	return decls.length && decls.every(decl => decl.getSourceFile() === scope.source) && decls.some(decl => moduleScope(ts, decl)) ? id.text : undefined;
}

/** Whether an identifier is the name a declaration declares (not a use). */
export function isDeclarationName(ts: Ts, id: TS.Identifier): boolean {
	const parent = id.parent as TS.Node & { name?: TS.Node };
	if (!parent || parent.name !== id) { return false; }
	return ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)
		|| ts.isEnumDeclaration(parent) || ts.isModuleDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isBindingElement(parent)
		|| ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent)
		|| ts.isParameter(parent) || ts.isEnumMember(parent) || ts.isTypeParameterDeclaration(parent) || ts.isClassExpression(parent) || ts.isFunctionExpression(parent);
}

/** Whether an identifier is used only as a type here: in a type, `implements`, an interface's `extends`, `typeof` in a type, or JSDoc. */
export function isTypeUse(ts: Ts, id: TS.Node): boolean {
	for (let node = id; node.parent && !ts.isSourceFile(node.parent); node = node.parent) {
		const parent = node.parent;
		if (ts.isExpressionWithTypeArguments(parent) && parent.expression === node) { continue; }
		if (ts.isHeritageClause(parent)) { return parent.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(parent.parent); }
		if (ts.isTypeNode(parent) || (parent.kind >= ts.SyntaxKind.FirstJSDocNode && parent.kind <= ts.SyntaxKind.LastJSDocNode)) { return true; }
		if (ts.isExportSpecifier(parent)) { return parent.isTypeOnly || parent.parent.parent.isTypeOnly; }
	}
	return false;
}

/** Every identifier in a node, JSDoc included (for `@type {T}` in JS). */
export function identifiers(ts: Ts, node: TS.Node, into: TS.Identifier[] = []): TS.Identifier[] {
	if (ts.isIdentifier(node)) { into.push(node); }
	for (const doc of (node as { jsDoc?: TS.Node[] }).jsDoc ?? []) { identifiers(ts, doc, into); }
	ts.forEachChild(node, child => { identifiers(ts, child, into); });
	return into;
}

const FUNCTION_LIKE = new Set(['FunctionExpression', 'ArrowFunction', 'MethodDeclaration', 'GetAccessor', 'SetAccessor', 'Constructor', 'FunctionDeclaration']);

/** The expressions that run when a declaration is evaluated: initializers, `extends`, computed names, static fields and blocks, enum values. */
export function definitionTime(ts: Ts, node: TS.Node): TS.Node[] {
	if (ts.isVariableStatement(node)) { return node.declarationList.declarations.flatMap(d => (d.initializer ? [d.initializer] : [])); }
	if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
		const parts: TS.Node[] = [];
		for (const clause of node.heritageClauses ?? []) {
			if (clause.token === ts.SyntaxKind.ExtendsKeyword) { parts.push(...clause.types.map(type => type.expression)); }
		}
		for (const member of node.members) {
			if (member.name && ts.isComputedPropertyName(member.name)) { parts.push(member.name.expression); }
			const isStatic = ts.canHaveModifiers(member) && ts.getModifiers(member)?.some(m => m.kind === ts.SyntaxKind.StaticKeyword);
			if (ts.isPropertyDeclaration(member) && isStatic && member.initializer) { parts.push(member.initializer); }
			if (ts.isClassStaticBlockDeclaration(member)) { parts.push(member.body); }
		}
		return parts;
	}
	if (ts.isEnumDeclaration(node)) { return node.members.flatMap(m => (m.initializer ? [m.initializer] : [])); }
	if (ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) { return []; }
	return [node];
}

/** Module-scope names read while a declaration is evaluated (not inside functions it defines). */
export function definitionReads(scope: Scope, node: TS.Node): string[] {
	const { ts } = scope;
	const names = new Set<string>();
	const visit = (at: TS.Node): void => {
		if (FUNCTION_LIKE.has(ts.SyntaxKind[at.kind])) { return; }
		if (ts.isClassExpression(at)) { definitionTime(ts, at).forEach(visit); return; }
		if (ts.isIdentifier(at) && !isDeclarationName(ts, at) && !isTypeUse(ts, at)) {
			const name = moduleName(scope, at);
			if (name) { names.add(name); }
		}
		ts.forEachChild(at, visit);
	};
	definitionTime(ts, node).forEach(visit);
	return [...names];
}

const GLOBAL_CONSTANTS = new Set(['undefined', 'NaN', 'Infinity']);
const EMPTY_COLLECTIONS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);

/**
 * Whether evaluating an expression runs no code: literals, functions, pure classes, module-scope reads, `undefined`,
 * plain arrays and objects of those, and argument-less `new Map()`/`Set`/`WeakMap`/`WeakSet`. Wrappers like `as` are transparent.
 */
export function isPure(scope: Scope, node: TS.Node): boolean {
	const { ts } = scope;
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)
		|| (ts.isSatisfiesExpression?.(node) ?? false)) {
		return isPure(scope, (node as TS.ParenthesizedExpression).expression);
	}
	switch (node.kind) {
		case ts.SyntaxKind.StringLiteral: case ts.SyntaxKind.NumericLiteral: case ts.SyntaxKind.BigIntLiteral:
		case ts.SyntaxKind.RegularExpressionLiteral: case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
		case ts.SyntaxKind.TrueKeyword: case ts.SyntaxKind.FalseKeyword: case ts.SyntaxKind.NullKeyword:
		case ts.SyntaxKind.FunctionExpression: case ts.SyntaxKind.ArrowFunction:
			return true;
	}
	if (ts.isPrefixUnaryExpression(node)) { return node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand); }
	if (ts.isIdentifier(node)) { return !!moduleName(scope, node) || (GLOBAL_CONSTANTS.has(node.text) && !scope.checker.getSymbolAtLocation(node)?.declarations?.length); }
	if (ts.isClassExpression(node)) { return classPure(scope, node); }
	if (ts.isArrayLiteralExpression(node)) { return node.elements.every(e => ts.isOmittedExpression(e) || (!ts.isSpreadElement(e) && isPure(scope, e))); }
	if (ts.isObjectLiteralExpression(node)) {
		return node.properties.every(p => {
			const plain = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name));
			if (ts.isPropertyAssignment(p)) { return !!plain && isPure(scope, p.initializer); }
			if (ts.isShorthandPropertyAssignment(p)) { return !p.objectAssignmentInitializer && !!moduleName(scope, p.name); }
			return ts.isMethodDeclaration(p) && !!plain;
		});
	}
	if (ts.isNewExpression(node)) {
		return ts.isIdentifier(node.expression) && EMPTY_COLLECTIONS.has(node.expression.text) && !moduleName(scope, node.expression)
			&& !scope.checker.getSymbolAtLocation(node.expression)?.declarations?.some(d => d.getSourceFile() === scope.source) && !node.arguments?.length;
	}
	return false;
}

/** A class whose definition runs no code: no decorators, and a pure `extends`, computed names and static initializers, no static block with code. */
export function classPure(scope: Scope, node: TS.ClassLikeDeclaration): boolean {
	const { ts } = scope;
	if (hasDecorators(ts, node)) { return false; }
	return definitionTime(ts, node).every(part => (ts.isBlock(part) ? part.statements.length === 0 : isPure(scope, part)));
}

/** Whether a class (or anything in it) has a decorator. */
export function hasDecorators(ts: Ts, node: TS.Node): boolean {
	let found = false;
	const visit = (at: TS.Node): void => { if (ts.isDecorator(at)) { found = true; } else if (!found) { ts.forEachChild(at, visit); } };
	visit(node);
	return found;
}

/** Whether an enum's members are all literals or references to earlier members of the same enum. */
export function enumLiteral(ts: Ts, node: TS.EnumDeclaration): boolean {
	const earlier = new Set<string>();
	for (const member of node.members) {
		const init = member.initializer;
		const literal = !init || ts.isStringLiteral(init) || ts.isNumericLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)
			|| (ts.isPrefixUnaryExpression(init) && init.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(init.operand))
			|| (ts.isIdentifier(init) && earlier.has(init.text))
			|| (ts.isPropertyAccessExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === node.name.text && earlier.has(init.name.text));
		if (!literal) { return false; }
		earlier.add(member.name.getText());
	}
	return true;
}

/** Whether an identifier is written to: assigned, incremented, a for-in/of target, or inside a destructuring assignment target. */
export function isWrite(ts: Ts, id: TS.Identifier): boolean {
	let node: TS.Node = id;
	let parent = node.parent;
	if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
		&& (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) { return true; }
	if ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === node) { return true; }
	while (parent && (ts.isArrayLiteralExpression(parent) || ts.isObjectLiteralExpression(parent) || ts.isShorthandPropertyAssignment(parent)
		|| (ts.isPropertyAssignment(parent) && parent.initializer === node) || ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent) || ts.isParenthesizedExpression(parent))) {
		node = parent;
		parent = node.parent;
	}
	if (node !== id && parent && (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === node) { return true; }
	return !!parent && ts.isBinaryExpression(parent) && parent.left === node
		&& parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

/**
 * Why a declaration's span may never move, whatever the scope: it names its module or file (`import.meta` except
 * `.dirname`/`.env`, `__filename`, a free `module`/`exports`, `require` other than `require('literal')`, `eval`), uses
 * module-level `this`/`arguments`/`new.target`, or lists its own folder.
 */
export function spanProblems(scope: Scope, node: TS.Node): string[] {
	const { ts, checker } = scope;
	const problems = new Set<string>();
	const unresolved = (id: TS.Identifier) => !(ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id
		? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id))?.declarations?.length;
	const moduleLevel = (at: TS.Node) => {
		for (let up = at.parent; up; up = up.parent) {
			if (ts.isSourceFile(up)) { return true; }
			if (ts.isFunctionLike(up) && !ts.isArrowFunction(up)) { return false; }
			if (ts.isPropertyDeclaration(up) || ts.isClassStaticBlockDeclaration(up)) { return false; }
		}
		return true;
	};
	const visit = (at: TS.Node): void => {
		if (ts.isMetaProperty(at) && at.keywordToken === ts.SyntaxKind.ImportKeyword) {
			const parent = at.parent;
			if (!(ts.isPropertyAccessExpression(parent) && /^(dirname|env)$/.test(parent.name.text))) { problems.add('it uses `import.meta`, which names its module'); }
		} else if (ts.isMetaProperty(at) && moduleLevel(at)) { problems.add('it uses `new.target` at module level'); }
		if (at.kind === ts.SyntaxKind.ThisKeyword && moduleLevel(at)) { problems.add('it uses `this` at module level, which differs per module'); }
		if (ts.isIdentifier(at)) {
			const text = at.text;
			if (text === 'arguments' && moduleLevel(at) && unresolved(at)) { problems.add('it uses `arguments` at module level'); }
			if ((text === '__filename' || text === 'module' || text === 'exports' || text === 'eval') && unresolved(at) && !isDeclarationName(ts, at)
				&& !(ts.isPropertyAccessExpression(at.parent) && at.parent.name === at)) {
				problems.add(`it uses \`${text}\`, which names its module or file`);
			}
			if (text === 'require' && unresolved(at)) {
				const call = at.parent;
				const literal = ts.isCallExpression(call) && call.expression === at && call.arguments.length === 1 && ts.isStringLiteralLike(call.arguments[0]);
				if (!literal) { problems.add('it uses `require` other than `require(\'literal\')`'); }
			}
			if (/^(readdir|readdirSync|opendir|opendirSync)$/.test(text)) { problems.add('it lists a folder, which would now hold the new files'); }
		}
		ts.forEachChild(at, visit);
	};
	visit(node);
	return [...problems];
}
````

Create `src/aiready/tsAst.ts`:

````ts
import * as path from 'path';
import type * as TS from 'typescript';
import type { Span } from './language';
import type { Ts } from './tsLoad';
import { classPure, definitionReads, enumLiteral, hasDecorators, identifiers, isDeclarationName, isPure, isTypeUse, isWrite, moduleName, Scope, spanProblems } from './tsRefs';

/** One binding of an import or re-export, with its exact source text. */
export interface TsBinding {
	/** The local name (for a re-export: the exported name). */
	readonly local: string;
	/** `default`, `*`, `=` (for `import x = require()`) or the imported name. */
	readonly imported: string;
	/** Written as a type: in `import type …` or with an inline `type`. */
	readonly typeOnly: boolean;
	readonly text: string;
}

/** An import, `import x = require()` or `export … from`, as written. Texts are UTF-16 slices of the statement. */
export interface TsImport {
	readonly kind: 'import' | 'equals' | 'export';
	readonly text: string;
	/** Whole lines, UTF-8. */
	readonly span: Span;
	readonly own: boolean;
	/** The module specifier with its quotes. */
	readonly specifier: string;
	readonly module: string;
	readonly typeOnly: boolean;
	readonly sideEffect: boolean;
	/** `export * from`. */
	readonly star: boolean;
	readonly bindings: readonly TsBinding[];
	/** Pieces to rebuild the statement with fewer bindings: prefix, default, between, braces open/separators/close, namespace, suffix. */
	readonly pieces: { prefix: string; between: string; open: string; seps: string[]; close: string; suffix: string; defaultText?: string; namespaceText?: string };
}

/** One top-level statement other than an import (overloads grouped), with what the rules need. */
export interface TsDecl {
	readonly kind: string;
	readonly names: string[];
	readonly exported: boolean;
	readonly isDefault: boolean;
	readonly declare: boolean;
	readonly valueMeaning: boolean;
	/** UTF-16 offsets of the span: attached comments to the end of its last line. */
	readonly start: number;
	readonly end: number;
	readonly own: boolean;
	readonly docText: string;
	/** Module-scope names it uses (not its own), as values and only as types. */
	readonly valueUses: string[];
	readonly typeUses: string[];
	/** Module-scope names its definition-time code reads. */
	readonly defReads: string[];
	readonly quiet: boolean;
	/** Its definition-time code runs nothing (for classes, variables and enums). */
	readonly pure: boolean;
	readonly problems: string[];
	readonly decorators: boolean;
	readonly jsx: boolean;
	/** JSDoc `@typedef`, `@callback` or `@import` in it. */
	readonly jsdocTypes: boolean;
	/** Variables: every name is a plain identifier. */
	readonly plainNames: boolean;
	/** Enums: literal members only. */
	readonly literalEnum: boolean;
	/** Names in it that are written to outside their own declaration span. */
	readonly assigned: string[];
	/** For an `export { … }` list: the local names it exports. */
	readonly listed: string[];
}

export interface TsFacts {
	readonly text: string;
	readonly imports: readonly TsImport[];
	readonly decls: readonly TsDecl[];
	/** UTF-16 offset of the line where the facade goes when there are no imports (after the directives). */
	readonly facadeAt: number;
	readonly directives: readonly string[];
	readonly parseErrors: number;
	/** Every import, `import x = require()` and `export … from` comes before the first other statement. */
	readonly importsAtTop: boolean;
	readonly module: boolean;
	readonly exportEquals: boolean;
	/** Top-level `require`, `module.exports` or `exports.x` in a JS file. */
	readonly commonJs: boolean;
	readonly decorators: boolean;
	/** Comments outside declarations' spans that apply to the file, and the first comment. */
	readonly comments: readonly string[];
	readonly firstComment: string;
	/** UTF-16 offset to UTF-8 byte offset. */
	readonly bytes: (offset: number) => number;
}

/** UTF-16 offsets to UTF-8 byte offsets, through one prefix table (a surrogate pair counts 4 bytes at its first unit). */
export function utf8Table(text: string): (offset: number) => number {
	const table = new Uint32Array(text.length + 1);
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		table[i + 1] = table[i] + (c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? 4 : c >= 0xdc00 && c <= 0xdfff ? 0 : 3);
	}
	return offset => table[offset];
}

function scriptKind(ts: Ts, file: string): TS.ScriptKind {
	const ext = path.extname(file);
	return ext === '.tsx' ? ts.ScriptKind.TSX : ext === '.jsx' ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(ext) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/** A program over one file's text only (no resolution, no libraries), for the binder and checker. */
export function fileProgram(ts: Ts, file: string, text: string, options: TS.CompilerOptions): { source: TS.SourceFile; checker: TS.TypeChecker; program: TS.Program } {
	const name = path.resolve('/', file);
	const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
	const host = ts.createCompilerHost(options);
	host.getSourceFile = requested => (path.resolve(requested) === name ? source : undefined);
	host.fileExists = requested => path.resolve(requested) === name;
	host.readFile = requested => (path.resolve(requested) === name ? text : undefined);
	const program = ts.createProgram({ rootNames: [name], options: { ...options, noResolve: true }, host });
	return { source, checker: program.getTypeChecker(), program };
}

function lineStart(text: string, at: number): number {
	return text.lastIndexOf('\n', at - 1) + 1;
}

function lineEnd(text: string, at: number): number {
	const end = text.indexOf('\n', at);
	return end < 0 ? text.length : end;
}

/** A statement's span (attached comments to the end of its last line) and whether it is on lines of its own. */
function statementSpan(ts: Ts, text: string, node: TS.Node, previousEnd: number, source: TS.SourceFile): { start: number; end: number; own: boolean } {
	const token = node.getStart(source);
	const comments = (ts.getLeadingCommentRanges(text, node.pos) ?? []).filter(c => c.pos >= previousEnd
		&& !(previousEnd > 0 && !text.slice(previousEnd, c.pos).includes('\n')));
	let start = token;
	for (let i = comments.length - 1; i >= 0; i--) {
		const comment = comments[i];
		const gap = text.slice(comment.end, start);
		if ((gap.match(/\n/g)?.length ?? 0) > 1 || text.slice(lineStart(text, comment.pos), comment.pos).trim()) { break; }
		start = comment.pos;
	}
	const trailing = ts.getTrailingCommentRanges(text, node.end) ?? [];
	const end = lineEnd(text, node.end);
	const after = trailing.reduce((rest, c) => rest.replace(text.slice(c.pos, c.end), ''), text.slice(node.end, end));
	const own = !text.slice(lineStart(text, start), start).trim() && !after.trim() && trailing.every(c => c.end <= end)
		&& (previousEnd === 0 || text.slice(previousEnd, start).includes('\n') || !text.slice(0, start).trim());
	return { start: lineStart(text, start), end, own };
}

/** Each top-level statement's span (UTF-16): attached comments to the end of its last line. */
export function statementSpans(ts: Ts, source: TS.SourceFile): Map<TS.Node, { start: number; end: number }> {
	const spans = new Map<TS.Node, { start: number; end: number }>();
	let previousEnd = 0;
	for (const node of source.statements) {
		const span = statementSpan(ts, source.text, node, previousEnd, source);
		spans.set(node, { start: span.start, end: span.end });
		previousEnd = node.end;
	}
	return spans;
}

function hasModifier(ts: Ts, node: TS.Node, kind: TS.SyntaxKind): boolean {
	return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(m => m.kind === kind);
}

function bindingNames(ts: Ts, name: TS.BindingName): string[] {
	if (ts.isIdentifier(name)) { return [name.text]; }
	return name.elements.flatMap(e => (ts.isOmittedExpression(e) ? [] : bindingNames(ts, e.name)));
}

function describe(ts: Ts, node: TS.Statement): { kind: string; names: string[]; valueMeaning: boolean; plainNames: boolean } {
	const name = (n: { name?: TS.Node }) => (n.name && ts.isIdentifier(n.name) ? n.name.text : 'default');
	if (ts.isFunctionDeclaration(node)) { return { kind: 'function', names: [name(node)], valueMeaning: true, plainNames: true }; }
	if (ts.isClassDeclaration(node)) { return { kind: 'class', names: [name(node)], valueMeaning: true, plainNames: true }; }
	if (ts.isInterfaceDeclaration(node)) { return { kind: 'interface', names: [node.name.text], valueMeaning: false, plainNames: true }; }
	if (ts.isTypeAliasDeclaration(node)) { return { kind: 'type', names: [node.name.text], valueMeaning: false, plainNames: true }; }
	if (ts.isEnumDeclaration(node)) { return { kind: hasModifier(ts, node, ts.SyntaxKind.ConstKeyword) ? 'const enum' : 'enum', names: [node.name.text], valueMeaning: true, plainNames: true }; }
	if (ts.isVariableStatement(node)) {
		const flags = node.declarationList.flags;
		const kind = flags & ts.NodeFlags.Using ? 'using' : flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : 'var';
		const decls = node.declarationList.declarations;
		return { kind, names: decls.flatMap(d => bindingNames(ts, d.name)), valueMeaning: true, plainNames: decls.every(d => ts.isIdentifier(d.name)) };
	}
	if (ts.isModuleDeclaration(node)) { return { kind: 'namespace', names: [node.name.text], valueMeaning: true, plainNames: true }; }
	if (ts.isExportAssignment(node)) { return { kind: node.isExportEquals ? 'export =' : 'export default', names: [], valueMeaning: true, plainNames: true }; }
	if (ts.isExportDeclaration(node)) { return { kind: 'export list', names: [], valueMeaning: false, plainNames: true }; }
	if (ts.isImportEqualsDeclaration(node)) { return { kind: 'import alias', names: [node.name.text], valueMeaning: true, plainNames: true }; }
	return { kind: 'statement', names: [], valueMeaning: false, plainNames: true };
}

function quiet(scope: Scope, node: TS.Statement, pure: boolean): boolean {
	const { ts } = scope;
	if (hasModifier(ts, node, ts.SyntaxKind.DeclareKeyword) || ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node)
		|| ts.isTypeAliasDeclaration(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isEmptyStatement(node)) { return true; }
	if (ts.isImportEqualsDeclaration(node)) { return ts.isExternalModuleReference(node.moduleReference); }
	if (ts.isClassDeclaration(node) || ts.isVariableStatement(node) || ts.isEnumDeclaration(node)) { return pure; }
	return ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression);
}

function importOf(ts: Ts, node: TS.Statement, source: TS.SourceFile): Omit<TsImport, 'span' | 'own'> | undefined {
	const start = node.getStart(source);
	const text = node.getText(source);
	const slice = (from: number, to: number) => source.text.slice(from, to);
	if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
		const spec = node.moduleReference.expression;
		return { kind: 'equals', text, specifier: spec.getText(source), module: ts.isStringLiteralLike(spec) ? spec.text : '', typeOnly: node.isTypeOnly, sideEffect: false, star: false,
			bindings: [{ local: node.name.text, imported: '=', typeOnly: node.isTypeOnly, text }], pieces: { prefix: text, between: '', open: '', seps: [], close: '', suffix: '' } };
	}
	const spec = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier : undefined;
	if (!spec || !ts.isStringLiteralLike(spec)) { return undefined; }
	const base = { specifier: spec.getText(source), module: spec.text, text };
	if (ts.isExportDeclaration(node)) {
		const named = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : [];
		return { ...base, kind: 'export', typeOnly: node.isTypeOnly, sideEffect: false, star: !node.exportClause,
			bindings: named.map(e => ({ local: e.name.text, imported: (e.propertyName ?? e.name).getText(source), typeOnly: node.isTypeOnly || e.isTypeOnly, text: e.getText(source) })),
			pieces: { prefix: text, between: '', open: '', seps: [], close: '', suffix: '' } };
	}
	const clause = (node as TS.ImportDeclaration).importClause;
	if (!clause) { return { ...base, kind: 'import', typeOnly: false, sideEffect: true, star: false, bindings: [], pieces: { prefix: text, between: '', open: '', seps: [], close: '', suffix: '' } }; }
	const bindings: TsBinding[] = [];
	const named = clause.namedBindings;
	const first = clause.name ?? named!;
	const last = named ?? clause.name!;
	const pieces = { prefix: slice(start, first.getStart(source)), between: '', open: '', seps: [] as string[], close: '', suffix: slice(last.end, node.end) } as TsImport['pieces'];
	if (clause.name) {
		bindings.push({ local: clause.name.text, imported: 'default', typeOnly: clause.isTypeOnly, text: clause.name.text });
		pieces.defaultText = clause.name.text;
		if (named) { pieces.between = slice(clause.name.end, named.getStart(source)); }
	}
	if (named && ts.isNamespaceImport(named)) {
		bindings.push({ local: named.name.text, imported: '*', typeOnly: clause.isTypeOnly, text: named.getText(source) });
		pieces.namespaceText = named.getText(source);
	} else if (named) {
		const elements = named.elements;
		pieces.open = elements.length ? slice(named.getStart(source), elements[0].getStart(source)) : slice(named.getStart(source), named.end - 1);
		pieces.close = elements.length ? slice(elements[elements.length - 1].end, named.end) : '}';
		elements.forEach((e, i) => {
			bindings.push({ local: e.name.text, imported: (e.propertyName ?? e.name).getText(source), typeOnly: clause.isTypeOnly || e.isTypeOnly, text: e.getText(source) });
			if (i < elements.length - 1) { pieces.seps.push(slice(e.end, elements[i + 1].getStart(source))); }
		});
	}
	return { ...base, kind: 'import', typeOnly: clause.isTypeOnly, sideEffect: false, star: false, bindings, pieces };
}

/** Rebuilds an import keeping only some local names, from its own text pieces; undefined when none is kept. */
export function keepBindings(imp: TsImport, keep: ReadonlySet<string>): string | undefined {
	const p = imp.pieces;
	if (imp.bindings.every(b => keep.has(b.local))) { return imp.text; }
	if (imp.kind !== 'import' || !imp.bindings.some(b => keep.has(b.local))) { return undefined; }
	const hasDefault = p.defaultText !== undefined;
	const def = hasDefault && keep.has(imp.bindings[0].local);
	const rest = imp.bindings.slice(hasDefault ? 1 : 0);
	let tail = '';
	if (p.namespaceText !== undefined) { tail = keep.has(rest[0].local) ? p.namespaceText : ''; }
	else {
		const kept = rest.map((b, i) => ({ b, i })).filter(({ b }) => keep.has(b.local));
		if (kept.length) { tail = `${p.open}${kept.map(({ b, i }, j) => `${b.text}${j < kept.length - 1 ? p.seps[i] : ''}`).join('')}${p.close}`; }
	}
	return `${p.prefix}${def ? p.defaultText : ''}${def && tail ? p.between : ''}${tail}${p.suffix}`;
}

/** Everything the TS rules need from one file's text, from a single-file program. */
export function tsFileFacts(ts: Ts, file: string, text: string, options: TS.CompilerOptions): TsFacts {
	const { source, checker, program } = fileProgram(ts, file, text, options);
	const scope: Scope = { ts, checker, source };
	const bytes = utf8Table(text);
	const imports: TsImport[] = [];
	const decls: TsDecl[] = [];
	const directives: string[] = [];
	let previousEnd = 0;
	let firstOther = -1;
	let importsAtTop = true;
	let facadeAt = -1;
	const statements = source.statements;
	for (let i = 0; i < statements.length; i++) {
		const node = statements[i];
		const span = statementSpan(ts, text, node, previousEnd, source);
		const imp = importOf(ts, node, source);
		const directive = ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && firstOther < 0 && !imports.length;
		if (directive) { directives.push((node.expression as TS.StringLiteral).text); previousEnd = node.end; continue; }
		if (facadeAt < 0) { facadeAt = span.start; }
		if (imp) {
			if (firstOther >= 0) { importsAtTop = false; }
			imports.push({ ...imp, span: { start: bytes(lineStart(text, node.getStart(source))), end: bytes(span.end) }, own: span.own });
			previousEnd = node.end;
			continue;
		}
		if (firstOther < 0) { firstOther = i; }
		const group = [node];
		while (ts.isFunctionDeclaration(node) && !(group[group.length - 1] as TS.FunctionDeclaration).body && i + 1 < statements.length
			&& ts.isFunctionDeclaration(statements[i + 1]) && (statements[i + 1] as TS.FunctionDeclaration).name?.text === node.name?.text) {
			group.push(statements[++i]);
		}
		const spans = group.map((member, k) => (k === 0 ? span : statementSpan(ts, text, member, group[k - 1].end, source)));
		const last = group[group.length - 1];
		const info = describe(ts, node);
		const uses = new Map<string, 'value' | 'type'>();
		for (const member of group) {
			for (const id of identifiers(ts, member)) {
				if (isDeclarationName(ts, id) && topLevelName(ts, id)) { continue; }
				const name = moduleName(scope, id);
				if (!name || info.names.includes(name)) { continue; }
				const kind = isTypeUse(ts, id) ? 'type' : 'value';
				if (uses.get(name) !== 'value') { uses.set(name, kind); }
			}
		}
		const pure = ts.isClassDeclaration(node) ? classPure(scope, node)
			: ts.isEnumDeclaration(node) ? enumLiteral(ts, node)
				: ts.isVariableStatement(node) ? info.plainNames && node.declarationList.declarations.every(d => !d.initializer || isPure(scope, d.initializer))
					: false;
		const jsx = group.some(member => containsJsx(ts, member));
		const docText = text.slice(span.start, node.getStart(source)).trim();
		decls.push({
			...info, exported: hasModifier(ts, node, ts.SyntaxKind.ExportKeyword), isDefault: hasModifier(ts, node, ts.SyntaxKind.DefaultKeyword),
			declare: hasModifier(ts, node, ts.SyntaxKind.DeclareKeyword), start: span.start, end: spans[spans.length - 1].end, own: spans.every(s => s.own),
			docText, valueUses: [...uses].filter(([, k]) => k === 'value').map(([n]) => n), typeUses: [...uses].filter(([, k]) => k === 'type').map(([n]) => n),
			defReads: definitionReads(scope, node), quiet: quiet(scope, node, pure), pure, problems: group.flatMap(member => spanProblems(scope, member)),
			decorators: hasDecorators(ts, node), jsx, jsdocTypes: /\.[cm]?jsx?$/.test(file) && /@(typedef|callback|import)\b/.test(text.slice(span.start, spans[spans.length - 1].end)),
			literalEnum: ts.isEnumDeclaration(node) && enumLiteral(ts, node), assigned: [],
			listed: ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map(e => (e.propertyName ?? e.name).getText(source)) : [],
		});
		previousEnd = last.end;
	}
	if (facadeAt < 0) { facadeAt = text.length; }
	markAssigned(scope, decls);
	const types = new Set(decls.filter(d => !d.valueMeaning && d.kind !== 'export list' && d.kind !== 'statement').flatMap(d => d.names));
	for (const decl of decls.filter(d => d.kind === 'export list')) {
		(decl.typeUses as string[]).push(...decl.valueUses.filter(name => types.has(name)));
		decl.valueUses.splice(0, decl.valueUses.length, ...decl.valueUses.filter(name => !types.has(name)));
	}
	return {
		text, imports, decls, facadeAt, directives, importsAtTop,
		parseErrors: program.getSyntacticDiagnostics(source).length,
		module: ts.isExternalModule(source), exportEquals: statements.some(s => (ts.isExportAssignment(s) && s.isExportEquals) || ts.isNamespaceExportDeclaration(s)),
		commonJs: /\.[cm]?jsx?$/.test(file) && statements.some(s => commonJsStatement(ts, s)),
		decorators: decls.some(d => d.decorators), comments: fileComments(ts, text, source), firstComment: firstComment(ts, text), bytes,
	};
}

function topLevelName(ts: Ts, id: TS.Identifier): boolean {
	let node: TS.Node = id.parent;
	while (node && (ts.isBindingElement(node) || ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node))) { node = node.parent; }
	if (ts.isVariableDeclaration(node)) { node = node.parent.parent; }
	return !!node?.parent && ts.isSourceFile(node.parent);
}

function containsJsx(ts: Ts, node: TS.Node): boolean {
	if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) { return true; }
	return !!ts.forEachChild(node, child => containsJsx(ts, child) || undefined);
}

function commonJsStatement(ts: Ts, node: TS.Node): boolean {
	let found = false;
	const visit = (at: TS.Node): void => {
		if (found || ts.isFunctionLike(at) || ts.isClassLike(at)) { return; }
		if (ts.isIdentifier(at) && (at.text === 'module' || at.text === 'exports' || at.text === 'require')
			&& !(ts.isPropertyAccessExpression(at.parent) && at.parent.name === at)) { found = true; return; }
		ts.forEachChild(at, visit);
	};
	visit(node);
	return found;
}

/** Records, per declaration, which of its names are written to outside its own span. */
function markAssigned(scope: Scope, decls: TsDecl[]): void {
	const { ts } = scope;
	const writes: { name: string; at: number }[] = [];
	const visit = (node: TS.Node): void => {
		if (ts.isIdentifier(node) && isWrite(ts, node)) {
			const name = moduleName(scope, node);
			if (name) { writes.push({ name, at: node.getStart(scope.source) }); }
		}
		ts.forEachChild(node, visit);
	};
	visit(scope.source);
	for (const decl of decls) {
		(decl.assigned as string[]).push(...new Set(writes.filter(w => decl.names.includes(w.name) && (w.at < decl.start || w.at >= decl.end)).map(w => w.name)));
	}
}

function fileComments(ts: Ts, text: string, source: TS.SourceFile): string[] {
	const out: string[] = [];
	for (const node of [...source.statements, source.endOfFileToken]) {
		for (const c of ts.getLeadingCommentRanges(text, node.pos) ?? []) { out.push(text.slice(c.pos, c.end)); }
	}
	return [...new Set(out)];
}

function firstComment(ts: Ts, text: string): string {
	const c = (ts.getLeadingCommentRanges(text, text.startsWith('#!') ? text.indexOf('\n') + 1 : 0) ?? [])[0];
	return c ? text.slice(c.pos, c.end) : '';
}
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/tsGraph.ts"
````

with:

````json
    "src/aiready/tsGraph.ts",
    "src/aiready/tsRefs.ts",
    "src/aiready/tsAst.ts"
````

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 218`, `ℹ fail 0`; with `MY_EDITOR_TS=…` on `out-test/test/aiReadyTsAst.test.js` → `ℹ pass 5`.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/tsRefs.ts src/aiready/tsAst.ts test/aiReadyTsAst.test.ts tsconfig.test.json
git commit -m "TS/JS adapter: one file's statements, spans, imports and references"
```

## Chunk 4: Rules

### Task 4: Skip reasons, movability and file names

**Files:**
- Create: `src/aiready/tsRules.ts`, `test/aiReadyTsRules.test.ts`
- Modify: `test/tsFixture.ts`, `tsconfig.test.json`

Probe **p2** (JSX) and **p3** (a template literal whose `toString` reads a getter: moving the second `const` swaps the values the first and the second see) are named cases here; p3's temporal-dead-zone half is in Task 5.

- [ ] **Step 1: Write the failing test and extend the fixture.**

In `test/tsFixture.ts`, replace:

````ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadTypeScript, Ts } from '../src/aiready/tsLoad';

````

with:

````ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tsFileFacts } from '../src/aiready/tsAst';
import { analysisOptions, jsxRoots } from '../src/aiready/tsConfig';
import { loadTypeScript, Ts } from '../src/aiready/tsLoad';
import { specifierStyle, TsFileContext, TsFileInfo, tsFileInfoView, tsSkipReason } from '../src/aiready/tsRules';

````

Append to `test/tsFixture.ts`:

````ts

export const CONTEXT: TsFileContext = {
	scope: 'runtime', jsx: 'automatic', emitDecoratorMetadata: false, cyclic: false, sideEffectFree: false, exportsWildcard: false, listedInFiles: false, generatedAttribute: false,
};
export const OPTIONS = analysisOptions(ts, { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022, strict: true });

/** A parsed file without a project: the given context (run-time scope by default) and specifier style (`.js`). */
export function tsInfo(file: string, text: string, context: Partial<TsFileContext> = {}, style?: TsFileInfo['style']): TsFileInfo {
	const facts = tsFileFacts(ts, file, text, OPTIONS);
	const full = { ...CONTEXT, ...context };
	const own = specifierStyle(facts);
	return tsFileInfoView(file, facts, full, tsSkipReason(file, text, facts, full), style ?? (own === 'mixed' ? undefined : own ?? 'js'), jsxRoots(undefined));
}
````

Create `test/aiReadyTsRules.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { TsFileContext } from '../src/aiready/tsRules';
import { tsFileNameProblems } from '../src/aiready/tsRules';
import { tsInfo } from './tsFixture';

/** Why the last declaration of the text may not move, or 'movable'. */
function last(text: string, context: Partial<TsFileContext> = {}, file = 'src/a.ts'): string {
	const info = tsInfo(file, text, context);
	const decl = info.declarations[info.declarations.length - 1];
	return decl.movable ? 'movable' : decl.reason ?? '';
}

test('spans: attached JSDoc and // comments, a trailing comment and @ts-expect-error move; a detached comment stays; overloads are one declaration', () => {
	const text = "import { x } from './x.js';\n\n// detached\n\n/** Doc. */\n// eslint-disable-next-line\nexport function a() { return x; } // trailing\n\n"
		+ "// @ts-expect-error old\nexport const b: number = 'x';\nexport function f(a: string): void;\nexport function f(a: number): void;\nexport function f(a: unknown) {}\n"
		+ 'const k = 1; const m = 2;\n';
	const info = tsInfo('src/a.ts', text);
	const source = Buffer.from(text);
	const spans = info.declarations.map(d => source.subarray(d.span.start, d.span.end).toString());
	assert.deepEqual(spans.slice(0, 3), ['/** Doc. */\n// eslint-disable-next-line\nexport function a() { return x; } // trailing',
		"// @ts-expect-error old\nexport const b: number = 'x';", 'export function f(a: string): void;\nexport function f(a: number): void;\nexport function f(a: unknown) {}']);
	assert.equal(info.declarations[0].doc, 'Doc.');
	assert.deepEqual(info.declarations.slice(3).map(d => d.reason), ['it shares a line with other code', 'it shares a line with other code']);
	assert.deepEqual(info.declarations.map(d => d.names), [['a'], ['b'], ['f'], ['k'], ['m']]);
});

test('spans are UTF-8 byte offsets even after an emoji and an accent', () => {
	const text = "export const s = 'é😀';\n\nexport function g() {}\n";
	const info = tsInfo('src/a.ts', text);
	const g = info.declarations[1];
	assert.equal(g.span.start, Buffer.byteLength("export const s = 'é😀';\n\n"));
	assert.notEqual(g.span.start, text.indexOf('export function g'));
	assert.equal(Buffer.from(text).subarray(g.span.start, g.span.end).toString(), 'export function g() {}');
});

test('purity: literals, functions, module reads, plain arrays and objects and new Map() are pure; operators, reads, calls and globals are not', () => {
	const pure = ['/a/', "'x'", '`x`', '() => 1', '[1, A]', '{ a: 1, f() { return 1; } }', 'new Map()', 'undefined', '-1', 'A as unknown'];
	const impure = ['`${A}`', 'A + 1', 'A.b', "'k' in A", 'A instanceof Object', '[...A]', '{ [A]: 1 }', '{ get x() { return 1; } }', '{ ...A }',
		'new Map([[1, 2]])', "Symbol('s')", 'Object.freeze({})', 'A()', 'window', 'process'];
	for (const expr of pure) { assert.equal(last(`import { A } from './a.js';\n\nexport const v = ${expr};\n`), 'movable', expr); }
	for (const expr of impure) { assert.match(last(`import { A } from './a.js';\n\nexport const v = ${expr};\n`), /its definition runs code/, expr); }
});

test('probe p3: a template with a substitution runs code (a getter read twice would swap values), so it never moves', () => {
	const text = "import { counter } from './c.mjs';\nexport const a = counter.next;\nexport const b = `${{ toString: () => 'id' + counter.next }}`;\n";
	assert.match(last(text, {}, 'src/orig.mts'), /its definition runs code/);
});

test('the quiet window: a function after init() moves, a const or class after it does not; extends an import after quiet statements does', () => {
	assert.equal(last("import { init } from './i.js';\n\ninit();\n\nexport function f() {}\n"), 'movable');
	assert.match(last("import { init } from './i.js';\n\ninit();\n\nexport const c = 1;\n"), /code runs before it/);
	assert.match(last("import { init } from './i.js';\n\ninit();\n\nexport class K {}\n"), /code runs before it/);
	assert.equal(last("import { Base } from './b.js';\n\nexport const n = 1;\nexport type T = string;\n\nexport class K extends Base {}\n"), 'movable');
	assert.match(last('export class K extends Error {}\n'), /its definition runs code/);
	assert.match(last('export const x = window;\n'), /its definition runs code/);
});

test('classes: a decorator, a static block calling code and extends mixin(B) do not move; a literal enum moves, a computed one and a const enum do not', () => {
	assert.match(last('declare const d: any;\n\nexport class K { @d m() {} }\n'), /decorators/);
	assert.match(last("import { setup } from './s.js';\n\nexport class K { static { setup(); } }\n"), /its definition runs code/);
	assert.match(last("import { mixin, B } from './m.js';\n\nexport class K extends mixin(B) {}\n"), /its definition runs code/);
	assert.equal(last('export class K { static n = 1; x = Date.now(); m() { return this; } }\n'), 'movable');
	assert.equal(last('export enum E { A = 1, B = A, C = \'c\' }\n'), 'movable');
	assert.match(last("import { f } from './f.js';\n\nexport enum E { A = f() }\n"), /a member is computed/);
	assert.match(last('export const enum E { A = 1 }\n'), /const enum/);
});

test('names: assigned elsewhere, merged, declare, namespace, destructuring and statements do not move', () => {
	assert.match(last('export let n = 0;\nexport function reset() { n = 0; }\n\nexport let m = 0;\n'), /^movable$/);
	assert.match(tsInfo('src/a.ts', 'export let n = 0;\nexport function reset() { n = 0; }\n').declarations[0].reason ?? '', /n is assigned elsewhere/);
	assert.match(tsInfo('src/a.ts', 'export function f() {}\nf = () => 1;\n').declarations[0].reason ?? '', /f is assigned elsewhere/);
	assert.match(tsInfo('src/a.ts', 'export class K {}\nexport function g() { K = class {}; }\n').declarations[0].reason ?? '', /K is assigned elsewhere/);
	assert.match(last('export interface I { a: 1 }\nexport interface I { b: 2 }\n'), /more than one declaration/);
	assert.match(last('export declare const x: number;\n'), /ambient/);
	assert.match(last('declare global { interface Window { a: 1 } }\nexport {};\n'), /not a declaration/);
	assert.match(last('export namespace N { export const a = 1; }\n'), /namespace/);
	assert.match(last("import { o } from './o.js';\n\nexport const { a } = o;\n"), /destructures/);
	assert.match(last("import { o } from './o.js';\n\nconsole.log(o);\n"), /not a declaration/);
});

test('module-relative code: import.meta.url, __filename, top-level this, and this or arguments in top-level arrows refuse; __dirname and require(literal) in a function move', () => {
	assert.match(last('export const u = () => import.meta.url;\n'), /import\.meta/);
	assert.equal(last('export const d = () => import.meta.dirname;\n'), 'movable');
	assert.match(last('export function f() { return __filename; }\n'), /__filename/);
	assert.match(last('export const t = () => this;\n'), /`this` at module level/);
	assert.match(last('export const t = () => () => this;\n'), /`this` at module level/);
	assert.match(last('export const t = () => arguments.length;\n'), /`arguments` at module level/);
	assert.equal(last('export function f() { return this; }\n'), 'movable');
	assert.equal(last("export function f() { return [__dirname, require('./x')]; }\n"), 'movable');
	assert.match(last('export function f(n: string) { return require(n); }\n'), /require/);
	assert.match(last("import { readdirSync } from 'fs';\n\nexport function list() { return readdirSync('.'); }\n"), /lists a folder/);
});

test('probe p2: JSX moves under react-jsx or classic JSX, never under jsx preserve or without a tsconfig; JSDoc @typedef refuses', () => {
	const tsx = "import React from 'react';\n\nexport function C() { return <div />; }\n";
	assert.equal(last(tsx, { jsx: 'automatic' }, 'src/c.tsx'), 'movable');
	assert.equal(last(tsx, { jsx: 'classic' }, 'src/c.tsx'), 'movable');
	assert.match(last(tsx, { jsx: 'other' }, 'src/c.tsx'), /JSX is compiled by another tool/);
	assert.match(last('/** @typedef {{ a: number }} Row */\nexport function f() {}\n', { scope: 'functions' }, 'lib/a.mjs'), /@typedef/);
});

test('scope: types-only files move only interfaces and type aliases; plain JS moves only functions', () => {
	const text = 'export interface I { a: 1 }\nexport type T = string;\nexport function f() {}\n';
	const types = tsInfo('src/a.ts', text, { scope: 'types', scopeReason: 'it is emitted as CommonJS' });
	assert.deepEqual(types.declarations.map(d => d.reason), [undefined, undefined, 'only interfaces and type aliases may move here: it is emitted as CommonJS']);
	assert.deepEqual(tsInfo('lib/a.mjs', 'export const c = 1;\nexport function f() {}\n', { scope: 'functions' }).declarations.map(d => d.reason),
		['only function declarations may move in plain JavaScript', undefined]);
});

test('skipped files: module format, directives, tool comments, CRLF, parse errors, tests, generated code, decorators with metadata and imports after code', () => {
	const skip = (file: string, text: string, context: Partial<TsFileContext> = {}) => tsInfo(file, text, context).skip ?? 'none';
	assert.equal(skip('src/a.ts', 'export const a = 1;\n'), 'none');
	assert.match(skip('lib/a.js', "const x = require('x');\nmodule.exports = { x };\n", { scope: 'functions' }), /CommonJS module/);
	assert.match(skip('src/a.ts', 'const a = 1;\nexport = a;\n'), /export =/);
	assert.match(skip('src/a.ts', 'const a = 1;\n'), /script file/);
	assert.match(skip('src/a.tsx', "'use client';\nexport const a = 1;\n"), /'use client'/);
	assert.equal(skip('src/a.ts', "'use strict';\nexport const a = 1;\n"), 'none');
	assert.match(skip('src/a.ts', '// @ts-nocheck\nexport const a = 1;\n'), /@ts-nocheck/);
	assert.match(skip('src/a.ts', '/* eslint-disable */\nexport const a = 1;\n'), /eslint-disable/);
	assert.equal(skip('src/a.ts', '// eslint-disable-next-line\nexport const a = 1;\n'), 'none');
	assert.match(skip('src/a.ts', 'export const a = 1;\r\n'), /CRLF/);
	assert.match(skip('src/a.ts', 'export const = ;\n'), /parser reports errors/);
	assert.match(skip('src/a.d.ts', 'export declare const a: 1;\n'), /declaration file/);
	assert.match(skip('src/a.test.ts', 'export const a = 1;\n'), /test/);
	assert.match(skip('src/__mocks__/a.ts', 'export const a = 1;\n'), /test/);
	assert.match(skip('vite.config.ts', 'export const a = 1;\n'), /config/);
	assert.match(skip('src/a.ts', '// Code generated by protoc. DO NOT EDIT.\nexport const a = 1;\n'), /generated/);
	assert.match(skip('src/a.ts', `export const a = '${'x'.repeat(1001)}';\n`), /minified/);
	assert.match(skip('src/a.ts', 'declare const d: any;\n@d class K {}\nexport { K };\n', { emitDecoratorMetadata: true }), /emitDecoratorMetadata/);
	assert.match(skip('src/a.ts', "export const a = 1;\nimport { b } from './b.js';\n"), /imports are not one block/);
	assert.match(skip('src/a.ts', 'export const a = 1;\n', { cyclic: true }), /import cycle/);
	assert.match(skip('src/a.ts', 'export const a = 1;\n', { scope: { skip: 'no tsconfig includes it' } }), /no tsconfig/);
});

test('skipped files: side-effect-free packages with code at load, folders found by path, public wildcard subpaths and files lists', () => {
	const skip = (text: string, context: Partial<TsFileContext>) => tsInfo('src/a.ts', text, context).skip ?? 'none';
	assert.match(skip("import { f } from './f.js';\n\nf();\nexport const a = 1;\n", { sideEffectFree: true }), /side-effect-free/);
	assert.match(skip("import './polyfill.js';\n\nexport const a = 1;\n", { sideEffectFree: true }), /side-effect-free/);
	assert.equal(skip('export const a = 1;\nexport function f() {}\n', { sideEffectFree: true }), 'none');
	assert.match(skip('export const a = 1;\n', { foundByPath: 'src/load.ts finds files in this folder by a path string' }), /finds files/);
	assert.match(skip('export const a = 1;\n', { exportsWildcard: true }), /wildcard/);
	assert.match(skip('export const a = 1;\n', { listedInFiles: true }), /"files"/);
});

test('file names: same extension, not index or a framework name, no stem clash with a file or folder, not matched by test globs', () => {
	const entries = ['report.ts', 'utils', 'rows.js'];
	assert.deepEqual(tsFileNameProblems('formatting.ts', 'src/report.ts', entries, []), []);
	assert.match(tsFileNameProblems('formatting.tsx', 'src/report.ts', entries, []).join(' '), /extension \.ts/);
	assert.match(tsFileNameProblems('index.ts', 'src/report.ts', entries, []).join(' '), /index files/);
	assert.match(tsFileNameProblems('page.tsx', 'app/report.tsx', [], []).join(' '), /frameworks/);
	assert.match(tsFileNameProblems('utils.ts', 'src/report.ts', entries, []).join(' '), /utils already uses the name utils/);
	assert.match(tsFileNameProblems('Rows.ts', 'src/report.ts', entries, []).join(' '), /rows\.js already uses the name Rows/);
	assert.match(tsFileNameProblems('rows.test.ts', 'src/report.ts', entries, []).join(' '), /test/);
	assert.match(tsFileNameProblems('_rows.ts', 'src/report.ts', entries, []).join(' '), /starting with a letter or digit/);
	assert.match(tsFileNameProblems('checks.ts', 'src/report.ts', entries, ['src/**/check*.ts']).join(' '), /test pattern src\/\*\*\/check\*\.ts matches it/);
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `test/aiReadyTsRules.test.ts(3,36): error TS2307: Cannot find module '../src/aiready/tsRules' or its corresponding type declarations.`

- [ ] **Step 3: Implement.**

Create `src/aiready/tsRules.ts`:

````ts
import * as path from 'path';
import type { Declaration, FileInfo } from './language';
import type { TsDecl, TsFacts } from './tsAst';
import type { Scope } from './tsProject';
import { globRegExp } from './tsScan';

/** Project facts about one file that its skip reason and movability need (pure inputs). */
export interface TsFileContext {
	/** What may move, or why nothing in the file may. */
	readonly scope: Scope | { skip: string };
	/** Why the scope is types only, for the reason text. */
	readonly scopeReason?: string;
	readonly jsx: 'classic' | 'automatic' | 'other';
	readonly emitDecoratorMetadata: boolean;
	readonly cyclic: boolean;
	/** Why a tool or framework finds this file's folder by path, if one does. */
	readonly foundByPath?: string;
	/** The nearest package.json marks the file side-effect-free. */
	readonly sideEffectFree: boolean;
	readonly exportsWildcard: boolean;
	/** The nearest package.json `files` names this file exactly. */
	readonly listedInFiles: boolean;
	/** `.gitattributes` marks it `linguist-generated`. */
	readonly generatedAttribute: boolean;
}

/** A TS declaration as the core sees it, plus what the TS split needs. */
export interface TsDeclaration extends Declaration {
	readonly ts: TsDecl;
}

/** A parsed TS/JS file: the language-neutral view plus the raw facts. */
export interface TsFileInfo extends FileInfo {
	readonly declarations: readonly TsDeclaration[];
	readonly facts: TsFacts;
	readonly context: TsFileContext;
	/** The original's own specifier style for relative imports, from its imports or its siblings'. */
	readonly style?: 'js' | 'ts' | 'none';
	/** Classic JSX: the root names the factory needs in scope. */
	readonly jsxRoots: readonly string[];
	/** From the unit program, filled by the adapter: the export surface and every identifier's binding. */
	readonly surface?: readonly string[];
	readonly bindings?: readonly string[];
}

const TEST = /\.(test|spec|stories)\.[^/]+$|(^|\/)(__tests__|__mocks__|__fixtures__|test|tests|spec|e2e|cypress)\//;
const CONFIG = /(^|\/)([^/]+\.(config|setup)\.[^/]+|setupTests\.[^/]+|gulpfile\.[^/]+|Gruntfile\.[^/]+|\.eslintrc\.[^/]+)$/;
const BUILD = /(^|\/)(node_modules|dist|build|out|coverage|vendor)\/|\.min\.js$/;
const GENERATED_NAME = /\.gen\.[cm]?[jt]sx?$|_pb\.[cm]?[jt]s$|(^|\/)__generated__\//;
const GENERATED_TEXT = /@generated|DO NOT EDIT|auto-generated|Code generated/i;
const TOOL_COMMENT = /@ts-nocheck|@ts-check|^\/\*\s*eslint-disable(?![\w-])|istanbul ignore file|c8 ignore file|@jsx\b|@jsxFrag\b|@jsxImportSource\b|@jsxRuntime\b|@flow\b|^\/\/\/\s*<amd-module/;

/** Why a TS/JS file is never split, or undefined. */
export function tsSkipReason(file: string, text: string, facts: TsFacts, context: TsFileContext): string | undefined {
	if (/\.d\.[cm]?ts$/.test(file)) { return 'a declaration file'; }
	if (TEST.test(file)) { return 'a test or test-support file'; }
	if (CONFIG.test(file)) { return 'a config or entry script'; }
	if (BUILD.test(file)) { return 'build output or vendored code'; }
	if (GENERATED_NAME.test(file) || context.generatedAttribute || GENERATED_TEXT.test(facts.firstComment)) { return 'generated code'; }
	if (text.length > 512 * 1024 || text.split('\n').some(line => line.length > 1000)) { return 'it looks minified (a line over 1,000 characters or over 512 KB)'; }
	if (text.charCodeAt(0) === 0xfeff) { return 'it starts with a byte-order mark'; }
	if (text.includes('\r\n')) { return 'it has CRLF line endings'; }
	if (facts.parseErrors) { return 'the parser reports errors in it (Flow or broken code)'; }
	if (typeof context.scope === 'object') { return context.scope.skip; }
	if (facts.commonJs) { return 'CommonJS module'; }
	if (facts.exportEquals) { return 'it has `export =` or `export as namespace`'; }
	if (!facts.module) { return 'a script file: its top-level names are globals and a new file would never load'; }
	const directive = facts.directives.find(d => d !== 'use strict');
	if (directive) { return `it has the directive '${directive}', which a new file would lack`; }
	const tool = facts.comments.find(comment => TOOL_COMMENT.test(comment));
	if (tool) { return `it has the file-level comment \`${tool.split('\n')[0].slice(0, 60)}\`, which new files would need`; }
	if (facts.decorators && context.emitDecoratorMetadata) { return 'it has decorators and emitDecoratorMetadata is on'; }
	if (!facts.importsAtTop) { return 'its imports are not one block at the top'; }
	if (facts.imports.some(imp => !imp.own)) { return 'an import shares a line with other code'; }
	if (context.cyclic) { return 'it is in an import cycle'; }
	if (context.sideEffectFree && (facts.decls.some(d => !d.quiet) || facts.imports.some(imp => imp.sideEffect))) {
		return 'its package.json marks it side-effect-free and it runs code when loaded, so a bundler may drop or reorder that code';
	}
	if (context.foundByPath) { return context.foundByPath; }
	if (context.exportsWildcard) { return 'its package.json "exports" has a wildcard subpath, which would make new files public'; }
	if (context.listedInFiles) { return 'its package.json "files" names it, and new files would be left out of the published package'; }
	return undefined;
}

const RUNTIME_KINDS = new Set(['function', 'interface', 'type', 'class', 'enum', 'const', 'let', 'var']);

/** Why one declaration may not move, given the file's scope and the declarations before it; undefined when it may. */
function unmovable(decl: TsDecl, index: number, facts: TsFacts, context: TsFileContext, merged: ReadonlySet<string>): string | undefined {
	const scope = context.scope as Scope;
	if (!RUNTIME_KINDS.has(decl.kind) || decl.declare) {
		return decl.kind === 'const enum' ? 'a const enum is inlined across files differently by each tool'
			: decl.kind === 'namespace' ? 'a namespace body runs code and merges' : decl.declare ? 'it is ambient (declare)' : 'it is not a declaration, or it runs code';
	}
	if (!decl.own) { return 'it shares a line with other code'; }
	if (decl.names.some(name => merged.has(name))) { return 'its name has more than one declaration (declaration merging)'; }
	if (decl.problems.length) { return decl.problems[0]; }
	if (decl.jsx && context.jsx === 'other') { return 'its JSX is compiled by another tool (jsx: preserve, or no tsconfig)'; }
	if (decl.jsdocTypes) { return 'its doc comment declares file-level types (@typedef, @callback or @import)'; }
	if (scope === 'types' && decl.kind !== 'interface' && decl.kind !== 'type') {
		return `only interfaces and type aliases may move here: ${context.scopeReason || 'the project is not ES modules checked by tsc alone'}`;
	}
	if (scope === 'functions' && decl.kind !== 'function') { return 'only function declarations may move in plain JavaScript'; }
	if (decl.assigned.length) { return `${decl.assigned[0]} is assigned elsewhere, and an imported name cannot be`; }
	if (decl.kind === 'class' && decl.decorators) { return 'it has decorators, which run when the class is defined'; }
	if (decl.kind === 'enum' && !decl.literalEnum) { return 'a member is computed, which runs code'; }
	if (['const', 'let', 'var'].includes(decl.kind) && !decl.plainNames) { return 'it destructures, which runs code'; }
	if (['class', 'const', 'let', 'var'].includes(decl.kind) && !decl.pure) { return 'its definition runs code (a call, a property read, an operator or a global read)'; }
	if (['class', 'enum', 'const', 'let', 'var'].includes(decl.kind) && facts.decls.slice(0, index).some(d => !d.quiet)) {
		return 'code runs before it in the file, so it would be defined earlier than now';
	}
	return undefined;
}

function firstDocLine(doc: string): string {
	return doc.split('\n').map(line => line.replace(/^\s*(\/\*\*?|\*\/|\*|\/\/)\s?/, '').replace(/\*\/\s*$/, '').trim()).find(Boolean) ?? '';
}

/** The language-neutral view of a parsed TS/JS file. */
export function tsFileInfoView(file: string, facts: TsFacts, context: TsFileContext, skip: string | undefined, style: TsFileInfo['style'], jsxRoots: readonly string[]): TsFileInfo {
	const counts = new Map<string, number>();
	for (const name of facts.decls.filter(d => d.kind !== 'export list' && d.kind !== 'statement').flatMap(d => d.names)) { counts.set(name, (counts.get(name) ?? 0) + 1); }
	const merged = new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
	const locals = new Map(facts.imports.flatMap(imp => imp.bindings.map(b => [b.local, `${b.local} ${imp.specifier}`] as const)));
	const { bytes, text } = facts;
	const declarations: TsDeclaration[] = facts.decls.map((decl, id) => {
		const reason = skip ? skip : unmovable(decl, id, facts, context, merged);
		return {
			id, kind: `${decl.exported ? 'export ' : ''}${decl.isDefault ? 'default ' : ''}${decl.kind}`, names: decl.names, span: { start: bytes(decl.start), end: bytes(decl.end) },
			lines: text.slice(decl.start, decl.end).split('\n').length, doc: firstDocLine(decl.docText), docText: decl.docText,
			uses: [...new Set([...decl.valueUses, ...decl.typeUses].flatMap(name => (locals.has(name) ? [locals.get(name)!] : [])))],
			movable: !reason, reason, ts: decl,
		};
	});
	const imports = facts.imports;
	const first = Math.min(imports[0]?.span.start ?? Infinity, declarations[0]?.span.start ?? Infinity, bytes(text.length));
	return {
		path: file, declarations, facts, context, style, jsxRoots, skip,
		importRegion: imports.length ? { start: imports[0].span.start, end: imports[imports.length - 1].span.end } : { start: bytes(facts.facadeAt), end: bytes(facts.facadeAt) },
		frame: [{ start: 0, end: first }, ...imports.map(imp => imp.span)],
		prelude: { start: 0, end: first },
		imports: imports.flatMap(imp => (imp.sideEffect ? [`_ ${imp.specifier}`] : imp.kind === 'export' ? [`export ${imp.specifier}`] : imp.bindings.map(b => `${b.local} ${imp.specifier}`))),
	};
}

/** The style of a file's relative specifiers: `.js`-like suffix, `.ts`-like suffix or none; `mixed` when they disagree. */
export function specifierStyle(facts: TsFacts): 'js' | 'ts' | 'none' | 'mixed' | undefined {
	const styles = new Set(facts.imports.filter(imp => /^\.\.?\//.test(imp.module)).flatMap(imp => {
		const ext = path.extname(imp.module);
		return /^\.[cm]?jsx?$/.test(ext) ? ['js'] : /^\.[cm]?tsx?$/.test(ext) ? ['ts'] : ext === '' ? ['none'] : [];
	}));
	return styles.size > 1 ? 'mixed' : ([...styles][0] as 'js' | 'ts' | 'none' | undefined);
}

const FRAMEWORK_FILES = new Set(['page', 'layout', 'route', 'template', 'loading', 'error', 'not-found', 'default', 'head', 'middleware', 'instrumentation', '_app', '_document', '_layout']);

/** Why a new file split from `original` may not have this name; `entries` are the names already in its folder. */
export function tsFileNameProblems(name: string, original: string, entries: readonly string[], testGlobs: readonly string[]): string[] {
	const problems: string[] = [];
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) { problems.push('use letters, digits, dots, dashes and underscores, starting with a letter or digit'); }
	const ext = /\.d\.[cm]?ts$/.test(name) ? '.d.ts' : path.extname(name);
	if (ext !== path.extname(original)) { problems.push(`use the original's extension ${path.extname(original)} (code can parse differently in another)`); }
	const stem = path.parse(name).name;
	if (/^index$/i.test(stem)) { problems.push('index files are found by folder imports'); }
	if (/\.d$|\.(test|spec|stories|config)(\.|$)/i.test(stem)) { problems.push('a new file must not be a declaration, test, story or config file'); }
	if (FRAMEWORK_FILES.has(stem.toLowerCase())) { problems.push(`${stem} is a file name frameworks give a meaning`); }
	const taken = entries.find(entry => entry !== name && path.parse(entry).name.toLowerCase() === stem.toLowerCase());
	if (taken) { problems.push(`${taken} already uses the name ${stem}, so an import of ./${stem} could resolve differently`); }
	const relative = path.posix.join(path.posix.dirname(original), name);
	const glob = testGlobs.find(g => globRegExp(g).test(relative) || globRegExp(g).test(name));
	if (glob) { problems.push(`the project's test pattern ${glob} matches it`); }
	return problems;
}
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/tsAst.ts"
````

with:

````json
    "src/aiready/tsAst.ts",
    "src/aiready/tsRules.ts"
````

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 231`, `ℹ fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/tsRules.ts test/aiReadyTsRules.test.ts test/tsFixture.ts tsconfig.test.json
git commit -m "TS/JS adapter: skip reasons, movability and file names"
```

## Chunk 5: Applying a split

### Task 5: Applying a split: new files, filtered imports and the facade

**Files:**
- Create: `src/aiready/tsSplit.ts`, `test/aiReadyTsSplit.test.ts`
- Modify: `test/tsFixture.ts`, `tsconfig.test.json`

Probes **p3** (TDZ: `const x = y` before `y` throws today and would not after a split across files), **p4** (a non-exported helper exported from a new file would appear in `Object.keys` of every `export *` of the folder) and **p5** (dropping `import { Config }` that is used only as a type made `other.ts` load before `config.ts` under Node's type stripping) run real Node on the split output.

- [ ] **Step 1: Write the failing test and extend the fixture.**

In `test/tsFixture.ts`, replace:

````ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tsFileFacts } from '../src/aiready/tsAst';
import { analysisOptions, jsxRoots } from '../src/aiready/tsConfig';
import { loadTypeScript, Ts } from '../src/aiready/tsLoad';
import { specifierStyle, TsFileContext, TsFileInfo, tsFileInfoView, tsSkipReason } from '../src/aiready/tsRules';

````

with:

````ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SplitPlan, SplitResult } from '../src/aiready/language';
import { tsFileFacts } from '../src/aiready/tsAst';
import { analysisOptions, jsxRoots } from '../src/aiready/tsConfig';
import { loadTypeScript, Ts } from '../src/aiready/tsLoad';
import { specifierStyle, TsFileContext, TsFileInfo, tsFileInfoView, tsSkipReason } from '../src/aiready/tsRules';
import { buildTsSplit } from '../src/aiready/tsSplit';

````

Append to `test/tsFixture.ts`:

````ts

/** Every relative specifier resolves. */
export const RESOLVES = { resolves: () => true };

/** Splits text with a plan, or returns the thrown reasons. */
export function split(file: string, text: string, plan: SplitPlan, context: Partial<TsFileContext> = {}, style?: TsFileInfo['style']): SplitResult | string {
	try { return buildTsSplit(Buffer.from(text), tsInfo(file, text, context, style), plan, RESOLVES); }
	catch (error) { return error instanceof Error ? error.message : String(error); }
}

/** The text of a split's new file by index, or the original. */
export function text(result: SplitResult | string, index?: number): string {
	if (typeof result === 'string') { throw new Error(result); }
	return (index === undefined ? result.original : result.files[index].text).toString('utf8');
}
````

Create `test/aiReadyTsSplit.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { buildTsSplit } from '../src/aiready/tsSplit';
import { split, text, ts, tsInfo } from './tsFixture';

const REPORT = `import { z } from 'zod';
import { helper } from './util.js';
import type { Options } from './options.js';

/** A row. */
export interface Row { name: string; size: number }

/** Parses one row. */
export function parseRow(line: string): Row {
	const [name, size] = line.split(',');
	return { name: z.string().parse(name), size: Number(size) };
}

export function formatRow(row: Row): string {
	return \`\${row.name}: \${row.size}\`;
}

export function report(lines: string[], options: Options): string {
	return lines.map(parseRow).map(formatRow).join(helper(options));
}
`;

/** Writes files into a temp folder and runs one with Node; returns its output. */
function run(files: Record<string, string>, main: string): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-probe-'));
	for (const [name, body] of Object.entries(files)) { writeFileSync(path.join(dir, name), body); }
	return execFileSync(process.execPath, [main], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

test('a split moves spans byte for byte, copies only the imports they use, and leaves a facade after the imports', () => {
	const result = split('src/report.ts', REPORT, [{ file: 'rows.ts', declarations: [0, 1, 2] }]);
	assert.equal(text(result, 0), `// Split from report.ts by my_editor.

import { z } from 'zod';

/** A row. */
export interface Row { name: string; size: number }

/** Parses one row. */
export function parseRow(line: string): Row {
	const [name, size] = line.split(',');
	return { name: z.string().parse(name), size: Number(size) };
}

export function formatRow(row: Row): string {
	return \`\${row.name}: \${row.size}\`;
}
`);
	assert.equal(text(result), `import 'zod';
import { helper } from './util.js';
import type { Options } from './options.js';
import { parseRow, formatRow } from './rows.js';
export { parseRow, formatRow } from './rows.js';
export type { Row } from './rows.js';

export function report(lines: string[], options: Options): string {
	return lines.map(parseRow).map(formatRow).join(helper(options));
}
`);
});

test('probe p4: a helper moves with every user; a non-exported helper used by staying code or by two new files is refused, so no export is added', () => {
	const orig = 'export function f() { return helper(); }\nfunction helper() { return 1; }\nexport const g = 1;\nexport function k() { return 2; }\n';
	assert.match(String(split('lib/orig.mjs', orig, [{ file: 'n.mjs', declarations: [0] }], { scope: 'functions' })), /declaration 0 \(f\) uses helper \(1\), which stays/);
	const moved = split('lib/orig.mjs', orig, [{ file: 'n.mjs', declarations: [0, 1] }], { scope: 'functions' });
	assert.equal(text(moved, 0), '// Split from orig.mjs by my_editor.\n\nexport function f() { return helper(); }\n\nfunction helper() { return 1; }\n');
	const index = "export * from './orig.mjs';\n";
	const keys = (files: Record<string, string>) => run({ ...files, 'index.mjs': index, 'main.mjs': "import * as ns from './index.mjs';\nconsole.log(Object.keys(ns).join(','));\n" }, 'main.mjs');
	assert.equal(keys({ 'orig.mjs': text(moved), 'n.mjs': text(moved, 0) }), keys({ 'orig.mjs': orig }));
	const staying = 'function helper() { return 1; }\nexport function k() { return helper(); }\n';
	assert.match(String(split('lib/orig.mjs', staying, [{ file: 'n.mjs', declarations: [0] }], { scope: 'functions' })), /stays and uses helper \(0\), which is not exported/);
	const two = 'function helper() { return 1; }\nexport function a() { return helper(); }\nexport function b() { return helper(); }\n';
	assert.match(String(split('lib/orig.mjs', two, [{ file: 'a2.mjs', declarations: [0, 1] }, { file: 'b2.mjs', declarations: [2] }], { scope: 'functions' })),
		/declaration 2 \(b\) uses helper \(0\), which is not exported: a helper moves to the same file/);
});

test('names across new files: an exported name is imported from its new file, type-only cycles pass, value cycles do not', () => {
	const src = 'export interface A { b?: B }\nexport interface B { a?: A }\nexport function f() { return g(); }\nexport function g() { return 1; }\nexport function h() { return f(); }\n';
	const types = split('src/t.ts', src, [{ file: 'ta.ts', declarations: [0] }, { file: 'tb.ts', declarations: [1] }]);
	assert.match(text(types, 0), /import type \{ B \} from '\.\/tb\.js';/);
	assert.match(text(types, 1), /import type \{ A \} from '\.\/ta\.js';/);
	const values = split('src/t.ts', src, [{ file: 'fa.ts', declarations: [2] }, { file: 'fb.ts', declarations: [3, 4] }]);
	assert.match(String(values), /import values from each other/);
	assert.match(text(split('src/t.ts', src, [{ file: 'fa.ts', declarations: [2, 4] }, { file: 'fb.ts', declarations: [3] }]), 0), /import \{ g \} from '\.\/fb\.js';/);
});

test('a type-only use of an exported staying type gets import type from the original; a non-exported one or a value use is refused', () => {
	const src = 'export interface Row { a: string }\ninterface Hidden { b: string }\nexport function f(r: Row): string { return r.a; }\nexport function h(x: Hidden) { return x.b; }\nexport function v() { return list; }\nexport const list: Row[] = [];\n';
	assert.match(text(split('src/t.ts', src, [{ file: 'f.ts', declarations: [2] }]), 0), /^import type \{ Row \} from '\.\/t\.js';$/m);
	assert.match(String(split('src/t.ts', src, [{ file: 'h.ts', declarations: [3] }])), /declaration 3 \(h\) uses Hidden \(1\), which stays/);
	assert.match(String(split('src/t.ts', src, [{ file: 'v.ts', declarations: [4] }])), /declaration 4 \(v\) uses list \(5\), which stays/);
	assert.match(String(split('src/t.ts', 'export interface I { a: 1 }\nexport { I as J };\n', [{ file: 'i.ts', declarations: [0] }])), /export list \(1\) names the type I/);
});

test('probe p3: a definition-time read must stay in order in one new file (const x = y before y would hit the temporal dead zone)', () => {
	const tdz = 'export const x = y;\nexport const y = 1;\n';
	assert.throws(() => run({ 'orig.mjs': tdz, 'main.mjs': "import './orig.mjs';\n" }, 'main.mjs'));
	assert.match(String(split('src/orig.mts', tdz, [{ file: 'n.mts', declarations: [0] }, { file: 'm.mts', declarations: [1] }])), /reads y \(1\) when it is defined; move both to the same file, y first/);
	assert.match(String(split('src/orig.mts', tdz, [{ file: 'n.mts', declarations: [0, 1] }])), /reads y \(1\) when it is defined, so y must come earlier/);
	assert.equal(typeof split('src/orig.mts', 'export const y = 1;\nexport const x = y;\n', [{ file: 'n.mts', declarations: [0, 1] }]), 'object');
});

test('copied imports keep as, type, default, namespace, attributes, quotes and semicolons; side-effect imports stay in the original', () => {
	const src = 'import D, { a as b, type T, c } from "./m.js"\nimport * as ns from "./ns.js"\nimport data from "./d.json" with { type: "json" }\nimport "./polyfill.js"\n\n'
		+ 'export function f(t: T) { return [D, b, ns.x, data, t]; }\nexport function g() { return c; }\n';
	const result = split('src/t.ts', src, [{ file: 'f.ts', declarations: [0] }]);
	assert.equal(text(result, 0), '// Split from t.ts by my_editor.\n\nimport D, { a as b, type T } from "./m.js"\nimport * as ns from "./ns.js"\n'
		+ 'import data from "./d.json" with { type: "json" }\n\nexport function f(t: T) { return [D, b, ns.x, data, t]; }\n');
	assert.equal(text(result), 'import { c } from "./m.js"\nimport "./ns.js"\nimport "./d.json" with { type: "json" }\nimport "./polyfill.js"\nexport { f } from "./f.js"\n\nexport function g() { return c; }\n');
});

test('probe p2: classic JSX copies the React import; automatic JSX does not', () => {
	const src = "import React from 'react';\nimport { useState } from 'react';\n\nexport function Counter() { const [n] = useState(0); return <b>{n}</b>; }\nexport function App() { return <Counter />; }\n";
	const classic = split('src/app.tsx', src, [{ file: 'counter.tsx', declarations: [0] }], { jsx: 'classic' });
	assert.match(text(classic, 0), /^import React from 'react';\nimport \{ useState \} from 'react';\n/m);
	assert.match(text(classic), /^import React from 'react';\nimport 'react';\nimport \{ Counter \} from '\.\/counter\.js';\nexport \{ Counter \} from '\.\/counter\.js';\n/);
	const automatic = split('src/app.tsx', src, [{ file: 'counter.tsx', declarations: [0] }], { jsx: 'automatic' });
	assert.doesNotMatch(text(automatic, 0), /import React/);
	assert.match(String(split('src/app.tsx', src.replace("import React from 'react';\n", ''), [{ file: 'counter.tsx', declarations: [0] }], { jsx: 'classic' })), /needs React in scope/);
});

test('the original keeps imports byte-identical unless a type specifier lost its last use or a value specifier its last value use', () => {
	const src = "import type { A, B } from './t.js';\nimport { a, type T } from './m.js';\nimport { type U } from './u.js';\nimport { Config } from './c.js';\n\n"
		+ 'export function moved(b: B, t: T, u: U, c: Config) { return [b, t, u, c]; }\nexport function stays(x: A, c: Config) { return [x, a, c]; }\n';
	const result = text(split('src/t.ts', src, [{ file: 'moved.ts', declarations: [0] }]));
	assert.match(result, /^import type \{ A \} from '\.\/t\.js';\nimport \{ a \} from '\.\/m\.js';\nimport \{ type U \} from '\.\/u\.js';\nimport \{ Config \} from '\.\/c\.js';\n/);
	const rejected = "import { a, b } from './m.js';\n\nexport function moved() { return a(); }\nexport function stays(x: typeof b) { return x; }\n";
	assert.match(String(split('src/t.ts', rejected, [{ file: 'moved.ts', declarations: [0] }])), /might no longer load it/);
	const still = "import { a } from './m.js';\n\nexport function moved() { return a(); }\nexport function stays(x: typeof a) { return x; }\n";
	assert.match(String(split('src/t.ts', still, [{ file: 'moved.ts', declarations: [0] }])), /still uses it as a type/);
});

test('probe p5: an import used only as a type stays in place, so modules still load in the same order', () => {
	const files = { 'package.json': '{"type":"module"}', 'config.ts': 'console.log("config loaded");\nexport class Config { x = 1 }\n', 'other.ts': 'console.log("other loaded");\n' };
	const orig = "import { Config } from './config.ts';\nimport './other.ts';\nexport function use(c: Config) { return c.x; }\n";
	const result = split('orig.ts', orig, [{ file: 'n.ts', declarations: [0] }]);
	assert.equal(text(result), "import { Config } from './config.ts';\nimport './other.ts';\nexport { use } from './n.ts';\n");
	if (process.features.typescript) {
		const main = "import { use } from './orig.ts';\nconsole.log(typeof use);\n";
		assert.equal(run({ ...files, 'orig.ts': text(result), 'n.ts': text(result, 0), 'main.ts': main }, 'main.ts'), 'config loaded\nother loaded\nfunction\n');
		assert.equal(run({ ...files, 'orig.ts': orig, 'main.ts': main }, 'main.ts'), 'config loaded\nother loaded\nfunction\n');
	}
});

test('a types-only move leaves the original\'s emitted JavaScript identical under both verbatimModuleSyntax and import elision', () => {
	const src = "import { type Shape, area } from './geo.js';\nimport type { Unit } from './units.js';\n\nexport interface Box { shape: Shape; unit: Unit }\nexport type Boxes = Box[];\n\n"
		+ 'export function total(boxes: Boxes): number { return boxes.reduce((n, b) => n + area(b.shape), 0); }\n';
	const result = split('src/box.ts', src, [{ file: 'boxes.ts', declarations: [0, 1] }], { scope: 'types' });
	assert.match(text(result), /^import \{ area \} from '\.\/geo\.js';\nimport type \{ Boxes \} from '\.\/boxes\.js';\nexport type \{ Box, Boxes \} from '\.\/boxes\.js';\n/);
	for (const verbatimModuleSyntax of [true, false]) {
		const emit = (code: string) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax } }).outputText;
		assert.equal(emit(text(result)), emit(src), `verbatimModuleSyntax: ${verbatimModuleSyntax}`);
	}
});

test('the facade: export default function re-exports as default and is imported by name; a file without imports gets it after use strict', () => {
	const src = "'use strict';\n\n/** Main. */\nexport default function main() { return 1; }\n\nexport const run = () => main();\n";
	const result = split('src/m.ts', src, [{ file: 'main-impl.ts', declarations: [0] }]);
	assert.equal(text(result), "'use strict';\n\nimport main from './main-impl.js';\nexport { default } from './main-impl.js';\n\nexport const run = () => main();\n");
});

test('specifiers copy the original\'s style: .js, .ts or none; .mts maps to .mjs and .cts to .cjs; no style or no resolution is refused', () => {
	const src = 'export function a() {}\nexport function b() { return a(); }\n';
	const plan = (file: string) => [{ file, declarations: [0] }];
	assert.match(text(split('src/x.ts', src, plan('a1.ts'), {}, 'ts')), /from '\.\/a1\.ts';/);
	assert.match(text(split('src/x.ts', src, plan('a1.ts'), {}, 'none')), /from '\.\/a1';/);
	assert.match(text(split('src/x.mts', src, plan('a1.mts'))), /from '\.\/a1\.mjs';/);
	assert.match(text(split('src/x.cts', 'export interface A {}\nexport type B = A;\n', plan('a1.cts'), { scope: 'types' })), /from '\.\/a1\.cjs';/);
	const info = tsInfo('src/x.ts', src);
	assert.throws(() => buildTsSplit(Buffer.from(src), { ...info, style: undefined }, plan('a1.ts'), { resolves: () => true }), /no relative import in the file or its folder/);
	assert.throws(() => buildTsSplit(Buffer.from(src), info, plan('a1.ts'), { resolves: () => false }), /'\.\/a1\.js' would not resolve to a1\.ts/);
});

test('staying code that reads a moved name when it is defined, before that name, is refused (a var would be read early)', () => {
	const src = 'export class S { static s = y; }\nexport var y = 1;\n';
	assert.equal(run({ 'orig.mjs': 'export class S { static s = y; }\nexport var y = 1;\nconsole.log(S.s);\n' }, 'orig.mjs'), 'undefined\n');
	assert.match(String(split('src/orig.ts', src, [{ file: 'n.ts', declarations: [1] }])), /stays and reads y \(1\) when it is defined, before y is defined now/);
	assert.equal(typeof split('src/orig.ts', 'export var y = 1;\nexport class S { static s = y; }\n', [{ file: 'n.ts', declarations: [0] }]), 'object');
});

test('a default-exported type is imported on its own type line', () => {
	const src = 'export default interface Row { a: string }\nexport interface Col { b: string }\nexport function f(r: Row, c: Col) { return [r, c]; }\n';
	assert.match(text(split('src/t.ts', src, [{ file: 'rows.ts', declarations: [0, 1] }])), /^import type Row from '\.\/rows\.js';\nimport type \{ Col \} from '\.\/rows\.js';\nexport type \{ default, Col \} from '\.\/rows\.js';\n/);
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `test/aiReadyTsSplit.test.ts(7,30): error TS2307: Cannot find module '../src/aiready/tsSplit' or its corresponding type declarations.`

- [ ] **Step 3: Implement.**

Create `src/aiready/tsSplit.ts`:

````ts
import * as path from 'path';
import type { SplitPlan, SplitResult } from './language';
import { keepBindings, TsImport } from './tsAst';
import type { TsDeclaration, TsFileInfo } from './tsRules';

/** What the pure split needs from the outside: whether a relative specifier from the original reaches a file in its folder. */
export interface SplitEnv {
	readonly resolves: (specifier: string, fileName: string) => boolean;
}

const JS_SUFFIX: Record<string, string> = { '.ts': '.js', '.tsx': '.js', '.mts': '.mjs', '.cts': '.cjs', '.js': '.js', '.jsx': '.js', '.mjs': '.mjs' };

/** The exact start of a new file: a comment naming the original, then a blank line so it is not attached to anything. */
export function tsSplitHeader(file: string): string {
	return `// Split from ${path.posix.basename(file)} by my_editor.\n\n`;
}

/** The relative specifier for a file in the original's folder, in the original's style (`.js`, `.ts` or none). */
export function specifierFor(info: TsFileInfo, fileName: string, quote: string): string {
	const ext = path.extname(info.path);
	const stem = fileName.slice(0, fileName.length - path.extname(fileName).length);
	const suffix = info.style === 'none' ? '' : info.style === 'ts' ? ext : JS_SUFFIX[ext] ?? ext;
	return `${quote}./${stem}${suffix}${quote}`;
}

function label(d: TsDeclaration): string {
	return `declaration ${d.id} (${d.names.join(', ') || d.kind})`;
}

interface Needs {
	/** Local names of the original's imports. */
	readonly imports: Set<string>;
	/** Per sibling plan index: names and whether any use is a value use. */
	readonly siblings: Map<number, Map<string, boolean>>;
	/** Exported types of the original used only as types. */
	readonly fromOriginal: Set<string>;
}

/**
 * Applies a TS/JS split plan without AI, or throws the reasons it cannot (the model gets them for its one retry). New
 * files: header, filtered copies of the original's imports plus sibling and type imports, then the moved spans byte
 * for byte. The original: its old bytes minus the moved spans, imports changed only as the load-order rules allow,
 * and a facade that re-exports what moved.
 */
export function buildTsSplit(source: Buffer, info: TsFileInfo, plan: SplitPlan, env: SplitEnv): SplitResult {
	const js = /\.[cm]?jsx?$/.test(info.path);
	const decls = info.declarations;
	const groupOf = new Map<number, number>();
	plan.forEach((group, i) => group.declarations.forEach(id => groupOf.set(id, i)));
	const owner = new Map<string, TsDeclaration>();
	for (const d of decls.filter(d => d.ts.kind !== 'export list' && d.ts.kind !== 'statement')) { d.names.forEach(name => owner.set(name, d)); }
	const locals = new Map(info.facts.imports.filter(imp => imp.kind !== 'export').flatMap(imp => imp.bindings.map(b => [b.local, imp] as const)));
	const listed = new Set(decls.flatMap(d => d.ts.listed));
	const problems: string[] = [];
	const needs: Needs[] = plan.map(() => ({ imports: new Set(), siblings: new Map(), fromOriginal: new Set() }));
	for (const d of decls.filter(d => groupOf.has(d.id))) {
		const i = groupOf.get(d.id)!;
		const uses: [string, boolean][] = [...d.ts.valueUses.map(n => [n, true] as [string, boolean]), ...(js ? [] : d.ts.typeUses.map(n => [n, false] as [string, boolean]))];
		for (const [name, value] of uses) {
			if (locals.has(name)) { needs[i].imports.add(name); continue; }
			const target = owner.get(name);
			if (!target) { continue; }
			const j = groupOf.get(target.id);
			const reads = d.ts.defReads.includes(name);
			if (j === i) {
				if (reads && target.id > d.id) { problems.push(`${label(d)} reads ${name} (${target.id}) when it is defined, so ${name} must come earlier in the file.`); }
			} else if (j !== undefined) {
				if (reads) { problems.push(`${label(d)} reads ${name} (${target.id}) when it is defined; move both to the same file, ${name} first.`); }
				else if (!target.ts.exported) { problems.push(`${label(d)} uses ${name} (${target.id}), which is not exported: a helper moves to the same file as every declaration that uses it.`); }
				else {
					const names = needs[i].siblings.get(j) ?? new Map<string, boolean>();
					names.set(name, (names.get(name) ?? false) || (value && target.ts.valueMeaning));
					needs[i].siblings.set(j, names);
				}
			} else if (!value && !js && (target.ts.exported || listed.has(name))) {
				needs[i].fromOriginal.add(name);
			} else {
				problems.push(`${label(d)} uses ${name} (${target.id}), which stays. Move it to the same file or leave both.`);
			}
		}
		if (d.ts.jsx && info.context.jsx === 'classic') {
			for (const root of info.jsxRoots) {
				if (locals.has(root)) { needs[i].imports.add(root); }
				else { problems.push(`${label(d)} has JSX, which needs ${root} in scope, but ${info.path} does not import it.`); }
			}
		}
	}
	const facade = plan.map(() => ({ uses: new Map<string, TsDeclaration>() }));
	const staying = decls.filter(d => !groupOf.has(d.id));
	for (const s of staying) {
		for (const name of [...s.ts.valueUses, ...s.ts.typeUses]) {
			const target = owner.get(name);
			const j = target && groupOf.get(target.id);
			if (!target || j === undefined) { continue; }
			if (!target.ts.exported) { problems.push(`${label(s)} stays and uses ${name} (${target.id}), which is not exported; moving it would add an export.`); }
			else if (s.ts.defReads.includes(name) && target.id > s.id) { problems.push(`${label(s)} stays and reads ${name} (${target.id}) when it is defined, before ${name} is defined now; it would see it early.`); }
			else if (s.ts.kind === 'export list' && !target.ts.valueMeaning) { problems.push(`The export list (${s.id}) names the type ${name}, which may not move.`); }
			else { facade[j].uses.set(name, target); }
		}
	}
	problems.push(...valueCycles(plan, needs));
	const quote = info.facts.imports[0]?.specifier[0] === '"' ? '"' : '\'';
	const semi = info.facts.imports.length && !info.facts.imports[0].text.trimEnd().endsWith(';') ? '' : ';';
	if (!info.style) { problems.push('There is no relative import in the file or its folder to copy the specifier style from.'); }
	else {
		for (const name of [...plan.map(g => g.file), ...(needs.some(n => n.fromOriginal.size) ? [path.posix.basename(info.path)] : [])]) {
			const spec = specifierFor(info, name, quote);
			if (!env.resolves(spec.slice(1, -1), name)) { problems.push(`${spec} would not resolve to ${name}.`); }
		}
	}
	const rewrites = originalImports(info, decls, groupOf, problems);
	if (problems.length) { throw new Error([...new Set(problems)].slice(0, 8).join(' ')); }
	const byId = new Map(decls.map(d => [d.id, d]));
	const files = plan.map((group, i) => {
		const lines = [
			...info.facts.imports.filter(imp => imp.kind !== 'export' && !imp.sideEffect).flatMap(imp => {
				const text = keepBindings(imp, needs[i].imports);
				return text === undefined ? [] : [text];
			}),
			...[...needs[i].siblings].sort(([a], [b]) => a - b).flatMap(([j, names]) => importLines(plan[j].file, names, owner, info, quote, semi, js)),
			...(needs[i].fromOriginal.size ? [`import type { ${[...needs[i].fromOriginal].join(', ')} } from ${specifierFor(info, path.posix.basename(info.path), quote)}${semi}`] : []),
		];
		const spans = group.declarations.map(id => byId.get(id)!).sort((a, b) => a.id - b.id).map(d => source.subarray(d.span.start, d.span.end).toString('utf8'));
		return { name: group.file, text: Buffer.from(`${tsSplitHeader(info.path)}${lines.length ? `${lines.join('\n')}\n\n` : ''}${spans.join('\n\n')}\n`) };
	});
	const facadeLines = plan.flatMap((group, j) => facadeFor(group.file, group.declarations.map(id => byId.get(id)!), facade[j].uses, info, quote, semi));
	return { original: rebuildOriginal(source, info, new Set(groupOf.keys()), rewrites, facadeLines), files };
}

/** Value imports between new files must not form a cycle; type-only ones may. */
function valueCycles(plan: SplitPlan, needs: readonly Needs[]): string[] {
	const edges = needs.map(n => [...n.siblings].filter(([, names]) => [...names.values()].some(Boolean)).map(([j]) => j));
	const state = new Array<number>(plan.length).fill(0);
	const visit = (i: number): boolean => {
		state[i] = 1;
		for (const j of edges[i]) { if (state[j] === 1 || (state[j] === 0 && visit(j))) { return true; } }
		state[i] = 2;
		return false;
	};
	return plan.some((_, i) => state[i] === 0 && visit(i)) ? ['Two new files would import values from each other (an import cycle); group those declarations together.'] : [];
}

/** A new file's imports from one sibling: values, then types (`import type`); plain JS has value imports only. */
function importLines(file: string, names: ReadonlyMap<string, boolean>, owner: ReadonlyMap<string, TsDeclaration>,
	info: TsFileInfo, quote: string, semi: string, js: boolean): string[] {
	const spec = specifierFor(info, file, quote);
	const values = [...names].filter(([, value]) => value || js).map(([name]) => name);
	const types = [...names].filter(([, value]) => !value && !js).map(([name]) => name);
	return [...bindingLine('import', values, owner, spec, semi), ...bindingLine('import type', types, owner, spec, semi)];
}

/** `import f, { a, b } from spec;` (or `import type`), with a moved default export imported by its own name. */
function bindingLine(keyword: string, names: readonly string[], owner: ReadonlyMap<string, TsDeclaration>, spec: string, semi: string): string[] {
	if (!names.length) { return []; }
	const def = names.find(name => owner.get(name)?.ts.isDefault);
	const named = names.filter(name => name !== def);
	// `import type D, { A }` is an error (TS1363), so a type-only default gets its own line.
	if (def && named.length && keyword === 'import type') { return [`${keyword} ${def} from ${spec}${semi}`, `${keyword} { ${named.join(', ')} } from ${spec}${semi}`]; }
	return [`${keyword} ${def ?? ''}${def && named.length ? ', ' : ''}${named.length ? `{ ${named.join(', ')} }` : ''} from ${spec}${semi}`];
}

/** The facade lines for one new file: imports for staying code, then value and type re-exports of what was exported. */
function facadeFor(file: string, moved: readonly TsDeclaration[], uses: ReadonlyMap<string, TsDeclaration>, info: TsFileInfo, quote: string, semi: string): string[] {
	const spec = specifierFor(info, file, quote);
	const owner = new Map(moved.flatMap(d => d.names.map(name => [name, d] as const)));
	const used = [...uses].sort(([, a], [, b]) => a.id - b.id).map(([name]) => name);
	const exported = [...moved].sort((a, b) => a.id - b.id).filter(d => d.ts.exported);
	const exportName = (d: TsDeclaration) => (d.ts.isDefault ? ['default'] : d.names);
	return [
		...bindingLine('import', used.filter(name => owner.get(name)?.ts.valueMeaning), owner, spec, semi),
		...bindingLine('import type', used.filter(name => !owner.get(name)?.ts.valueMeaning), owner, spec, semi),
		...(exported.some(d => d.ts.valueMeaning) ? [`export { ${exported.filter(d => d.ts.valueMeaning).flatMap(exportName).join(', ')} } from ${spec}${semi}`] : []),
		...(exported.some(d => !d.ts.valueMeaning) ? [`export type { ${exported.filter(d => !d.ts.valueMeaning).flatMap(exportName).join(', ')} } from ${spec}${semi}`] : []),
	];
}

/**
 * The original's import declarations after the move: unchanged, dropped (`import type` with no use left), filtered
 * (specifiers written as types with no use left, or whose last value use moved while another kept one still loads the
 * module), or turned into a side-effect import (the last value use of every specifier moved). Undefined means unchanged.
 */
function originalImports(info: TsFileInfo, decls: readonly TsDeclaration[], groupOf: ReadonlyMap<number, number>, problems: string[]): Map<TsImport, string | null> {
	const staying = decls.filter(d => !groupOf.has(d.id));
	const stayingValue = new Set(staying.flatMap(d => d.ts.valueUses));
	const stayingAny = new Set(staying.flatMap(d => [...d.ts.valueUses, ...d.ts.typeUses]));
	const everValue = new Set(decls.flatMap(d => d.ts.valueUses));
	const out = new Map<TsImport, string | null>();
	for (const imp of info.facts.imports) {
		if (imp.kind === 'export' || imp.sideEffect) { continue; }
		const drop = new Set<string>();
		let valueMoved = false;
		for (const b of imp.bindings) {
			const lostValue = everValue.has(b.local) && !stayingValue.has(b.local);
			if (stayingAny.has(b.local)) {
				if (lostValue && !b.typeOnly) { problems.push(`The last value use of ${b.local} (from ${imp.specifier}) moves, but staying code still uses it as a type, so ${imp.specifier} could stop loading in its place.`); }
				continue;
			}
			if (b.typeOnly) { drop.add(b.local); } else if (lostValue) { drop.add(b.local); valueMoved = true; }
		}
		if (!drop.size) { continue; }
		const keep = new Set(imp.bindings.filter(b => !drop.has(b.local)).map(b => b.local));
		if (imp.kind === 'equals') { problems.push(`${imp.text.trim()} would lose its last use; it is never rewritten.`); continue; }
		if (!keep.size) {
			if (imp.typeOnly) { out.set(imp, null); }
			else if (valueMoved) { out.set(imp, `import ${imp.pieces.suffix.replace(/^\s*from\s*/, '')}`); }
			continue;
		}
		if (valueMoved && ![...keep].some(name => stayingValue.has(name))) {
			problems.push(`The last value use of ${[...drop].join(', ')} (from ${imp.specifier}) moves, and the names left in that import might no longer load it; move their users too, or none.`);
			continue;
		}
		out.set(imp, keepBindings(imp, keep)!);
	}
	return out;
}

interface Line {
	text: Buffer;
	readonly start: number;
	readonly end: number;
	gap: boolean;
	facade?: boolean;
}

function rebuildOriginal(source: Buffer, info: TsFileInfo, moved: ReadonlySet<number>, rewrites: ReadonlyMap<TsImport, string | null>, facade: readonly string[]): Buffer {
	let lines = splitLines(source);
	const inside = (line: Line, start: number, end: number) => line.start >= start && line.end <= end;
	for (const d of info.declarations.filter(d => moved.has(d.id))) {
		for (const line of lines) { if (inside(line, d.span.start, d.span.end)) { line.gap = true; } }
	}
	for (const [imp, text] of rewrites) {
		const old = source.subarray(imp.span.start, imp.span.end).toString('utf8');
		const own = lines.filter(line => inside(line, imp.span.start, imp.span.end));
		lines = lines.filter(line => !own.includes(line) || line === own[0]);
		if (text === null) { lines = lines.filter(line => line !== own[0]); } else { own[0].text = Buffer.from(old.replace(imp.text, text)); }
	}
	if (facade.length) {
		const imports = info.facts.imports;
		const at = imports.length
			? lines.findIndex(line => line.start > imports[imports.length - 1].span.end)
			: lines.findIndex(line => line.start >= info.facts.bytes(info.facts.facadeAt));
		const added = facade.map(text => ({ text: Buffer.from(text), start: -1, end: -1, gap: false, facade: true }));
		lines.splice(at < 0 ? lines.length : at, 0, ...added);
	}
	const out = collapse(lines);
	const last = out.map(line => line.facade).lastIndexOf(true);
	if (last >= 0 && last + 1 < out.length && out[last + 1].text.toString('utf8').trim() !== '') {
		out.splice(last + 1, 0, { text: Buffer.alloc(0), start: -1, end: -1, gap: false });
	}
	const finalNewline = source.length > 0 && source[source.length - 1] === 10;
	const parts = out.flatMap((line, index) => (index ? [Buffer.from('\n'), line.text] : [line.text]));
	return Buffer.concat([...parts, ...(finalNewline && out.length ? [Buffer.from('\n')] : [])]);
}

/** Each run of blank lines and gaps holding a gap becomes one blank line if it held a blank line, else nothing; at the end, nothing. */
function collapse(lines: readonly Line[]): Line[] {
	const blank = (line: Line) => !line.gap && !line.facade && line.text.toString('utf8').trim() === '';
	const out: Line[] = [];
	for (let i = 0; i < lines.length;) {
		if (!lines[i].gap && !blank(lines[i])) { out.push(lines[i]); i++; continue; }
		let j = i;
		while (j < lines.length && (lines[j].gap || blank(lines[j]))) { j++; }
		const run = lines.slice(i, j);
		if (!run.some(line => line.gap)) { out.push(...run); }
		else if (run.some(blank) && j < lines.length) { out.push({ text: Buffer.alloc(0), start: -1, end: -1, gap: false }); }
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
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/tsRules.ts"
````

with:

````json
    "src/aiready/tsRules.ts",
    "src/aiready/tsSplit.ts"
````

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 245`, `ℹ fail 0`. The p5 case runs `node` on `.ts` files only when `process.features.typescript` is set (Node 22.10 and later).

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/tsSplit.ts test/aiReadyTsSplit.test.ts test/tsFixture.ts tsconfig.test.json
git commit -m "TS/JS adapter: apply a split with filtered imports and a facade"
```

## Chunk 6: The move check and the adapter

### Task 6: Unit program, move rules 2, 4 and 6, test output, the prompt and the adapter

**Files:**
- Create: `src/aiready/tsUnit.ts`, `src/aiready/tsMoveCheck.ts`, `src/aiready/tsTests.ts`, `src/aiready/tsPrompts.ts`, `src/aiready/tsAdapter.ts`, `test/aiReadyTsAdapter.test.ts`
- Modify: `tsconfig.test.json`

Rules 2 and 6 run on the files as written and re-parsed from disk. A binding target is a declaration in the unit (by its statement's bytes and its offset there), an import of a module outside the unit (by specifier and name), or a global; aliases into the unit are followed, so a name imported from a new file re-traces to the declaration it was before.

- [ ] **Step 1: Write the failing test.**

Create `test/aiReadyTsAdapter.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import type { SplitPlan } from '../src/aiready/language';
import { checkMove } from '../src/aiready/moveCheck';
import { createTsAdapter } from '../src/aiready/tsAdapter';
import type { TsFileInfo } from '../src/aiready/tsRules';
import { tsProject, workspaceLinkProblem } from '../src/aiready/tsProject';
import { parseTsTests } from '../src/aiready/tsTests';
import { ESM, project, ts } from './tsFixture';

const REPORT = `import { helper } from './util.js';

/** A row. */
export interface Row { name: string; size: number }

/** Parses one row. */
export function parseRow(line: string): Row {
	const [name, size] = line.split(',');
	return { name, size: Number(size) };
}

export function formatRow(row: Row): string {
	return \`\${row.name}: \${row.size}\`;
}

export class Store { rows: Row[] = []; }

export function report(lines: string[]): string {
	return lines.map(parseRow).map(formatRow).join(helper());
}
`;
const UTIL = "export function helper(): string { return '\\n'; }\n";

/** Splits a file of a temp project with the adapter, writes the result, and runs move rules 1–6 on what is on disk. */
async function splitIn(files: Record<string, string>, file: string, plan: SplitPlan) {
	const { root, tracked } = project(files);
	const adapter = createTsAdapter(root, ts, tracked);
	const info = await adapter.parse(file);
	const source = readFileSync(path.join(root, file));
	const unitBefore = await Promise.all((await adapter.unitFiles(file)).map(f => adapter.parse(f)));
	const result = adapter.buildSplit(source, info, plan);
	const names = result.files.map(f => `${path.posix.dirname(file)}/${f.name}`);
	const check = async (edit: { original?: (t: string) => string; first?: (t: string) => string } = {}) => {
		writeFileSync(path.join(root, file), edit.original ? edit.original(result.original.toString()) : result.original);
		result.files.forEach((f, i) => writeFileSync(path.join(root, names[i]), i === 0 && edit.first ? edit.first(f.text.toString()) : f.text));
		const read = async (name: string) => ({ text: readFileSync(path.join(root, name)), info: await adapter.parse(name) });
		const after = await read(file);
		const news = await Promise.all(names.map(read));
		const unitAfter = await Promise.all((await adapter.unitFiles(file)).map(f => adapter.parse(f)));
		return [...checkMove({ before: { text: source, info }, after, files: news, plan, header: adapter.splitHeader(file), importProblems: adapter.importProblems }),
			...adapter.sameDeclarations(unitBefore, unitAfter)];
	};
	return { check, result, adapter, info: info as TsFileInfo, root };
}

const FILES = { ...ESM, 'src/report.ts': REPORT, 'src/util.ts': UTIL };
const PLAN: SplitPlan = [{ file: 'rows.ts', declarations: [0, 1, 2] }];

test('the adapter parses with the project: unit, export surface, bindings, checks and the prompt', async () => {
	const { adapter, info } = await splitIn(FILES, 'src/report.ts', PLAN);
	assert.equal(info.skip, undefined);
	assert.deepEqual(await adapter.unitFiles('src/report.ts'), ['src/report.ts', 'src/util.ts']);
	assert.ok(info.surface?.some(entry => entry.startsWith('Store|vt|at:')));
	assert.ok(info.bindings?.length);
	assert.deepEqual(adapter.checks('src/report.ts').map(c => c.command), ['npx --no -- tsc --noEmit -p tsconfig.json --pretty false', 'npm test']);
	assert.deepEqual(adapter.setup?.().map(c => c.command), ['npm ci']);
	assert.deepEqual(adapter.fixes, ['split']);
	const prompt = adapter.splitPrompt(info, 22).text;
	assert.match(prompt, /"id":1,"kind":"export function","names":\["parseRow"\],"lines":5,"firstDocLine":"Parses one row\.","typeNeeds":\[0\]/);
	assert.match(prompt, /"id":4,"kind":"export function","names":\["report"\],"lines":3,"needs":\[1,2\]/);
	assert.match(prompt, /Files already in its folder: .*util\.ts/);
	assert.deepEqual(adapter.fileNameProblems('Util.ts', 'src/report.ts'), ['util.ts already uses the name Util, so an import of ./Util could resolve differently']);
});

test('the move check passes a clean split: byte-identical spans, the facade, the same exports and the same bindings', async () => {
	const { check } = await splitIn(FILES, 'src/report.ts', PLAN);
	assert.deepEqual(await check(), []);
});

test('the move check fails on an edited body, an added side-effect import, a foreign import or an added export in a new file', async () => {
	const { check } = await splitIn(FILES, 'src/report.ts', PLAN);
	assert.match((await check({ first: t => t.replace('Number(size)', 'Number(size) + 0') })).join(' '), /Rule 1/);
	assert.match((await check({ first: t => t.replace('by my_editor.\n\n', "by my_editor.\n\nimport './polyfill.js';\n") })).join(' '), /Rule 3: src\/rows\.ts has the side-effect import/);
	assert.match((await check({ first: t => t.replace('by my_editor.\n\n', "by my_editor.\n\nimport { x } from 'other';\n") })).join(' '), /not a filtered copy of an import of the original/);
	assert.match((await check({ first: t => `${t}\nexport { formatRow as fmt };\n` })).join(' '), /Rule [13]/);
});

test('the move check fails on a facade naming another file, a dropped export, a changed export meaning and a rebinding import (rule 6)', async () => {
	const { check } = await splitIn(FILES, 'src/report.ts', [{ file: 'rows.ts', declarations: [0, 1, 2, 3] }]);
	assert.deepEqual(await check(), []);
	assert.match((await check({ original: t => t.replace("export type { Row } from './rows.js';", "export type { Row } from './rows.js';\nexport { helper } from './util.js';") })).join(' '),
		/gained export \{ helper \} from '\.\/util\.js';/);
	assert.match((await check({ original: t => t.replace("export type { Row } from './rows.js';\n", '') })).join(' '), /Rule 4: src\/report\.ts no longer exports Row/);
	assert.match((await check({ original: t => t.replace("export { parseRow, formatRow, Store } from './rows.js';", "export { parseRow, formatRow } from './rows.js';\nexport type { Store } from './rows.js';") })).join(' '),
		/Rule 4: src\/report\.ts no longer exports Store the same way/);
	assert.match((await check({ original: t => t.replace("import { parseRow, formatRow } from './rows.js';", "import { formatRow as parseRow, formatRow } from './rows.js';") })).join(' '), /Rule 6: \d+ identifier bindings? differ/);
});

test('the move check fails when a tsconfig that lists the original does not list the new file', async () => {
	const files = { ...FILES, 'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', strict: true }, files: ['src/report.ts', 'src/util.ts'] }) };
	const { check } = await splitIn(files, 'src/report.ts', PLAN);
	assert.match((await check()).join(' '), /Rule 4: tsconfig\.json does not include src\/rows\.ts/);
});

test('test output: Jest and Vitest JSON, Mocha JSON and node --test TAP give per-test results keyed by file and path', () => {
	const roots = ['/w'];
	const jest = '> shop@1.0.0 test\n> jest --json\n\n{"numTotalTests":2,"testResults":[{"name":"/w/src/a.test.ts","status":"failed","assertionResults":['
		+ '{"ancestorTitles":["rows"],"title":"parses","status":"passed"},{"ancestorTitles":["rows"],"title":"fails","status":"failed"},{"ancestorTitles":[],"title":"later","status":"todo"}]}]}\n';
	assert.deepEqual(parseTsTests(jest, roots), {
		tests: { 'src/a.test.ts rows › parses': 'pass', 'src/a.test.ts rows › fails': 'fail', 'src/a.test.ts later': 'skip' }, packages: { 'src/a.test.ts': 'fail' },
	});
	const mocha = '{"stats":{},"tests":[{"title":"a","fullTitle":"g a","file":"/w/test/a.js"},{"title":"b","fullTitle":"g b","file":"/w/test/a.js"}],'
		+ '"passes":[{"title":"a","fullTitle":"g a","file":"/w/test/a.js"}],"failures":[{"title":"b","fullTitle":"g b","file":"/w/test/a.js"}],"pending":[]}';
	assert.deepEqual(parseTsTests(mocha, roots), { tests: { 'test/a.js g a': 'pass', 'test/a.js g b': 'fail' }, packages: { 'test/a.js': 'fail' } });
	const tap = 'TAP version 13\n# Subtest: top passes\nok 1 - top passes\n  ---\n  ...\n# Subtest: group\n    # Subtest: inner fails\n    not ok 1 - inner fails\n'
		+ '    # Subtest: inner ok\n    ok 2 - inner ok\n    1..2\nnot ok 2 - group\n# Subtest: skipped one\nok 3 - skipped one # SKIP\n';
	assert.deepEqual(parseTsTests(tap, roots), {
		tests: { 'node:test top passes': 'pass', 'node:test group › inner fails': 'fail', 'node:test group › inner ok': 'pass', 'node:test group': 'fail', 'node:test skipped one': 'skip' },
		packages: { 'node:test': 'fail' },
	});
	assert.deepEqual(parseTsTests('> build && jest\nPASS src/a.test.ts\n', roots), { tests: {}, packages: {} });
});

test('Prettier is asked only when it is installed and configured, and only about the given files', async () => {
	const { root, tracked } = project({ ...FILES, '.prettierrc': '{}' });
	const adapter = createTsAdapter(root, ts, tracked);
	assert.deepEqual(await adapter.unformatted(['src/report.ts']), []);
	mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
	const bin = path.join(root, 'node_modules', '.bin', 'prettier');
	writeFileSync(bin, `#!${process.execPath}\nconsole.log('Checking formatting...');\nfor (const f of process.argv.slice(3)) { if (f.includes('report')) { console.log('[warn] ' + f); } }\n`);
	chmodSync(bin, 0o755);
	assert.deepEqual(await adapter.unformatted(['src/report.ts', 'src/util.ts']), ['src/report.ts']);
	assert.deepEqual(await createTsAdapter(root, ts, tracked.filter(f => f !== '.prettierrc')).unformatted(['src/report.ts']), []);
});

test('after install, a workspace package linked from outside the working copy stops the run', () => {
	const { root, tracked } = project({ ...ESM, 'package.json': '{"name":"shop","workspaces":["packages/*"]}', 'packages/b/package.json': '{"name":"@shop/b"}' });
	mkdirSync(path.join(root, 'node_modules', '@shop'), { recursive: true });
	symlinkSync(path.join(root, 'packages', 'b'), path.join(root, 'node_modules', '@shop', 'b'));
	assert.equal(workspaceLinkProblem(tsProject(ts, root, tracked)), undefined);
	const outside = mkdtempSync(path.join(os.tmpdir(), 'my-editor-outside-'));
	const other = project({ ...ESM, 'package.json': '{"name":"shop","workspaces":["packages/*"]}', 'packages/b/package.json': '{"name":"@shop/b"}' });
	mkdirSync(path.join(other.root, 'node_modules', '@shop'), { recursive: true });
	symlinkSync(outside, path.join(other.root, 'node_modules', '@shop', 'b'));
	assert.match(workspaceLinkProblem(tsProject(ts, other.root, other.tracked)) ?? '', /@shop\/b resolves to .*outside the working copy/);
});

test('plain JS run as native ES modules (no tsconfig) moves function declarations only, checked by its tests', async () => {
	const { root, tracked } = project({ 'package.json': '{"type":"module","scripts":{"test":"node --test"}}', 'package-lock.json': '{}',
		'lib/a.js': "import { b } from './b.js';\n\nexport const c = 1;\nexport function f() { return b; }\n", 'lib/b.js': 'export const b = 2;\n' });
	const adapter = createTsAdapter(root, ts, tracked);
	const info = await adapter.parse('lib/a.js');
	assert.deepEqual(info.declarations.map(d => d.reason), ['only function declarations may move in plain JavaScript', undefined]);
	assert.deepEqual(adapter.checks('lib/a.js'), [{ label: 'test', command: 'npm test', verifies: true }]);
});

test('a namespace import of a module in the same folder binds to that module, and the split passes', async () => {
	const files = { ...ESM, 'src/report.ts': "import * as util from './util.js';\n\nexport function a() { return util.helper(); }\n\nexport function b() { return a(); }\n", 'src/util.ts': UTIL };
	const { check, info } = await splitIn(files, 'src/report.ts', [{ file: 'part.ts', declarations: [0] }]);
	assert.ok(info.bindings?.some(entry => entry.endsWith('|module:src/util.ts')));
	assert.deepEqual(await check(), []);
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `test/aiReadyTsAdapter.test.ts(8,33): error TS2307: Cannot find module '../src/aiready/tsAdapter' or its corresponding type declarations.`

- [ ] **Step 3: Implement.**

Create `src/aiready/tsUnit.ts`:

````ts
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import type * as TS from 'typescript';
import { statementSpans } from './tsAst';
import type { Ts } from './tsLoad';
import { identifiers, topStatement } from './tsRefs';

/** Same-folder modules a file imports (any import or re-export, type-only too), transitively; the file first. */
export function unitOf(ts: Ts, root: string, file: string, options: TS.CompilerOptions): string[] {
	const dir = path.posix.dirname(file);
	const unit = [file];
	for (let i = 0; i < unit.length; i++) {
		const abs = path.join(root, unit[i]);
		let text = '';
		try { text = readFileSync(abs, 'utf8'); } catch { continue; }
		const source = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, false);
		for (const node of source.statements) {
			const spec = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
				: ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) ? node.moduleReference.expression : undefined;
			if (!spec || !ts.isStringLiteralLike(spec) || !/^\.\.?\//.test(spec.text)) { continue; }
			const resolved = ts.resolveModuleName(spec.text, abs, options, ts.sys).resolvedModule?.resolvedFileName;
			const relative = resolved && existsSync(resolved) ? path.relative(root, resolved).split(path.sep).join('/') : undefined;
			if (relative && path.posix.dirname(relative) === dir && !unit.includes(relative) && !/\.d\.[cm]?ts$/.test(relative)) { unit.push(relative); }
		}
	}
	return unit;
}

/** What rules 4 and 6 compare for one file of a unit: its export surface and where every identifier binds. */
export interface UnitFacts {
	/** `name|meanings|target`, one per export of the module. */
	readonly surface: string[];
	/** `statement|offset|target`, one per identifier outside its import declarations. */
	readonly bindings: string[];
}

function hash(text: string): string {
	return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

/** The alias declaration's module specifier, if it imports or re-exports from a module. */
function specifierOf(ts: Ts, decl: TS.Declaration): TS.Expression | undefined {
	if (ts.isImportSpecifier(decl)) { return decl.parent.parent.parent.moduleSpecifier; }
	if (ts.isImportClause(decl)) { return decl.parent.moduleSpecifier; }
	if (ts.isNamespaceImport(decl)) { return decl.parent.parent.moduleSpecifier; }
	if (ts.isExportSpecifier(decl)) { return decl.parent.parent.moduleSpecifier; }
	if (ts.isNamespaceExport(decl)) { return decl.parent.moduleSpecifier; }
	if (ts.isImportEqualsDeclaration(decl) && ts.isExternalModuleReference(decl.moduleReference)) { return decl.moduleReference.expression; }
	return undefined;
}

function importedName(ts: Ts, decl: TS.Declaration): string {
	if (ts.isImportSpecifier(decl) || ts.isExportSpecifier(decl)) { return (decl.propertyName ?? decl.name).getText(); }
	if (ts.isImportClause(decl)) { return 'default'; }
	return '*';
}

function typeOnlyAlias(ts: Ts, decl: TS.Declaration): boolean {
	if (ts.isImportSpecifier(decl)) { return decl.isTypeOnly || decl.parent.parent.isTypeOnly; }
	if (ts.isExportSpecifier(decl)) { return decl.isTypeOnly || decl.parent.parent.isTypeOnly; }
	if (ts.isImportClause(decl)) { return decl.isTypeOnly; }
	if (ts.isNamespaceImport(decl)) { return decl.parent.isTypeOnly; }
	if (ts.isImportEqualsDeclaration(decl)) { return decl.isTypeOnly; }
	return false;
}

/**
 * Rule 4 and rule 6 facts for one file, from a program over its unit (the file plus the same-folder modules it
 * imports). A binding target is a declaration in the unit (by its statement's bytes and its offset there), an import
 * of a module outside the unit (by specifier and name), or a global. Aliases into the unit are followed, so a name
 * imported from a new file re-traces to the declaration it was before.
 */
export function unitFacts(ts: Ts, root: string, file: string, unit: readonly string[], options: TS.CompilerOptions): UnitFacts {
	const names = new Set(unit.map(f => path.resolve(root, f)));
	const host = ts.createCompilerHost(options);
	const read = host.getSourceFile.bind(host);
	host.getSourceFile = (name, version, onError, create) => (names.has(path.resolve(name)) ? read(name, version, onError, create) : undefined);
	const program = ts.createProgram({ rootNames: [...names], options, host });
	const checker = program.getTypeChecker();
	const spans = new Map<TS.SourceFile, Map<TS.Node, { start: number; end: number }>>();
	const where = (node: TS.Node) => {
		const source = node.getSourceFile();
		if (!spans.has(source)) { spans.set(source, statementSpans(ts, source)); }
		const statement = topStatement(ts, node);
		const span = spans.get(source)!.get(statement)!;
		return { key: hash(source.text.slice(span.start, span.end)), offset: node.getStart(source) - span.start };
	};
	const follow = (start: TS.Symbol): { target: string; typeOnly: boolean; symbol?: TS.Symbol } => {
		let symbol = start;
		let typeOnly = false;
		for (let i = 0; i < 32 && symbol.flags & ts.SymbolFlags.Alias; i++) {
			const decl = symbol.declarations?.[0];
			if (!decl) { break; }
			typeOnly ||= typeOnlyAlias(ts, decl);
			const spec = specifierOf(ts, decl);
			const module = spec && checker.getSymbolAtLocation(spec);
			const into = module?.declarations?.[0]?.getSourceFile();
			if (spec && (!into || !names.has(path.resolve(into.fileName)))) { return { target: `import:${spec.getText()}:${importedName(ts, decl)}`, typeOnly }; }
			const next = checker.getImmediateAliasedSymbol(symbol);
			if (!next || next === symbol) { return { target: `alias:${symbol.name}`, typeOnly }; }
			symbol = next;
		}
		const decl = symbol.declarations?.[0];
		if (!decl) { return { target: `symbol:${symbol.name}`, typeOnly, symbol }; }
		if (ts.isSourceFile(decl)) { return { target: `module:${path.relative(root, decl.fileName)}`, typeOnly, symbol }; }
		if (!names.has(path.resolve(decl.getSourceFile().fileName))) { return { target: `outside:${symbol.name}`, typeOnly, symbol }; }
		const at = where(decl);
		return { target: `at:${at.key}:${at.offset}`, typeOnly, symbol };
	};
	const source = program.getSourceFile(path.resolve(root, file));
	if (!source) { return { surface: [], bindings: [] }; }
	const moduleSymbol = checker.getSymbolAtLocation(source);
	const surface = (moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []).map(symbol => {
		const { target, typeOnly, symbol: final } = follow(symbol);
		const flags = final?.flags ?? 0;
		const meanings = `${flags & ts.SymbolFlags.Value && !typeOnly ? 'v' : ''}${flags & ts.SymbolFlags.Type ? 't' : ''}${flags & ts.SymbolFlags.Namespace ? 'n' : ''}`;
		return `${symbol.name}|${meanings}|${target}`;
	}).sort();
	const bindings: string[] = [];
	for (const statement of source.statements) {
		if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement) || (ts.isExportDeclaration(statement) && statement.moduleSpecifier)) { continue; }
		for (const id of identifiers(ts, statement)) {
			const parent = id.parent;
			const symbol = parent && ts.isShorthandPropertyAssignment(parent) && parent.name === id
				? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(id);
			const at = where(id);
			bindings.push(`${at.key}|${at.offset}|${symbol ? follow(symbol).target : `none:${id.text}`}`);
		}
	}
	return { surface, bindings };
}
````

Create `src/aiready/tsMoveCheck.ts`:

````ts
import * as path from 'path';
import type { FileInfo, ParsedFile } from './language';
import { declarationProblems } from './moveCheck';
import type { TsImport } from './tsAst';
import type { TsFileInfo } from './tsRules';

const stem = (name: string) => path.posix.basename(name).replace(/\.[^.]+$/, '');

/** The new file (or the original) a relative specifier names, by stem, among files in the original's folder. */
function target(imp: TsImport, files: readonly string[]): string | undefined {
	if (!/^\.\/[^/]+$/.test(imp.module)) { return undefined; }
	const name = imp.module.slice(2).replace(/\.[cm]?[jt]sx?$/, '');
	return files.find(file => stem(file) === name);
}

/** Names a file exports by its own `export` keyword (`default` for a default export). */
function ownExports(info: TsFileInfo): string[] {
	return info.declarations.filter(d => d.ts.exported).flatMap(d => (d.ts.isDefault ? ['default'] : d.names));
}

function usedNames(info: TsFileInfo, values: boolean): Set<string> {
	return new Set(info.declarations.flatMap(d => (values ? d.ts.valueUses : [...d.ts.valueUses, ...d.ts.typeUses])));
}

/**
 * Move rule 2's import part for TS/JS. The original: every old import declaration is unchanged, lost only specifiers
 * written as types that nothing left uses (never all of them unless it is `import type`) or specifiers whose last value
 * use moved, or became a side-effect import of the same module; after them only the facade, which names only the
 * plan's new files and only what they export. A new file: only filtered copies of the original's imports, imports of
 * sibling new files, and `import type` from the original.
 */
export function tsImportProblems(before: ParsedFile, after: ParsedFile, files: readonly ParsedFile[]): string[] {
	const was = before.info as TsFileInfo;
	const now = after.info as TsFileInfo;
	const news = files.map(f => f.info as TsFileInfo);
	const newNames = news.map(info => info.path);
	const problems: string[] = [];
	const everValue = usedNames(was, true);
	const stayingValue = usedNames(now, true);
	const stayingAny = usedNames(now, false);
	const old = was.facts.imports;
	const current = now.facts.imports;
	let at = 0;
	for (const imp of old) {
		const found = current[at];
		if (found && found.text === imp.text) { at++; continue; }
		if (found && found.specifier === imp.specifier && found.kind === imp.kind && imp.kind === 'import') {
			if (found.sideEffect && !imp.typeOnly && imp.bindings.every(b => !stayingAny.has(b.local) && (b.typeOnly || everValue.has(b.local)))
				&& imp.bindings.some(b => !b.typeOnly)) { at++; continue; }
			const kept = found.bindings.map(b => b.text);
			const dropped = imp.bindings.filter(b => !kept.includes(b.text));
			const allowed = found.typeOnly === imp.typeOnly && kept.every(text => imp.bindings.some(b => b.text === text)) && dropped.every(b =>
				!stayingAny.has(b.local) && (b.typeOnly || (everValue.has(b.local) && found.bindings.some(k => stayingValue.has(k.local)))));
			if (allowed && kept.length) { at++; continue; }
		}
		if (imp.typeOnly && imp.bindings.every(b => !stayingAny.has(b.local))) { continue; }
		problems.push(`Rule 2: the import ${imp.text.trim().split('\n')[0]} changed beyond what the move allows.`);
		if (found && found.specifier === imp.specifier) { at++; }
	}
	for (const imp of current.slice(at)) {
		const file = target(imp, newNames);
		const info = news.find(n => n.path === file);
		if (!info || imp.sideEffect || imp.star || imp.bindings.some(b => b.imported === '*')) {
			problems.push(`Rule 2: ${now.path} gained ${imp.text.trim()}, which is not part of the facade.`);
			continue;
		}
		const exported = ownExports(info);
		const missing = imp.bindings.filter(b => !exported.includes(b.imported));
		if (missing.length) { problems.push(`Rule 2: the facade names ${missing.map(b => b.imported).join(', ')}, which ${info.path} does not export.`); }
	}
	for (const [index, info] of news.entries()) {
		for (const imp of info.facts.imports) {
			const where = `Rule 3: ${info.path}`;
			if (imp.sideEffect) { problems.push(`${where} has the side-effect import ${imp.text.trim()}.`); continue; }
			if (imp.kind === 'export') { problems.push(`${where} re-exports with ${imp.text.trim()}.`); continue; }
			const sibling = target(imp, newNames.filter((_, i) => i !== index));
			if (sibling) {
				const exported = ownExports(news.find(n => n.path === sibling)!);
				if (imp.bindings.some(b => !exported.includes(b.imported))) { problems.push(`${where} imports from ${sibling} a name it does not export.`); }
				continue;
			}
			if (target(imp, [now.path])) {
				const exported = [...ownExports(now), ...now.declarations.flatMap(d => d.ts.listed)];
				if (!imp.bindings.every(b => imp.typeOnly || b.typeOnly) || imp.bindings.some(b => !exported.includes(b.imported))) {
					problems.push(`${where} imports ${imp.text.trim()} from the original, which must be \`import type\` of names it exports.`);
				}
				continue;
			}
			const copy = old.find(o => o.specifier === imp.specifier && o.kind === imp.kind && o.typeOnly === imp.typeOnly && !o.sideEffect
				&& imp.bindings.every(b => o.bindings.some(ob => ob.text === b.text)));
			if (!copy) { problems.push(`${where} imports ${imp.text.trim()}, which is not a filtered copy of an import of the original.`); }
		}
	}
	return problems;
}

/**
 * Move rule 4 and rule 6 for TS/JS: the same declarations (kind with its `export` keyword, names, doc) across the
 * unit; the original's export surface the same (names, meanings, and the declaration each resolves to); each new file
 * exporting only what its spans export by their own keyword; and every identifier binding the same way.
 */
export function tsSameDeclarations(before: readonly FileInfo[], after: readonly FileInfo[]): string[] {
	const was = before as readonly TsFileInfo[];
	const now = after as readonly TsFileInfo[];
	const problems = declarationProblems(before, after);
	const surface = (info: TsFileInfo | undefined) => new Set(info?.surface ?? []);
	const old = surface(was[0]);
	const current = surface(now[0]);
	for (const entry of old) { if (!current.has(entry)) { problems.push(`Rule 4: ${was[0].path} no longer exports ${entry.split('|')[0]} the same way (${entry}).`); } }
	for (const entry of current) { if (!old.has(entry)) { problems.push(`Rule 4: ${was[0].path} now exports ${entry.split('|')[0]} differently (${entry}).`); } }
	for (const info of now.filter(n => !was.some(w => w.path === n.path))) {
		const own = ownExports(info).sort().join(', ');
		const actual = [...surface(info)].map(entry => entry.split('|')[0]).sort().join(', ');
		if (own !== actual) { problems.push(`Rule 4: ${info.path} exports ${actual || 'nothing'}, but its declarations export ${own || 'nothing'}.`); }
	}
	const count = (infos: readonly TsFileInfo[]) => {
		const counts = new Map<string, number>();
		for (const entry of infos.flatMap(info => info.bindings ?? [])) { counts.set(entry, (counts.get(entry) ?? 0) + 1); }
		return counts;
	};
	const a = count(was);
	const b = count(now);
	const changed = [...new Set([...a.keys(), ...b.keys()])].filter(key => (a.get(key) ?? 0) !== (b.get(key) ?? 0));
	if (changed.length) { problems.push(`Rule 6: ${changed.length} identifier binding${changed.length === 1 ? '' : 's'} differ after the move (${changed[0].split('|')[2]}).`); }
	return problems;
}
````

Create `src/aiready/tsTests.ts`:

````ts
import type { Outcome, TestRun } from './baseline';

interface JestFile {
	readonly name?: string;
	readonly testFilePath?: string;
	readonly status?: string;
	readonly assertionResults?: readonly { readonly ancestorTitles?: readonly string[]; readonly title?: string; readonly status?: string }[];
}

interface MochaTest {
	readonly fullTitle?: string;
	readonly title?: string;
	readonly file?: string;
}

const OUTCOME: Record<string, Outcome> = { passed: 'pass', failed: 'fail', pending: 'skip', skipped: 'skip', todo: 'skip', disabled: 'skip' };

/** A test file's path relative to the project (the worktree's absolute prefix removed), with no spaces. */
function relative(file: string, roots: readonly string[]): string {
	const root = roots.find(r => file.startsWith(`${r}/`));
	return (root ? file.slice(root.length + 1) : file).replace(/\s/g, '_');
}

/** The JSON report in a test command's output (npm prints its own lines first), or undefined. */
function jsonReport(output: string): unknown {
	const end = output.lastIndexOf('}');
	for (let start = output.indexOf('{'); start >= 0 && start < end; start = output.indexOf('{', start + 1)) {
		if (start > 0 && output[start - 1] !== '\n') { continue; }
		try { return JSON.parse(output.slice(start, end + 1)); } catch { /* Not the report; try the next line. */ }
	}
	return undefined;
}

/** `node --test` TAP: `# Subtest:` lines give the path of nested tests; `ok`/`not ok` lines their outcome. */
function parseTap(output: string): TestRun {
	const tests: Record<string, Outcome> = {};
	const stack: string[] = [];
	let failed = false;
	for (const line of output.split('\n')) {
		const subtest = /^(\s*)# Subtest: (.*)$/.exec(line);
		if (subtest) { stack.length = subtest[1].length / 4; stack.push(subtest[2]); continue; }
		const result = /^(\s*)(not ok|ok) \d+ - (.*?)(?:\s+#\s+(SKIP|TODO)\b.*)?$/.exec(line);
		if (!result) { continue; }
		const level = result[1].length / 4;
		const name = [...stack.slice(0, level), result[3].replace(/\\#/g, '#')].join(' › ');
		let key = `node:test ${name}`;
		for (let n = 2; key in tests; n++) { key = `node:test ${name} #${n}`; }
		const outcome: Outcome = result[4] ? 'skip' : result[2] === 'ok' ? 'pass' : 'fail';
		failed ||= outcome === 'fail';
		tests[key] = outcome;
	}
	return { tests, packages: Object.keys(tests).length ? { 'node:test': failed ? 'fail' : 'pass' } : {} };
}

/**
 * Per-test outcomes from a TS/JS test command: Jest or Vitest `--json` reports, Mocha's JSON reporter, or `node --test`
 * TAP. Keys are `<test file> <describe › test>` (`node:test <path>` for TAP). Anything else gives no tests, so the run
 * is compared by exit code.
 */
export function parseTsTests(output: string, roots: readonly string[]): TestRun {
	const report = jsonReport(output) as { testResults?: readonly JestFile[]; tests?: readonly MochaTest[]; passes?: readonly MochaTest[]; failures?: readonly MochaTest[] } | undefined;
	const tests: Record<string, Outcome> = {};
	const packages: Record<string, Outcome> = {};
	if (report?.testResults) {
		for (const file of report.testResults) {
			const name = relative(file.name ?? file.testFilePath ?? 'unknown', roots);
			packages[name] = file.status === 'failed' ? 'fail' : 'pass';
			for (const result of file.assertionResults ?? []) {
				tests[`${name} ${[...(result.ancestorTitles ?? []), result.title ?? ''].join(' › ')}`] = OUTCOME[result.status ?? ''] ?? 'fail';
			}
		}
		return { tests, packages };
	}
	if (report?.tests) {
		const key = (test: MochaTest) => `${relative(test.file ?? 'unknown', roots)} ${test.fullTitle ?? test.title ?? ''}`;
		const passed = new Set((report.passes ?? []).map(key));
		const failedKeys = new Set((report.failures ?? []).map(key));
		for (const test of report.tests) {
			const k = key(test);
			tests[k] = failedKeys.has(k) ? 'fail' : passed.has(k) ? 'pass' : 'skip';
			const file = k.slice(0, k.indexOf(' '));
			packages[file] = packages[file] === 'fail' || tests[k] === 'fail' ? 'fail' : 'pass';
		}
		return { tests, packages };
	}
	return /^\s*(not ok|ok) \d+ - /m.test(output) ? parseTap(output) : { tests, packages };
}
````

Create `src/aiready/tsPrompts.ts`:

````ts
import * as path from 'path';
import type { Prompt } from './language';
import type { TsFileInfo } from './tsRules';

const SPLIT_SYSTEM = `You plan how to split one long TypeScript or JavaScript file into focused files in the same folder.
The host moves whole top-level declarations byte for byte, writes every import itself and leaves re-exports in the original, so no caller changes; you only choose groups.
Rules:
- Refer to declarations only by their numeric "id". Never move one marked "movable": false.
- "needs" lists the ids a declaration uses as values, "typeNeeds" the ids it uses only as types. Put a declaration in the same new file as every non-exported id it needs, and as every id it reads when defined ("readsWhenDefined", which must also come first).
- A declaration may use an exported id that moves to another new file, but two new files must not use each other's values. It may not use an id that stays in the original, except an exported type through "typeNeeds".
- Code that stays may only use moved declarations that are exported.
- Every new file and the original must end up at 400 lines or fewer. Leave the declarations that belong to the original's main job in it.
- New file names: the original's extension; letters, digits, dots, dashes and underscores; not index, not a test, story or config name, and not the name (ignoring the extension) of a file or folder already in the folder. Follow the folder's naming style.
Reply with only a JSON array, for example: [{"file":"rows.ts","declarations":[3,7]}]`;

/** The model's input for a TS/JS split plan: declarations by ID with what they need, and the folder's file names. */
export function tsSplitPrompt(info: TsFileInfo, totalLines: number, folder: readonly string[]): Prompt {
	const owner = new Map<string, number>();
	for (const d of info.declarations.filter(d => d.ts.kind !== 'export list' && d.ts.kind !== 'statement')) { d.names.forEach(name => owner.set(name, d.id)); }
	const ids = (names: readonly string[], self: number) => [...new Set(names.flatMap(name => (owner.has(name) && owner.get(name) !== self ? [owner.get(name)!] : [])))];
	const declarations = info.declarations.map(d => {
		const needs = ids(d.ts.valueUses, d.id);
		const typeNeeds = ids(d.ts.typeUses, d.id).filter(id => !needs.includes(id));
		const reads = ids(d.ts.defReads, d.id);
		return {
			id: d.id, kind: d.kind, names: d.names, lines: d.lines, ...(d.doc ? { firstDocLine: d.doc } : {}),
			...(needs.length ? { needs } : {}), ...(typeNeeds.length ? { typeNeeds } : {}), ...(reads.length ? { readsWhenDefined: reads } : {}),
			...(d.movable ? {} : { movable: false, reason: d.reason }),
		};
	});
	return {
		system: SPLIT_SYSTEM,
		text: `File: ${info.path} (${totalLines} lines)\nFiles already in its folder: ${folder.join(', ')}\n`
			+ `Declarations:\n${declarations.map(d => JSON.stringify(d)).join('\n')}\n\n`
			+ `Plan new files so ${path.posix.basename(info.path)} and every new file are at most 400 lines.`,
	};
}

/** Adding tests for TS/JS is a later plan; the adapter offers splits only, so this prompt is never sent. */
export function tsTestPrompt(file: string): Prompt {
	return { system: 'Adding TypeScript and JavaScript tests is not available yet.', text: file };
}
````

Create `src/aiready/tsAdapter.ts`:

````ts
import { existsSync, readdirSync, readFileSync, realpathSync } from 'fs';
import * as path from 'path';
import type { FileInfo, LanguageAdapter } from './language';
import { runTool } from './projectCommands';
import { tsFileFacts } from './tsAst';
import { analysisOptions, builds, holder, jsxMode, jsxRoots, readConfigs, TsConfig } from './tsConfig';
import { cyclicFiles } from './tsGraph';
import type { Ts } from './tsLoad';
import { tsImportProblems, tsSameDeclarations } from './tsMoveCheck';
import { checkCommands, commandEnv, fileScope, nearestPackage, PackageJson, scopeReason, setupCommands, TsProject, tsProject, workspaceLinkProblem } from './tsProject';
import { tsSplitPrompt, tsTestPrompt } from './tsPrompts';
import { specifierStyle, TsFileContext, TsFileInfo, tsFileInfoView, tsFileNameProblems, tsSkipReason } from './tsRules';
import { findsFolder, frameworkFolder, globRegExp, PathFinder, pathFinders } from './tsScan';
import { buildTsSplit, tsSplitHeader } from './tsSplit';
import { parseTsTests } from './tsTests';
import { unitFacts, unitOf } from './tsUnit';

const CODE = /\.(?:[cm]?[jt]sx?)$/;

/** Whether the nearest package.json marks a file side-effect-free (`false`, or a list that does not match it). */
function sideEffectFree(found: { dir: string; pkg: PackageJson } | undefined, file: string): boolean {
	const flag = found?.pkg.sideEffects;
	if (flag === false) { return true; }
	if (!Array.isArray(flag)) { return false; }
	const relative = found!.dir === '.' ? file : file.slice(found!.dir.length + 1);
	return !flag.some(glob => globRegExp(glob.replace(/^\.\//, '').includes('/') ? glob.replace(/^\.\//, '') : `**/${glob}`).test(relative));
}

function hasWildcard(exports: unknown): boolean {
	if (!exports || typeof exports !== 'object') { return false; }
	return Object.entries(exports as Record<string, unknown>).some(([key, value]) => key.includes('*') || hasWildcard(value));
}

/** Files a `.gitattributes` marks `linguist-generated`. */
function generatedPatterns(root: string, tracked: readonly string[]): RegExp[] {
	return tracked.filter(file => file.endsWith('.gitattributes')).flatMap(file => {
		const dir = path.posix.dirname(file);
		let text = '';
		try { text = readFileSync(path.join(root, file), 'utf8'); } catch { return []; }
		return text.split('\n').filter(line => /\blinguist-generated(?!=false)\b/.test(line) && !/-linguist-generated/.test(line)).map(line => {
			const pattern = line.trim().split(/\s+/)[0].replace(/^\//, '');
			return globRegExp(`${dir === '.' ? '' : `${dir}/`}${pattern.includes('/') ? pattern : `**/${pattern}`}`);
		});
	});
}

/** The relative-import style of the original, else of its siblings when they all agree. */
function styleOf(root: string, file: string, own: ReturnType<typeof specifierStyle>, tracked: readonly string[]): TsFileInfo['style'] {
	if (own && own !== 'mixed') { return own; }
	if (own === 'mixed') { return undefined; }
	const dir = path.posix.dirname(file);
	const styles = new Set<string>();
	for (const sibling of tracked.filter(f => f !== file && path.posix.dirname(f) === dir && CODE.test(f))) {
		let text = '';
		try { text = readFileSync(path.join(root, sibling), 'utf8'); } catch { continue; }
		for (const match of text.matchAll(/\bfrom\s+['"](\.\.?\/[^'"]+)['"]/g)) {
			const ext = path.extname(match[1]);
			styles.add(/^\.[cm]?jsx?$/.test(ext) ? 'js' : /^\.[cm]?tsx?$/.test(ext) ? 'ts' : ext === '' ? 'none' : 'other');
		}
	}
	styles.delete('other');
	return styles.size === 1 ? [...styles][0] as TsFileInfo['style'] : undefined;
}

/**
 * The TypeScript and JavaScript language adapter for one root (the user's folder for the picker, the worktree for
 * fixes). All analysis runs here with the editor's TypeScript `ts`; the model only proposes groups of declaration IDs.
 */
export function createTsAdapter(root: string, ts: Ts, tracked: readonly string[]): LanguageAdapter {
	let project: TsProject | undefined;
	let cyclic: Set<string> | undefined;
	let finders: PathFinder[] | undefined;
	let generated: RegExp[] | undefined;
	const facts = () => (project ??= tsProject(ts, root, tracked));
	/** The tsconfig for a file; a new file uses the one that holds a sibling in its folder. */
	const nearest = (file: string) => holder(builds(facts().configs, file), file);
	const configFor = (file: string): TsConfig | undefined => nearest(file)
		?? facts().tracked.filter(f => path.posix.dirname(f) === path.posix.dirname(file)).map(nearest).find(Boolean);
	const optionsFor = (file: string) => analysisOptions(ts, configFor(file)?.options);
	const context = (file: string): TsFileContext => {
		const p = facts();
		const scoped = fileScope(ts, p, file);
		const config = configFor(file);
		const dir = path.posix.dirname(file);
		cyclic ??= cyclicFiles(ts, p);
		finders ??= pathFinders(p);
		generated ??= generatedPatterns(root, tracked);
		const finder = finders.find(f => f.file !== file && findsFolder(f, dir, [file, `${dir}/zzprobe${path.extname(file)}`]));
		const pkg = nearestPackage(p, file);
		return {
			scope: 'skip' in scoped ? { skip: scoped.skip } : scoped.scope, scopeReason: scopeReason(ts, p, file),
			jsx: config ? jsxMode(ts, config.options) : 'other', emitDecoratorMetadata: !!config?.options.emitDecoratorMetadata, cyclic: cyclic.has(file),
			foundByPath: frameworkFolder(p, file) ?? (finder ? `${finder.file} finds files in ${dir === '.' ? 'the top folder' : `${dir}/`} by a path string` : undefined),
			sideEffectFree: sideEffectFree(pkg, file), exportsWildcard: hasWildcard(pkg?.pkg.exports),
			listedInFiles: !!pkg?.pkg.files?.some(entry => path.posix.normalize(path.posix.join(pkg.dir, entry)) === file),
			generatedAttribute: generated.some(re => re.test(file)),
		};
	};
	const roots = [root, ...(existsSync(root) ? [realpathSync(root)] : [])];
	const entries = (file: string) => { try { return readdirSync(path.join(root, path.posix.dirname(file))); } catch { return []; } };
	return {
		id: 'ts',
		label: 'TypeScript/JavaScript',
		extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs'],
		fixes: ['split'],
		get commandEnv() { return commandEnv(facts()); },
		async parse(file) {
			const text = readFileSync(path.join(root, file), 'utf8');
			const options = optionsFor(file);
			const fileFacts = tsFileFacts(ts, file, text, options);
			const ctx = context(file);
			const skip = facts().tracked.includes(file) ? tsSkipReason(file, text, fileFacts, ctx) : undefined;
			const info = tsFileInfoView(file, fileFacts, ctx, skip, styleOf(root, file, specifierStyle(fileFacts), tracked), jsxRoots(configFor(file)?.options));
			return skip ? info : { ...info, ...unitFacts(ts, root, file, unitOf(ts, root, file, options), options) } as FileInfo;
		},
		fileNameProblems: (name, original) => tsFileNameProblems(name, original, entries(original), facts().testGlobs),
		splitHeader: tsSplitHeader,
		buildSplit(source, info, plan) {
			const dir = path.join(root, path.posix.dirname(info.path));
			const planned = new Set(plan.map(group => path.join(dir, group.file)));
			const host = { ...ts.sys, fileExists: (name: string) => planned.has(path.resolve(name)) || ts.sys.fileExists(name) };
			const resolves = (specifier: string, fileName: string) =>
				ts.resolveModuleName(specifier, path.join(root, info.path), optionsFor(info.path), host).resolvedModule?.resolvedFileName === path.join(dir, fileName);
			return buildTsSplit(source, info as TsFileInfo, plan, { resolves });
		},
		sameDeclarations(before, after) {
			const original = before[0].path;
			const added = after.filter(a => !before.some(b => b.path === a.path)).map(a => a.path);
			const configs = readConfigs(ts, root, facts().tracked);
			const membership = configs.flatMap(config => added.filter(file => config.files.has(file) !== config.files.has(original))
				.map(file => `Rule 4: ${config.path} ${config.files.has(original) ? 'does not include' : 'now includes'} ${file}.`));
			return [...tsSameDeclarations(before, after), ...membership];
		},
		unitFiles: async file => unitOf(ts, root, file, optionsFor(file)),
		async unformatted(files) {
			const bin = path.join(root, 'node_modules', '.bin', 'prettier');
			const configured = facts().tracked.some(f => /^(\.prettierrc[^/]*|prettier\.config\.\w+)$/.test(f)) || !!facts().packages.get('.')?.prettier;
			if (!files.length || !configured || !existsSync(bin)) { return []; }
			const result = await runTool(bin, ['--check', ...files], root);
			return `${result.stdout}\n${result.stderr}`.split('\n').map(line => /^\[warn\] (.+)$/.exec(line.trim())?.[1] ?? '')
				.filter(name => files.includes(name));
		},
		checks: file => checkCommands(ts, facts(), file),
		setup: () => setupCommands(facts()),
		ready: () => workspaceLinkProblem(facts()),
		importProblems: tsImportProblems,
		parseTests: output => parseTsTests(output, roots),
		testFileName: file => file.replace(/(\.[cm]?[jt]sx?)$/, '.ai.test$1'),
		testNames: () => [],
		testProblems: () => ['adding TypeScript and JavaScript tests comes in a later version'],
		splitPrompt: (info, lines) => tsSplitPrompt(info as TsFileInfo, lines, entries(info.path)),
		testPrompt: file => tsTestPrompt(file),
	};
}
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/tsSplit.ts"
````

with:

````json
    "src/aiready/tsSplit.ts",
    "src/aiready/tsUnit.ts",
    "src/aiready/tsMoveCheck.ts",
    "src/aiready/tsTests.ts",
    "src/aiready/tsPrompts.ts",
    "src/aiready/tsAdapter.ts"
````

- [ ] **Step 4: Run the tests with both TypeScripts.** `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 255`, `ℹ fail 0`; `MY_EDITOR_TS=/Applications/my_editor.app/Contents/Resources/app/extensions/node_modules/typescript node --test out-test/test/aiReadyTs*.test.js 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 55`, `ℹ fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/tsUnit.ts src/aiready/tsMoveCheck.ts src/aiready/tsTests.ts src/aiready/tsPrompts.ts src/aiready/tsAdapter.ts test/aiReadyTsAdapter.test.ts tsconfig.test.json
git commit -m "TS/JS adapter: move check rules 2, 4 and 6, test output and the adapter"
```

## Chunk 7: Wiring, a dry run on fixture projects, and verification

### Task 7: Register the adapter, install before the baseline, and pass the import check

**Files:**
- Modify: `src/aiready/languages.ts`, `src/aiready/fixSetup.ts`, `src/aiready/fixRun.ts`, `src/aiready/healthRun.ts`, `src/aiready/steps.ts`
- Create: `test/aiReadyTsSteps.test.ts`

The step test runs the real pipeline on a temporary Git repository and worktree: `npx --no -- tsc` and `npm test` (`node --test` on `tsc` output) against a baseline recorded twice, one split committed, one plan refused, the user's folder untouched. It links the extension's `node_modules` into the worktree instead of running `npm ci`, so it needs no network.

- [ ] **Step 1: Write the failing test.**

Create `test/aiReadyTsSteps.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CheckResult, failureLines } from '../src/aiready/baseline';
import { adapterFor, fixableFinding } from '../src/aiready/languages';
import { runCommand, tail } from '../src/aiready/projectCommands';
import { runSplit, StepContext } from '../src/aiready/steps';
import { createTsAdapter } from '../src/aiready/tsAdapter';
import { lockfileProblem } from '../src/aiready/tsProject';
import { prepare, trackedFiles } from '../src/aiready/worktree';
import { project, ts, TS_DIR } from './tsFixture';

const SHOP = `import { helper } from './util.js';

/** A row. */
export interface Row { name: string; size: number }

/** Parses one row. */
export function parseRow(line: string): Row {
	const [name, size] = line.split(',');
	return { name, size: Number(size) };
}

export function formatRow(row: Row): string {
	return \`\${row.name}: \${row.size}\`;
}

export function report(lines: string[]): string {
	return lines.map(parseRow).map(formatRow).join(helper());
}
`;
const TEST = `import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { report, parseRow } from '../src/shop.js';

test('report formats rows', () => { assert.equal(report(['a,1', 'b,2']), 'a: 1\\nb: 2'); });
test('parseRow reads the size', () => { assert.equal(parseRow('x,3').size, 3); });
`;
const NODE_MODULES = path.resolve(__dirname, '../../node_modules');

test('steps: a TS split on a worktree is planned by ID, checked by tsc and node --test against the baseline, and committed', async () => {
	const parent = mkdtempSync(path.join(os.tmpdir(), 'my-editor-ts-steps-'));
	const root = path.join(parent, 'shop');
	mkdirSync(path.join(root, 'src'), { recursive: true });
	mkdirSync(path.join(root, 'test'));
	const files: Record<string, string> = {
		'.gitignore': 'node_modules\ndist\n', 'package-lock.json': '{}', 'src/shop.ts': SHOP, 'src/util.ts': "export function helper(): string { return '\\n'; }\n",
		'test/shop.test.ts': TEST,
		'package.json': JSON.stringify({ name: 'shop', type: 'module', scripts: { pretest: 'tsc -p .', test: 'node --test "dist/test/*.test.js"' } }),
		'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', strict: true, outDir: 'dist', rootDir: '.', types: ['node'] }, include: ['src', 'test'] }),
	};
	for (const [file, text] of Object.entries(files)) { writeFileSync(path.join(root, file), text); }
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	git('init', '--quiet');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	const wt = await prepare(root);
	symlinkSync(NODE_MODULES, path.join(wt.path, 'node_modules'));
	const adapter = createTsAdapter(wt.path, ts, await trackedFiles(wt.path));
	const checks = adapter.checks('src/shop.ts');
	assert.deepEqual(checks.map(c => c.command), ['npx --no -- tsc --noEmit -p tsconfig.json --pretty false', 'npm test']);
	const approved = checks.map(c => c.command);
	const check = async (command: string, label: string): Promise<CheckResult> => {
		// Without NODE_TEST_CONTEXT: a `node --test` started inside a test file reports to this run instead of printing TAP.
		const env = { ...adapter.commandEnv, NODE_TEST_CONTEXT: undefined };
		const out = await runCommand(command, { cwd: wt.path, approved, timeoutMs: 120_000, env, logFile: path.join(parent, 'logs', `${Date.now()}.log`) });
		return { command, code: out.code, failures: label === 'test' ? [] : failureLines(out.output), tests: label === 'test' ? adapter.parseTests(out.stdout) : undefined, tail: tail(out.output), log: '' };
	};
	const baseline: Record<string, [CheckResult, CheckResult]> = {};
	for (const { command, label } of checks) { baseline[command] = [await check(command, label), await check(command, label)]; }
	assert.equal(baseline['npm test'][0].code, 0, baseline['npm test'][0].tail);
	assert.deepEqual(Object.keys(baseline['npm test'][0].tests?.tests ?? {}), ['node:test report formats rows', 'node:test parseRow reads the size']);
	let replies = ['[{"file":"rows.ts","declarations":[0,1,2]}]'];
	const ctx: StepContext = { adapter, worktree: wt.path, baseline, flaky: [], check, cancelled: () => false, progress: () => undefined, ask: async () => replies.shift() ?? '[]' };
	const step = await runSplit(ctx, { file: 'src/shop.ts', kind: 'split', lines: 18 });
	assert.equal(step === 'stopped' ? 'stopped' : step.status, 'committed', step === 'stopped' ? '' : step.reason);
	assert.match(readFileSync(path.join(wt.path, 'src/shop.ts'), 'utf8'), /^import \{ helper \} from '\.\/util\.js';\nimport \{ parseRow, formatRow \} from '\.\/rows\.js';\nexport \{ parseRow, formatRow \} from '\.\/rows\.js';\nexport type \{ Row \} from '\.\/rows\.js';\n/);
	assert.match(execFileSync('git', ['log', '--format=%s', '-1'], { cwd: wt.path, encoding: 'utf8' }), /my_editor: split into 1 file \(src\/shop\.ts\)/);
	replies = ['[{"file":"more.ts","declarations":[3]}]', '[{"file":"more.ts","declarations":[3]}]'];
	const refused = await runSplit(ctx, { file: 'src/shop.ts', kind: 'split', lines: 8 });
	assert.equal(refused === 'stopped' ? 'stopped' : refused.status, 'refused');
	assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
});

test('a TS project needs the editor\'s TypeScript and a lockfile; mixed repositories stay Go-first', async () => {
	const appRoot = mkdtempSync(path.join(os.tmpdir(), 'my-editor-app-'));
	mkdirSync(path.join(appRoot, 'extensions', 'node_modules'), { recursive: true });
	symlinkSync(TS_DIR, path.join(appRoot, 'extensions', 'node_modules', 'typescript'));
	const host = { extensionPath: '/nowhere', storageDir: os.tmpdir(), version: 'test', appRoot };
	const locked = project({ 'package.json': '{"type":"module"}', 'package-lock.json': '{}' });
	assert.equal(typeof await adapterFor(locked.root, host), 'function');
	const loose = project({ 'package.json': '{"type":"module"}' });
	assert.match(String(await adapterFor(loose.root, host)), /no lockfile/);
	assert.match(lockfileProblem(project({ 'package-lock.json': '{}', 'yarn.lock': '' }).root) ?? '', /lockfiles of npm and yarn disagree/);
	assert.match(String(await adapterFor(locked.root, { ...host, appRoot: '/nowhere' })), /needs the editor's TypeScript 5 or 6/);
	assert.ok(!existsSync(path.join(locked.root, 'node_modules')));
	assert.ok(fixableFinding('src/a.ts', 'too-long') && fixableFinding('a.go', 'untested') && !fixableFinding('src/a.ts', 'untested') && !fixableFinding('a.py', 'too-long'));
});
````

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | grep -m1 'error TS'` → `test/aiReadyTsSteps.test.ts(8,22): error TS2305: Module '"../src/aiready/languages"' has no exported member 'fixableFinding'.`

- [ ] **Step 3: Implement.** `languages.ts`:

In `src/aiready/languages.ts`, replace:

````ts
import type { LanguageAdapter } from './language';

````

with:

````ts
import type { LanguageAdapter } from './language';
import { createTsAdapter } from './tsAdapter';
import { bundledTypeScript, loadTypeScript } from './tsLoad';
import { lockfileProblem } from './tsProject';

````

In `src/aiready/languages.ts`, replace:

````ts
	readonly version: string;
}
````

with:

````ts
	readonly version: string;
	/** The editor's install folder (`vscode.env.appRoot`); its bundled TypeScript is used for TS/JS. */
	readonly appRoot: string;
}

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs'];

/** Whether a health finding has a fix on a branch: Go splits and tests; TS/JS splits. */
export function fixableFinding(file: string, kind: string): boolean {
	const ext = path.extname(file);
	return (ext === '.go' && (kind === 'too-long' || kind === 'untested')) || (TS_EXTENSIONS.includes(ext) && kind === 'too-long');
}
````

In `src/aiready/languages.ts`, replace:

````ts
/**
 * The adapter for the project's language, or a plain message. Go is the first adapter; TS/JS, Python, C#, Rust and
 * C/C++ follow, each in its own `<language>Adapter.ts` registered here.
 */
````

with:

````ts
/**
 * The adapter for the project's language, or a plain message. Go and TS/JS so far (a mixed repository stays Go-first);
 * Python, C#, Rust and C/C++ follow, each in its own `<language>Adapter.ts` registered here.
 */
````

In `src/aiready/languages.ts`, replace:

````ts
	}
	return 'Fixing on a branch works for Go projects first (a `go.mod` in the top folder). TypeScript, JavaScript, Python, C#, Rust and C/C++ come next.';
}
````

with:

````ts
	}
	if (['package.json', 'tsconfig.json', 'jsconfig.json'].some(name => existsSync(path.join(root, name)))) {
		const ts = loadTypeScript(bundledTypeScript(host.appRoot));
		if (typeof ts === 'string') { return ts; }
		return lockfileProblem(root) ?? ((dir, tracked) => createTsAdapter(dir, ts, tracked));
	}
	return 'Fixing on a branch works for Go, TypeScript and JavaScript projects (a `go.mod`, `package.json` or `tsconfig.json` in the top folder). Python, C#, Rust and C/C++ come next.';
}
````

`fixSetup.ts` (only the adapter's fix kinds; the install is approved with the checks and runs before the baseline):

In `src/aiready/fixSetup.ts`, replace:

````ts
import type { Sink } from '../chat/engine';
import { CheckResult, failureLines, runBaseline } from './baseline';
import { fixChoices, pickFixes, skippedWithLines } from './fixPicker';
````

with:

````ts
import type { Sink } from '../chat/engine';
import { CheckResult, failureLines, runBaseline, runSetup } from './baseline';
import { fixChoices, pickFixes, skippedWithLines } from './fixPicker';
````

In `src/aiready/fixSetup.ts`, replace:

````ts
import { runCommand, tail } from './projectCommands';
import { discard, freeFolder, initRepository, prepare, prerequisites, trackedFiles, Worktree } from './worktree';

````

with:

````ts
import { runCommand, tail } from './projectCommands';
import { changedFiles, discard, freeFolder, initRepository, prepare, prerequisites, trackedFiles, Worktree } from './worktree';

````

In `src/aiready/fixSetup.ts`, replace:

````ts
	const findings = scanHealth(stats, tracked, { languages: [local.label], checks: [], tests: [] }, []);
	const candidates = [...new Set(findings.filter(f => f.file && (f.kind === 'too-long' || f.kind === 'untested')).map(f => f.file!))]
		.filter(file => sources.includes(file));
````

with:

````ts
	const findings = scanHealth(stats, tracked, { languages: [local.label], checks: [], tests: [] }, []);
	const offers = (kind: 'split' | 'tests') => !local.fixes || local.fixes.includes(kind);
	const candidates = [...new Set(findings.filter(f => f.file && ((f.kind === 'too-long' && offers('split')) || (f.kind === 'untested' && offers('tests')))).map(f => f.file!))]
		.filter(file => sources.includes(file));
````

In `src/aiready/fixSetup.ts`, replace:

````ts
	}
	const choices = fixChoices(findings, stats, local.extensions, skipped);
	sink.progress('');
````

with:

````ts
	}
	const choices = fixChoices(findings, stats, local.extensions, skipped).filter(choice => offers(choice.kind));
	sink.progress('');
````

In `src/aiready/fixSetup.ts`, replace:

````ts
	const checks = [...new Map(picked.flatMap(fix => local.checks(fix.file)).map(check => [check.command, check])).values()];
	const approved = checks.map(check => check.command);
	const folder = freeFolder(root);
	const answer = await vscode.window.showWarningMessage('Run these commands on a new local branch?',
		{ modal: true, detail: approvalDetail(folder, approved, local.label, picked.length) }, 'Run them');
	if (answer !== 'Run them') { sink.text('The commands were not approved, so nothing changed.'); return undefined; }
````

with:

````ts
	const checks = [...new Map(picked.flatMap(fix => local.checks(fix.file)).map(check => [check.command, check])).values()];
	const setup = local.setup?.() ?? [];
	const approved = [...setup, ...checks].map(check => check.command);
	const folder = freeFolder(root);
	const answer = await vscode.window.showWarningMessage('Run these commands on a new local branch?',
		{ modal: true, detail: approvalDetail(folder, approved, local.label, picked.length, setup.length > 0) }, 'Run them');
	if (answer !== 'Run them') { sink.text('The commands were not approved, so nothing changed.'); return undefined; }
````

In `src/aiready/fixSetup.ts`, replace:

````ts
		logDir(env.storage, root, true);
		const inWorktree = adapter(worktree.path, await trackedFiles(worktree.path));
````

with:

````ts
		logDir(env.storage, root, true);
		const ready = await prepareWorktree(env, adapter, worktree.path, approved, sink);
		if (ready) { return await discardUnstarted(root, worktree, sink, ready === 'stopped' ? 'Stopped before any fix.' : ready); }
		const inWorktree = adapter(worktree.path, await trackedFiles(worktree.path));
````

In `src/aiready/fixSetup.ts`, replace:

````ts

/** Before any fix (Stop, a baseline that could not run, or an error): nothing was committed, so the worktree and branch go. */
````

with:

````ts

/** Runs the adapter's setup (an install) once in the worktree: undefined when ready, else a plain message or 'stopped'. */
export async function prepareWorktree(env: CommandEnv, adapter: (root: string, tracked: readonly string[]) => LanguageAdapter, worktree: string,
	approved: readonly string[], sink: Sink): Promise<string | undefined> {
	const local = adapter(worktree, await trackedFiles(worktree));
	return runSetup(local.setup?.() ?? [], {
		check: (command, label) => runCheck(env, local, worktree, approved, command, label),
		cancelled: () => env.token.isCancellationRequested,
		progress: text => sink.progress(text),
	}, () => changedFiles(worktree), () => local.ready?.());
}

/** Before any fix (Stop, a baseline that could not run, or an error): nothing was committed, so the worktree and branch go. */
````

`fixRun.ts` (the editor's install folder, and the install again on Continue):

In `src/aiready/fixRun.ts`, replace:

````ts
import { noteFileName, renderChangeNote, reportWithRun, runFlaky } from './changeNote';
import { CommandEnv, runCheck, startRun } from './fixSetup';
import { clearState, discardRest, loadState, MAX_FIXES_PER_RUN, RunState, saveState, StepRecord } from './fixState';
````

with:

````ts
import { noteFileName, renderChangeNote, reportWithRun, runFlaky } from './changeNote';
import { CommandEnv, prepareWorktree, runCheck, startRun } from './fixSetup';
import { clearState, discardRest, loadState, MAX_FIXES_PER_RUN, RunState, saveState, StepRecord } from './fixState';
````

In `src/aiready/fixRun.ts`, replace:

````ts
	const language = await adapterFor(root, {
		extensionPath: context.extensionUri.fsPath, storageDir: storage, version: String(context.extension.packageJSON.version ?? 'dev'),
	});
````

with:

````ts
	const language = await adapterFor(root, {
		extensionPath: context.extensionUri.fsPath, storageDir: storage, version: String(context.extension.packageJSON.version ?? 'dev'), appRoot: vscode.env.appRoot,
	});
````

In `src/aiready/fixRun.ts`, replace:

````ts
		catch (error) { return forgetRun(storage, state, sink, error); }
		if (state.next < state.fixes.length) { sink.text(`Continuing on \`${state.worktree.branch}\` with ${state.fixes.length - state.next} fix${state.fixes.length - state.next === 1 ? '' : 'es'} left.\n`); }
````

with:

````ts
		catch (error) { return forgetRun(storage, state, sink, error); }
		const ready = await prepareWorktree(env, language, state.worktree.path, state.approved, sink);
		if (ready) { sink.progress(''); sink.text(ready === 'stopped' ? 'Stopped before any fix.' : ready); return; }
		if (state.next < state.fixes.length) { sink.text(`Continuing on \`${state.worktree.branch}\` with ${state.fixes.length - state.next} fix${state.fixes.length - state.next === 1 ? '' : 'es'} left.\n`); }
````

`healthRun.ts` and `steps.ts`:

In `src/aiready/healthRun.ts`, replace:

````ts
import { DEFAULT_LIMITS, ReviewPart, reviewParts } from './healthReview';
import { renderReport } from './report';
````

with:

````ts
import { DEFAULT_LIMITS, ReviewPart, reviewParts } from './healthReview';
import { fixableFinding } from './languages';
import { renderReport } from './report';
````

In `src/aiready/healthRun.ts`, replace:

````ts
		+ `and ${count('bug', 'poor-code')} suggestions.${review.partial ? ' I stopped early, so the report is partial.' : ''} Nothing in the code changed.`);
	if (commands.languages.includes('Go') && all.some(f => f.file?.endsWith('.go') && (f.kind === 'too-long' || f.kind === 'untested'))) {
		sink.action('Fix on a local branch', 'myEditor.aiReadyFix', []);
````

with:

````ts
		+ `and ${count('bug', 'poor-code')} suggestions.${review.partial ? ' I stopped early, so the report is partial.' : ''} Nothing in the code changed.`);
	if (all.some(f => f.file && fixableFinding(f.file, f.kind))) {
		sink.action('Fix on a local branch', 'myEditor.aiReadyFix', []);
````

In `src/aiready/steps.ts`, replace:

````ts
	const problems = [
		...checkMove({ before: { text: facts.source, info: facts.info }, after, files, plan: facts.plan, header: adapter.splitHeader(file) }),
		...adapter.sameDeclarations(facts.unitBefore, unitAfter),
````

with:

````ts
	const problems = [
		...checkMove({ before: { text: facts.source, info: facts.info }, after, files, plan: facts.plan, header: adapter.splitHeader(file), importProblems: adapter.importProblems }),
		...adapter.sameDeclarations(facts.unitBefore, unitAfter),
````

- [ ] **Step 4: Compile, test and check sizes.** `npm run -s compile && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'` → `ℹ pass 257`, `ℹ fail 0`. `wc -l src/aiready/*.ts src/chat/view.ts | sort -n | tail -3` → the largest `src/aiready` file is `tsAst.ts` at 393 lines and `src/chat/view.ts` is 399. `grep -c 'require("typescript")' dist/extension.js` → `0` (the compiler is loaded at run time, never bundled).

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/languages.ts src/aiready/fixSetup.ts src/aiready/fixRun.ts src/aiready/healthRun.ts src/aiready/steps.ts test/aiReadyTsSteps.test.ts
git commit -m "TS/JS adapter: register it, install before the baseline, check the facade"
```

### Task 8: Dry run on fixture projects

**Files:** none in the repository. Everything runs in a scratch folder on generated fixture repositories; the model is replaced by hand-made ID plans.

Four repositories, each a Git repository with one commit and a `package-lock.json` that installs the extension's own TypeScript from a packed tarball (no network): **esm** (ES modules checked by `tsc`, `node --test` on the `tsc` output; a 615-line `src/report.ts` with interfaces, a type alias, a pure `const`, a pure class and 69 functions, plus a two-file import cycle and a `'use client'` file), **cjs** (the same source compiled as CommonJS), **babel** (the ESM project plus `babel.config.json`), and **nolock** (no lockfile).

- [ ] **Step 1: Write the scripts and generate the fixtures.**

```bash
EXT=$PWD   # overlay/extensions/my-editor-core
W=$(mktemp -d) && mkdir -p "$W/check" && cd "$W/check"
npm pack "$EXT/node_modules/typescript" >/dev/null 2>&1   # typescript-5.9.3.tgz
(cd "$EXT" && npm test >/dev/null 2>&1)             # fills out-test/ with the compiled modules
```

Create `$W/check/gen-fixtures.js`:

````js
// Writes the dry-run fixture projects into a folder, each a Git repository with one commit and a package-lock.json.
// Usage: node gen-fixtures.js <out folder> <typescript .tgz>
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const [out, tgz] = process.argv.slice(2);

const groups = n => Array.from({ length: n }, (_, k) => k + 1).map(i => `/** Sales of group ${i}. */
function pick${i}(sales: Sale[]): Sale[] {
	return sales.filter(sale => sale.amount > ${i});
}

/** Totals group ${i}, clamped. */
export function total${i}(sales: Sale[]): number {
	let sum = 0;
	for (const sale of pick${i}(sales)) {
		sum += clamp(sale.amount, 0, ${i * 100});
	}
	return sum;
}

/** Describes group ${i}. */
export function describe${i}(sales: Sale[]): string {
	const total = total${i}(sales);
	const lines = [
		\`group ${i}\`,
		\`count \${pick${i}(sales).length}\`,
		\`total \${formatAmount(total)}\`,
	];
	return lines.join('; ');
}
`).join('\n');

const REPORT = `import { clamp } from './math.js';

/** One sale. */
export interface Sale {
	id: string;
	amount: number;
	region: Region;
}

/** Where a sale happened. */
export type Region = 'north' | 'south' | 'east' | 'west';

/** How amounts are shown. */
export const CURRENCY = { code: 'EUR', digits: 2 };

/** Formats an amount in the currency. */
export function formatAmount(amount: number): string {
	return \`\${amount.toFixed(CURRENCY.digits)} \${CURRENCY.code}\`;
}

/** Collects sales and totals them. */
export class Ledger {
	entries: Sale[] = [];

	add(sale: Sale): this {
		this.entries.push(sale);
		return this;
	}

	total(): number {
		return this.entries.reduce((sum, sale) => sum + sale.amount, 0);
	}
}

${groups(23)}
/** The whole report, one line per group. */
export function report(sales: Sale[]): string {
	return [${Array.from({ length: 23 }, (_, k) => `describe${k + 1}(sales)`).join(', ')}].join('\\n');
}

export default report;
`;
const MATH = 'export function clamp(value: number, low: number, high: number): number {\n\treturn Math.min(high, Math.max(low, value));\n}\n';
const TEST_ESM = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import report, { CURRENCY, describe7, formatAmount, Ledger, total1 } from '../dist/report.js';

const sales = [{ id: 'a', amount: 5, region: 'north' }, { id: 'b', amount: 50, region: 'south' }];
test('report lists every group', () => { assert.equal(report(sales).split('\\n').length, 23); });
test('totals are clamped', () => { assert.equal(total1(sales), 55); });
test('describe uses the currency', () => { assert.match(describe7(sales), /total 50\\.00 EUR/); });
test('the ledger is one class', () => { const ledger = new Ledger().add(sales[0]); assert.ok(ledger instanceof Ledger); assert.equal(ledger.total(), 5); });
test('amounts are formatted', () => { assert.equal(formatAmount(2), '2.00 EUR'); assert.equal(CURRENCY.code, 'EUR'); });
`;
const TEST_CJS = TEST_ESM.replace("import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport report, { CURRENCY, describe7, formatAmount, Ledger, total1 } from '../dist/report.js';",
	"const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { default: report, CURRENCY, describe7, formatAmount, Ledger, total1 } = require('../dist/report.js');");

function write(dir, files) {
	for (const [file, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	}
}

function repo(name, files, lock = true) {
	const dir = path.join(out, name);
	fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });
	fs.copyFileSync(tgz, path.join(dir, 'vendor', path.basename(tgz)));
	write(dir, files);
	if (lock) { execFileSync('npm', ['install', '--package-lock-only', '--offline', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'ignore' }); }
	const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
	git('init', '--quiet');
	git('config', 'user.email', 'dry@example.com');
	git('config', 'user.name', 'Dry Run');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	console.log(`${name}: ${fs.readFileSync(path.join(dir, 'src/report.ts'), 'utf8').split('\n').length - 1} lines in src/report.ts`);
}

const pkg = type => JSON.stringify({
	name: 'shop', version: '1.0.0', private: true, ...(type ? { type } : {}),
	scripts: { pretest: 'tsc -p .', test: 'node --test' }, devDependencies: { typescript: `file:vendor/${path.basename(tgz)}` },
}, null, '\t');
const tsconfig = (module, resolution) => JSON.stringify({ compilerOptions: { module, moduleResolution: resolution, target: 'es2022', strict: true, outDir: 'dist', rootDir: 'src' }, include: ['src'] }, null, '\t');
const common = { '.gitignore': 'node_modules\ndist\n', 'src/report.ts': REPORT, 'src/math.ts': MATH };

repo('esm', { ...common, 'package.json': pkg('module'), 'tsconfig.json': tsconfig('nodenext', 'nodenext'), 'test/report.test.mjs': TEST_ESM,
	'src/cycle-a.ts': "import { b } from './cycle-b.js';\nexport const a = (): number => b() + 1;\n", 'src/cycle-b.ts': "import { a } from './cycle-a.js';\nexport const b = (): number => 1;\nexport const c = a;\n",
	'src/client.ts': "'use client';\nexport const client = 1;\n" });
repo('cjs', { ...common, 'package.json': pkg(), 'tsconfig.json': tsconfig('node16', 'node16'), 'test/report.test.cjs': TEST_CJS });
repo('babel', { ...common, 'package.json': pkg('module'), 'tsconfig.json': tsconfig('nodenext', 'nodenext'), 'test/report.test.mjs': TEST_ESM, 'babel.config.json': '{ "presets": [] }\n' });
repo('nolock', { ...common, 'package.json': pkg('module'), 'tsconfig.json': tsconfig('nodenext', 'nodenext'), 'test/report.test.mjs': TEST_ESM }, false);
````

Create `$W/check/pipeline-check.js`:

````js
// Runs the real TS/JS step pipeline without VS Code on a fixture repository: worktree and branch, the install (setup),
// the baseline twice, one split per argument (the model replaced by a plan file; each plan is sent twice, so a rejected
// one is refused after its retry), the change note, and worktree removal.
// Usage: EXT=<extension> TS=<typescript folder> node pipeline-check.js <project> <file>=<plan.json> [<file>=<plan.json> …]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const EXT = process.env.EXT;
const [root, ...fixes] = process.argv.slice(2);
const m = name => require(path.join(EXT, 'out-test/src/aiready', name));
const { loadTypeScript } = m('tsLoad');
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
	const appRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'app-'));
	fs.mkdirSync(path.join(appRoot, 'extensions', 'node_modules'), { recursive: true });
	fs.symlinkSync(process.env.TS, path.join(appRoot, 'extensions', 'node_modules', 'typescript'));
	console.log(`TypeScript ${loadTypeScript(process.env.TS).version}`);
	const factory = await adapterFor(root, { extensionPath: EXT, storageDir: __dirname, version: 'check', appRoot });
	if (typeof factory === 'string') { console.log(`refused: ${factory}`); return; }
	const local = factory(root, git('ls-files').split('\n'));
	const plans = fixes.map(arg => { const [file, plan] = arg.split('='); return { file, plan: fs.readFileSync(plan, 'utf8') }; });
	for (const { file } of plans) {
		const info = await local.parse(file);
		console.log(`${file}: ${info.declarations.length} declarations, ${info.declarations.filter(d => d.movable).length} movable, skip: ${info.skip ?? 'no'}`);
	}
	const checks = [...new Map(plans.flatMap(p => local.checks(p.file)).map(c => [c.command, c])).values()];
	const setup = local.setup ? local.setup() : [];
	const approved = [...setup, ...checks].map(c => c.command);
	const wt = await prepare(root);
	console.log(`worktree ${path.basename(wt.path)} on ${wt.branch}; approved: ${approved.join(' | ')}`);
	let n = 0;
	const runner = adapter => ({
		check: async (command, label) => {
			const out = await runCommand(command, { cwd: wt.path, approved, timeoutMs: 600_000, env: adapter.commandEnv, logFile: path.join(__dirname, 'logs', `${n++}-${label}.log`) });
			return { command, code: out.code, failures: label === 'test' ? [] : failureLines(out.output), tests: label === 'test' ? adapter.parseTests(out.stdout) : undefined, tail: tail(out.output), log: '' };
		},
		cancelled: () => false, progress: () => undefined,
	});
	const first = factory(wt.path, await trackedFiles(wt.path));
	const ready = await runSetup(first.setup ? first.setup() : [], runner(first), () => changedFiles(wt.path), () => first.ready && first.ready());
	console.log(`setup: ${ready ?? 'ready'}`);
	if (ready) { await remove(root, wt.path); git('branch', '-D', wt.branch); return; }
	const adapter = factory(wt.path, await trackedFiles(wt.path));
	const outcome = await runBaseline(checks, runner(adapter));
	const baseline = outcome.baseline;
	for (const [command, [run]] of Object.entries(baseline)) {
		console.log(`baseline \`${command}\`: exit ${run.code}${run.tests ? `, ${Object.keys(run.tests.tests).length} tests` : ''}`);
	}
	const flaky = Object.values(baseline).flatMap(([a, b]) => flakyTests(a.tests, b.tests));
	const steps = [];
	for (const { file, plan } of plans) {
		const ctx = { adapter, worktree: wt.path, baseline, flaky, ask: async () => plan, check: runner(adapter).check, cancelled: () => false, progress: () => undefined };
		const step = await runSplit(ctx, { file, kind: 'split', lines: 0 });
		console.log(`split ${file}: ${step.status}${step.commit ? ` ${step.commit.slice(0, 7)}` : ''}${step.reason ? ` (${step.reason})` : ''}`);
		if (step.checks) { console.log(`  checks: ${step.checks}`); }
		for (const note of step.notes ?? []) { console.log(`  note: ${note}`); }
		steps.push(step);
	}
	const fixesDone = plans.map(p => ({ file: p.file, kind: 'split', lines: 0 }));
	const state = { version: 1, root, language: adapter.label, worktree: wt, startedAt: new Date().toISOString(), approved, fixes: fixesDone, next: fixesDone.length, steps, baseline, skippedFiles: [] };
	const at = new Date();
	const note = noteFileName(at);
	fs.mkdirSync(path.dirname(path.join(wt.path, note)), { recursive: true });
	fs.writeFileSync(path.join(wt.path, note), renderChangeNote(state, at));
	await commit(wt.path, [note], 'my_editor: change note for the AI-ready fixes', 'Check run.');
	console.log(git('log', '--format=%h %s', `${wt.base}..${wt.branch}`).replace(/^[0-9a-f]{7,} /gm, '<sha> '));
	for (const line of git('diff', '--stat', `${wt.base}..${wt.branch}`, '--', 'src').split('\n')) { console.log(`  ${line.trim()}`); }
	await remove(root, wt.path);
	console.log(`user folder unchanged: ${user() === userBefore}; worktree removed: ${!fs.existsSync(wt.path)}`);
})().catch(error => { console.error(error); process.exit(1); });
````

Create `$W/check/ids.js`:

````js
// Prints a file's declarations by ID (what the model sees). Usage: EXT=<extension> TS=<typescript> node ids.js <project> <file>
const path = require('path'), { execFileSync } = require('child_process');
const m = name => require(path.join(process.env.EXT, 'out-test/src/aiready', name));
const ts = m('tsLoad').loadTypeScript(process.env.TS);
const [root, file] = process.argv.slice(2);
const adapter = m('tsAdapter').createTsAdapter(root, ts, execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean));
adapter.parse(file).then(info => {
	console.log(`skip: ${info.skip ?? 'no'}`);
	for (const d of info.declarations) { console.log(`${d.id} ${d.kind} ${d.names.join(',')} ${d.lines}${d.movable ? '' : ` — ${d.reason}`}`); }
});
````

Then:

```bash
node gen-fixtures.js fx typescript-5.9.3.tgz
node -e "
const r = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i), w = (f, p) => require('fs').writeFileSync(f, JSON.stringify(p));
w('esm-plan.json', [{ file: 'money.ts', declarations: [0, 1, 2, 3, 4] }, { file: 'groups-a.ts', declarations: r(5, 28) }, { file: 'groups-b.ts', declarations: r(29, 52) }]);
w('types-plan.json', [{ file: 'sale-types.ts', declarations: [0, 1] }]);
w('money-plan.json', [{ file: 'money.ts', declarations: [0, 1, 2, 3, 4] }]);
w('helper-plan.json', [{ file: 'describe-one.ts', declarations: [7] }]);"
export EXT TS=/Applications/my_editor.app/Contents/Resources/app/extensions/node_modules/typescript
node ids.js fx/esm src/report.ts | sed -n '1,8p;$p'
```

Expected:

```text
esm: 615 lines in src/report.ts
cjs: 615 lines in src/report.ts
babel: 615 lines in src/report.ts
nolock: 615 lines in src/report.ts
skip: no
0 export interface Sale 6
1 export type Region 2
2 export const CURRENCY 2
3 export function formatAmount 4
4 export class Ledger 13
5 function pick1 4
6 export function total1 8
75 export default  1 — it is not a declaration, or it runs code
```

- [ ] **Step 2: ESM: functions, types, a pure `const` and a pure class move; `tsc` and the tests pass on the branch.**

```bash
node pipeline-check.js fx/esm src/report.ts=esm-plan.json
```

Expected:

```text
TypeScript 6.0.3
src/report.ts: 76 declarations, 75 movable, skip: no
worktree esm.ai-ready on my_editor/ai-ready; approved: npm ci | npx --no -- tsc --noEmit -p tsconfig.json --pretty false | npm test
setup: ready
baseline `npx --no -- tsc --noEmit -p tsconfig.json --pretty false`: exit 0
baseline `npm test`: exit 0, 5 tests
split src/report.ts: committed <sha>
  checks: `npx --no -- tsc --noEmit -p tsconfig.json --pretty false`: passed; `npm test`: passed (5 of 5 tests passing).
<sha> my_editor: change note for the AI-ready fixes
<sha> my_editor: split into 3 files (src/report.ts)
  src/groups-a.ts | 205 ++++++++++++++++++++++++++
  src/groups-b.ts | 205 ++++++++++++++++++++++++++
  src/money.ts    |  33 +++++
  src/report.ts   | 440 ++------------------------------------------------------
  4 files changed, 451 insertions(+), 432 deletions(-)
user folder unchanged: true; worktree removed: true
```

Then look at the branch: the facade follows the original's import, and a new file imports the filtered `clamp` and its siblings' names.

```bash
git -C fx/esm show my_editor/ai-ready~1:src/report.ts | head -5
git -C fx/esm show my_editor/ai-ready~1:src/groups-a.ts | sed -n 3,5p
git -C fx/esm status --short
```

Expected (the last command prints nothing):

```text
import { clamp } from './math.js';
import { formatAmount } from './money.js';
import type { Sale } from './money.js';
export { CURRENCY, formatAmount, Ledger } from './money.js';
export type { Sale, Region } from './money.js';
import { clamp } from './math.js';
import { formatAmount } from './money.js';
import type { Sale } from './money.js';
```

- [ ] **Step 3: CommonJS and Babel: only types move.** The first plan per project moves run-time declarations and is refused; the second moves the interface and the type alias and is committed, leaving the original over 400 lines with a note, because nothing else in it may move.

```bash
node pipeline-check.js fx/cjs src/report.ts=money-plan.json src/report.ts=types-plan.json
node pipeline-check.js fx/babel src/report.ts=money-plan.json src/report.ts=types-plan.json | grep -v '^TypeScript'
```

Expected:

```text
TypeScript 6.0.3
src/report.ts: 76 declarations, 2 movable, skip: no
src/report.ts: 76 declarations, 2 movable, skip: no
worktree cjs.ai-ready on my_editor/ai-ready; approved: npm ci | npx --no -- tsc --noEmit -p tsconfig.json --pretty false | npm test
setup: ready
baseline `npx --no -- tsc --noEmit -p tsconfig.json --pretty false`: exit 0
baseline `npm test`: exit 0, 5 tests
split src/report.ts: refused (The split plan was rejected twice: Declaration 2 (export const CURRENCY) may not move: only interfaces and type aliases may move here: tsconfig.json emits it as CommonJS. Declaration 3 (export function formatAmount) may not move: only interfaces and type aliases may move here: tsconfig.json emits it as CommonJS. Declaration 4 (export class Ledger) may not move: only interfaces and type aliases may move here: tsconfig.json emits it as CommonJS.)
split src/report.ts: committed <sha>
  checks: `npx --no -- tsc --noEmit -p tsconfig.json --pretty false`: passed; `npm test`: passed (5 of 5 tests passing).
  note: src/report.ts stays at 607 lines: the rest may not move (only interfaces and type aliases may move here: tsconfig.json emits it as CommonJS).
<sha> my_editor: change note for the AI-ready fixes
<sha> my_editor: split into 1 file (src/report.ts)
  src/report.ts     | 12 ++----------
  src/sale-types.ts | 11 +++++++++++
  2 files changed, 13 insertions(+), 10 deletions(-)
user folder unchanged: true; worktree removed: true
src/report.ts: 76 declarations, 2 movable, skip: no
src/report.ts: 76 declarations, 2 movable, skip: no
worktree babel.ai-ready on my_editor/ai-ready; approved: npm ci | npx --no -- tsc --noEmit -p tsconfig.json --pretty false | npm test
setup: ready
baseline `npx --no -- tsc --noEmit -p tsconfig.json --pretty false`: exit 0
baseline `npm test`: exit 0, 5 tests
split src/report.ts: refused (The split plan was rejected twice: Declaration 2 (export const CURRENCY) may not move: only interfaces and type aliases may move here: Babel transforms the code. Declaration 3 (export function formatAmount) may not move: only interfaces and type aliases may move here: Babel transforms the code. Declaration 4 (export class Ledger) may not move: only interfaces and type aliases may move here: Babel transforms the code.)
split src/report.ts: committed <sha>
  checks: `npx --no -- tsc --noEmit -p tsconfig.json --pretty false`: passed; `npm test`: passed (5 of 5 tests passing).
  note: src/report.ts stays at 607 lines: the rest may not move (only interfaces and type aliases may move here: Babel transforms the code).
<sha> my_editor: change note for the AI-ready fixes
<sha> my_editor: split into 1 file (src/report.ts)
  src/report.ts     | 12 ++----------
  src/sale-types.ts | 11 +++++++++++
  2 files changed, 13 insertions(+), 10 deletions(-)
user folder unchanged: true; worktree removed: true
```

- [ ] **Step 4: Refusals.** A plan that moves `describe1` without the helpers it uses, a file in an import cycle, a `'use client'` file, and a project without a lockfile:

```bash
git -C fx/esm branch -D my_editor/ai-ready
node pipeline-check.js fx/esm src/report.ts=helper-plan.json src/cycle-a.ts=types-plan.json src/client.ts=types-plan.json
node pipeline-check.js fx/nolock src/report.ts=types-plan.json
```

Expected:

```text
Deleted branch my_editor/ai-ready (was <sha>).
TypeScript 6.0.3
src/report.ts: 76 declarations, 75 movable, skip: no
src/cycle-a.ts: 1 declarations, 0 movable, skip: it is in an import cycle
src/client.ts: 1 declarations, 0 movable, skip: it has the directive 'use client', which a new file would lack
worktree esm.ai-ready on my_editor/ai-ready; approved: npm ci | npx --no -- tsc --noEmit -p tsconfig.json --pretty false | npm test
setup: ready
baseline `npx --no -- tsc --noEmit -p tsconfig.json --pretty false`: exit 0
baseline `npm test`: exit 0, 5 tests
split src/report.ts: refused (The split plan was rejected twice: declaration 7 (describe1) uses total1 (6), which stays. Move it to the same file or leave both. declaration 7 (describe1) uses pick1 (5), which stays. Move it to the same file or leave both. declaration 7 (describe1) uses formatAmount (3), which stays. Move it to the same file or leave both.)
split src/cycle-a.ts: skipped (Never split: it is in an import cycle.)
split src/client.ts: skipped (Never split: it has the directive 'use client', which a new file would lack.)
<sha> my_editor: change note for the AI-ready fixes
  
user folder unchanged: true; worktree removed: true
TypeScript 6.0.3
refused: This project has no lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lock), so its dependencies cannot be installed on the branch exactly as in your folder. Commit a lockfile, then try again.
```

- [ ] **Step 5: The same ESM split with the dev dependency's TypeScript (5.9.3).**

```bash
git -C fx/esm branch -D my_editor/ai-ready
TS=$EXT/node_modules/typescript node pipeline-check.js fx/esm src/report.ts=esm-plan.json | sed -n '1p;7,8p;$p'
```

Expected:

```text
Deleted branch my_editor/ai-ready (was <sha>).
TypeScript 5.9.3
split src/report.ts: committed <sha>
  checks: `npx --no -- tsc --noEmit -p tsconfig.json --pretty false`: passed; `npm test`: passed (5 of 5 tests passing).
user folder unchanged: true; worktree removed: true
```

- [ ] **Step 6: Throw the scratch folder away.** `rm -rf "$W"`. Nothing to commit.

### Task 9: Final verification

- [ ] **Step 1: Everything, from `overlay/extensions/my-editor-core`.**

```bash
npm run -s compile && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'
MY_EDITOR_TS=/Applications/my_editor.app/Contents/Resources/app/extensions/node_modules/typescript node --test out-test/test/*.test.js 2>&1 | grep '^ℹ \(pass\|fail\)'
(cd resources/goast && GOTOOLCHAIN=local go test ./...)
wc -l src/aiready/*.ts src/chat/view.ts | sort -n | tail -3
git status --short
```

Expected: `ℹ pass 257` and `ℹ fail 0` twice; `ok  	goast	…`; `393 src/aiready/tsAst.ts` and `399 src/chat/view.ts`, then the total; and a clean tree (every task committed). `dist/extension.js` grows by about 130 KB and has no `require("typescript")`.

- [ ] **Step 2: Live check (after the user confirms my_editor is closed):** `scripts/install.sh`, open a cloned ESM TypeScript project with a committed lockfile and a clean tree, run **Check AI-Readiness**, then **Fix on a local branch** → the picker lists only long TS/JS files; the modal shows `npm ci` first with the sentence about install scripts, then the `npx --no -- tsc …` and test lines; afterwards `git status` and the current branch of the project are unchanged and `git log my_editor/ai-ready` has one commit per split plus the change note. Do not push.

## Dry run of this plan

Applied task by task to a copy of `overlay/extensions/my-editor-core` at `55e672f` (`rsync` without `node_modules`, `dist` and `out-test`, with the extension's `node_modules` linked in): each Step 2 failed with the line shown, each Step 4 passed with the count shown, `npx tsc --noEmit -p ./` stayed clean, `go test` in `resources/goast` stayed `ok`, and Task 8's outputs are the ones above.

Related: [TS/JS design](2026-10-09-ai-ready-ts-design.md), [Go plan](2026-10-09-ai-ready-stage2-go-plan.md).
