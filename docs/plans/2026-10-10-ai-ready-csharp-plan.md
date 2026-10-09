> **Paused 2026-10-10.** This plan was dry-run against `90dd44b`. The code has since changed (view.ts split, long lines wrapped, new tests; HEAD `0591e05`), so its modify blocks must be rebased and re-dry-run before execution. Also add: per-run cache for `membershipProblems`, skip `dotnet restore` on Continue when assets/lockfile are unchanged, wrap the remaining >160-char lines in the core files it edits, and a test file per new module.

# AI-ready Stage 2d (C# splits on a local branch) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AI-ready fixer splits C# files on its local branch, exactly within the design's *Version 1 scope*: every movable top-level type except the keeper moves byte for byte into its own `<TypeName>.cs` in the same folder, project and namespace, planned by the host without a model call, and each split is committed only after the move check, project membership from MSBuild, the build (no new warnings), the tests and a metadata and IL dump of the assembly (rule 6) match the baseline.

**Architecture:** One more `LanguageAdapter` (`src/aiready/csAdapter.ts`), registered in `languages.ts` after Go, TS/JS and Python. Parsing, editor-config comparison and the assembly dump run in a small helper in `resources/csast/` that references the SDK's own Roslyn (`Private=true`) and is built once per SDK into global storage, offline. MSBuild evaluation (`-getItem`/`-getProperty`, no restore) answers every project question. The core gets a few optional, language-neutral hooks: a host plan, an assembly check, warning counts, result files, and a blank-line mode for braces.

**Tech Stack:** TypeScript (strict, CommonJS), `node:test`, C# 12 on the installed .NET SDK (8.0.100 or newer; Roslyn and System.Reflection.Metadata from the SDK and shared framework), MSBuild evaluation, `dotnet build`/`test`/`restore`/`format`, Git worktrees.

**Spec:** [C# design](2026-10-10-ai-ready-csharp-design.md), section *Version 1 scope* and everything it refers to, plus the adversarial reviewer's three non-blocking notes (see *Reviewer notes*). Models for detail and style: [Python plan](2026-10-10-ai-ready-python-plan.md), [TS/JS plan](2026-10-09-ai-ready-ts-plan.md), [Go plan](2026-10-09-ai-ready-stage2-go-plan.md).

**Base:** branch `ai-ready-go` at `90dd44b`, where `npm test` reports `ℹ pass 348`. The plan was dry-run task by task on a copy of that tree (see *Dry run of this plan* at the end).

---

## How the design's components map to files

One responsibility and one class per file, every file under 400 lines, so several design units are split:

| Design unit | Built as | Why |
|---|---|---|
| `resources/csast/` helper: `Program.cs`, `Parse.cs`, `Config.cs`, `Dump.cs` | `Program.cs`, `Parse.cs` (encodings), `FileReader.cs` (Roslyn to facts), one file per JSON type (`FileFacts`, `UsingFact`, `NamespaceFact`, `TypeFact`, `DirectiveFact`, `NameLine`), `Config.cs`, `Dump.cs` (assembly, types, members), `DumpIl.cs` (bodies), `DumpNames.cs` (names, signatures, attributes) | One class per file |
| `csTools.ts`, `csAst.ts` | same | |
| `csProject.ts` | `csEval.ts` (MSBuild evaluation, membership), `csScan.ts` (pure pattern scans), `csProject.ts` (project facts, ownership, commands, `ready`), `csContext.ts` (one file's place) | Over 400 lines together; scans and decisions stay pure |
| `csRules.ts`, `csSplit.ts`, `csMoveCheck.ts`, `csTests.ts`, `csHealth.ts`, `csAssembly.ts`, `csAdapter.ts` | same | |
| (core) `fixSetup.runCheck`'s parsing | `checkResult.ts` | The glue stays thin; the tests and the dry-run script use the same function |

## Decisions made while planning

Where the code differs from the design's words, this is what it does and why. Each was found by a probe or the dry run.

- **Rule 4's project part is its own optional hook, `membershipProblems(file, newFiles)`,** awaited with the move check, instead of making `sameDeclarations` async; the existing Python and TS tests call `sameDeclarations` synchronously.
- **`blankLines: 'braces'`.** Blank lines around a removed type collapse to one, but to none right after a `{` line or before a `}` line, so a type removed first or last in a block namespace leaves no blank line by the brace (StyleCop SA1505/SA1508 would turn that into a new warning and undo the step). A kept blank line keeps its `\r` in a CRLF file. Other languages keep their modes.
- **`installNote`** (adapter) and a seventh parameter of `approvalDetail`: the approval text for `dotnet restore` says it may download packages from the NuGet sources and that builds run MSBuild targets from them; the npm wording stays for TS/JS.
- **`ready()` may be async** (`runSetup` awaits it): C# asks MSBuild where each assets file is.
- **TS-only sentences.** The change note's "types-only project" sentence and the picker's "so splits leave the run-time code in place" (now `narrowedText`) apply to TypeScript/JavaScript only.
- **Anonymous delegates are renamed by signature and by parameter names, ref kinds and default values.** Probe: `(int a = 3) => a` and `(string s = "a") => s` are both `<>f__AnonymousDelegate…`2<T1,TResult>`; their signatures are equal and only the `Invoke` parameter constants differ, so a signature-only name collided.
- **Assembly references are sorted in the dump.** Probe: moving a type to its own file moved the `System.Console` row in the `AssemblyRef` table (rows follow first use in compile order).
- **TRX packages are `<AssemblyName>@<framework>`, matched by the evaluated `TargetPath`** (which also covers the artifacts layout, `artifacts/bin/<project>/debug_<tfm>/`); the folder name next to `codeBase` is the fallback.
- **Interceptor generators are also detected by `InterceptorsPreviewNamespaces`/`InterceptorsNamespaces` naming their namespace.** Probe: with `PublishAot=true` the Web SDK sets `EnableRequestDelegateGenerator` and adds both namespaces during evaluation. `BindConfiguration` is added to the binder's calls (the safe direction).
- **The reproducibility verdict is stored in global storage** (`csast-runs/<hash of the worktree path>.json`), because Continue's `reattach` runs `git clean -fd`, which would remove an untracked record in the worktree.
- **Editor-config paths are resolved with `realpath`.** MSBuild lists config files under `/private/var/…` on macOS; Roslyn matches sections by path prefix, so `/var/…` candidates matched no section.
- **`#nullable` and `#pragma warning` are allowed only in the top-level using region,** not among a block namespace's own usings (the design's words; those files are skipped).
- **A fourth helper command, `cultures`,** prints .NET's culture list (`CultureInfo.GetCultures(AllCultures)`), which the culture-`.resx` rule uses (reviewer note 1).
- **`dotnet restore` gets `--disable-build-servers`** like the other commands.
- **Two builds of the same helper at once both succeed.** Found by the dry run: `npm test` runs test files in parallel, and a process that finished second replaced the `out` folder while another was running the helper from it. The first finished build now stays and a later one is dropped (`csTools.test.ts` *two builds … at once*).
- **The test command exists only when a tracked test project exists** (`IsTestProject` or `Microsoft.NET.Test.Sdk`); otherwise "no TRX written" would fail every class library.
- **Unity and Godot are recognised by root markers** (`project.godot`, `Godot.NET.Sdk` in a root project, `ProjectSettings/` with `Assets/`) in `languages.ts`, before any tool runs.
- **A project, solution or test project path the checks cannot carry** (a space, or a character `splitCommand` refuses) skips the files: the project's own path per project, the solution or test projects for every file.

## Reviewer notes

1. *The culture-`.resx` check goes by file name with .NET's culture list:* `resourceCulture` (`csScan.ts`) takes the second-to-last dot part of an `EmbeddedResource`'s file name and checks it against the helper's `cultures` list. Tests: `csScan.test.ts` *resource cultures*, `csProject.test.ts` *project facts* (`Strings.de.resx`), `csTools.test.ts` (the list has `de`, `zh-hans`, `fr-ca`).
2. *The interceptor detection also covers `EnableRequestDelegateGenerator` set in `Directory.Build.props`, read from evaluation:* `csProject.test.ts` *project facts* (`src/Api` sets it in its `Directory.Build.props`) and `csAdapter.test.ts` *a call the request delegate generator intercepts skips the file when Directory.Build.props turns it on* (a plain library, end to end through `parse`).
3. *TRX parsing is unprobed:* no xUnit, NUnit or MSTest package was in the offline NuGet cache (`~/.nuget/packages` has none), so `test/trxFixture.ts` writes the three frameworks' TRX by hand from the TRX schema and the vstest TRX logger's naming rules, and says so; the dry run's fixtures have no test project.

The other probes the reviewer named each have cases: satellite resources (*project facts*), detached `///` comments (`csAst.test.ts`, `csRules.test.ts`), per-configuration membership (`csEval.test.ts`, `csProject.test.ts` *ownership*), the artifacts layout (`csProject.test.ts` *restore and ready*, `csTests.test.ts` MSTest), warning-count growth (`baseline.test.ts`, `checkResult.test.ts`), TRX keys (`csTests.test.ts`), interceptors (`csRules.test.ts`, `csAdapter.test.ts`) and scanners (`csScan.test.ts`, `csProject.test.ts`, `csRules.test.ts`, and the dry run's *scanner* fixture).

## Ground rules for every task

- Work in `overlay/extensions/my-editor-core/` unless a path says otherwise. Paths are relative to it.
- Edit only the AI-ready core files named here and new `cs*` files: another change is splitting `src/chat/view.ts` and wrapping long lines in other files at the same time. `src/chat/view.ts` stays at 399 lines and is not touched.
- Tabs, one short `/** … */` line on exported functions, the surrounding comment density. No file over 400 lines, no new line over 160 characters, one statement per line (no folding statements onto long lines), one class per file. Every pure module has its own `test/<module>.test.ts`.
- Pure modules must not import `vscode`. Only `fixSetup.ts` and `fixRun.ts` import it here, and they only pass values through.
- `npm test` compiles to `out-test/` and runs every test. The .NET-backed tests use `DOTNET` from `test/csFixture.ts` and are skipped without a .NET SDK 8.0.100 or newer; the helper is built once into `$TMPDIR/my-editor-csast-cache`. Every fixture repository gets a `nuget.config` that clears all package sources, so restores stay offline.
- Commits stay **local**. Never run `git push`, `git fetch` or any remote command.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/aiready/language.ts` | modify | `CheckCommand.warnings`/`results`, `ResultFile`, `AssemblyCheck`; optional `plan`, `assemblyCheck`, `splitFindings`, `membershipProblems`, `installNote`; async `ready`; `parseTests(output, files)` |
| `src/aiready/baseline.ts` | modify | `warningCounts`, warnings may not grow, `runBaseline`'s `after`, async `ready` |
| `src/aiready/checkResult.ts` | new, pure | A finished command as a `CheckResult` |
| `src/aiready/steps.ts` | modify | Host plan, rule 6 around the checks, rule 4's project part |
| `src/aiready/moveCheck.ts`, `projectCommands.ts`, `fixPicker.ts`, `fixText.ts`, `changeNote.ts`, `fixSetup.ts`, `fixRun.ts`, `health.ts`, `languages.ts` | modify | `braces` mode; `readResults`/`emptyResults`; splits for `many-classes`; install wording and `narrowedText`; TS-only sentence; pass-through; C# type count; C# registration |
| `resources/csast/*` | new | The helper: `parse`, `config`, `dump`, `cultures` |
| `src/aiready/csTools.ts`, `csAst.ts` | new | Find dotnet, SDK gate, build and run the helper; its JSON |
| `src/aiready/csEval.ts`, `csScan.ts`, `csProject.ts`, `csContext.ts` | new | MSBuild evaluation and membership; pattern scans; project facts and commands; one file's context |
| `src/aiready/csRules.ts`, `csSplit.ts`, `csMoveCheck.ts` | new, pure | Skips, movability, names, plan; new files and the original; rules 2 and 4 |
| `src/aiready/csTests.ts`, `csHealth.ts` | new, pure | TRX results; stage 1 type count |
| `src/aiready/csAssembly.ts`, `csAdapter.ts` | new | Rule 6; the adapter |
| `test/*.test.ts` (one per module), `test/csFixture.ts`, `test/trxFixture.ts` | new | Tests and fixtures |
| `tsconfig.test.json` | modify | The new modules |

## Chunk 1: Check results in the core

### Task 1: Check results: warning counts, result files and `checkResult`

**Files:**
- Create: `src/aiready/checkResult.ts`, `test/baseline.test.ts`, `test/checkResult.test.ts`, `test/projectCommands.test.ts`
- Modify: `src/aiready/baseline.ts`, `src/aiready/fixSetup.ts`, `src/aiready/language.ts`, `src/aiready/projectCommands.ts`, `tsconfig.test.json`

A check may now ask for warning counts (`warnings: 'no-more'`) and a results folder (`results`). The decisions `runCheck` made inline move into the pure `checkResult`, so the VS Code glue stays thin and the tests and dry-run script use the same code. Every option is optional, so Go, TS/JS and Python checks run as before.

- [ ] **Step 1: Write the failing tests.**

Create `test/baseline.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CheckResult, compareWithBaseline, runBaseline, runSetup, warningCounts } from '../src/aiready/baseline';

const ok = (command: string, extra: Partial<CheckResult> = {}): CheckResult => ({ command, code: 0, failures: [], tail: '', log: '', ...extra });

test('warnings are counted per code and message, without positions or the project path', () => {
	const output = 'Big.cs(3,5): warning CS0219: The variable \'a\' is assigned but its value is never used [/w/App.csproj]\n'
		+ 'Orders.cs(9,1): warning CS0219: The variable \'a\' is assigned but its value is never used [/w/App.csproj]\n'
		+ 'CSC : warning CS8019: Unnecessary using directive. [/w/App.csproj]\nBig.cs(1,1): error CS1002: ; expected [/w/App.csproj]\n';
	assert.deepEqual(warningCounts(output), {
		'CS0219: The variable \'a\' is assigned but its value is never used': 2, 'CS8019: Unnecessary using directive.': 1,
	});
});

test('a step may not print a warning more often than the baseline; fewer is fine, and volatile counts are ignored', () => {
	const build = (warnings: Record<string, number>) => ok('dotnet build', { warnings });
	const baseline = [build({ 'CS0219: x': 1, 'CS0105: y': 1 }), build({ 'CS0219: x': 1, 'CS0105: y': 1, 'NU1603: z': 1 })] as const;
	assert.deepEqual(compareWithBaseline(baseline, build({ 'CS0219: x': 1, 'CS0105: y': 1 })).problems, []);
	assert.deepEqual(compareWithBaseline(baseline, build({ 'CS0219: x': 1 })).problems, []);
	assert.deepEqual(compareWithBaseline(baseline, build({ 'CS0219: x': 1, 'CS0105: y': 1, 'NU1603: z': 3 })).problems, []);
	assert.deepEqual(compareWithBaseline(baseline, build({ 'CS0219: x': 1, 'CS0105: y': 2 })).problems,
		['`dotnet build` printed a warning more often: CS0105: y (1 before, 2 now).']);
	assert.match(compareWithBaseline(baseline, build({ 'CS0219: x': 1, 'CS0105: y': 1, 'IDE0005: u': 1 })).problems.join(' '), /IDE0005: u \(0 before, 1 now\)/);
	assert.deepEqual(compareWithBaseline([ok('go vet'), ok('go vet')], ok('go vet')).problems, []);
});

test('runBaseline passes each check its warnings and results settings and shows every run to `after`', async () => {
	const seen: string[] = [];
	const runner = {
		check: async (command: string, _label: string, _env?: unknown, options?: { warnings?: string; results?: string }) => {
			seen.push(`${command} ${options?.warnings ?? '-'} ${options?.results ?? '-'}`);
			return ok(command);
		},
		cancelled: () => false, progress: () => undefined,
	};
	const after: string[] = [];
	const checks = [{ label: 'build' as const, command: 'dotnet build App.csproj', warnings: 'no-more' as const },
		{ label: 'test' as const, command: 'dotnet test', results: '.my_editor/r' }];
	await runBaseline(checks, runner, async (command, round, result) => {
		after.push(`${command} ${round} ${result.code}`);
	});
	const build = 'dotnet build App.csproj no-more -';
	assert.deepEqual(seen, [build, build, 'dotnet test - .my_editor/r', 'dotnet test - .my_editor/r']);
	assert.deepEqual(after, ['dotnet build App.csproj 1 0', 'dotnet build App.csproj 2 0', 'dotnet test 1 0', 'dotnet test 2 0']);
});
test('runSetup waits for an asynchronous ready()', async () => {
	const runner = { check: async () => ok('x'), cancelled: () => false, progress: () => undefined };
	assert.equal(await runSetup([], runner, async () => [], async () => 'App.csproj: no assets file'), 'App.csproj: no assets file');
});
````

Create `test/checkResult.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { TestRun } from '../src/aiready/baseline';
import { checkResult } from '../src/aiready/checkResult';
import type { ResultFile } from '../src/aiready/language';

const WARNINGS = 'Big.cs(3,5): warning CS0219: x [/w/A.csproj]\nBig.cs(4,1): warning CS0219: x [/w/A.csproj]\n';
const OUTPUT = { code: 0, timedOut: false, stdout: 'out\n', output: WARNINGS };

test('a build result keeps failure lines without positions and, when asked, warning counts', () => {
	const adapter = { parseTests: () => undefined };
	const build = checkResult('dotnet build', 'build', OUTPUT, adapter, { warnings: 'no-more', log: '/l.log' });
	assert.deepEqual([build.failures, build.warnings, build.log, build.tests], [['warning CS0219: x [/w/A.csproj]'], { 'CS0219: x': 2 }, '/l.log', undefined]);
	assert.equal(checkResult('go vet', 'vet', OUTPUT, adapter).warnings, undefined);
});

test('a test result is parsed from stdout, or from both streams, with the results files', () => {
	const seen: [string, readonly ResultFile[] | undefined][] = [];
	const parseTests = (text: string, files?: readonly ResultFile[]): TestRun => {
		seen.push([text, files]);
		return { tests: {}, packages: {} };
	};
	const files = [{ name: 'a.trx', text: '<TestRun/>' }];
	const run = checkResult('dotnet test', 'test', OUTPUT, { parseTests }, { files });
	assert.deepEqual([run.failures, run.tests], [[], { tests: {}, packages: {} }]);
	checkResult('python -m pytest', 'test', OUTPUT, { parseTests, testOutput: 'both' });
	assert.deepEqual(seen, [['out\n', files], [OUTPUT.output, undefined]]);
	assert.equal(checkResult('dotnet test', 'test', { ...OUTPUT, code: undefined, timedOut: true }, { parseTests }).tests, undefined);
});
````

Create `test/projectCommands.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { emptyResults, readResults } from '../src/aiready/projectCommands';

test('readResults reads the files directly in a results folder, sorted, and nothing when it is missing', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-results-'));
	writeFileSync(path.join(dir, 'b.trx'), '<b/>');
	writeFileSync(path.join(dir, 'a.trx'), '<a/>');
	mkdirSync(path.join(dir, 'In'));
	assert.deepEqual(readResults(dir), [{ name: 'a.trx', text: '<a/>' }, { name: 'b.trx', text: '<b/>' }]);
	assert.deepEqual(readResults(path.join(dir, 'missing')), []);
});

test('emptyResults removes what an earlier run left and keeps the folder', () => {
	const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'my-editor-results-')), 'r');
	mkdirSync(path.join(dir, 'In'), { recursive: true });
	writeFileSync(path.join(dir, 'old.trx'), '<old/>');
	emptyResults(dir);
	assert.deepEqual(readResults(dir), []);
	emptyResults(path.join(dir, 'new'));
	assert.deepEqual(readResults(path.join(dir, 'new')), []);
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/baseline.test.ts(3,67): error TS2305: Module '"../src/aiready/baseline"' has no exported member 'warningCounts'.
```

- [ ] **Step 3: Implement.**

The interface first: the check options and result files.

In `src/aiready/language.ts`, replace:

````ts
	readonly env?: Readonly<Record<string, string>>;
}
````

with:

````ts
	readonly env?: Readonly<Record<string, string>>;
	/** `no-more`: warning lines are counted per code and message, and a step may not raise a count (C#), even when the command passes. */
	readonly warnings?: 'no-more';
	/** A worktree-relative folder emptied before the command; the files it holds afterwards go to `parseTests` (C#: TRX files). */
	readonly results?: string;
}

/** What a runner needs from a check besides its command line. */
export type CheckOptions = Pick<CheckCommand, 'warnings' | 'results'>;

/** A file a test command wrote into its `results` folder. */
export interface ResultFile {
	readonly name: string;
	readonly text: string;
}
````

In `src/aiready/language.ts`, replace:

````ts
	setup?(): CheckCommand[];
	/** Why the worktree is not ready after `setup` (TS: a workspace package resolves outside it). */
	ready?(): string | undefined;
	/** A fingerprint of what `setup` installed while its result is in place (TS: the lockfiles' hash while node_modules exists). */
````

with:

````ts
	setup?(): CheckCommand[];
	/** Why the worktree is not ready after `setup` (TS: a workspace package resolves outside it; C#: asks MSBuild, so it may be async). */
	ready?(): string | undefined | Promise<string | undefined>;
	/** A fingerprint of what `setup` installed while its result is in place (TS: the lockfiles' hash while node_modules exists). */
````

In `src/aiready/language.ts`, replace:

````ts
	checks(file: string): CheckCommand[];
	/** Per-test results from a test command's output; undefined when no known format matched (compared by exit code then). */
	parseTests(output: string): TestRun | undefined;
	/** The add-tests fix writes this file. */
````

with:

````ts
	checks(file: string): CheckCommand[];
	/** Per-test results from a test command's output (and its `results` files); undefined when no known format matched (compared by exit code then). */
	parseTests(output: string, files?: readonly ResultFile[]): TestRun | undefined;
	/** The add-tests fix writes this file. */
````

Warning counts, the comparison that only lets them shrink, `after` for each baseline run, and an async `ready()`:

In `src/aiready/baseline.ts`, replace:

````ts
import type { CheckCommand } from './language';

````

with:

````ts
import type { CheckCommand, CheckOptions } from './language';

````

In `src/aiready/baseline.ts`, replace:

````ts
	readonly tests?: TestRun;
	readonly tail: string;
````

with:

````ts
	readonly tests?: TestRun;
	/** For a check with `warnings: 'no-more'`: how often each warning (code and message) was printed. */
	readonly warnings?: Readonly<Record<string, number>>;
	readonly tail: string;
````

In `src/aiready/baseline.ts`, replace:

````ts
	return [...new Set(output.split(/\r?\n/).map(line => line.trim().replace(POSITION, '')).filter(Boolean))].sort();
}
````

with:

````ts
	return [...new Set(output.split(/\r?\n/).map(line => line.trim().replace(POSITION, '')).filter(Boolean))].sort();
}

const WARNING = /: warning ([A-Za-z]+\d+): (.*?)(?: \[[^\]]*\])?$/;

/** Warning lines (`Big.cs(3,5): warning CS0219: message [/w/App.csproj]`) counted per code and message; positions and paths are dropped. */
export function warningCounts(output: string): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const line of output.split(/\r?\n/)) {
		const match = WARNING.exec(line.trim());
		if (match) { counts[`${match[1]}: ${match[2]}`] = (counts[`${match[1]}: ${match[2]}`] ?? 0) + 1; }
	}
	return counts;
}

/** Warnings that grew: counted more often than in the first baseline run, unless the two baseline runs already differed on them. */
function moreWarnings(first: CheckResult, second: CheckResult, now: CheckResult): string[] {
	if (!first.warnings || !now.warnings) { return []; }
	const before = first.warnings;
	return Object.entries(now.warnings).filter(([key, count]) => count > (before[key] ?? 0) && (second.warnings?.[key] ?? 0) === (before[key] ?? 0))
		.map(([key, count]) => `\`${now.command}\` printed a warning more often: ${key} (${before[key] ?? 0} before, ${count} now).`);
}
````

In `src/aiready/baseline.ts`, replace:

````ts
		}
		return { problems, newFailing: [] };
````

with:

````ts
		}
		problems.push(...moreWarnings(first, second, now));
		return { problems, newFailing: [] };
````

In `src/aiready/baseline.ts`, replace:

````ts
export interface BaselineRunner {
	/** `env` is the check's own `CheckCommand.env`, set over the adapter's `commandEnv`. */
	readonly check: (command: string, label: string, env?: Readonly<Record<string, string>>) => Promise<CheckResult>;
	readonly cancelled: () => boolean;
````

with:

````ts
export interface BaselineRunner {
	/** `env` is the check's own `CheckCommand.env`, set over the adapter's `commandEnv`; `options` its warnings and results settings. */
	readonly check: (command: string, label: string, env?: Readonly<Record<string, string>>, options?: CheckOptions) => Promise<CheckResult>;
	readonly cancelled: () => boolean;
````

In `src/aiready/baseline.ts`, replace:

````ts
export async function runSetup(commands: readonly CheckCommand[], runner: BaselineRunner, changed: () => Promise<string[]>,
	ready: () => string | undefined, installed = false): Promise<string | 'stopped' | undefined> {
	if (!commands.length || installed) { return ready(); }
````

with:

````ts
export async function runSetup(commands: readonly CheckCommand[], runner: BaselineRunner, changed: () => Promise<string[]>,
	ready: () => string | undefined | Promise<string | undefined>, installed = false): Promise<string | 'stopped' | undefined> {
	if (!commands.length || installed) { return ready(); }
````

In `src/aiready/baseline.ts`, replace:

````ts
 * Runs every check twice on the untouched branch. A run that timed out or did not start leaves nothing to compare
 * with, so the run stops with what to change.
 */
export async function runBaseline(checks: readonly CheckCommand[], runner: BaselineRunner): Promise<BaselineOutcome> {
	const baseline: Record<string, readonly [CheckResult, CheckResult]> = {};
	for (const { command, label, env } of checks) {
		const runs: CheckResult[] = [];
		for (const round of [1, 2]) {
			runner.progress(`Baseline ${round} of 2: \`${command}\`…`);
			const result = await runner.check(command, label, env);
			if (runner.cancelled()) { return { stopped: true }; }
````

with:

````ts
 * Runs every check twice on the untouched branch. A run that timed out or did not start leaves nothing to compare
 * with, so the run stops with what to change. `after` sees each run (C#: the assembly dump of each baseline build).
 */
export async function runBaseline(checks: readonly CheckCommand[], runner: BaselineRunner,
	after?: (command: string, round: number, result: CheckResult) => Promise<void>): Promise<BaselineOutcome> {
	const baseline: Record<string, readonly [CheckResult, CheckResult]> = {};
	for (const { command, label, env, warnings, results } of checks) {
		const runs: CheckResult[] = [];
		for (const round of [1, 2]) {
			runner.progress(`Baseline ${round} of 2: \`${command}\`…`);
			const result = await runner.check(command, label, env, { warnings, results });
			if (runner.cancelled()) { return { stopped: true }; }
````

In `src/aiready/baseline.ts`, replace:

````ts
			runs.push(result);
		}
````

with:

````ts
			runs.push(result);
			await after?.(command, round, result);
		}
````

The result a check becomes:

Create `src/aiready/checkResult.ts`:

````ts
import { CheckResult, failureLines, warningCounts } from './baseline';
import type { CheckOptions, LanguageAdapter, ResultFile } from './language';
import { CommandOutput, tail } from './projectCommands';

const MAX_FAILURE_LINES = 200;

/**
 * A finished command as the comparison reads it: failure lines (for builds), per-test results from its output and
 * its `results` files (for tests), and warning counts when the check asks for them.
 */
export function checkResult(command: string, label: string, output: CommandOutput, adapter: Pick<LanguageAdapter, 'parseTests' | 'testOutput'>,
	options: CheckOptions & { readonly log?: string; readonly files?: readonly ResultFile[] } = {}): CheckResult {
	const text = adapter.testOutput === 'both' ? output.output : output.stdout;
	return {
		command, label, code: output.code, timedOut: output.timedOut, log: options.log ?? '',
		failures: label === 'test' ? [] : failureLines(output.error ?? output.output).slice(0, MAX_FAILURE_LINES),
		tests: label === 'test' && output.code !== undefined ? adapter.parseTests(text, options.files) : undefined,
		...(options.warnings === 'no-more' ? { warnings: warningCounts(output.output) } : {}),
		tail: tail(output.error ?? output.output),
	};
}
````

In `src/aiready/projectCommands.ts`, replace:

````ts
import { ChildProcess, spawn } from 'child_process';
import { accessSync, constants, createWriteStream, mkdirSync } from 'fs';
import * as path from 'path';
````

with:

````ts
import { ChildProcess, spawn } from 'child_process';
import { accessSync, constants, createWriteStream, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import * as path from 'path';
````

In `src/aiready/projectCommands.ts`, replace:

````ts

/** The last lines of a command's output, for Pair. */
````

with:

````ts

/** Empties a check's `results` folder before its command runs, so files of an earlier run are never read as this run's. */
export function emptyResults(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
}

/** The files directly in a check's `results` folder (C#: one TRX file per test project and target framework), as text. */
export function readResults(dir: string): { name: string; text: string }[] {
	try {
		return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name).sort()
			.map(name => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }));
	} catch { return []; }
}

/** The last lines of a command's output, for Pair. */
````

`runCheck` empties the results folder and hands the rest to `checkResult`:

In `src/aiready/fixSetup.ts`, replace:

````ts
import type { Sink } from '../chat/engine';
import { CheckResult, failureLines, runBaseline, runSetup } from './baseline';
import { fixChoices, pickFixes, skippedWithLines } from './fixPicker';
````

with:

````ts
import type { Sink } from '../chat/engine';
import { CheckResult, runBaseline, runSetup } from './baseline';
import { checkResult } from './checkResult';
import { fixChoices, pickFixes, skippedWithLines } from './fixPicker';
````

In `src/aiready/fixSetup.ts`, replace:

````ts
import { fileStats, scanHealth } from './health';
import type { LanguageAdapter } from './language';
import { runCommand, tail } from './projectCommands';
import { changedFiles, discard, freeFolder, initRepository, prepare, prerequisites, trackedFiles, Worktree } from './worktree';

const MAX_FAILURE_LINES = 200;

````

with:

````ts
import { fileStats, scanHealth } from './health';
import type { CheckOptions, LanguageAdapter } from './language';
import { emptyResults, readResults, runCommand } from './projectCommands';
import { changedFiles, discard, freeFolder, initRepository, prepare, prerequisites, trackedFiles, Worktree } from './worktree';

````

In `src/aiready/fixSetup.ts`, replace:

````ts
export async function runCheck(env: CommandEnv, adapter: LanguageAdapter, worktree: string, approved: readonly string[],
	command: string, label: string, extra?: Readonly<Record<string, string>>): Promise<CheckResult> {
	const log = path.join(logDir(env.storage, env.root), `${Date.now()}-${label}.log`);
	const output = await runCommand(command, {
		cwd: worktree, approved, timeoutMs: timeoutMs(), logFile: log, cancel: env.token, env: { ...adapter.commandEnv, ...extra },
	});
	return {
		command, label, code: output.code, timedOut: output.timedOut, log,
		failures: label === 'test' ? [] : failureLines(output.error ?? output.output).slice(0, MAX_FAILURE_LINES),
		tests: label === 'test' && output.code !== undefined ? adapter.parseTests(adapter.testOutput === 'both' ? output.output : output.stdout) : undefined,
		tail: tail(output.error ?? output.output),
	};
}
````

with:

````ts
export async function runCheck(env: CommandEnv, adapter: LanguageAdapter, worktree: string, approved: readonly string[],
	command: string, label: string, extra?: Readonly<Record<string, string>>, options: CheckOptions = {}): Promise<CheckResult> {
	const log = path.join(logDir(env.storage, env.root), `${Date.now()}-${label}.log`);
	const results = options.results && path.join(worktree, options.results);
	if (results) { emptyResults(results); }
	const output = await runCommand(command, {
		cwd: worktree, approved, timeoutMs: timeoutMs(), logFile: log, cancel: env.token, env: { ...adapter.commandEnv, ...extra },
	});
	return checkResult(command, label, output, adapter, { ...options, log, files: results ? readResults(results) : undefined });
}
````

In `src/aiready/fixSetup.ts`, replace:

````ts
		const outcome = await runBaseline(checks, {
			check: (command, label, extra) => runCheck(env, inWorktree, worktree.path, approved, command, label, extra),
			cancelled: () => token.isCancellationRequested,
````

with:

````ts
		const outcome = await runBaseline(checks, {
			check: (command, label, extra, options) => runCheck(env, inWorktree, worktree.path, approved, command, label, extra, options),
			cancelled: () => token.isCancellationRequested,
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/pyPrompts.ts",
    "src/aiready/pyAdapter.ts"
  ]
````

with:

````json
    "src/aiready/pyPrompts.ts",
    "src/aiready/pyAdapter.ts",
    "src/aiready/checkResult.ts"
  ]
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 356
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/baseline.ts src/aiready/checkResult.ts src/aiready/fixSetup.ts src/aiready/language.ts src/aiready/projectCommands.ts test/baseline.test.ts test/checkResult.test.ts test/projectCommands.test.ts tsconfig.test.json
git commit -m "AI-ready core: warning counts, result files, checkResult"
```

## Chunk 2: Host plans and the assembly check in the core

### Task 2: Host plans, the assembly check around a step, braces and split findings

**Files:**
- Create: `test/changeNote.test.ts`, `test/fixPicker.test.ts`, `test/fixText.test.ts`, `test/moveCheck.test.ts`, `test/steps.test.ts`
- Modify: `src/aiready/changeNote.ts`, `src/aiready/fixPicker.ts`, `src/aiready/fixRun.ts`, `src/aiready/fixSetup.ts`, `src/aiready/fixText.ts`, `src/aiready/language.ts`, `src/aiready/moveCheck.ts`, `src/aiready/steps.ts`

Every hook is optional: an adapter without `plan` is planned by the model, one without `assemblyCheck` has no rule 6, one without `membershipProblems` has no rule 4 build part, and `collapse` keeps its output for LF files in the `one` and `longest` modes.

- [ ] **Step 1: Write the failing tests.**

Create `test/steps.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import type { CheckResult } from '../src/aiready/baseline';
import type { AssemblyCheck, Declaration, FileInfo, LanguageAdapter, SplitPlan, SplitResult } from '../src/aiready/language';
import { collapse, declarationProblems } from '../src/aiready/moveCheck';
import { runSplit, StepContext } from '../src/aiready/steps';

const HEADER = '// split\n\n';
const FIX = { file: 'Big.cs', kind: 'split' as const, lines: 0 };

/** What the fake assembly check answers, and every call it got. */
interface Answers {
	readonly snapshot: string[];
	readonly compare: string[];
	readonly calls: string[];
}

function ok(command: string): CheckResult {
	return { command, code: 0, failures: [], tail: '', log: '' };
}

/** `class X` lines as declarations, each spanning its line. */
function parseLines(root: string, file: string): FileInfo {
	const text = readFileSync(path.join(root, file), 'utf8');
	const declarations = [...text.matchAll(/^class (\w+)$/gm)].map((m, id): Declaration => ({
		id, kind: 'class', names: [m[1]], span: { start: m.index, end: m.index + m[0].length }, lines: 1, doc: '', docText: '', uses: [], movable: true,
	}));
	const header = text.startsWith(HEADER) ? { frame: [{ start: 0, end: HEADER.length }], prelude: { start: 0, end: HEADER.length } } : { frame: [] };
	return { path: file, declarations, imports: [], ...header };
}

/** Each group's lines in a new file after the header; the original without them, blank lines collapsed. */
function splitLines(source: Buffer, info: FileInfo, plan: SplitPlan): SplitResult {
	const text = source.toString('utf8');
	const line = (id: number) => text.slice(info.declarations[id].span.start, info.declarations[id].span.end);
	const moved = new Set(plan.flatMap(group => group.declarations).map(line));
	const items = text.slice(0, -1).split('\n').map(l => (moved.has(l) ? undefined : l));
	const files = plan.map(group => ({ name: group.file, text: Buffer.from(`${HEADER}${group.declarations.map(line).join('\n')}\n`) }));
	return { original: Buffer.from(`${collapse(items).join('\n')}\n`), files };
}

/** A fake assembly check that records its calls and answers as the test says. */
function assemblyCheck(answers: Answers): AssemblyCheck {
	return {
		baseline: async () => undefined,
		async snapshot(file, run) {
			answers.calls.push(`snapshot ${file} ${(await run('build', 'build')).code}`);
			return answers.snapshot;
		},
		async compare(file, files) {
			answers.calls.push(`compare ${file} ${files.join(',')}`);
			return answers.compare;
		},
	};
}

/** A tiny adapter over `class X` lines, with a host plan (every line but the first to its own file) and the fake assembly check. */
function lineAdapter(root: string, answers: Answers): LanguageAdapter {
	const none = () => ({ system: '', text: '' });
	return {
		id: 'lines', label: 'Lines', extensions: ['.cs'], assemblyCheck: assemblyCheck(answers),
		parse: async file => parseLines(root, file),
		plan: info => info.declarations.slice(1).map(d => ({ file: `${d.names[0]}.cs`, declarations: [d.id] })),
		fileNameProblems: () => [], splitHeader: () => HEADER, buildSplit: splitLines, sameDeclarations: declarationProblems,
		async membershipProblems(file, files) {
			answers.calls.push(`membership ${file} ${files.join(',')}`);
			return [];
		},
		unitFiles: async () => ['Big.cs', 'B.cs', 'C.cs'].filter(f => existsSync(path.join(root, f))),
		unformatted: async () => [], checks: () => [{ label: 'build', command: 'build', verifies: true }], parseTests: () => undefined,
		testFileName: f => f, testNames: () => [], testProblems: () => [], splitPrompt: none, testPrompt: none,
	};
}

function repository(): string {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-hostplan-'));
	writeFileSync(path.join(root, 'Big.cs'), 'class Big\n\nclass B\n\nclass C\n');
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	git('init', '--quiet');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	return root;
}

function context(root: string, adapter: LanguageAdapter): StepContext {
	const ask = async (): Promise<string> => {
		throw new Error('the model must not be asked');
	};
	const baseline = { build: [ok('build'), ok('build')] as const };
	return { adapter, worktree: root, baseline, flaky: [], cancelled: () => false, progress: () => undefined, ask, check: async command => ok(command) };
}

test('steps: the host plan is used without the model; membership is checked, the assembly built before and compared after', async () => {
	const root = repository();
	const answers = { snapshot: [], compare: [], calls: [] };
	const step = await runSplit(context(root, lineAdapter(root, answers)), FIX);
	assert.equal(step !== 'stopped' && step.status, 'committed', JSON.stringify(step));
	assert.equal(step !== 'stopped' && step.plan?.attempts, 0);
	assert.deepEqual(answers.calls, ['snapshot Big.cs 0', 'membership Big.cs B.cs,C.cs', 'compare Big.cs B.cs,C.cs']);
	assert.equal(readFileSync(path.join(root, 'Big.cs'), 'utf8'), 'class Big\n');
	assert.equal(readFileSync(path.join(root, 'C.cs'), 'utf8'), '// split\n\nclass C\n');
});

test('steps: a different assembly refuses and restores the step', async () => {
	const root = repository();
	const step = await runSplit(context(root, lineAdapter(root, { snapshot: [], compare: ['Rule 6: App.Big differs.'], calls: [] })), FIX);
	assert.equal(step !== 'stopped' && `${step.status}: ${step.reason}`, 'refused: The move check failed: Rule 6: App.Big differs.');
	assert.ok(!existsSync(path.join(root, 'B.cs')));
	assert.match(readFileSync(path.join(root, 'Big.cs'), 'utf8'), /class C/);
});

test('steps: a failed snapshot skips the step before anything is written', async () => {
	const root = repository();
	const answers = { snapshot: ['The build of HEAD is not reproducible.'], compare: [], calls: [] };
	const step = await runSplit(context(root, lineAdapter(root, answers)), FIX);
	assert.equal(step !== 'stopped' && `${step.status}: ${step.reason}`, 'skipped: The build of HEAD is not reproducible.');
	assert.deepEqual(answers.calls, ['snapshot Big.cs 0']);
	assert.ok(!existsSync(path.join(root, 'B.cs')));
});

test('steps: a host plan of nothing is refused without asking the model', async () => {
	const root = repository();
	const adapter = { ...lineAdapter(root, { snapshot: [], compare: [], calls: [] }), plan: () => undefined };
	const step = await runSplit(context(root, adapter), FIX);
	assert.equal(step !== 'stopped' && `${step.status}: ${step.reason}`, 'refused: The split plan was refused: Nothing in it may move.');
});
````

Create `test/moveCheck.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Declaration, FileInfo, ParsedFile } from '../src/aiready/language';
import { checkMove, collapse } from '../src/aiready/moveCheck';

test('collapse keeps a CRLF blank line as \\r, and in braces mode leaves none next to a brace line', () => {
	const gap = undefined;
	assert.deepEqual(collapse(['a\r', '\r', gap, '\r', 'b\r']), ['a\r', '\r', 'b\r']);
	assert.deepEqual(collapse(['{\r', gap, '\r', 'b\r'], 'braces'), ['{\r', 'b\r']);
	assert.deepEqual(collapse(['a\r', '\r', gap, '}\r'], 'braces'), ['a\r', '}\r']);
	assert.deepEqual(collapse(['a', '', gap, '', 'b'], 'braces'), ['a', '', 'b']);
	assert.deepEqual(collapse(['{', gap, '', 'b']), ['{', '', 'b']);
});

function parsed(text: string, info: Partial<FileInfo>): ParsedFile {
	return { text: Buffer.from(text), info: { path: 'Big.cs', declarations: [], frame: [], imports: [], ...info } };
}

test('move check: a CRLF file with a BOM keeps its bytes when a type leaves a block namespace (braces mode)', () => {
	const head = '\ufeff// Split from Big.cs by my_editor.\r\n\r\n';
	const before = '\ufeffusing System;\r\n\r\nnamespace App\r\n{\r\n    class A {}\r\n\r\n    class B {}\r\n}\r\n';
	const after = '\ufeffusing System;\r\n\r\nnamespace App\r\n{\r\n    class A {}\r\n}\r\n';
	const moved = `${head}using System;\r\n\r\nnamespace App\r\n{\r\n    class B {}\r\n}\r\n`;
	const off = (text: string, index: number) => Buffer.byteLength(text.slice(0, index));
	const type = (id: number, text: string, name: string): Declaration => {
		const at = text.indexOf(`    class ${name}`);
		const span = { start: off(text, at), end: off(text, text.indexOf('\n', at)) };
		return { id, kind: 'class', names: [name], span, lines: 1, doc: '', docText: '', uses: [], movable: true };
	};
	const cut = (text: string, from: string, to: string) => ({ start: off(text, text.indexOf(from)), end: off(text, text.indexOf(to)) });
	const frame = [cut(moved, '\ufeff', 'using'), cut(moved, 'using', 'namespace'), cut(moved, 'namespace', '    class'),
		{ start: off(moved, moved.lastIndexOf('}')), end: Buffer.byteLength(moved) }];
	const input = {
		before: parsed(before, { declarations: [type(0, before, 'A'), type(1, before, 'B')] }),
		after: parsed(after, { declarations: [type(0, after, 'A')] }),
		files: [parsed(moved, { path: 'B.cs', declarations: [type(0, moved, 'B')], frame, prelude: { start: 0, end: Buffer.byteLength(head) } })],
		plan: [{ file: 'B.cs', declarations: [1] }], header: head, importProblems: () => [],
	};
	assert.deepEqual(checkMove({ ...input, blankLines: 'braces' }), []);
	assert.match(checkMove(input).join(' '), /Rule 2: Big.cs changed beyond the moved spans/);
});
````

Create `test/fixPicker.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fixChoices } from '../src/aiready/fixPicker';

test('fixChoices offers one split per file for each finding a split fixes', () => {
	const stats = [{ path: 'Big.cs', lines: 600, classes: [], inlineTests: false }, { path: 'Two.cs', lines: 20, classes: [], inlineTests: false }];
	const findings = [{ kind: 'too-long' as const, file: 'Big.cs', text: '' }, { kind: 'many-classes' as const, file: 'Big.cs', text: '' },
		{ kind: 'many-classes' as const, file: 'Two.cs', text: '' }];
	assert.deepEqual(fixChoices(findings, stats, ['.cs'], new Map(), new Map(), ['too-long', 'many-classes']).map(c => `${c.file} ${c.kind}`),
		['Big.cs split', 'Two.cs split']);
	assert.deepEqual(fixChoices(findings, stats, ['.cs'], new Map()).map(c => `${c.file} ${c.kind}`), ['Big.cs split']);
});
````

Create `test/fixText.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { approvalDetail, narrowedText } from '../src/aiready/fixText';

test('the approval modal uses the adapter\'s install wording when it has one, and the npm wording otherwise', () => {
	const restore = 'my_editor runs `dotnet restore` once. ';
	const cs = approvalDetail('/p/w', ['dotnet restore Shop.sln', 'dotnet build Shop/Shop.csproj'], 'C#', 1, true, '', restore);
	assert.match(cs, /dotnet build Shop\/Shop\.csproj\n\nmy_editor runs `dotnet restore` once\. The others build the project/);
	assert.doesNotMatch(cs, /lockfile|\.npmrc/);
	assert.match(approvalDetail('/p/w', ['npm ci', 'npm test'], 'TypeScript/JavaScript', 1, true), /chose `npm ci` from the lockfile/);
	assert.doesNotMatch(approvalDetail('/p/w', ['go build ./...'], 'Go', 1, false, '', restore), /dotnet restore/);
});

test('the narrowed line keeps the run-time code sentence for TypeScript/JavaScript only', () => {
	assert.equal(narrowedText(['only types may move (x)'], 'TypeScript/JavaScript'),
		'In this project only types may move (x), so splits leave the run-time code in place.\n');
	assert.equal(narrowedText(['only interfaces … may move (y)', 'z'], 'C#'), 'In this project only interfaces … may move (y); and z.\n');
});
````

Create `test/changeNote.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderChangeNote } from '../src/aiready/changeNote';
import type { RunState } from '../src/aiready/fixState';

test('the types-only sentence is for TypeScript/JavaScript only; a narrowed C# split keeps its own wording', () => {
	const fix = { file: 'Shop/Big.cs', kind: 'split' as const, lines: 500, narrowed: 'only interfaces, enums, delegates … may move' };
	const step = { file: 'Shop/Big.cs', kind: 'split' as const, status: 'committed' as const, commit: 'abcdef1234', moved: [] };
	const state: RunState = {
		version: 1, root: '/p/shop', language: 'C#', worktree: { branch: 'b', path: '/p/w', base: '0123456789abcdef' }, startedAt: '2026-10-10T10:00:00Z',
		approved: [], fixes: [fix], next: 1, steps: [step], baseline: {}, skippedFiles: [],
	};
	const at = new Date('2026-10-10T12:00:00Z');
	assert.doesNotMatch(renderChangeNote(state, at, 'C# note.'), /types-only/);
	const ts: RunState = { ...state, language: 'TypeScript/JavaScript', fixes: [{ ...fix, file: 'a.ts' }], steps: [{ ...step, file: 'a.ts' }] };
	assert.match(renderChangeNote(ts, at, 'TS note.'), /moved in a types-only project/);
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/fixPicker.test.ts(9,78): error TS2554: Expected 4-5 arguments, but got 6.
```

- [ ] **Step 3: Implement.**

In `src/aiready/language.ts`, replace:

````ts
import type { TestRun } from './baseline';

````

with:

````ts
import type { CheckResult, TestRun } from './baseline';
import type { BlankLines } from './moveCheck';

````

In `src/aiready/language.ts`, replace:

````ts

export interface Prompt {
````

with:

````ts

/** Runs one approved command in the worktree (the build a check approved). */
export type CheckRunner = (command: string, label: string) => Promise<CheckResult>;

/** Move rule 6 for compiled languages (C#): what the build produced must be the same before and after a split. */
export interface AssemblyCheck {
	/** After each baseline run of a check, so it can tell whether building the same commit twice gives the same result. */
	baseline(command: string, round: number, result: CheckResult): Promise<void>;
	/** Before the split is written, while the worktree is at the last commit: build and record the reference. Problems skip the step. */
	snapshot(file: string, run: CheckRunner): Promise<string[]>;
	/** After the checks passed: how what was built differs from the snapshot; empty means the same. */
	compare(file: string, newFiles: readonly string[], run: CheckRunner): Promise<string[]>;
}

export interface Prompt {
````

In `src/aiready/language.ts`, replace:

````ts
	readonly mayDiffer: string;
}
````

with:

````ts
	readonly mayDiffer: string;
	/** The health findings a split fixes; `too-long` when absent (C#: also `many-classes`, one type per file). */
	readonly splitFindings?: readonly string[];
}
````

In `src/aiready/language.ts`, replace:

````ts
	readonly commandEnv?: Readonly<Record<string, string>>;
	/** How blank lines around a removed span collapse: to one (the default), or to the longer bordering run, at most two (Python). */
	readonly blankLines?: 'one' | 'longest';
	/** Said in the approval modal before anything runs (Python: the interpreter, its version and `sys.prefix`). */
	readonly approvalNote?: string;
	/** Which output `parseTests` reads: stdout (the default), or stdout and stderr together (Python: unittest reports on stderr). */
````

with:

````ts
	readonly commandEnv?: Readonly<Record<string, string>>;
	/**
	 * How blank lines around a removed span collapse: to one (the default), to the longer bordering run, at most two
	 * (Python), or to one but none next to a brace line (C#).
	 */
	readonly blankLines?: BlankLines;
	/** Said in the approval modal before anything runs (Python: the interpreter, its version and `sys.prefix`). */
	readonly approvalNote?: string;
	/** What the `setup` commands do, for the approval modal, when the npm wording does not fit (C#: `dotnet restore`). */
	readonly installNote?: string;
	/** Which output `parseTests` reads: stdout (the default), or stdout and stderr together (Python: unittest reports on stderr). */
````

In `src/aiready/language.ts`, replace:

````ts
	parse(file: string): Promise<FileInfo>;
	/** The fix kinds it offers; both when absent. */
````

with:

````ts
	parse(file: string): Promise<FileInfo>;
	/** The host's own split plan (C#: every movable type to its own file); when present the model is not asked. Undefined when nothing may move. */
	plan?(info: FileInfo): SplitPlan | undefined;
	/** Move rule 6 (C#): the compiled output before and after each split. */
	readonly assemblyCheck?: AssemblyCheck;
	/** The health findings a split fixes; `too-long` when absent. */
	readonly splitFindings?: readonly string[];
	/** The fix kinds it offers; both when absent. */
````

In `src/aiready/language.ts`, replace:

````ts
	sameDeclarations(before: readonly FileInfo[], after: readonly FileInfo[]): string[];
	/** The files rule 4 compares (Go: the package's files). */
````

with:

````ts
	sameDeclarations(before: readonly FileInfo[], after: readonly FileInfo[]): string[];
	/** Move rule 4's build part, on the files as written (C#: each new file is compiled by the original's project only, asked from MSBuild). */
	membershipProblems?(file: string, newFiles: readonly string[]): Promise<string[]>;
	/** The files rule 4 compares (Go: the package's files). */
````

The `braces` blank-line mode, and a kept blank line keeps its `\r`:

In `src/aiready/moveCheck.ts`, replace:

````ts
	/** How blank lines around a removed span collapse (`LanguageAdapter.blankLines`); one by default. */
	readonly blankLines?: 'one' | 'longest';
}

````

with:

````ts
	/** How blank lines around a removed span collapse (`LanguageAdapter.blankLines`); one by default. */
	readonly blankLines?: BlankLines;
}

/** How blank lines around a removed span collapse: see `collapse`. */
export type BlankLines = 'one' | 'longest' | 'braces';

````

In `src/aiready/moveCheck.ts`, replace:

````ts
 * Each run of blank lines and gaps that holds a gap becomes one blank line if it held a blank line, else nothing; with
 * `longest`, as many blank lines as its longest unbroken stretch of them, at most two. At the end, nothing.
 */
export function collapse(items: readonly (string | undefined)[], mode: 'one' | 'longest' = 'one'): string[] {
	const out: string[] = [];
````

with:

````ts
 * Each run of blank lines and gaps that holds a gap becomes one blank line if it held a blank line, else nothing; with
 * `longest`, as many blank lines as its longest unbroken stretch of them, at most two; with `braces`, one, but none
 * right after a line ending in `{` or right before one starting with `}` (C#: a type removed first or last in a block
 * namespace). At the end, nothing. A blank line is one that is empty after removing `\r`, and a kept one keeps the `\r`.
 */
export function collapse(items: readonly (string | undefined)[], mode: BlankLines = 'one'): string[] {
	const out: string[] = [];
````

In `src/aiready/moveCheck.ts`, replace:

````ts
		}
		if (!gap) { out.push(...(items.slice(i, j) as string[])); }
		else if (longest && j < items.length) { out.push(...Array<string>(mode === 'longest' ? Math.min(longest, 2) : 1).fill('')); }
		i = j;
````

with:

````ts
		}
		const braced = mode === 'braces' && (!!out[out.length - 1]?.trimEnd().endsWith('{') || (j < items.length && items[j]!.trim().startsWith('}')));
		const blank = items.slice(i, j).some(item => item?.endsWith('\r')) ? '\r' : '';
		if (!gap) { out.push(...(items.slice(i, j) as string[])); }
		else if (longest && j < items.length && !braced) { out.push(...Array<string>(mode === 'longest' ? Math.min(longest, 2) : 1).fill(blank)); }
		i = j;
````

The host plan replaces the model call; rule 6 builds before the split is written and compares after the checks pass; rule 4's build part runs with the move check:

In `src/aiready/steps.ts`, replace:

````ts
import type { FixChoice, StepRecord } from './fixState';
import type { FileInfo, LanguageAdapter, SplitPlan } from './language';
import { checkMove } from './moveCheck';
````

with:

````ts
import type { FixChoice, StepRecord } from './fixState';
import type { CheckOptions, FileInfo, LanguageAdapter, SplitPlan } from './language';
import { checkMove } from './moveCheck';
````

In `src/aiready/steps.ts`, replace:

````ts
	/** Runs one approved command in the worktree and parses its output. */
	readonly check: (command: string, label: string, env?: Readonly<Record<string, string>>) => Promise<CheckResult>;
	readonly baseline: Readonly<Record<string, readonly [CheckResult, CheckResult]>>;
````

with:

````ts
	/** Runs one approved command in the worktree and parses its output. */
	readonly check: (command: string, label: string, env?: Readonly<Record<string, string>>, options?: CheckOptions) => Promise<CheckResult>;
	readonly baseline: Readonly<Record<string, readonly [CheckResult, CheckResult]>>;
````

In `src/aiready/steps.ts`, replace:

````ts
		ctx.progress(`Running \`${check.command}\`…`);
		const result = await ctx.check(check.command, check.label, check.env);
		if (ctx.cancelled()) { return { results, problems: [], newFailing, stopped: true }; }
````

with:

````ts
		ctx.progress(`Running \`${check.command}\`…`);
		const result = await ctx.check(check.command, check.label, check.env, check);
		if (ctx.cancelled()) { return { results, problems: [], newFailing, stopped: true }; }
````

In `src/aiready/steps.ts`, replace:

````ts

/** One split: plan with the model (one retry), apply without AI, move check, build and tests, then commit or restore. */
export async function runSplit(ctx: StepContext, fix: FixChoice): Promise<StepOutcome> {
````

with:

````ts

/**
 * One split: plan with the model (one retry) or take the adapter's own plan, apply without AI, move check, build and
 * tests (and the adapter's assembly check), then commit or restore.
 */
export async function runSplit(ctx: StepContext, fix: FixChoice): Promise<StepOutcome> {
````

In `src/aiready/steps.ts`, replace:

````ts
	const input = { source, info, existing: readdirSync(path.dirname(abs(fix.file))) };
	const prompt = adapter.splitPrompt(info, sourceLines(source.toString('utf8')));
	ctx.progress(`Planning how to split ${fix.file}…`);
	let reply = await ctx.ask(prompt.system, prompt.text);
	asked++;
	let plan = parsePlan(reply);
	let problems = plan ? planProblems(adapter, input, plan) : ['The reply was not a JSON array of {"file", "declarations"}.'];
	if (problems.length && !ctx.cancelled()) {
		rejected.push(problems.slice(0, 5).join(' '));
		reply = await ctx.ask(prompt.system, retryText(prompt, reply, problems));
		asked++;
		plan = parsePlan(reply);
		problems = plan ? planProblems(adapter, input, plan) : ['The reply was not a JSON array of {"file", "declarations"}.'];
	}
	if (ctx.cancelled()) { return 'stopped'; }
	if (problems.length || !plan) {
		rejected.push(problems.slice(0, 5).join(' '));
		return done('refused', `The split plan was rejected twice: ${problems.slice(0, 5).join(' ')}`);
	}
````

with:

````ts
	const input = { source, info, existing: readdirSync(path.dirname(abs(fix.file))) };
	let plan: SplitPlan | undefined;
	if (adapter.plan) {
		plan = adapter.plan(info);
		const problems = plan ? planProblems(adapter, input, plan) : ['Nothing in it may move.'];
		if (!plan || problems.length) { return done('refused', `The split plan was refused: ${problems.slice(0, 5).join(' ')}`); }
	} else {
		const prompt = adapter.splitPrompt(info, sourceLines(source.toString('utf8')));
		ctx.progress(`Planning how to split ${fix.file}…`);
		let reply = await ctx.ask(prompt.system, prompt.text);
		asked++;
		plan = parsePlan(reply);
		let problems = plan ? planProblems(adapter, input, plan) : ['The reply was not a JSON array of {"file", "declarations"}.'];
		if (problems.length && !ctx.cancelled()) {
			rejected.push(problems.slice(0, 5).join(' '));
			reply = await ctx.ask(prompt.system, retryText(prompt, reply, problems));
			asked++;
			plan = parsePlan(reply);
			problems = plan ? planProblems(adapter, input, plan) : ['The reply was not a JSON array of {"file", "declarations"}.'];
		}
		if (ctx.cancelled()) { return 'stopped'; }
		if (problems.length || !plan) {
			rejected.push(problems.slice(0, 5).join(' '));
			return done('refused', `The split plan was rejected twice: ${problems.slice(0, 5).join(' ')}`);
		}
	}
	const assembly = adapter.assemblyCheck;
	const run = (command: string, label: string) => ctx.check(command, label);
	if (assembly) {
		ctx.progress(`Building the project of ${fix.file} before the split…`);
		const problems = await assembly.snapshot(fix.file, run);
		if (ctx.cancelled()) { return 'stopped'; }
		if (problems.length) { return done('skipped', problems.join(' ')); }
	}
````

In `src/aiready/steps.ts`, replace:

````ts
				: `Other tracked files changed: ${changed.join(', ')}.`);
		}
````

with:

````ts
				: `Other tracked files changed: ${changed.join(', ')}.`);
		}
		if (assembly) {
			ctx.progress(`Comparing what ${fix.file}'s project compiles to…`);
			const differs = await assembly.compare(fix.file, newFiles, run);
			if (ctx.cancelled() || differs.length) {
				await restore(worktree, newFiles);
				return ctx.cancelled() ? 'stopped' : done('refused', `The move check failed: ${differs.slice(0, 3).join(' ')}`);
			}
		}
````

In `src/aiready/steps.ts`, replace:

````ts
		...adapter.sameDeclarations(facts.unitBefore, unitAfter),
	];
````

with:

````ts
		...adapter.sameDeclarations(facts.unitBefore, unitAfter),
		...(await adapter.membershipProblems?.(file, newFiles) ?? []),
	];
````

In `src/aiready/fixPicker.ts`, replace:

````ts
 * The fixes a run can offer, from the deterministic health findings (re-scanned at fix time, never parsed from the
 * report): a split for each long file and tests for each untested one, in the adapter's languages, minus files that
 * are never split. Biggest first.
 */
export function fixChoices(findings: readonly HealthFinding[], stats: readonly FileStats[], extensions: readonly string[],
	skipped: ReadonlyMap<string, string>, narrowed: ReadonlyMap<string, string> = new Map()): FixChoice[] {
	const lines = new Map(stats.map(s => [s.path, s.lines]));
````

with:

````ts
 * The fixes a run can offer, from the deterministic health findings (re-scanned at fix time, never parsed from the
 * report): a split for each long file (or each finding in `splitKinds`, once per file) and tests for each untested
 * one, in the adapter's languages, minus files that are never split. Biggest first.
 */
export function fixChoices(findings: readonly HealthFinding[], stats: readonly FileStats[], extensions: readonly string[],
	skipped: ReadonlyMap<string, string>, narrowed: ReadonlyMap<string, string> = new Map(), splitKinds: readonly string[] = ['too-long']): FixChoice[] {
	const lines = new Map(stats.map(s => [s.path, s.lines]));
````

In `src/aiready/fixPicker.ts`, replace:

````ts
		if (!file || !extensions.includes(path.extname(file)) || skipped.has(file)) { continue; }
		if (finding.kind === 'too-long') { choices.push({ file, kind: 'split', lines: lines.get(file) ?? 0, ...(narrowed.has(file) ? { narrowed: narrowed.get(file) } : {}) }); }
		if (finding.kind === 'untested') { choices.push({ file, kind: 'tests', lines: lines.get(file) ?? 0 }); }
````

with:

````ts
		if (!file || !extensions.includes(path.extname(file)) || skipped.has(file)) { continue; }
		if (splitKinds.includes(finding.kind) && !choices.some(choice => choice.file === file && choice.kind === 'split')) {
			choices.push({ file, kind: 'split', lines: lines.get(file) ?? 0, ...(narrowed.has(file) ? { narrowed: narrowed.get(file) } : {}) });
		}
		if (finding.kind === 'untested') { choices.push({ file, kind: 'tests', lines: lines.get(file) ?? 0 }); }
````

In `src/aiready/fixText.ts`, replace:

````ts
	return Math.min(MAX_TIMEOUT_MINUTES, Math.max(1, value));
}
````

with:

````ts
	return Math.min(MAX_TIMEOUT_MINUTES, Math.max(1, value));
}

/** The line that says what splits may move in this project; the run-time code sentence is about TS/JS's types-only splits. */
export function narrowedText(limits: readonly string[], language: string): string {
	return `In this project ${limits.join('; and ')}${language === 'TypeScript/JavaScript' ? ', so splits leave the run-time code in place' : ''}.\n`;
}
````

In `src/aiready/fixText.ts`, replace:

````ts

/** The approval modal's detail: where the commands run, the exact commands, what they run, and the adapter's note. */
export function approvalDetail(folder: string, approved: readonly string[], language: string, fixCount = 0, installs = false, note = ''): string {
	const over = fixCount > MAX_FIXES_PER_RUN ? `${fixCount} fixes chosen: ${MAX_FIXES_PER_RUN} now; Continue does the rest.\n\n` : '';
	return `${over}In a new working copy at ${folder}, on a new branch:\n\n${approved.join('\n')}\n\n`
		+ (installs ? installText(approved[0]) : '')
		+ `${installs ? 'The others' : 'They'} build the project and run its tests, which runs project code and tests written by the AI model. `
````

with:

````ts

/**
 * The approval modal's detail: where the commands run, the exact commands, what they run, and the adapter's note.
 * `install` says what the install does when the adapter words it itself (C#: `dotnet restore`); the npm wording otherwise.
 */
export function approvalDetail(folder: string, approved: readonly string[], language: string, fixCount = 0, installs = false, note = '',
	install?: string): string {
	const over = fixCount > MAX_FIXES_PER_RUN ? `${fixCount} fixes chosen: ${MAX_FIXES_PER_RUN} now; Continue does the rest.\n\n` : '';
	return `${over}In a new working copy at ${folder}, on a new branch:\n\n${approved.join('\n')}\n\n`
		+ (installs ? install ?? installText(approved[0]) : '')
		+ `${installs ? 'The others' : 'They'} build the project and run its tests, which runs project code and tests written by the AI model. `
````

In `src/aiready/changeNote.ts`, replace:

````ts
	const { branch, base } = state.worktree;
	const narrowed = state.steps.some(step => step.status === 'committed' && step.kind === 'split' && state.fixes.some(fix => fix.file === step.file && fix.narrowed));
	const lines = [
````

with:

````ts
	const { branch, base } = state.worktree;
	// The types-only sentence is about TS/JS; other languages narrow for other reasons, named on each fix.
	const narrowed = state.language === 'TypeScript/JavaScript'
		&& state.steps.some(step => step.status === 'committed' && step.kind === 'split' && state.fixes.some(fix => fix.file === step.file && fix.narrowed));
	const lines = [
````

The VS Code glue only passes the new values through:

In `src/aiready/fixSetup.ts`, replace:

````ts
import { logDir, RunState, saveState } from './fixState';
import { alreadyFailingText, approvalDetail, timeoutMinutes } from './fixText';
import { fileStats, scanHealth } from './health';
````

with:

````ts
import { logDir, RunState, saveState } from './fixState';
import { alreadyFailingText, approvalDetail, narrowedText, timeoutMinutes } from './fixText';
import { fileStats, scanHealth } from './health';
````

In `src/aiready/fixSetup.ts`, replace:

````ts
	const offers = (kind: 'split' | 'tests') => !local.fixes || local.fixes.includes(kind);
	const fixable = (f: (typeof findings)[number]) => (f.kind === 'too-long' && offers('split')) || (f.kind === 'untested' && offers('tests'));
	const candidates = [...new Set(findings.filter(f => f.file && fixable(f)).map(f => f.file!))].filter(file => sources.includes(file));
````

with:

````ts
	const offers = (kind: 'split' | 'tests') => !local.fixes || local.fixes.includes(kind);
	const splitKinds = local.splitFindings ?? ['too-long'];
	const fixable = (f: (typeof findings)[number]) => (splitKinds.includes(f.kind) && offers('split')) || (f.kind === 'untested' && offers('tests'));
	const candidates = [...new Set(findings.filter(f => f.file && fixable(f)).map(f => f.file!))].filter(file => sources.includes(file));
````

In `src/aiready/fixSetup.ts`, replace:

````ts
	}
	const choices = fixChoices(findings, stats, local.extensions, skipped, narrowed).filter(choice => offers(choice.kind));
	sink.progress('');
````

with:

````ts
	}
	const choices = fixChoices(findings, stats, local.extensions, skipped, narrowed, splitKinds).filter(choice => offers(choice.kind));
	sink.progress('');
````

In `src/aiready/fixSetup.ts`, replace:

````ts
	const answer = await vscode.window.showWarningMessage('Run these commands on a new local branch?',
		{ modal: true, detail: approvalDetail(folder, approved, local.label, picked.length, setup.length > 0, local.approvalNote) }, 'Run them');
	if (answer !== 'Run them') { sink.text('The commands were not approved, so nothing changed.'); return undefined; }
````

with:

````ts
	const answer = await vscode.window.showWarningMessage('Run these commands on a new local branch?',
		{ modal: true, detail: approvalDetail(folder, approved, local.label, picked.length, setup.length > 0, local.approvalNote, local.installNote) },
		'Run them');
	if (answer !== 'Run them') { sink.text('The commands were not approved, so nothing changed.'); return undefined; }
````

In `src/aiready/fixSetup.ts`, replace:

````ts
		sink.text(`Working on branch \`${worktree.branch}\` in \`${worktree.path}\`. Your folder stays as it is.\n`);
		if (limits.length) { sink.text(`In this project ${limits.join('; and ')}, so splits leave the run-time code in place.\n`); }
		logDir(env.storage, root, true);
````

with:

````ts
		sink.text(`Working on branch \`${worktree.branch}\` in \`${worktree.path}\`. Your folder stays as it is.\n`);
		if (limits.length) { sink.text(narrowedText(limits, local.label)); }
		logDir(env.storage, root, true);
````

In `src/aiready/fixSetup.ts`, replace:

````ts
			progress: text => sink.progress(text),
		});
		if ('stopped' in outcome) { return await discardUnstarted(root, worktree, sink, 'Stopped before any fix.'); }
````

with:

````ts
			progress: text => sink.progress(text),
		}, inWorktree.assemblyCheck && ((command, round, result) => inWorktree.assemblyCheck!.baseline(command, round, result)));
		if ('stopped' in outcome) { return await discardUnstarted(root, worktree, sink, 'Stopped before any fix.'); }
````

In `src/aiready/fixRun.ts`, replace:

````ts
		adapter, worktree, ask: askModel, baseline: state.baseline, flaky: runFlaky(state),
		check: (command, label, extra) => runCheck(env, adapter, worktree, state.approved, command, label, extra),
		cancelled: () => token.isCancellationRequested,
````

with:

````ts
		adapter, worktree, ask: askModel, baseline: state.baseline, flaky: runFlaky(state),
		check: (command, label, extra, options) => runCheck(env, adapter, worktree, state.approved, command, label, extra, options),
		cancelled: () => token.isCancellationRequested,
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 366
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/changeNote.ts src/aiready/fixPicker.ts src/aiready/fixRun.ts src/aiready/fixSetup.ts src/aiready/fixText.ts src/aiready/language.ts src/aiready/moveCheck.ts src/aiready/steps.ts test/changeNote.test.ts test/fixPicker.test.ts test/fixText.test.ts test/moveCheck.test.ts test/steps.test.ts
git commit -m "AI-ready core: host plans, assembly check hooks, braces, split findings"
```

## Chunk 3: The C# helper

### Task 3: The C# helper: build it offline, gate the SDK, parse one file

**Files:**
- Create: `resources/csast/DirectiveFact.cs`, `resources/csast/FileFacts.cs`, `resources/csast/FileReader.cs`, `resources/csast/NameLine.cs`, `resources/csast/NamespaceFact.cs`, `resources/csast/Program.cs`, `resources/csast/TypeFact.cs`, `resources/csast/UsingFact.cs`, `resources/csast/csast.csproj`, `resources/csast/nuget.config`, `src/aiready/csAst.ts`, `src/aiready/csTools.ts`, `test/csAst.test.ts`, `test/csFixture.ts`, `test/csTools.test.ts`

The helper is a small project in `resources/csast` that references the SDK's own Roslyn (`Private=true`). `csTools` builds it once per extension version, source hash and SDK into global storage, with a `nuget.config` that clears every package source, runs it once on a probe file, and reads .NET's culture list from it (reviewer note 1). One class per file; `FileReader` turns Roslyn's tree into the facts with UTF-8 byte offsets.

- [ ] **Step 1: Write the failing tests.**

Create `test/csFixture.ts`:

````ts
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CsFacts, csFileFacts } from '../src/aiready/csAst';
import { CsTools, csTools, dotnetInstallDirs, sdkSupported } from '../src/aiready/csTools';
import { findTool } from '../src/aiready/projectCommands';

/** The extension folder (tests run from out-test/test). */
export const EXTENSION = path.resolve(__dirname, '../..');

/** Why the .NET-backed tests are skipped on this machine, or false when a .NET SDK 8.0.100 or newer is installed. */
export const NO_DOTNET: string | false = (() => {
	const dotnet = findTool('dotnet', dotnetInstallDirs());
	const version = dotnet ? spawnSync(dotnet, ['--version'], { cwd: os.tmpdir(), encoding: 'utf8' }).stdout ?? '' : '';
	return dotnet && sdkSupported(version) ? false : 'no .NET SDK 8.0.100 or newer';
})();

/** The options of a test that needs .NET. */
export const DOTNET = { skip: NO_DOTNET };

let tools: Promise<CsTools> | undefined;

/** The C# tools, with the helper built once into a temporary cache; a failure to build it fails the test. */
export function dotnetTools(): Promise<CsTools> {
	tools ??= csTools(EXTENSION, path.join(os.tmpdir(), 'my-editor-csast-cache'), 'test').then(found => {
		if (typeof found === 'string') { throw new Error(found); }
		return found;
	});
	return tools;
}

const work = mkdtempSync(path.join(os.tmpdir(), 'my-editor-csast-test-'));
let count = 0;

/** Parses C# source with the real helper. The file keeps its name, in a folder of its own. */
export async function csFacts(name: string, text: string | Buffer): Promise<{ source: Buffer; facts: CsFacts }> {
	const found = await dotnetTools();
	const dir = path.join(work, String(count++));
	mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
	const source = Buffer.isBuffer(text) ? text : Buffer.from(text);
	writeFileSync(path.join(dir, name), source);
	return { source, facts: await csFileFacts(found, path.join(dir, name)) };
}

/** The bytes of a helper range. */
export function slice(source: Buffer, range: readonly [number, number]): string {
	return source.subarray(range[0], range[1]).toString('utf8');
}
````

Create `test/csTools.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { buildCsHelper, csHelperSources, DOTNET_ENV, runHelper, sdkProblem, sdkSupported } from '../src/aiready/csTools';
import { runTool } from '../src/aiready/projectCommands';
import { DOTNET, dotnetTools, EXTENSION } from './csFixture';

test('the SDK gate: 8.0.100 and newer pass, older and malformed do not', () => {
	assert.ok(sdkSupported('8.0.100') && sdkSupported('9.0.108') && sdkSupported('10.0.100-rc.1.25451.107') && sdkSupported('8.0.412'));
	assert.ok(!sdkSupported('7.0.410') && !sdkSupported('8.0.99') && !sdkSupported('6.0.100'));
});

test('helper: built offline, keyed by SDK, cached; a global.json naming a missing SDK stops with its message', DOTNET, async () => {
	const tools = await dotnetTools();
	assert.match(tools.helper, new RegExp(`csast/test-${tools.sdk.replace(/\./g, '\\.')}-[0-9a-f]{8}/out/csast\\.dll$`));
	assert.ok(tools.cultures.has('de') && tools.cultures.has('zh-hans') && tools.cultures.has('fr-ca') && !tools.cultures.has('designer'));
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-globaljson-'));
	writeFileSync(path.join(dir, 'global.json'), '{ "sdk": { "version": "1.0.100", "rollForward": "disable" } }\n');
	assert.match(await sdkProblem(tools.dotnet, dir) ?? '', /^`dotnet --version` failed in this folder: .*1\.0\.100/);
	assert.equal(await sdkProblem(tools.dotnet, os.tmpdir()), undefined);
});

test('helper: with Private=false the Roslyn DLLs are not copied and the helper cannot start', DOTNET, async () => {
	const tools = await dotnetTools();
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-private-'));
	cpSync(csHelperSources(EXTENSION), dir, { recursive: true });
	const project = path.join(dir, 'csast.csproj');
	writeFileSync(project, readFileSync(project, 'utf8').replace(/<Private>true<\/Private>/g, '<Private>false</Private>'));
	const built = await runTool(tools.dotnet, ['build', '-nologo', '-v:q', '--disable-build-servers', '-o', path.join(dir, 'out')], dir, DOTNET_ENV);
	assert.equal(built.code, 0, built.stdout);
	writeFileSync(path.join(dir, 'P.cs'), 'class P { }\n');
	const run = await runTool(tools.dotnet, [path.join(dir, 'out', 'csast.dll'), 'parse', path.join(dir, 'P.cs')], dir, DOTNET_ENV);
	assert.notEqual(run.code, 0);
	assert.match(run.stderr, /Could not load file or assembly 'Microsoft\.CodeAnalysis/);
});

test('helper: two builds of the same helper at once both end with a helper that runs', DOTNET, async () => {
	const tools = await dotnetTools();
	const storage = mkdtempSync(path.join(os.tmpdir(), 'my-editor-twice-'));
	const [first, second] = await Promise.all([1, 2].map(() => buildCsHelper(csHelperSources(EXTENSION), storage, 'test', tools.dotnet, tools.sdk)));
	assert.equal(first, second);
	writeFileSync(path.join(storage, 'P.cs'), 'class P { }\n');
	assert.match(await runHelper({ dotnet: tools.dotnet, helper: first }, ['parse', path.join(storage, 'P.cs')], storage), /"name":"P"/);
});
````

Create `test/csAst.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { csFacts, DOTNET, slice } from './csFixture';

const BIG = `// Copyright (c) Acme Ltd. Licensed under the MIT license.

using System;
using static System.Math;
using Alias = System.Text.StringBuilder;
#nullable enable

[assembly: System.CLSCompliant(false)]

namespace Shop.Models;

/// <summary>An order.</summary>
[Serializable]
public sealed class Order : IComparable<Order> // compared by id
{
	public int CompareTo(Order? other) => 0;
}

// Detached: stays where it is.

public record Line(string Sku, decimal Price);

public enum State { Open, Closed }

public delegate void Changed(Order order);

public interface IPrices { decimal Price(string sku); }
`;

test('parse: header, prelude, using region, global attributes, file-scoped namespace, types and attached comments', DOTNET, async () => {
	const parsed = await csFacts('Big.cs', BIG);
	const { source, facts } = parsed;
	assert.equal(facts.error, null);
	assert.equal(slice(source, facts.header), '// Copyright (c) Acme Ltd. Licensed under the MIT license.\n');
	assert.ok(facts.license && !facts.namesFile);
	assert.equal(source.subarray(0, facts.prelude).toString(), '// Copyright (c) Acme Ltd. Licensed under the MIT license.\n\n');
	assert.equal(slice(source, facts.usingRegion), 'using System;\nusing static System.Math;\nusing Alias = System.Text.StringBuilder;\n#nullable enable\n');
	assert.deepEqual(facts.usings.map(u => u.kind), ['plain', 'static', 'alias']);
	assert.deepEqual(facts.globalAttributes.map(r => slice(source, r)), ['[assembly: System.CLSCompliant(false)]\n']);
	assert.deepEqual(facts.namespaces.map(n => [n.kind, n.name, slice(source, n.header), n.close]), [['file', 'Shop.Models', 'namespace Shop.Models;\n', null]]);
	assert.deepEqual(facts.types.map(type => `${type.id} ${type.kind} ${type.name} ${type.namespace}`),
		['0 class Order 0', '1 record Line 0', '2 enum State 0', '3 delegate Changed 0', '4 interface IPrices 0']);
	const order = facts.types[0];
	assert.equal(slice(source, order.span), '/// <summary>An order.</summary>\n[Serializable]\n'
		+ 'public sealed class Order : IComparable<Order> // compared by id\n{\n\tpublic int CompareTo(Order? other) => 0;\n}');
	assert.deepEqual([order.doc, order.attributes, order.bases, order.modifiers, order.lines], ['<summary>An order.</summary>', ['Serializable'],
		['IComparable<Order>'], ['public', 'sealed'], 6]);
	assert.equal(slice(source, facts.types[1].span), 'public record Line(string Sku, decimal Price);');
	assert.deepEqual(facts.detachedDocs, []);
	assert.deepEqual(facts.directives.map(d => [d.kind, d.inUsingRegion, d.type]), [['nullable', true, -1]]);
});

test('parse: a block namespace header with inner usings, its closing line, indentation, BOM and CRLF, UTF-8 offsets', DOTNET, async () => {
	const text = '\ufeff// Résumé tools.\r\nusing System;\r\n\r\nnamespace Shop\r\n{\r\n    using System.Text;\r\n\r\n    /// <summary>Ünïcode.</summary>\r\n'
		+ '    public class A { }\r\n\r\n    public class B<TKey, TValue> { }\r\n} // Shop\r\n';
	const parsed = await csFacts('A.cs', text);
	const { source, facts } = parsed;
	assert.deepEqual([facts.bom, facts.eol, facts.license], [true, 'crlf', false]);
	assert.equal(slice(source, facts.header), '// Résumé tools.\r\n');
	assert.equal(facts.header[0], 3);
	assert.equal(slice(source, facts.usingRegion), 'using System;\r\n');
	assert.equal(slice(source, facts.namespaces[0].header), 'namespace Shop\r\n{\r\n    using System.Text;\r\n');
	assert.equal(slice(source, facts.namespaces[0].close!), '} // Shop\r\n');
	assert.equal(slice(source, facts.types[0].span), '    /// <summary>Ünïcode.</summary>\r\n    public class A { }\r');
	assert.equal(source[facts.types[0].span[1]], 10);
	assert.deepEqual([facts.types[1].arity, facts.types[1].typeParameters], [2, ['TKey', 'TValue']]);
});

test('parse: a detached /// comment (before a blank line, or at the end) is reported; a detached // comment is not', DOTNET, async () => {
	const text = 'namespace N;\n\n/// <summary>Lost.</summary>\n\npublic class A { }\n\n// Plain.\n\npublic class B { }\n\n/// <summary>End.</summary>\n';
	const parsed = await csFacts('D.cs', text);
	assert.deepEqual(parsed.facts.detachedDocs, [3, 11]);
	assert.equal(slice(parsed.source, parsed.facts.types[1].span), 'public class B { }');
});

test('parse: encodings, line endings, shared lines, generated headers and file-local lookup', DOTNET, async () => {
	const utf16le = await csFacts('U.cs', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('class A { }\n', 'utf16le')]));
	assert.equal(utf16le.facts.encoding, 'utf16');
	assert.equal((await csFacts('V.cs', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('class A { }\n', 'utf16le').swap16()]))).facts.encoding, 'utf16');
	assert.equal((await csFacts('W.cs', Buffer.from([0x63, 0x6c, 0xff, 0x0a]))).facts.encoding, 'invalid');
	assert.equal((await csFacts('M.cs', 'class A { }\r\nclass B { }\n')).facts.eol, 'mixed');
	const shared = (await csFacts('S.cs', 'namespace N;\npublic class A { } public class B { }\n')).facts;
	assert.deepEqual(shared.types.map(type => type.sharesLine), [true, true]);
	assert.ok((await csFacts('G.cs', '// <auto-generated>\n//   by a tool\n// </auto-generated>\nclass A { }\n')).facts.generated);
	const local = (await csFacts('F.cs', 'global using System;\nfile class Helper { }\nSystem.Console.WriteLine(1);\n')).facts;
	assert.deepEqual([local.fileTypes, local.globalUsings, local.topLevelStatements], [true, true, true]);
	assert.match((await csFacts('E.cs', 'class A {\n')).facts.error ?? '', /^line \d+: } expected/);
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/csAst.test.ts(42,36): error TS7006: Parameter 'u' implicitly has an 'any' type.
```

- [ ] **Step 3: Implement.**

Create `resources/csast/csast.csproj`:

````xml
<Project Sdk="Microsoft.NET.Sdk">
  <!-- my_editor's C# helper: built once per SDK into global storage, offline, against the SDK's own Roslyn. -->
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net$(BundledNETCoreAppTargetFrameworkVersion)</TargetFramework>
    <RoslynDir>$(NetCoreRoot)sdk/$(NETCoreSdkVersion)/Roslyn/bincore/</RoslynDir>
    <DisableImplicitNuGetFallbackFolder>true</DisableImplicitNuGetFallbackFolder>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <InvariantGlobalization>false</InvariantGlobalization>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="Microsoft.CodeAnalysis"><HintPath>$(RoslynDir)Microsoft.CodeAnalysis.dll</HintPath><Private>true</Private></Reference>
    <Reference Include="Microsoft.CodeAnalysis.CSharp"><HintPath>$(RoslynDir)Microsoft.CodeAnalysis.CSharp.dll</HintPath><Private>true</Private></Reference>
  </ItemGroup>
</Project>
````

Create `resources/csast/nuget.config`:

````xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
  </packageSources>
</configuration>
````

Create `resources/csast/Program.cs`:

````cs
using System.Globalization;
using System.Text.Json;

namespace Csast;

/// <summary>my_editor's C# helper. Each command prints one result on stdout and exits 0, or prints why on stderr and exits 2.</summary>
static class Program
{
	public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

	static int Main(string[] args)
	{
		try {
			switch (args.FirstOrDefault()) {
				case "parse" when args.Length == 2:
					Console.Out.Write(JsonSerializer.Serialize(FileReader.Read(args[1]), Json));
					return 0;
				case "cultures" when args.Length == 1:
					var names = CultureInfo.GetCultures(CultureTypes.AllCultures).Select(c => c.Name.ToLowerInvariant()).Where(n => n.Length > 0);
					Console.Out.Write(JsonSerializer.Serialize(names.Distinct().OrderBy(n => n, StringComparer.Ordinal), Json));
					return 0;
				default:
					Console.Error.WriteLine("usage: csast parse <file> | cultures");
					return 2;
			}
		} catch (Exception error) {
			Console.Error.WriteLine($"{error.GetType().Name}: {error.Message}");
			return 2;
		}
	}
}
````

Create `resources/csast/FileReader.cs`:

````cs
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Text;

namespace Csast;

/// <summary>
/// Reads one C# file with the SDK's own parser (syntax only, preview language, no symbols) and turns it into the facts
/// the splitter needs, with UTF-8 byte offsets.
/// </summary>
sealed class FileReader
{
	static readonly HashSet<string> InterceptedNames = new(StringComparer.Ordinal) {
		"MapGet", "MapPost", "MapPut", "MapDelete", "MapPatch", "MapMethods", "Map", "MapFallback", "Bind", "Get", "GetValue", "Configure", "BindConfiguration",
	};
	static readonly Regex License = new("copyright|license|spdx", RegexOptions.IgnoreCase);
	static readonly Regex GeneratedMarker = new("<auto-?generated", RegexOptions.IgnoreCase);
	readonly string text;
	readonly int bomBytes;
	readonly string fileName;
	readonly int size;
	readonly SourceText source;
	readonly SyntaxTree tree;
	readonly CompilationUnitSyntax root;
	readonly int[] prefix;
	string? layout;

	/// <summary>One file's facts; a UTF-16 or invalid UTF-8 file gets only its encoding and size.</summary>
	public static FileFacts Read(string path)
	{
		var bytes = File.ReadAllBytes(path);
		if (bytes.Length >= 2 && ((bytes[0] == 0xFF && bytes[1] == 0xFE) || (bytes[0] == 0xFE && bytes[1] == 0xFF))) {
			return new FileFacts { Encoding = "utf16", Size = bytes.Length };
		}
		var bom = bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
		string text;
		try {
			text = new UTF8Encoding(false, true).GetString(bytes, bom ? 3 : 0, bytes.Length - (bom ? 3 : 0));
		} catch (DecoderFallbackException) {
			return new FileFacts { Encoding = "invalid", Size = bytes.Length };
		}
		return new FileReader(text, bom, Path.GetFileName(path), bytes.Length).Facts();
	}

	FileReader(string text, bool bom, string fileName, int size)
	{
		this.text = text;
		bomBytes = bom ? 3 : 0;
		this.fileName = fileName;
		this.size = size;
		source = SourceText.From(text);
		tree = CSharpSyntaxTree.ParseText(source, new CSharpParseOptions(LanguageVersion.Preview, DocumentationMode.Parse));
		root = (CompilationUnitSyntax)tree.GetRoot();
		prefix = new int[text.Length + 1];
		for (var i = 0; i < text.Length; i++) {
			var c = text[i];
			prefix[i + 1] = prefix[i] + (c < 0x80 ? 1 : c < 0x800 ? 2 : char.IsSurrogate(c) ? 2 : 3);
		}
	}

	/// <summary>A character position as a UTF-8 byte offset into the file (the BOM counted).</summary>
	int Off(int position) => bomBytes + prefix[position];
	TextLine LineOf(int position) => source.Lines.GetLineFromPosition(Math.Clamp(position, 0, text.Length));
	bool Blank(TextLine line) => string.IsNullOrWhiteSpace(source.ToString(line.Span));
	int FirstNonSpace(TextLine line)
	{
		for (var i = line.Start; i < line.End; i++) { if (!char.IsWhiteSpace(text[i])) { return i; } }
		return -1;
	}
	/// <summary>The end of a span whose last character is at `last`: the newline ending that line (a CR before it included), or the end of the text.</summary>
	int SpanEnd(int last)
	{
		var line = LineOf(last);
		return line.EndIncludingLineBreak > line.End ? line.EndIncludingLineBreak - 1 : line.End;
	}
	int[] Lines(int start, int lastChar) => [Off(LineOf(start).Start), Off(LineOf(lastChar).EndIncludingLineBreak)];
	static bool IsComment(SyntaxTrivia t) => t.IsKind(SyntaxKind.SingleLineCommentTrivia) || t.IsKind(SyntaxKind.MultiLineCommentTrivia) || IsDoc(t);
	static bool IsDoc(SyntaxTrivia t) =>
		t.IsKind(SyntaxKind.SingleLineDocumentationCommentTrivia) || t.IsKind(SyntaxKind.MultiLineDocumentationCommentTrivia);

	public FileFacts Facts()
	{
		var error = tree.GetDiagnostics().FirstOrDefault(d => d.Severity == DiagnosticSeverity.Error);
		var headerEnd = HeaderEnd();
		var header = text[..headerEnd];
		var prelude = Prelude(headerEnd);
		var usingEnd = UsingEnd(prelude);
		var namespaces = Namespaces();
		var nodes = root.Members.Concat(root.DescendantNodes(n => n is CompilationUnitSyntax or BaseNamespaceDeclarationSyntax)
			.OfType<BaseNamespaceDeclarationSyntax>().SelectMany(n => n.Members)).Where(IsType).OrderBy(n => n.SpanStart).ToList();
		var nsNodes = NamespaceNodes();
		var types = nodes.Select((node, id) => Type(node, id, Math.Max(prelude, usingEnd), NamespaceIndex(nsNodes, node))).ToList();
		bool InType(int offset, TypeFact t) => offset >= t.Span[0] && offset < t.Span[1];
		return new FileFacts {
			Bom = bomBytes > 0, Eol = Eol(), Size = size, LongLine = source.Lines.Any(l => l.Span.Length > 1000),
			Error = error is null ? null : $"line {error.Location.GetLineSpan().StartLinePosition.Line + 1}: {error.GetMessage()}",
			Generated = root.GetFirstToken(includeZeroWidth: true).LeadingTrivia.Any(t => IsComment(t) && GeneratedMarker.IsMatch(t.ToString())),
			Header = [bomBytes, Off(headerEnd)],
			License = License.IsMatch(header) || header.Contains("<copyright", StringComparison.OrdinalIgnoreCase),
			NamesFile = header.Contains(fileName, StringComparison.OrdinalIgnoreCase),
			Prelude = Off(prelude),
			UsingRegion = [Off(prelude), Off(Math.Max(prelude, usingEnd))],
			Usings = root.Externs.Select(e => new UsingFact { Kind = "extern", Text = e.ToString() })
				.Concat(root.Usings.Select(u => new UsingFact { Kind = UsingKind(u), Text = u.ToString() })).ToArray(),
			GlobalAttributes = root.AttributeLists.Select(a => Lines(a.SpanStart, a.Span.End - 1)).ToArray(),
			Namespaces = namespaces,
			Types = types.ToArray(),
			Directives = Directives().Select(d => Directive(d, prelude, usingEnd, types)).ToArray(),
			DetachedDocs = root.DescendantTrivia().Where(IsDoc).Where(t => !types.Any(type => InType(Off(t.FullSpan.Start), type)))
				.Select(t => LineOf(t.FullSpan.Start).LineNumber + 1).ToArray(),
			Intercepted = root.DescendantNodes().OfType<InvocationExpressionSyntax>().Select(i => (name: InvokedName(i.Expression), at: i.SpanStart))
				.Where(c => c.name is not null && InterceptedNames.Contains(c.name)).GroupBy(c => c.name)
				.Select(g => new NameLine { Name = g.Key!, Line = LineOf(g.First().at).LineNumber + 1 }).ToArray(),
			TopLevelStatements = root.Members.OfType<GlobalStatementSyntax>().Any(),
			FileTypes = root.DescendantNodes().OfType<MemberDeclarationSyntax>().Any(m => m.Modifiers.Any(SyntaxKind.FileKeyword)),
			GlobalUsings = root.Usings.Any(u => u.GlobalKeyword.IsKind(SyntaxKind.GlobalKeyword)),
			Layout = layout,
		};
	}

	static bool IsType(MemberDeclarationSyntax node) => node is BaseTypeDeclarationSyntax or DelegateDeclarationSyntax;

	static int NamespaceIndex(List<BaseNamespaceDeclarationSyntax> namespaces, SyntaxNode node) =>
		node.Parent is BaseNamespaceDeclarationSyntax parent ? namespaces.IndexOf(parent) : -1;

	List<BaseNamespaceDeclarationSyntax> NamespaceNodes() =>
		root.DescendantNodes(n => n is CompilationUnitSyntax or BaseNamespaceDeclarationSyntax).OfType<BaseNamespaceDeclarationSyntax>().ToList();

	string Eol()
	{
		int crlf = 0, lf = 0, other = 0;
		for (var i = 0; i < text.Length; i++) {
			var c = text[i];
			if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') {
				crlf++;
				i++;
			} else if (c == '\n') {
				lf++;
			} else if (c == '\r') {
				other++;
			}
			else if (c is (char)0x85 or (char)0x2028 or (char)0x2029) {
				other++;
			}
		}
		if (other > 0 || (crlf > 0 && lf > 0)) { return "mixed"; }
		return crlf > 0 ? "crlf" : lf > 0 ? "lf" : "none";
	}

	/// <summary>The end (after its newline) of the leading block of `//` and `/* */` comment lines; documentation comments are not part of it.</summary>
	int HeaderEnd()
	{
		var end = 0;
		for (var index = 0; index < source.Lines.Count;) {
			var at = FirstNonSpace(source.Lines[index]);
			if (at < 0) { break; }
			var trivia = root.FindTrivia(at);
			if (!(trivia.IsKind(SyntaxKind.SingleLineCommentTrivia) || trivia.IsKind(SyntaxKind.MultiLineCommentTrivia)) || trivia.SpanStart != at) { break; }
			var last = LineOf(trivia.Span.End);
			if (!string.IsNullOrWhiteSpace(source.ToString(TextSpan.FromBounds(trivia.Span.End, last.End)))) { break; }
			end = last.EndIncludingLineBreak;
			index = last.LineNumber + 1;
		}
		return end;
	}

	int Prelude(int headerEnd)
	{
		var position = headerEnd;
		while (position < text.Length) {
			var line = LineOf(position);
			if (!Blank(line)) { return line.Start; }
			position = line.EndIncludingLineBreak;
		}
		return text.Length;
	}

	/// <summary>
	/// The end (after its newline) of the last extern alias, using, `#nullable` or `#pragma warning` before the first
	/// attribute, namespace or type.
	/// </summary>
	int UsingEnd(int prelude)
	{
		var first = root.AttributeLists.Select(a => a.SpanStart).Concat(root.Members.Select(m => m.SpanStart))
			.DefaultIfEmpty(root.EndOfFileToken.SpanStart).Min();
		var ends = root.Externs.Select(e => e.Span.End).Concat(root.Usings.Select(u => u.Span.End))
			.Concat(Directives().Where(d => d.SpanStart < first && d.SpanStart >= prelude && RegionDirective(d)).Select(d => d.Span.End)).ToList();
		if (ends.Count == 0) { return prelude; }
		var last = LineOf(ends.Max() - 1);
		if (first < last.EndIncludingLineBreak && first < text.Length) { layout ??= "its usings share a line with other code"; }
		return last.EndIncludingLineBreak;
	}

	IEnumerable<DirectiveTriviaSyntax> Directives() =>
		root.DescendantTrivia().Where(t => t.IsDirective).Select(t => (DirectiveTriviaSyntax)t.GetStructure()!);

	static bool RegionDirective(DirectiveTriviaSyntax d) => d is NullableDirectiveTriviaSyntax or PragmaWarningDirectiveTriviaSyntax;

	NamespaceFact[] Namespaces() => NamespaceNodes().Select(ns => {
		var keyword = LineOf(ns.NamespaceKeyword.SpanStart);
		if (FirstNonSpace(keyword) != ns.NamespaceKeyword.SpanStart) { layout ??= "a namespace declaration shares a line with other code"; }
		var inner = ns.Externs.Select(e => e.Span.End).Concat(ns.Usings.Select(u => u.Span.End));
		var opener = ns is NamespaceDeclarationSyntax block ? block.OpenBraceToken : ((FileScopedNamespaceDeclarationSyntax)ns).SemicolonToken;
		var headerLast = inner.Append(opener.Span.End).Max() - 1;
		var next = root.FindToken(headerLast).GetNextToken();
		if (next.RawKind != 0 && !next.IsKind(SyntaxKind.EndOfFileToken) && LineOf(next.SpanStart).LineNumber == LineOf(headerLast).LineNumber) {
			layout ??= "a namespace's opening line holds other code";
		}
		int[]? close = null;
		if (ns is NamespaceDeclarationSyntax closing) {
			var brace = closing.CloseBraceToken;
			var line = LineOf(brace.SpanStart);
			var after = (closing.SemicolonToken.IsKind(SyntaxKind.SemicolonToken) ? closing.SemicolonToken : brace).GetNextToken();
			if (FirstNonSpace(line) != brace.SpanStart || (after.RawKind != 0 && !after.IsKind(SyntaxKind.EndOfFileToken)
				&& LineOf(after.SpanStart).LineNumber == line.LineNumber)) {
				layout ??= "a namespace's closing brace shares a line with other code";
			}
			close = [Off(line.Start), Off(line.EndIncludingLineBreak)];
		}
		return new NamespaceFact {
			Kind = ns is FileScopedNamespaceDeclarationSyntax ? "file" : "block", Name = ns.Name.ToString(),
			Header = [Off(keyword.Start), Off(LineOf(headerLast).EndIncludingLineBreak)], Close = close, Nested = ns.Parent is BaseNamespaceDeclarationSyntax,
		};
	}).ToArray();

	TypeFact Type(MemberDeclarationSyntax node, int id, int floor, int ns)
	{
		var bound = Math.Max(node.FullSpan.Start, floor);
		var startLine = LineOf(node.SpanStart).LineNumber;
		for (var k = startLine - 1; k >= 0; k = startLine - 1) {
			var line = source.Lines[k];
			var at = FirstNonSpace(line);
			if (line.Start < bound || at < 0) { break; }
			var trivia = root.FindTrivia(at);
			// A documentation comment's Span leaves out its first `///`; FullSpan has it.
			var triviaLine = LineOf(trivia.FullSpan.Start);
			if (!IsComment(trivia) || FirstNonSpace(triviaLine) != trivia.FullSpan.Start || triviaLine.Start < bound) { break; }
			startLine = triviaLine.LineNumber;
		}
		var start = source.Lines[startLine].Start;
		var end = SpanEnd(node.Span.End - 1);
		var first = node.GetFirstToken();
		var previous = first.GetPreviousToken();
		var last = node.GetLastToken();
		var next = last.GetNextToken();
		var shares = (previous.RawKind != 0 && LineOf(previous.Span.End - 1).LineNumber == LineOf(first.SpanStart).LineNumber)
			|| (next.RawKind != 0 && !next.IsKind(SyntaxKind.EndOfFileToken) && LineOf(next.SpanStart).LineNumber == LineOf(last.SpanStart).LineNumber);
		var docs = node.GetLeadingTrivia().Where(t => IsDoc(t) && t.FullSpan.Start >= start).Select(t => t.ToFullString()).ToList();
		var docText = string.Concat(docs);
		var (kind, name, parameters) = node switch {
			RecordDeclarationSyntax r => (r.ClassOrStructKeyword.IsKind(SyntaxKind.StructKeyword) ? "record struct" : "record", r.Identifier.Text, r.TypeParameterList),
			ClassDeclarationSyntax c => ("class", c.Identifier.Text, c.TypeParameterList),
			StructDeclarationSyntax s => ("struct", s.Identifier.Text, s.TypeParameterList),
			InterfaceDeclarationSyntax i => ("interface", i.Identifier.Text, i.TypeParameterList),
			EnumDeclarationSyntax e => ("enum", e.Identifier.Text, (TypeParameterListSyntax?)null),
			DelegateDeclarationSyntax d => ("delegate", d.Identifier.Text, d.TypeParameterList),
			_ => ("?", "?", null),
		};
		return new TypeFact {
			Id = id, Kind = kind, Name = name, Arity = parameters?.Parameters.Count ?? 0,
			TypeParameters = parameters?.Parameters.Select(p => p.Identifier.Text).ToArray() ?? [],
			Modifiers = node.Modifiers.Select(m => m.Text).ToArray(),
			Attributes = node.AttributeLists.SelectMany(l => l.Attributes).Select(a => a.Name.ToString()).ToArray(),
			Bases = (node as BaseTypeDeclarationSyntax)?.BaseList?.Types.Select(t => t.Type.ToString()).ToArray() ?? [],
			Namespace = ns, Span = [Off(start), Off(end)], Lines = LineOf(end).LineNumber - startLine + 1,
			Doc = docText.Split('\n').Select(l => l.Trim().TrimStart('/').Trim()).FirstOrDefault(l => l.Length > 0) ?? "",
			DocText = docText, SharesLine = shares,
			ModuleInitializer = node.DescendantNodes().OfType<MethodDeclarationSyntax>().Any(m => m.AttributeLists.SelectMany(l => l.Attributes)
				.Any(a => LastName(a.Name) is "ModuleInitializer" or "ModuleInitializerAttribute")),
		};
	}

	static string LastName(NameSyntax name) => name switch {
		QualifiedNameSyntax q => q.Right.Identifier.Text,
		AliasQualifiedNameSyntax a => a.Name.Identifier.Text,
		SimpleNameSyntax s => s.Identifier.Text,
		_ => name.ToString(),
	};

	static string? InvokedName(ExpressionSyntax expression) => expression switch {
		MemberAccessExpressionSyntax m => m.Name.Identifier.Text,
		MemberBindingExpressionSyntax b => b.Name.Identifier.Text,
		SimpleNameSyntax s => s.Identifier.Text,
		_ => null,
	};

	static string UsingKind(UsingDirectiveSyntax u)
	{
		if (u.GlobalKeyword.IsKind(SyntaxKind.GlobalKeyword)) { return "global"; }
		if (u.StaticKeyword.IsKind(SyntaxKind.StaticKeyword)) { return "static"; }
		return u.Alias is not null ? "alias" : "plain";
	}

	DirectiveFact Directive(DirectiveTriviaSyntax d, int prelude, int usingEnd, List<TypeFact> types)
	{
		var offset = Off(d.SpanStart);
		var pragma = d as PragmaWarningDirectiveTriviaSyntax;
		return new DirectiveFact {
			Kind = d switch {
				PragmaWarningDirectiveTriviaSyntax => "pragma warning",
				PragmaChecksumDirectiveTriviaSyntax => "pragma checksum",
				_ => d.DirectiveNameToken.Text,
			},
			Line = LineOf(d.SpanStart).LineNumber + 1, Offset = offset, Text = d.ToString().Trim(),
			Type = types.FindIndex(t => offset >= t.Span[0] && offset < t.Span[1]),
			InUsingRegion = d.SpanStart >= prelude && d.SpanStart < usingEnd,
			Action = pragma?.DisableOrRestoreKeyword.Text ?? "",
			Ids = pragma?.ErrorCodes.Select(c => c.ToString().Trim()).ToArray() ?? [],
		};
	}
}
````

Create `resources/csast/FileFacts.cs`:

````cs
namespace Csast;

/// <summary>The JSON `parse` prints. Offsets are UTF-8 bytes into the file as read (a BOM included); spans are [start, end).</summary>
sealed class FileFacts
{
	/// <summary>utf8, utf16 or invalid; only utf8 files carry the other facts.</summary>
	public string Encoding { get; init; } = "utf8";
	public bool Bom { get; init; }
	/// <summary>lf, crlf, mixed (also a lone CR or a Unicode line separator) or none.</summary>
	public string Eol { get; init; } = "none";
	public int Size { get; init; }
	public bool LongLine { get; init; }
	public string? Error { get; init; }
	public bool Generated { get; init; }
	/// <summary>The leading comment block (after the BOM), whole lines.</summary>
	public int[] Header { get; init; } = [0, 0];
	public bool License { get; init; }
	public bool NamesFile { get; init; }
	/// <summary>Where the first non-blank line after the header starts: the BOM, header and blank lines are before it.</summary>
	public int Prelude { get; init; }
	/// <summary>From the prelude to the end of the last extern alias, using or directive before the first attribute, namespace or type.</summary>
	public int[] UsingRegion { get; init; } = [0, 0];
	public UsingFact[] Usings { get; init; } = [];
	public int[][] GlobalAttributes { get; init; } = [];
	public NamespaceFact[] Namespaces { get; init; } = [];
	public TypeFact[] Types { get; init; } = [];
	public DirectiveFact[] Directives { get; init; } = [];
	/// <summary>Lines of documentation comments outside every type's span.</summary>
	public int[] DetachedDocs { get; init; } = [];
	/// <summary>Calls an interceptor generator may rewrite, by method name.</summary>
	public NameLine[] Intercepted { get; init; } = [];
	public bool TopLevelStatements { get; init; }
	public bool FileTypes { get; init; }
	public bool GlobalUsings { get; init; }
	/// <summary>Why the file's layout cannot be split by lines (usings or a namespace brace sharing a line with other code).</summary>
	public string? Layout { get; init; }
}
````

Create `resources/csast/UsingFact.cs`:

````cs
namespace Csast;

/// <summary>One extern alias or using directive of the file, with its kind.</summary>
sealed class UsingFact
{
	public string Kind { get; init; } = "plain";
	public string Text { get; init; } = "";
}
````

Create `resources/csast/NamespaceFact.cs`:

````cs
namespace Csast;

/// <summary>One namespace declaration: its kind, name, header lines and closing line.</summary>
sealed class NamespaceFact
{
	public string Kind { get; init; } = "block";
	public string Name { get; init; } = "";
	/// <summary>The `namespace` line through its `{` line (block) or `;` line (file-scoped) and its own usings, whole lines.</summary>
	public int[] Header { get; init; } = [0, 0];
	/// <summary>The closing-brace line of a block namespace, whole line.</summary>
	public int[]? Close { get; init; }
	public bool Nested { get; init; }
}
````

Create `resources/csast/TypeFact.cs`:

````cs
namespace Csast;

/// <summary>One top-level type with its span and the facts its movability depends on.</summary>
sealed class TypeFact
{
	public int Id { get; init; }
	public string Kind { get; init; } = "";
	public string Name { get; init; } = "";
	public int Arity { get; init; }
	public string[] TypeParameters { get; init; } = [];
	public string[] Modifiers { get; init; } = [];
	public string[] Attributes { get; init; } = [];
	public string[] Bases { get; init; } = [];
	/// <summary>Index into Namespaces, or -1 for the global namespace.</summary>
	public int Namespace { get; init; }
	public int[] Span { get; init; } = [0, 0];
	public int Lines { get; init; }
	public string Doc { get; init; } = "";
	public string DocText { get; init; } = "";
	public bool SharesLine { get; init; }
	public bool ModuleInitializer { get; init; }
}
````

Create `resources/csast/DirectiveFact.cs`:

````cs
namespace Csast;

/// <summary>One preprocessor directive and where it sits.</summary>
sealed class DirectiveFact
{
	public string Kind { get; init; } = "";
	public int Line { get; init; }
	public int Offset { get; init; }
	public string Text { get; init; } = "";
	/// <summary>The type whose span holds it, or -1.</summary>
	public int Type { get; init; } = -1;
	public bool InUsingRegion { get; init; }
	/// <summary>`#pragma warning`: disable or restore, and its ids.</summary>
	public string Action { get; init; } = "";
	public string[] Ids { get; init; } = [];
}
````

Create `resources/csast/NameLine.cs`:

````cs
namespace Csast;

/// <summary>A name and the line it first appears on.</summary>
sealed class NameLine
{
	public string Name { get; init; } = "";
	public int Line { get; init; }
}
````

Create `src/aiready/csTools.ts`:

````ts
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findTool, runTool } from './projectCommands';

/** The .NET tools a run needs, found and built once. */
export interface CsTools {
	readonly dotnet: string;
	/** `dotnet --version` where no `global.json` applies: the SDK that built the helper. */
	readonly sdk: string;
	/** The helper's `csast.dll`, run with `dotnet`. */
	readonly helper: string;
	/** .NET's culture names, lower case (`de`, `de-de`, `zh-hans`), for culture-specific `.resx` files. */
	readonly cultures: ReadonlySet<string>;
	/** The extension's global storage, for run records (the baseline's reproducibility). */
	readonly storageDir: string;
}

/**
 * Every dotnet command, approved or not. English output for parsing, no telemetry, no MSBuild node or compiler server
 * left running in the worktree. Nothing else: MSBuild turns every environment variable into a property.
 */
export const DOTNET_ENV: Readonly<Record<string, string>> = {
	DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_CLI_UI_LANGUAGE: 'en',
	MSBUILDDISABLENODEREUSE: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
};

const MIN_SDK = [8, 0, 100];

/** Where .NET is usually installed besides PATH. */
export function dotnetInstallDirs(): string[] {
	return ['/usr/local/share/dotnet', '/opt/homebrew/bin', path.join(os.homedir(), '.dotnet'), '/usr/share/dotnet', '/usr/lib/dotnet',
		'C:\\Program Files\\dotnet'];
}

/** Whether `dotnet --version` output names an SDK of 8.0.100 or newer. */
export function sdkSupported(version: string): boolean {
	const parts = version.trim().split(/[.-]/).slice(0, 3).map(Number);
	for (let i = 0; i < 3; i++) {
		if ((parts[i] ?? 0) !== MIN_SDK[i]) { return (parts[i] ?? 0) > MIN_SDK[i]; }
	}
	return true;
}

/** A plain message when the SDK the project's `global.json` selects is missing or older than 8.0.100. */
export async function sdkProblem(dotnet: string, root: string): Promise<string | undefined> {
	const result = await runTool(dotnet, ['--version'], root, DOTNET_ENV);
	if (result.code !== 0) {
		const lines = `${result.stdout}\n${result.stderr}`.split('\n').map(line => line.trim()).filter(Boolean);
		const named = lines.filter(line => /compatible \.NET SDK|Requested SDK version|global\.json file/.test(line));
		return `\`dotnet --version\` failed in this folder: ${(named.length ? named : lines.slice(0, 3)).join(' ')} `
			+ 'Install that SDK or change global.json, then try again.';
	}
	return sdkSupported(result.stdout) ? undefined : `C# splitting needs the .NET SDK 8.0.100 or newer; this folder selects ${result.stdout.trim()}.`;
}

/** The helper's source files, shipped in `resources/csast`. */
export function csHelperSources(extensionPath: string): string {
	return path.join(extensionPath, 'resources', 'csast');
}

/**
 * Builds the helper once per extension version, helper source and SDK, offline (its nuget.config clears every
 * package source) and against the SDK's own Roslyn. It is run once on a probe file before it is cached.
 */
export async function buildCsHelper(sources: string, storageDir: string, version: string, dotnet: string, sdk: string): Promise<string> {
	const files = readdirSync(sources).filter(name => /\.(cs|csproj)$|^nuget\.config$/.test(name)).sort();
	const hash = createHash('sha1');
	for (const name of files) { hash.update(name).update(readFileSync(path.join(sources, name))); }
	const dir = path.join(storageDir, 'csast', `${version}-${sdk}-${hash.update(sdk).digest('hex').slice(0, 8)}`);
	const helper = path.join(dir, 'out', 'csast.dll');
	if (existsSync(helper)) { return helper; }
	mkdirSync(dir, { recursive: true });
	const work = mkdtempSync(path.join(dir, 'build-'));
	try {
		for (const name of files) { copyFileSync(path.join(sources, name), path.join(work, name)); }
		const built = await runTool(dotnet, ['build', '-nologo', '-v:q', '-clp:NoSummary', '--disable-build-servers', '-o', path.join(work, 'out')], work,
			DOTNET_ENV, { timeoutMs: 300_000 });
		if (built.code !== 0) { throw new Error(`Could not build the C# helper: ${`${built.stdout}\n${built.stderr}`.trim().slice(0, 500)}`); }
		writeFileSync(path.join(work, 'Probe.cs'), 'namespace Probe;\n\npublic class P { }\n');
		const probe = await runTool(dotnet, [path.join(work, 'out', 'csast.dll'), 'parse', path.join(work, 'Probe.cs')], work, DOTNET_ENV);
		if (probe.code !== 0 || !probe.stdout.includes('"name":"P"')) {
			throw new Error(`The C# helper was built but does not run: ${probe.stderr.trim().slice(0, 300) || 'wrong output'}`);
		}
		// Another window (or test process) may have built the same helper meanwhile: its copy stays, and is never removed under it.
		try {
			renameSync(path.join(work, 'out'), path.join(dir, 'out'));
		} catch (error) {
			if (!existsSync(helper)) { throw error; }
		}
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
	return helper;
}

/** Runs one helper command; throws with its message when it fails. */
export async function runHelper(tools: Pick<CsTools, 'dotnet' | 'helper'>, args: readonly string[], cwd: string): Promise<string> {
	const result = await runTool(tools.dotnet, [tools.helper, ...args], cwd, DOTNET_ENV, { timeoutMs: 300_000 });
	if (result.code !== 0) { throw new Error(result.stderr.trim().split('\n').pop() || `the C# helper failed (${args[0]})`); }
	return result.stdout;
}

/** Finds dotnet, checks the SDK, builds the helper and reads .NET's culture list. Returns a plain message on failure. */
export async function csTools(extensionPath: string, storageDir: string, version: string): Promise<CsTools | string> {
	const dotnet = findTool('dotnet', dotnetInstallDirs());
	if (!dotnet) { return 'The .NET SDK was not found. Install it (8.0.100 or newer) or add `dotnet` to your PATH, then try again.'; }
	mkdirSync(storageDir, { recursive: true });
	const sdk = (await runTool(dotnet, ['--version'], storageDir, DOTNET_ENV)).stdout.trim();
	if (!sdk || !sdkSupported(sdk)) { return `C# splitting needs the .NET SDK 8.0.100 or newer; the newest installed is ${sdk || 'unknown'}.`; }
	try {
		const helper = await buildCsHelper(csHelperSources(extensionPath), storageDir, version, dotnet, sdk);
		const cultures = new Set(JSON.parse(await runHelper({ dotnet, helper }, ['cultures'], storageDir)) as string[]);
		return { dotnet, sdk, helper, cultures, storageDir };
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}
````

Create `src/aiready/csAst.ts`:

````ts
import * as path from 'path';
import { CsTools, runHelper } from './csTools';

/** A byte range `[start, end)` as the helper prints it. */
export type CsRange = readonly [number, number];

export interface CsUsing {
	readonly kind: 'plain' | 'static' | 'alias' | 'global' | 'extern';
	readonly text: string;
}

export interface CsNamespace {
	readonly kind: 'block' | 'file';
	readonly name: string;
	/** The `namespace` line through its `{` (block) or `;` (file-scoped) line and its own usings, whole lines. */
	readonly header: CsRange;
	/** A block namespace's closing-brace line. */
	readonly close: CsRange | null;
	readonly nested: boolean;
}

/** One top-level type. Its span starts at its attached comments or attributes and ends at the newline of its last line. */
export interface CsType {
	readonly id: number;
	readonly kind: 'class' | 'struct' | 'record' | 'record struct' | 'interface' | 'enum' | 'delegate';
	readonly name: string;
	readonly arity: number;
	readonly typeParameters: readonly string[];
	readonly modifiers: readonly string[];
	readonly attributes: readonly string[];
	readonly bases: readonly string[];
	/** Index into `namespaces`; -1 for the global namespace. */
	readonly namespace: number;
	readonly span: CsRange;
	readonly lines: number;
	readonly doc: string;
	readonly docText: string;
	readonly sharesLine: boolean;
	readonly moduleInitializer: boolean;
}

export interface CsDirective {
	readonly kind: string;
	readonly line: number;
	readonly offset: number;
	readonly text: string;
	/** The id of the type whose span holds it, or -1. */
	readonly type: number;
	readonly inUsingRegion: boolean;
	readonly action: string;
	readonly ids: readonly string[];
}

/** The helper's `parse` JSON for one file; a file that is not UTF-8 has only `encoding` and `size`. */
export interface CsFacts {
	readonly encoding: 'utf8' | 'utf16' | 'invalid';
	readonly bom: boolean;
	readonly eol: 'lf' | 'crlf' | 'mixed' | 'none';
	readonly size: number;
	readonly longLine: boolean;
	readonly error: string | null;
	readonly generated: boolean;
	readonly header: CsRange;
	readonly license: boolean;
	readonly namesFile: boolean;
	readonly prelude: number;
	readonly usingRegion: CsRange;
	readonly usings: readonly CsUsing[];
	readonly globalAttributes: readonly CsRange[];
	readonly namespaces: readonly CsNamespace[];
	readonly types: readonly CsType[];
	readonly directives: readonly CsDirective[];
	readonly detachedDocs: readonly number[];
	readonly intercepted: readonly { readonly name: string; readonly line: number }[];
	readonly topLevelStatements: boolean;
	readonly fileTypes: boolean;
	readonly globalUsings: boolean;
	readonly layout: string | null;
}

const EMPTY: Omit<CsFacts, 'encoding' | 'size'> = {
	bom: false, eol: 'none', longLine: false, error: null, generated: false, header: [0, 0], license: false, namesFile: false, prelude: 0,
	usingRegion: [0, 0], usings: [], globalAttributes: [], namespaces: [], types: [], directives: [], detachedDocs: [], intercepted: [],
	topLevelStatements: false, fileTypes: false, globalUsings: false, layout: null,
};

/** Parses one C# file with the helper. */
export async function csFileFacts(tools: Pick<CsTools, 'dotnet' | 'helper'>, file: string): Promise<CsFacts> {
	let output: string;
	try { output = await runHelper(tools, ['parse', path.resolve(file)], path.dirname(path.resolve(file))); }
	catch (error) { throw new Error(`${path.basename(file)} could not be parsed: ${error instanceof Error ? error.message : String(error)}`); }
	try { return { ...EMPTY, ...JSON.parse(output) } as CsFacts; }
	catch { throw new Error(`${path.basename(file)} could not be parsed: the helper printed no JSON.`); }
}
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 374
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add resources/csast/DirectiveFact.cs resources/csast/FileFacts.cs resources/csast/FileReader.cs resources/csast/NameLine.cs resources/csast/NamespaceFact.cs resources/csast/Program.cs resources/csast/TypeFact.cs resources/csast/UsingFact.cs resources/csast/csast.csproj resources/csast/nuget.config src/aiready/csAst.ts src/aiready/csTools.ts test/csAst.test.ts test/csFixture.ts test/csTools.test.ts
git commit -m "C# helper: offline build per SDK, parse facts"
```

## Chunk 4: The project from MSBuild

### Task 4: MSBuild evaluation, repository scans and the project facts

**Files:**
- Create: `src/aiready/csEval.ts`, `src/aiready/csProject.ts`, `src/aiready/csScan.ts`, `test/csEval.test.ts`, `test/csProject.test.ts`, `test/csScan.test.ts`
- Modify: `test/csFixture.ts`, `tsconfig.test.json`

`csEval` asks MSBuild (evaluation only, no restore) for every configuration × target framework; `csScan` holds the pure pattern scans; `csProject` combines them into project skips, ownership, the restore, build and test commands, and `ready`. The reviewer's probes are named cases: culture `.resx` by file name and .NET's culture list, `EnableRequestDelegateGenerator` in `Directory.Build.props` read from evaluation, per-configuration membership, and the artifacts layout.

- [ ] **Step 1: Write the failing tests.**

Fixture repositories: a library project, a Git repository with an offline `nuget.config`:

In `test/csFixture.ts`, replace:

````ts
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import * as os from 'os';
````

with:

````ts
import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import * as os from 'os';
````

In `test/csFixture.ts`, replace:

````ts
	return source.subarray(range[0], range[1]).toString('utf8');
}
````

with:

````ts
	return source.subarray(range[0], range[1]).toString('utf8');
}

/** A nuget.config with every package source cleared, so restores in tests stay offline. */
export const OFFLINE_NUGET = '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n    <clear />\n  </packageSources>\n'
	+ '</configuration>\n';

/** A class library project file (SDK style) with extra properties and items. */
export function library(properties = '', items = '', sdk = 'Microsoft.NET.Sdk'): string {
	const group = items ? `  <ItemGroup>\n${items}  </ItemGroup>\n` : '';
	return `<Project Sdk="${sdk}">\n  <PropertyGroup>\n    <TargetFramework>net9.0</TargetFramework>\n    <ImplicitUsings>enable</ImplicitUsings>\n`
		+ `    <Nullable>enable</Nullable>\n${properties}  </PropertyGroup>\n${group}</Project>\n`;
}

/** A Git repository with these files and one commit (a cleared nuget.config added). */
export function repository(files: Record<string, string | Buffer>, prefix = 'my-editor-cs-'): string {
	const root = path.join(mkdtempSync(path.join(os.tmpdir(), prefix)), 'shop');
	for (const [name, text] of Object.entries({ 'nuget.config': OFFLINE_NUGET, '.gitignore': 'bin/\nobj/\nartifacts/\n.my_editor/\n', ...files })) {
		mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
		writeFileSync(path.join(root, name), text);
	}
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	git('init', '--quiet');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	return root;
}

/** Tracked files of a repository. */
export function tracked(root: string): string[] {
	return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
}
````

Create `test/csScan.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
	acquisition, assetsPackages, enforcesUnusedUsings, importedBuildFiles, linguistGenerated, platformCompile, resourceCulture, scanningPackage, solutionProjects,
	usesDotnetFormat, whitespaceProblems,
} from '../src/aiready/csScan';

test('acquisition: typeof(…).Assembly, GetExecutingAssembly and scanning registration calls are found by line; plain text is not', () => {
	assert.equal(acquisition('a.cs', 'x\nvar types = typeof(Program).Assembly.GetTypes();\n'), 'a.cs:2 uses typeof(…).Assembly');
	assert.match(acquisition('a.cs', 'var a = Assembly.GetExecutingAssembly();') ?? '', /GetExecutingAssembly/);
	assert.match(acquisition('a.cs', 'var t = GetType().Assembly;') ?? '', /GetType\(\)\.Assembly/);
	assert.match(acquisition('a.cs', 'services.AddMediatR(cfg => cfg.RegisterServicesFromAssemblyContaining<Program>());') ?? '', /FromAssembly|registration/);
	assert.match(acquisition('a.cs', 'builder.Services.AddControllers();') ?? '', /registration call/);
	assert.equal(acquisition('a.cs', 'var assembly = "nothing to see";\nclass AssemblyInfo { }\n'), undefined);
});

test('scanning packages: listed libraries and their packages match by id, others do not; assets files list package libraries only', () => {
	const ids = ['Scrutor', 'MediatR.Contracts', 'Microsoft.Orleans.Core', 'WolverineFx', 'FluentMigrator.Runner', 'Newtonsoft.Json', 'Gracefully'];
	assert.deepEqual(ids.map(id => scanningPackage(id) ?? '-'), ['Scrutor', 'MediatR', 'Orleans', 'Wolverine', 'FluentMigrator', '-', 'Grace']);
	const assets = '{"libraries":{"FluentMigrator.Runner/5.0.0":{"type":"package"},"Lab.Core/1.0.0":{"type":"project"}}}';
	assert.deepEqual(assetsPackages(assets), ['FluentMigrator.Runner']);
	assert.deepEqual(assetsPackages('not json'), []);
});

test('platform conditions: a Compile item, or an ItemGroup holding one, conditioned on the OS or runtime identifier', () => {
	const group = '<ItemGroup Condition="$([MSBuild]::IsOSPlatform(\'Windows\'))">\n<Compile Remove="Win.cs" />\n</ItemGroup>';
	assert.equal(platformCompile(group), '$([MSBuild]::IsOSPlatform(\'Windows\'))');
	const item = '<ItemGroup>\n<Compile Include="x.cs" Condition="\'$(OS)\' == \'Windows_NT\'" />\n</ItemGroup>';
	assert.equal(platformCompile(item), '\'$(OS)\' == \'Windows_NT\'');
	assert.equal(platformCompile('<ItemGroup Condition="\'$(RuntimeIdentifier)\' == \'\'">\n<None Include="x.txt" />\n</ItemGroup>'), undefined);
});

test('imported build files: Directory.Build.props and .targets in the project folder or above it', () => {
	const tracked = ['Directory.Build.props', 'src/Directory.Build.targets', 'tests/Directory.Build.props', 'src/App/x.props'];
	assert.deepEqual(importedBuildFiles('src/App/App.csproj', tracked), ['Directory.Build.props', 'src/Directory.Build.targets']);
	assert.deepEqual(importedBuildFiles('App.csproj', tracked), ['Directory.Build.props']);
});

test('dotnet format and IDE0005: CI files and scripts that run the formatter; editor configs that make unused usings warnings', () => {
	assert.ok(usesDotnetFormat('.github/workflows/ci.yml', 'run: dotnet format --verify-no-changes'));
	assert.ok(usesDotnetFormat('.config/dotnet-tools.json', '{ "tools": { "dotnet-format": {} } }'));
	assert.ok(!usesDotnetFormat('docs/readme.md', 'dotnet format'));
	assert.ok(enforcesUnusedUsings('[*.cs]\ndotnet_diagnostic.IDE0005.severity = warning\n'));
	assert.ok(!enforcesUnusedUsings('dotnet_diagnostic.IDE0005.severity = suggestion'));
});

test('resource cultures: a culture-specific .resx goes by its file name and the culture list .NET reports', () => {
	const cultures = new Set(['de', 'de-de', 'zh-hans']);
	const files = ['Strings.de.resx', 'Strings.zh-Hans.resx', 'Strings.resx', 'Form1.Designer.resx', 'Strings.de.txt'];
	assert.deepEqual(files.map(file => resourceCulture(file, cultures) ?? '-'), ['de', 'zh-hans', '-', '-', '-']);
});

test('solutions: projects listed in .sln lines and .slnx elements, relative to the root', () => {
	assert.deepEqual(solutionProjects('Lab.sln', 'Project("{FAE04EC0}") = "App", "src\\App\\App.csproj", "{1}"\nEndProject\n'), ['src/App/App.csproj']);
	const slnx = '<Solution>\n  <Project Path="tests/App.Tests/App.Tests.csproj" />\n</Solution>\n';
	assert.deepEqual(solutionProjects('Lab.slnx', slnx), ['tests/App.Tests/App.Tests.csproj']);
});

test('linguist-generated: the last matching .gitattributes line wins; patterns without a slash match the name anywhere', () => {
	const attributes = '# generated\n*.Generated.cs linguist-generated\nsrc/Gen/** linguist-generated=true\nsrc/Gen/Keep.cs -linguist-generated\n';
	assert.ok(linguistGenerated(attributes, 'src/App/Big.Generated.cs'));
	assert.ok(linguistGenerated(attributes, 'src/Gen/Deep/Model.cs'));
	assert.ok(!linguistGenerated(attributes, 'src/Gen/Keep.cs'));
	assert.ok(!linguistGenerated(attributes, 'src/App/Big.cs'));
});

test('whitespace problems: the files dotnet format names, once each; other lines are ignored', () => {
	const output = '/w/Shop/Bad.cs(2,17): error WHITESPACE: Fix whitespace formatting. Replace 1 characters with \'\\n\'. [/w/]\n'
		+ '/w/Shop/Bad.cs(3,5): error WHITESPACE: Fix whitespace formatting. Delete 2 characters. [/w/]\n'
		+ 'Shop/Other.cs(1,1): warning WHITESPACE: Fix whitespace formatting. [/w/]\nWarnings were encountered while loading the workspace.\n';
	assert.deepEqual(whitespaceProblems(output), ['/w/Shop/Bad.cs', 'Shop/Other.cs']);
	assert.deepEqual(whitespaceProblems(''), []);
});
````

Create `test/csEval.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { evaluateProject, mapLimit, membership, samePath } from '../src/aiready/csEval';
import { DOTNET, dotnetTools, library, repository } from './csFixture';

const CLASS = (name: string) => `namespace Lab;\n\npublic class ${name} { }\n`;

test('mapLimit keeps the order and never runs more than the limit at once', async () => {
	let running = 0;
	let most = 0;
	const out = await mapLimit([5, 1, 4, 2, 3], 2, async n => {
		running++;
		most = Math.max(most, running);
		await new Promise(resolve => setTimeout(resolve, n));
		running--;
		return n * 10;
	});
	assert.deepEqual(out, [50, 10, 40, 20, 30]);
	assert.equal(most, 2);
});

test('samePath resolves links in the folder, and ignores case on macOS and Windows', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-samepath-'));
	symlinkSync(dir, `${dir}-link`);
	assert.ok(samePath(path.join(dir, 'A.cs'), path.join(`${dir}-link`, 'A.cs')));
	assert.equal(samePath(path.join(dir, 'A.cs'), path.join(dir, 'a.cs')), process.platform !== 'linux');
	assert.ok(!samePath(path.join(dir, 'A.cs'), path.join(dir, 'B.cs')));
});

test('evaluateProject: every configuration and target framework, with the properties and items the rules read', DOTNET, async () => {
	const tools = await dotnetTools();
	const multi = library('', '    <EmbeddedResource Update="Strings.resx" DependentUpon="Big.cs" />\n')
		.replace('<TargetFramework>net9.0</TargetFramework>', '<TargetFrameworks>net8.0;net9.0</TargetFrameworks>');
	const root = repository({ 'App/App.csproj': multi, 'App/Big.cs': CLASS('Big'), 'App/Strings.resx': '<root />\n', 'Bad/Bad.csproj': '<Project>' });
	const evaluation = await evaluateProject(tools, root, 'App/App.csproj');
	const pairs = evaluation.pairs.map(pair => `${pair.configuration} ${pair.framework}`);
	assert.deepEqual(pairs, ['Debug net8.0', 'Debug net9.0', 'Release net8.0', 'Release net9.0']);
	const pair = evaluation.pairs[1];
	assert.deepEqual([pair.properties.UsingMicrosoftNETSdk, pair.items.Compile.map(item => item.identity)], ['true', ['Big.cs']]);
	assert.match(pair.properties.TargetPath, /App\/bin\/Debug\/net9\.0\/App\.dll$/);
	assert.deepEqual(pair.items.EmbeddedResource.map(item => [item.identity, item.dependentUpon]), [['Strings.resx', 'Big.cs']]);
	assert.match((await evaluateProject(tools, root, 'Bad/Bad.csproj')).error ?? '', /error/i);
});

test('membership after writing: compiled by the original project only in every pair, and no other kind of item', DOTNET, async () => {
	const tools = await dotnetTools();
	const items = '    <Compile Remove="Removed.cs" />\n    <Compile Remove="Late.cs" Condition="\'$(Configuration)\' == \'Release\'" />\n'
		+ '    <AdditionalFiles Include="**/Fed*.cs" />\n';
	const root = repository({ 'App/App.csproj': library('', items), 'App/Big.cs': CLASS('Big'),
		'Other/Other.csproj': library('', '    <Compile Include="../App/Glob*.cs" />\n') });
	for (const name of ['Order', 'Removed', 'Late', 'GlobThing', 'FedThing']) {
		writeFileSync(path.join(root, 'App', `${name}.cs`), CLASS(name));
	}
	const evals = await Promise.all(['App/App.csproj', 'Other/Other.csproj'].map(project => evaluateProject(tools, root, project)));
	const check = (name: string) => membership(evals, 'App/App.csproj', [{ name: `${name}.cs`, path: path.join(root, 'App', `${name}.cs`) }]);
	const pairs = (text: (pair: string) => string) => [text('Debug, net9.0'), text('Release, net9.0')];
	assert.deepEqual(check('Order'), []);
	assert.deepEqual(check('Removed'), pairs(pair => `Rule 4: Removed.cs is not compiled by App/App.csproj (${pair}).`));
	assert.deepEqual(check('Late'), ['Rule 4: Late.cs is not compiled by App/App.csproj (Release, net9.0).']);
	assert.deepEqual(check('GlobThing'), pairs(pair => `Rule 4: GlobThing.cs is also compiled by Other/Other.csproj (${pair}).`));
	assert.deepEqual(check('FedThing'), pairs(pair => `Rule 4: FedThing.cs is an AdditionalFiles item of App/App.csproj (${pair}).`));
});
````

Create `test/csProject.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { buildCheck, csRepo, CsRepo, ownerOf, readyProblem, restoreChecks, testChecks } from '../src/aiready/csProject';
import { DOTNET_ENV } from '../src/aiready/csTools';
import { runTool } from '../src/aiready/projectCommands';
import { DOTNET, dotnetTools, library, repository, tracked } from './csFixture';

const CLASS = (name: string) => `namespace Lab;\n\npublic class ${name} { }\n`;

test('commands: restore the root solution (locked when a lock file is tracked), build each project, test with TRX into the worktree', () => {
	assert.deepEqual(restoreChecks(['Lab.sln', 'src/App/App.csproj', 'src/App/packages.lock.json']).map(c => c.command),
		['dotnet restore Lab.sln --locked-mode --disable-build-servers']);
	assert.deepEqual(restoreChecks(['src/App/App.csproj', 'src/Core/Core.csproj']).map(c => c.command),
		['dotnet restore src/App/App.csproj --disable-build-servers', 'dotnet restore src/Core/Core.csproj --disable-build-servers']);
	assert.deepEqual(buildCheck('src/App/App.csproj'), { label: 'build', verifies: true, warnings: 'no-more',
		command: 'dotnet build src/App/App.csproj --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false' });
	const repo = { projects: [{ path: 'tests/T/T.csproj', test: true }], solution: 'Lab.sln', mtp: false } as unknown as CsRepo;
	assert.deepEqual(testChecks(repo), [{ label: 'test', results: '.my_editor/test-results',
		command: 'dotnet test Lab.sln --no-restore --disable-build-servers -nologo --logger trx --results-directory .my_editor/test-results' }]);
	assert.deepEqual(testChecks({ ...repo, solution: undefined, mtp: true }), [{ label: 'test', command: 'dotnet test tests/T/T.csproj --no-restore' }]);
	assert.deepEqual(testChecks({ ...repo, projects: [] }), []);
});

const LAB: Record<string, string> = {
	'src/App/App.csproj': library('', '    <Compile Remove="Gone.cs" Condition="\'$(Configuration)\' == \'Release\'" />\n'),
	'src/App/Big.cs': CLASS('Big'), 'src/App/Gone.cs': CLASS('Gone'), 'src/App/Strings.resx': '<root />\n',
	'src/Multi/Multi.csproj': library('', '    <Compile Remove="Old.cs" Condition="\'$(TargetFramework)\' == \'net8.0\'" />\n')
		.replace('<TargetFramework>net9.0</TargetFramework>', '<TargetFrameworks>net8.0;net9.0</TargetFrameworks>'),
	'src/Multi/Old.cs': CLASS('Old'), 'src/Multi/New.cs': CLASS('New'),
	'src/Shared/Shared.csproj': library(), 'src/Shared/Common.cs': CLASS('Common'),
	'src/Linker/Linker.csproj': library('', '    <Compile Include="../Shared/**/*.cs" />\n'),
	'src/Intl/Intl.csproj': library(), 'src/Intl/Strings.resx': '<root />\n', 'src/Intl/Strings.de.resx': '<root />\n', 'src/Intl/Text.cs': CLASS('Text'),
	'src/Win/Win.csproj': library(), 'src/Win/Directory.Build.props': '<Project>\n  <ItemGroup Condition="$([MSBuild]::IsOSPlatform(\'Windows\'))">\n'
		+ '    <Compile Remove="Unix.cs" />\n  </ItemGroup>\n</Project>\n', 'src/Win/Unix.cs': CLASS('Unix'),
	'src/NoGlob/NoGlob.csproj': library('    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>\n', '    <Compile Include="A.cs" />\n'),
	'src/NoGlob/A.cs': CLASS('A'),
	'tests/App.Tests/App.Tests.csproj': library('    <IsTestProject>true</IsTestProject>\n'), 'tests/App.Tests/BigTests.cs': CLASS('BigTests'),
	'src/Api/Api.csproj': library('', '', 'Microsoft.NET.Sdk.Web'), 'src/Api/Directory.Build.props':
		'<Project>\n  <PropertyGroup>\n    <EnableRequestDelegateGenerator>true</EnableRequestDelegateGenerator>\n  </PropertyGroup>\n</Project>\n',
	'src/Api/Routes.cs': CLASS('Routes'),
	'src/Odd/Odd.csproj': library('    <InterceptorsNamespaces>$(InterceptorsNamespaces);Odd.Generated</InterceptorsNamespaces>\n'),
	'src/Odd/Odd.cs': CLASS('Odd'),
};

interface Lab {
	readonly root: string;
	readonly repo: CsRepo;
}

let lab: Promise<Lab> | undefined;

/** The lab repository read once, for the tests that only look at it. */
function labRepo(): Promise<Lab> {
	lab ??= dotnetTools().then(async tools => {
		const root = repository(LAB, 'my-editor-cslab-');
		return { root, repo: await csRepo(root, tools, tracked(root)) };
	});
	return lab;
}

test('project facts: skips for culture resources, platform conditions, no default items, test projects and other interceptors', DOTNET, async () => {
	const found = await labRepo();
	const skip = (project: string) => found.repo.projects.find(p => p.path === project)?.skip ?? '-';
	assert.equal(skip('src/App/App.csproj'), '-');
	assert.equal(skip('src/Intl/Intl.csproj'), 'src/Intl/Intl.csproj has culture-specific resources (Strings.de.resx), whose satellite assemblies '
		+ 'the assembly check does not compare');
	assert.equal(skip('src/Win/Win.csproj'), 'src/Win/Directory.Build.props conditions Compile items on the operating system or runtime identifier '
		+ '($([MSBuild]::IsOSPlatform(\'Windows\')))');
	assert.equal(skip('src/NoGlob/NoGlob.csproj'), 'src/NoGlob/NoGlob.csproj turns off default compile items, so a new file would not compile');
	assert.equal(skip('tests/App.Tests/App.Tests.csproj'), 'tests/App.Tests/App.Tests.csproj is a test project');
	assert.equal(skip('src/Odd/Odd.csproj'), 'src/Odd/Odd.csproj turns on interceptors in Odd.Generated, which name call sites by file and position');
	const api = found.repo.projects.find(p => p.path === 'src/Api/Api.csproj')!;
	assert.deepEqual([api.web, api.interceptors.rdg, api.interceptors.binder, api.skip ?? '-'], [true, true, false, '-']);
	assert.match(found.repo.scanning ?? '', /^src\/Api\/Api\.csproj uses the Web SDK/);
	assert.deepEqual(testChecks(found.repo).map(c => c.command), ['dotnet test tests/App.Tests/App.Tests.csproj --no-restore --disable-build-servers -nologo '
		+ '--logger trx --results-directory .my_editor/test-results']);
});

test('ownership: one project in every configuration and target framework, or why not', DOTNET, async () => {
	const found = await labRepo();
	const owner = (file: string) => {
		const owned = ownerOf(found.repo, found.root, file);
		return typeof owned === 'string' ? owned : owned.path;
	};
	assert.equal(owner('src/App/Big.cs'), 'src/App/App.csproj');
	assert.equal(owner('src/App/Gone.cs'), 'src/App/App.csproj compiles it only in some configurations or target frameworks (not in Release net9.0)');
	assert.equal(owner('src/Multi/Old.cs'), 'src/Multi/Multi.csproj compiles it only in some configurations or target frameworks (not in Debug net8.0)');
	assert.equal(owner('src/Multi/New.cs'), 'src/Multi/Multi.csproj');
	assert.equal(owner('src/Shared/Common.cs'), 'it is compiled by more than one project (src/Linker/Linker.csproj, src/Shared/Shared.csproj)');
	assert.equal(owner('src/App/Nothing.cs'), 'no tracked project compiles it');
});

test('restore and ready: the assets file is found where ProjectAssetsFile says, also under the artifacts layout', DOTNET, async () => {
	const tools = await dotnetTools();
	const props = '<Project>\n  <PropertyGroup>\n    <UseArtifactsOutput>true</UseArtifactsOutput>\n  </PropertyGroup>\n</Project>\n';
	const root = repository({ 'Directory.Build.props': props, 'App/App.csproj': library(), 'App/Big.cs': CLASS('Big') });
	const before = await csRepo(root, tools, tracked(root));
	assert.match(readyProblem(before) ?? '', /^App\/App\.csproj was not restored: its assets file .*\/artifacts\/obj\/App\/project\.assets\.json is missing\.$/);
	const restored = await runTool(tools.dotnet, ['restore', 'App/App.csproj', '--disable-build-servers'], root, DOTNET_ENV);
	assert.equal(restored.code, 0, restored.stdout);
	assert.equal(readyProblem(await csRepo(root, tools, tracked(root))), undefined);
});

test('scanning: a file acquiring an assembly, a direct or transitive scanning package; nothing else narrows', DOTNET, async () => {
	const tools = await dotnetTools();
	const scanning = async (files: Record<string, string>, assets?: string) => {
		const root = repository({ 'App/App.csproj': library(), 'App/Big.cs': CLASS('Big'), ...files });
		if (assets) {
			mkdirSync(path.join(root, 'App', 'obj'), { recursive: true });
			writeFileSync(path.join(root, 'App', 'obj', 'project.assets.json'), assets);
		}
		return (await csRepo(root, tools, tracked(root))).scanning ?? '-';
	};
	assert.equal(await scanning({}), '-');
	assert.equal(await scanning({ 'App/Setup.cs': 'namespace Lab;\nstatic class Setup { static object A = typeof(Setup).Assembly; }\n' }),
		'App/Setup.cs:2 uses typeof(…).Assembly');
	assert.equal(await scanning({ 'App/App.csproj': library('', '    <PackageReference Include="Scrutor" Version="4.2.2" />\n') }),
		'App/App.csproj references Scrutor, which registers types it finds by scanning');
	assert.equal(await scanning({}, '{"libraries":{"FluentMigrator.Runner/5.0.0":{"type":"package"}}}'),
		'App/App.csproj references FluentMigrator.Runner (through another package), which registers types it finds by scanning');
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/csEval.test.ts(6,65): error TS2307: Cannot find module '../src/aiready/csEval' or its corresponding type declarations.
```

- [ ] **Step 3: Implement.**

Create `src/aiready/csEval.ts`:

````ts
import { realpathSync } from 'fs';
import * as path from 'path';
import { CsTools, DOTNET_ENV } from './csTools';
import { runTool } from './projectCommands';

/** One item from MSBuild evaluation: its full path and the metadata the rules read. */
export interface CsItem {
	readonly path: string;
	readonly identity: string;
	readonly dependentUpon: string;
	readonly copyToOutput: string;
}

/** One configuration and target framework of a project, as MSBuild evaluates it (no restore, no build). */
export interface CsEvaluation {
	readonly configuration: string;
	/** Empty for a project MSBuild evaluated without one. */
	readonly framework: string;
	readonly properties: Readonly<Record<string, string>>;
	readonly items: Readonly<Record<string, readonly CsItem[]>>;
}

/** A project's evaluations in every configuration × target framework, or why MSBuild could not evaluate it. */
export interface CsProjectEval {
	/** Relative to the root, `/`-separated. */
	readonly project: string;
	readonly pairs: readonly CsEvaluation[];
	readonly error?: string;
}

export const PROPERTIES = ['UsingMicrosoftNETSdk', 'UsingMicrosoftNETSdkWeb', 'EnableDefaultCompileItems', 'EnableDefaultItems', 'TargetPath',
	'ProjectAssetsFile', 'IsTestProject', 'EnableRequestDelegateGenerator', 'EnableConfigurationBindingGenerator', 'PublishAot', 'InterceptorsNamespaces',
	'InterceptorsPreviewNamespaces', 'TestingPlatformDotnetTestSupport', 'AssemblyName', 'EnforceCodeStyleInBuild', 'GenerateDocumentationFile'];
export const ITEMS = ['Compile', 'EmbeddedResource', 'AdditionalFiles', 'Content', 'None', 'Page', 'Resource', 'PackageReference', 'EditorConfigFiles',
	'GlobalAnalyzerConfigFiles'];

/** An item as `-getItem` prints it (only the metadata read here). */
interface RawItem {
	readonly Identity?: string;
	readonly FullPath?: string;
	readonly DependentUpon?: string;
	readonly CopyToOutputDirectory?: string;
}

interface Raw {
	readonly Properties?: Record<string, string>;
	readonly Items?: Record<string, RawItem[]>;
}

/** Runs `dotnet msbuild <project> -getProperty:… -getItem:…` (evaluation only) and reads its JSON; a string is the failure. */
async function msbuild(tools: Pick<CsTools, 'dotnet'>, root: string, project: string, args: readonly string[]): Promise<Raw | string> {
	const result = await runTool(tools.dotnet, ['msbuild', project, '-nologo', ...args], root, DOTNET_ENV, { timeoutMs: 300_000 });
	const start = result.stdout.indexOf('{');
	if (result.code !== 0 || start < 0) {
		const lines = `${result.stdout}\n${result.stderr}`.split('\n').map(line => line.trim()).filter(Boolean);
		return lines.find(line => /error/i.test(line)) ?? lines[0] ?? `exit ${result.code}`;
	}
	try {
		return JSON.parse(result.stdout.slice(start)) as Raw;
	} catch {
		return 'MSBuild printed no JSON';
	}
}

/** Maps with at most `limit` calls at a time. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

const list = (value: string | undefined) => (value ?? '').split(';').map(part => part.trim()).filter(Boolean);

/**
 * Evaluates a project once for its configurations and target frameworks (the SDK default is `Debug;Release`), then
 * once per pair with the properties and items the rules read.
 */
export async function evaluateProject(tools: Pick<CsTools, 'dotnet'>, root: string, project: string): Promise<CsProjectEval> {
	const outer = await msbuild(tools, root, project, ['-getProperty:Configurations', '-getProperty:TargetFrameworks', '-getProperty:TargetFramework']);
	if (typeof outer === 'string') { return { project, pairs: [], error: outer }; }
	const configurations = list(outer.Properties?.Configurations);
	const frameworks = list(outer.Properties?.TargetFrameworks);
	const pairs = (configurations.length ? configurations : ['Debug', 'Release'])
		.flatMap(configuration => (frameworks.length ? frameworks : [outer.Properties?.TargetFramework ?? '']).map(framework => ({ configuration, framework })));
	const evaluations = await mapLimit(pairs, 4, async ({ configuration, framework }) => {
		const raw = await msbuild(tools, root, project, [`-p:Configuration=${configuration}`, ...(framework ? [`-p:TargetFramework=${framework}`] : []),
			...PROPERTIES.map(name => `-getProperty:${name}`), ...ITEMS.map(name => `-getItem:${name}`)]);
		if (typeof raw === 'string') { return raw; }
		const items: Record<string, CsItem[]> = {};
		for (const name of ITEMS) {
			items[name] = (raw.Items?.[name] ?? []).map(item => ({
				path: item.FullPath ?? path.resolve(root, path.dirname(project), item.Identity ?? ''), identity: item.Identity ?? '',
				dependentUpon: item.DependentUpon ?? '', copyToOutput: item.CopyToOutputDirectory ?? '',
			}));
		}
		return { configuration, framework, properties: raw.Properties ?? {}, items };
	});
	const failed = evaluations.find((e): e is string => typeof e === 'string');
	return failed ? { project, pairs: [], error: failed } : { project, pairs: evaluations as CsEvaluation[] };
}

const realDirs = new Map<string, string>();

/** A path with its folder's symbolic links resolved (MSBuild reports `/private/var/…` for `/var/…` on macOS). */
function real(file: string): string {
	const dir = path.dirname(path.resolve(file));
	let resolved = realDirs.get(dir);
	if (resolved === undefined) {
		try {
			resolved = realpathSync.native(dir);
		} catch {
			resolved = dir;
		}
		realDirs.set(dir, resolved);
	}
	return path.join(resolved, path.basename(file)).split(path.sep).join('/');
}

/** Paths compare after resolving links, and without case where the file system usually ignores it (macOS, Windows). */
export function samePath(a: string, b: string): boolean {
	return process.platform === 'linux' ? real(a) === real(b) : real(a).toLowerCase() === real(b).toLowerCase();
}

/** Items that would feed a new `.cs` file to the build as something other than source. */
const OTHER_KINDS = ['EmbeddedResource', 'AdditionalFiles', 'Content', 'Page', 'Resource'];

/**
 * Move rule 4's project part: in every configuration and target framework of every project, each new file is a
 * `Compile` item of the original's project and of no other, and no other kind of item anywhere.
 */
export function membership(evals: readonly CsProjectEval[], owner: string, files: readonly { readonly name: string; readonly path: string }[]): string[] {
	const problems: string[] = [];
	for (const file of files) {
		for (const project of evals) {
			if (project.error) {
				problems.push(`Rule 4: MSBuild could not evaluate ${project.project}: ${project.error}`);
				continue;
			}
			for (const pair of project.pairs) {
				const where = `${project.project} (${pair.configuration}${pair.framework ? `, ${pair.framework}` : ''})`;
				const compiled = pair.items.Compile.some(item => samePath(item.path, file.path));
				if (project.project === owner && !compiled) { problems.push(`Rule 4: ${file.name} is not compiled by ${where}.`); }
				if (project.project !== owner && compiled) { problems.push(`Rule 4: ${file.name} is also compiled by ${where}.`); }
				const other = OTHER_KINDS.find(kind => pair.items[kind].some(item => samePath(item.path, file.path)))
					?? (pair.items.None.some(item => samePath(item.path, file.path) && item.copyToOutput && item.copyToOutput !== 'Never') ? 'None' : undefined);
				if (other) { problems.push(`Rule 4: ${file.name} is an ${other} item of ${where}.`); }
			}
		}
	}
	return [...new Set(problems)];
}
````

Create `src/aiready/csScan.ts`:

````ts
import * as path from 'path';

/** Registration calls that scan an assembly, by name (`\w*` allows `AddControllersWithViews` and the like). */
const SCANNING_CALLS = ['Scan', 'AddMediatR', 'AddAutoMapper', 'AddMaps', 'AddValidatorsFrom\\w*', 'ApplyConfigurationsFromAssembly', 'AddConsumers',
	'AddControllers\\w*', 'AddMvc\\w*', 'AddApplicationPart', 'AddCarter', 'AddFastEndpoints', 'ScanIn'];

/** Code that gets hold of an assembly or its types, which is how scanners start (design: *Assembly scanning*). */
const ACQUIRES: readonly [RegExp, string][] = [
	[/\btypeof\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*\.\s*Assembly\b/, 'typeof(…).Assembly'],
	[/\.\s*GetTypeInfo\s*\(\s*\)\s*\.\s*Assembly\b/, '.GetTypeInfo().Assembly'],
	[/\bGetType\s*\(\s*\)\s*\.\s*Assembly\b/, 'GetType().Assembly'],
	[/\bAssembly\s*\.\s*(?:GetExecutingAssembly|GetCallingAssembly|GetEntryAssembly|Load\w*)\b/,
		'Assembly.GetExecutingAssembly/GetCallingAssembly/GetEntryAssembly/Load'],
	[/\bAppDomain\s*\.\s*CurrentDomain\s*\.\s*GetAssemblies\b/, 'AppDomain.CurrentDomain.GetAssemblies'],
	[/\bAssemblyLoadContext\b/, 'AssemblyLoadContext'],
	[/\bDependencyContext\b/, 'DependencyContext'],
	[/\b(?:GetTypes|GetExportedTypes|GetForwardedTypes|DefinedTypes|ExportedTypes)\b/, 'GetTypes/GetExportedTypes/GetForwardedTypes/DefinedTypes/ExportedTypes'],
	[/\b\w*(?:FromAssembl|AssemblyTypes|AssemblyOf)\w*\s*[<(]/, 'a call naming FromAssembly, AssemblyTypes or AssemblyOf'],
	[new RegExp(`\\b(?:${SCANNING_CALLS.join('|')})\\s*[<(]`), 'a registration call that scans (Scan, AddMediatR, AddAutoMapper, AddControllers…)'],
];

/** DI containers, mappers, messaging and migration libraries that register types found by scanning. */
export const SCANNING_PACKAGES = ['Scrutor', 'MediatR', 'AutoMapper', 'Mapster', 'FluentValidation.DependencyInjectionExtensions', 'Autofac', 'Lamar',
	'StructureMap', 'SimpleInjector', 'Castle.Windsor', 'DryIoc', 'Ninject', 'Grace', 'Stashbox', 'MassTransit', 'NServiceBus', 'Rebus', 'Wolverine',
	'Brighter', 'Carter', 'FastEndpoints', 'FluentMigrator', 'Evolve', 'Hangfire', 'Quartz', 'Orleans'];

/** The first line of a C# file that acquires an assembly or calls a scanner, as `file:line uses what`. */
export function acquisition(file: string, text: string): string | undefined {
	const lines = text.split('\n');
	for (const [index, line] of lines.entries()) {
		const hit = ACQUIRES.find(([pattern]) => pattern.test(line));
		if (hit) { return `${file}:${index + 1} uses ${hit[1]}`; }
	}
	return undefined;
}

/** Whether a package id is one of the scanning libraries or one of their packages (`MediatR.Contracts`, `Microsoft.Orleans.Core`, `WolverineFx`). */
export function scanningPackage(id: string): string | undefined {
	const parts = id.toLowerCase().split('.');
	return SCANNING_PACKAGES.find(name => {
		const want = name.toLowerCase().split('.');
		return id.toLowerCase().startsWith(name.toLowerCase())
			|| parts.some((_, i) => want.every((part, j) => parts[i + j] === part));
	});
}

/** Package ids of a project's restore (`project.assets.json` libraries), transitive ones included. */
export function assetsPackages(json: string): string[] {
	try {
		const libraries = (JSON.parse(json) as { libraries?: Record<string, { type?: string }> }).libraries ?? {};
		return Object.entries(libraries).filter(([, library]) => library.type === 'package').map(([key]) => key.split('/')[0]);
	} catch { return []; }
}

const PLATFORM = /IsOSPlatform|\$\(\s*OS\s*\)|RuntimeIdentifiers?\b/;

/**
 * Whether a project or imported props/targets text has a `Compile` item, or an `ItemGroup` holding one, with a
 * condition on the operating system or runtime identifier (the evaluation here cannot show another machine's items).
 */
export function platformCompile(text: string): string | undefined {
	for (const group of text.matchAll(/<ItemGroup\b([^>]*)>([\s\S]*?)<\/ItemGroup>/g)) {
		const condition = /Condition\s*=\s*"([^"]*)"/.exec(group[1])?.[1] ?? '';
		if (/<Compile\b/.test(group[2]) && PLATFORM.test(condition)) { return condition; }
		for (const item of group[2].matchAll(/<Compile\b([^>]*)>/g)) {
			const itemCondition = /Condition\s*=\s*"([^"]*)"/.exec(item[1])?.[1] ?? '';
			if (PLATFORM.test(itemCondition)) { return itemCondition; }
		}
	}
	return undefined;
}

/** `Directory.Build.props`/`.targets` files (tracked) that MSBuild imports for a project: in its folder or any folder above it. */
export function importedBuildFiles(project: string, tracked: readonly string[]): string[] {
	const dirs: string[] = [];
	for (let dir = path.posix.dirname(project); ; dir = path.posix.dirname(dir)) { dirs.push(dir); if (dir === '.') { break; } }
	return tracked.filter(file => /^(?:.*\/)?Directory\.Build\.(?:props|targets)$/.test(file) && dirs.includes(path.posix.dirname(file)));
}

/** Whether a tracked script, CI file or tool manifest runs `dotnet format`. */
export function usesDotnetFormat(file: string, text: string): boolean {
	return /(?:^|\/)(?:\.github\/|\.gitlab-ci|azure-pipelines|\.config\/dotnet-tools\.json$|Makefile$|[^/]+\.(?:sh|ps1|cmd|bat|ya?ml|cake|json)$)/.test(file)
		&& /dotnet[ -]format/.test(text);
}

/** The files `dotnet format whitespace --verify-no-changes` names (`/w/Bad.cs(2,17): error WHITESPACE: …`), each once. */
export function whitespaceProblems(output: string): string[] {
	const named = output.split('\n').map(line => /^(.+?\.cs)\(\d+,\d+\): (?:error|warning) WHITESPACE\b/.exec(line.trim())?.[1]);
	return [...new Set(named.filter((name): name is string => !!name))];
}

/** Whether an editor config sets IDE0005 (unused usings) to warning or error. */
export function enforcesUnusedUsings(text: string): boolean {
	return /^\s*dotnet_diagnostic\.IDE0005\.severity\s*=\s*(?:warning|error)\b/im.test(text);
}

/** The culture a resource file is for (`Strings.de.resx` → `de`), by .NET's culture list; undefined for a neutral one. */
export function resourceCulture(file: string, cultures: ReadonlySet<string>): string | undefined {
	const parts = path.basename(file).split('.');
	if (parts.length < 3 || parts[parts.length - 1].toLowerCase() !== 'resx') { return undefined; }
	const culture = parts[parts.length - 2].toLowerCase();
	return cultures.has(culture) ? culture : undefined;
}

/** Projects a solution lists (`.sln` lines or `.slnx` elements), relative to the root and `/`-separated. */
export function solutionProjects(solution: string, text: string): string[] {
	const dir = path.posix.dirname(solution);
	const found = [...text.matchAll(/^Project\("[^"]*"\)\s*=\s*"[^"]*",\s*"([^"]+\.csproj)"/gm), ...text.matchAll(/<Project\s+Path="([^"]+\.csproj)"/g)]
		.map(match => path.posix.normalize(path.posix.join(dir, match[1].replace(/\\/g, '/'))));
	return [...new Set(found)];
}

/** A `.gitattributes` pattern as a regular expression: `*`, `**` and `?`; a pattern without `/` matches the file name anywhere. */
function attributePattern(pattern: string): RegExp {
	const body = pattern.replace(/^\//, '').split(/(\*\*\/?|\*|\?)/).map(part => {
		if (part === '**/') { return '(?:.*/)?'; }
		if (part === '**') { return '.*'; }
		if (part === '*') { return '[^/]*'; }
		if (part === '?') { return '[^/]'; }
		return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}).join('');
	return new RegExp(pattern.includes('/') ? `^${body}$` : `(?:^|/)${body}$`);
}

/** Whether `.gitattributes` marks a file `linguist-generated` (the last matching line wins, as in Git). */
export function linguistGenerated(gitattributes: string, file: string): boolean {
	let generated = false;
	for (const line of gitattributes.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))) {
		const [pattern, ...attrs] = line.split(/\s+/);
		const attr = attrs.find(a => /^-?linguist-generated(?:=|$)/.test(a));
		if (attr && attributePattern(pattern).test(file)) { generated = !attr.startsWith('-') && !attr.endsWith('=false'); }
	}
	return generated;
}
````

Create `src/aiready/csProject.ts`:

````ts
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { CsEvaluation, CsProjectEval, evaluateProject, mapLimit, samePath } from './csEval';
import {
	acquisition, assetsPackages, enforcesUnusedUsings, importedBuildFiles, platformCompile, resourceCulture, scanningPackage, solutionProjects, usesDotnetFormat,
} from './csScan';
import type { CsTools } from './csTools';
import type { CheckCommand } from './language';
import { splitCommand } from './projectCommands';

/** The namespaces of the two interceptor generators the static rule knows; any other namespace skips the whole project. */
const KNOWN_INTERCEPTORS = { rdg: 'Microsoft.AspNetCore.Http.Generated', binder: 'Microsoft.Extensions.Configuration.Binder.SourceGeneration' };
/** Where `dotnet test` writes TRX files: worktree-relative, because the run-state folder's path has a space. */
export const RESULTS = '.my_editor/test-results';

/** What the rules need to know about one project. */
export interface CsProjectFacts {
	readonly path: string;
	readonly evaluation: CsProjectEval;
	/** Why none of its files may be split. */
	readonly skip?: string;
	readonly test: boolean;
	readonly mtp: boolean;
	readonly web: boolean;
	/** Interceptor generators it turns on in any configuration. */
	readonly interceptors: { readonly rdg: boolean; readonly binder: boolean };
	/** Its build reports unused usings (IDE0005), so copied usings would add warnings. */
	readonly unusedUsings: boolean;
}

/** The repository as the C# adapter sees it. */
export interface CsRepo {
	readonly projects: readonly CsProjectFacts[];
	/** The root's only `.sln`/`.slnx`. */
	readonly solution?: string;
	/** Why every project may scan its assembly for types (the first reason found), if any does. */
	readonly scanning?: string;
	readonly formatUsed: boolean;
	readonly mtp: boolean;
	/** A solution or test project path the test command cannot carry (a space, or another character `splitCommand` refuses). */
	readonly pathProblem?: string;
}

const truthy = (pair: CsEvaluation, name: string) => (pair.properties[name] ?? '').toLowerCase() === 'true';
const names = (value: string | undefined) => (value ?? '').split(';').map(part => part.trim()).filter(Boolean);

/** A tracked text file, or nothing when it cannot be read. */
function read(root: string, file: string): string {
	try {
		return readFileSync(path.join(root, file), 'utf8');
	} catch {
		return '';
	}
}

/** Why a project's files are never split, or undefined. */
function projectSkip(root: string, project: CsProjectEval, tracked: readonly string[], cultures: ReadonlySet<string>, test: boolean): string | undefined {
	if (project.error) { return `MSBuild could not evaluate ${project.project}: ${project.error}`; }
	if (!splitCommand(project.project)) { return `the path ${project.project} has a space or another character the checks cannot pass without a shell`; }
	if (project.pairs.some(pair => !truthy(pair, 'UsingMicrosoftNETSdk'))) { return `${project.project} is an old-style (non-SDK) project`; }
	if (project.pairs.some(pair => pair.properties.EnableDefaultCompileItems === 'false' || pair.properties.EnableDefaultItems === 'false')) {
		return `${project.project} turns off default compile items, so a new file would not compile`;
	}
	if (test) { return `${project.project} is a test project`; }
	const resource = project.pairs.flatMap(pair => pair.items.EmbeddedResource).find(item => resourceCulture(item.path, cultures));
	if (resource) {
		return `${project.project} has culture-specific resources (${path.basename(resource.path)}), whose satellite assemblies the assembly check does not compare`;
	}
	for (const file of [project.project, ...importedBuildFiles(project.project, tracked)]) {
		const condition = platformCompile(read(root, file));
		if (condition) { return `${file} conditions Compile items on the operating system or runtime identifier (${condition})`; }
	}
	const other = project.pairs.flatMap(pair => [...names(pair.properties.InterceptorsNamespaces), ...names(pair.properties.InterceptorsPreviewNamespaces)])
		.find(ns => !Object.values(KNOWN_INTERCEPTORS).includes(ns));
	if (other) { return `${project.project} turns on interceptors in ${other}, which name call sites by file and position`; }
	return undefined;
}

/** Reads every tracked project with MSBuild, and scans the repository for assembly scanning, `dotnet format` and test runners. */
export async function csRepo(root: string, tools: Pick<CsTools, 'dotnet' | 'cultures'>, tracked: readonly string[]): Promise<CsRepo> {
	const solutions = tracked.filter(file => /^[^/]+\.slnx?$/.test(file));
	const solution = solutions.length === 1 ? solutions[0] : undefined;
	const listed = solution ? solutionProjects(solution, read(root, solution)) : undefined;
	const globalJson = read(root, 'global.json');
	const mtpRunner = /"runner"\s*:\s*"Microsoft\.Testing\.Platform"/.test(globalJson);
	const evaluations = await mapLimit(tracked.filter(file => file.endsWith('.csproj')), 2, project => evaluateProject(tools, root, project));
	const projects = evaluations.map(evaluation => {
		const pairs = evaluation.pairs;
		const test = pairs.some(pair => truthy(pair, 'IsTestProject')
			|| pair.items.PackageReference.some(item => item.identity.toLowerCase() === 'microsoft.net.test.sdk'));
		const enabled = (name: string) => pairs.some(pair => names(pair.properties.InterceptorsPreviewNamespaces).includes(name)
			|| names(pair.properties.InterceptorsNamespaces).includes(name));
		return {
			path: evaluation.project, evaluation, test, web: pairs.some(pair => truthy(pair, 'UsingMicrosoftNETSdkWeb')),
			mtp: test && (mtpRunner || pairs.some(pair => truthy(pair, 'TestingPlatformDotnetTestSupport'))),
			skip: projectSkip(root, evaluation, tracked, tools.cultures, test),
			interceptors: {
				rdg: enabled(KNOWN_INTERCEPTORS.rdg) || pairs.some(pair => truthy(pair, 'EnableRequestDelegateGenerator')
					|| (truthy(pair, 'PublishAot') && truthy(pair, 'UsingMicrosoftNETSdkWeb'))),
				binder: enabled(KNOWN_INTERCEPTORS.binder) || pairs.some(pair => truthy(pair, 'EnableConfigurationBindingGenerator') || truthy(pair, 'PublishAot')),
			},
			unusedUsings: pairs.some(pair => truthy(pair, 'EnforceCodeStyleInBuild') && truthy(pair, 'GenerateDocumentationFile')
				&& [...pair.items.EditorConfigFiles, ...pair.items.GlobalAnalyzerConfigFiles].some(item => existsSync(item.path)
					&& enforcesUnusedUsings(readFileSync(item.path, 'utf8')))),
		};
	});
	const testProjects = projects.filter(p => p.test && (!listed || listed.includes(p.path)));
	const unsafe = [...(solution ? [solution] : testProjects.map(p => p.path))].find(file => !splitCommand(file));
	return {
		projects, solution, scanning: scanningReason(root, tracked, projects), mtp: testProjects.some(p => p.mtp),
		formatUsed: tracked.some(file => !file.endsWith('.cs') && usesDotnetFormat(file, read(root, file))),
		...(unsafe ? { pathProblem: `the path ${unsafe} has a space or another character the test command cannot pass without a shell` } : {}),
	};
}

/** Why every project may scan its assembly: a tracked file that acquires one, a scanning package (direct, or transitive after restore), or the Web SDK. */
function scanningReason(root: string, tracked: readonly string[], projects: readonly CsProjectFacts[]): string | undefined {
	for (const file of tracked.filter(f => f.endsWith('.cs'))) {
		const found = acquisition(file, read(root, file));
		if (found) { return found; }
	}
	for (const project of projects) {
		const pairs = project.evaluation.pairs;
		const direct = pairs.flatMap(pair => pair.items.PackageReference.map(item => item.identity));
		const assets = [...new Set(pairs.map(pair => pair.properties.ProjectAssetsFile ?? ''))].filter(file => file && existsSync(file));
		const all = [...direct, ...assets.flatMap(file => assetsPackages(readFileSync(file, 'utf8')))];
		const id = all.find(scanningPackage);
		if (id) { return `${project.path} references ${id}${direct.includes(id) ? '' : ' (through another package)'}, which registers types it finds by scanning`; }
		if (project.web) { return `${project.path} uses the Web SDK, whose MVC and Razor Pages discover controllers and pages by scanning`; }
	}
	return undefined;
}

/** The project that compiles a file in every configuration and target framework, or why there is not exactly one. */
export function ownerOf(repo: CsRepo, root: string, file: string): CsProjectFacts | string {
	const full = path.join(root, file);
	const compiling = repo.projects.filter(p => p.evaluation.pairs.some(pair => pair.items.Compile.some(item => samePath(item.path, full))));
	if (!compiling.length) { return 'no tracked project compiles it'; }
	if (compiling.length > 1) { return `it is compiled by more than one project (${compiling.map(p => p.path).join(', ')})`; }
	const owner = compiling[0];
	const missing = owner.evaluation.pairs.find(pair => !pair.items.Compile.some(item => samePath(item.path, full)));
	if (missing) {
		const pair = `${missing.configuration} ${missing.framework}`.trim();
		return `${owner.path} compiles it only in some configurations or target frameworks (not in ${pair})`;
	}
	return owner;
}

/** The test command(s): one for the root solution, else one per test project; TRX results unless a test project uses Microsoft.Testing.Platform. */
export function testChecks(repo: CsRepo): CheckCommand[] {
	const tests = repo.projects.filter(p => p.test);
	if (!tests.length) { return []; }
	const targets = repo.solution ? [repo.solution] : tests.map(p => p.path);
	return targets.map(target => (repo.mtp
		? { label: 'test' as const, command: `dotnet test ${target} --no-restore` }
		: { label: 'test' as const, command: `dotnet test ${target} --no-restore --disable-build-servers -nologo --logger trx --results-directory ${RESULTS}`,
			results: RESULTS }));
}

/** The build check of a project: every target framework, rebuilt so warnings print every time, positions relative so they compare. */
export function buildCheck(project: string): CheckCommand {
	return { label: 'build', command: `dotnet build ${project} --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary `
		+ '-p:GenerateFullPaths=false', verifies: true, warnings: 'no-more' };
}

/** The restore, once per run: the root's only solution, else the root's only project, else every tracked project. */
export function restoreChecks(tracked: readonly string[]): CheckCommand[] {
	const locked = tracked.some(file => /(?:^|\/)packages\.lock\.json$/.test(file)) ? ' --locked-mode' : '';
	const solutions = tracked.filter(file => /^[^/]+\.slnx?$/.test(file));
	const rootProjects = tracked.filter(file => /^[^/]+\.csproj$/.test(file));
	const targets = solutions.length === 1 ? solutions : rootProjects.length === 1 ? rootProjects : tracked.filter(file => file.endsWith('.csproj'));
	return targets.filter(target => splitCommand(target))
		.map(target => ({ label: 'install', command: `dotnet restore ${target}${locked} --disable-build-servers` }));
}

/** Why the worktree is not ready after the restore: a project MSBuild cannot evaluate, or one whose assets file is missing. */
export function readyProblem(repo: CsRepo): string | undefined {
	for (const project of repo.projects.filter(p => !p.evaluation.error && p.evaluation.pairs.every(pair => truthy(pair, 'UsingMicrosoftNETSdk')))) {
		const assets = project.evaluation.pairs.map(pair => pair.properties.ProjectAssetsFile ?? '').find(file => !file || !existsSync(file));
		if (assets !== undefined) { return `${project.path} was not restored: its assets file ${assets || '(unknown)'} is missing.`; }
	}
	const broken = repo.projects.find(p => p.evaluation.error);
	return broken ? `MSBuild could not evaluate ${broken.path}: ${broken.evaluation.error}` : undefined;
}

/** A fingerprint of the restore while its assets files exist. */
export function restoreStamp(repo: CsRepo): string | undefined {
	const files = [...new Set(repo.projects.flatMap(p => p.evaluation.pairs.map(pair => pair.properties.ProjectAssetsFile ?? '')))].filter(Boolean).sort();
	if (!files.length || !files.every(file => existsSync(file))) { return undefined; }
	const hash = createHash('sha1');
	for (const file of files) { hash.update(file).update(readFileSync(file)); }
	return hash.digest('hex');
}
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/pyAdapter.ts",
    "src/aiready/checkResult.ts"
  ]
````

with:

````json
    "src/aiready/pyAdapter.ts",
    "src/aiready/checkResult.ts",
    "src/aiready/csTools.ts",
    "src/aiready/csAst.ts",
    "src/aiready/csEval.ts",
    "src/aiready/csScan.ts",
    "src/aiready/csProject.ts"
  ]
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 392
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/csEval.ts src/aiready/csProject.ts src/aiready/csScan.ts test/csEval.test.ts test/csFixture.ts test/csProject.test.ts test/csScan.test.ts tsconfig.test.json
git commit -m "C#: MSBuild evaluation, scans and project facts"
```

## Chunk 5: Rules, splitting and the move check

### Task 5: Skip reasons, directives, movability, the keeper, names and the host plan

**Files:**
- Create: `src/aiready/csRules.ts`, `test/csRules.test.ts`
- Modify: `test/csAst.test.ts`, `tsconfig.test.json`

Pure rules over the helper's facts and the file's context. Every refusal of the design's *Skipped files*, *Directives* and *What may move* has a case; names go `<Name>.cs`, then `<Name>{T}.cs`, else the type stays with the reason.

- [ ] **Step 1: Write the failing tests.**

The parse facts the directive rules read:

In `test/csAst.test.ts`, replace:

````ts
	assert.match((await csFacts('E.cs', 'class A {\n')).facts.error ?? '', /^line \d+: } expected/);
});
````

with:

````ts
	assert.match((await csFacts('E.cs', 'class A {\n')).facts.error ?? '', /^line \d+: } expected/);
});

test('parse: directives with their place, module initializers, nested namespaces and intercepted calls', DOTNET, async () => {
	const text = 'using System;\n#pragma warning disable CS0618\n\nnamespace N\n{\n    #region Types\n    public class A\n    {\n        #region Members\n'
		+ '        #pragma warning disable CS0168, CS0219\n        void M() { }\n        #pragma warning restore CS0168, CS0219\n        #endregion\n'
		+ '        [System.Runtime.CompilerServices.ModuleInitializer] internal static void Init() { }\n    }\n    #endregion\n\n'
		+ '    public class B { void Map(object app) { app.MapGet("/", 1); config.Bind(this); } }\n\n    namespace Inner { }\n}\n';
	const parsed = await csFacts('N.cs', text);
	const { facts } = parsed;
	assert.deepEqual(facts.directives.map(d => `${d.kind} ${d.line} ${d.type} ${d.inUsingRegion} ${d.action} ${d.ids.join(',')}`.trim()), [
		'pragma warning 2 -1 true disable CS0618', 'region 6 -1 false', 'region 9 0 false', 'pragma warning 10 0 false disable CS0168,CS0219',
		'pragma warning 12 0 false restore CS0168,CS0219', 'endregion 13 0 false', 'endregion 16 -1 false',
	]);
	assert.deepEqual(facts.types.map(type => [type.name, type.moduleInitializer]), [['A', true], ['B', false]]);
	assert.deepEqual(facts.namespaces.map(n => [n.name, n.nested]), [['N', false], ['Inner', true]]);
	assert.deepEqual(facts.intercepted.map(c => `${c.name} ${c.line}`), ['MapGet 18', 'Bind 18']);
});
````

Create `test/csRules.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CsFileContext, csFileInfoView, csFileNameProblems, csPlan, csSkipReason, directiveProblem } from '../src/aiready/csRules';
import { csFacts, DOTNET } from './csFixture';

const CTX: CsFileContext = { entries: ['Big.cs'], interceptors: { rdg: false, binder: false } };
const NOT_SPLIT = 'which version 1 does not split around';

/** The skip reason of a file with this text and name, or 'no'. */
async function skipOf(text: string | Buffer, name = 'Big.cs', ctx: Partial<CsFileContext> = {}): Promise<string> {
	const parsed = await csFacts(name, text);
	return csSkipReason(name, parsed.facts, { ...CTX, entries: [name], ...ctx }) ?? 'no';
}

const NS = (body: string) => `using System;\n\nnamespace Shop;\n\n${body}`;
const TYPE = (body: string) => NS(`public class A\n{\n${body}}\n`);

test('skipped files: lookup that depends on the file and namespace shapes', DOTNET, async () => {
	const cases: [string, string][] = [
		[NS('public class A { }\n\nfile class Helper { }\n'), 'it declares a file-local type, which wins name lookup only inside its file'],
		['System.Console.WriteLine(1);\n\nclass A { }\n', 'it has top-level statements'],
		['global using System.Text;\n\nclass A { }\n', 'it has a global using, which belongs in one place'],
		['namespace A { class X { } }\nnamespace B { class Y { } }\n', 'it has more than one namespace declaration'],
		['namespace A\n{\n    namespace B\n    {\n        class Y { }\n    }\n}\n', 'it has a namespace inside another'],
		['class Outside { }\n\nnamespace A\n{\n    class X { }\n}\n', 'it has types outside its namespace'],
		['// <auto-generated/>\nclass A { }\n', 'it has an <auto-generated> header'],
	];
	for (const [text, reason] of cases) { assert.equal(await skipOf(text), reason, text); }
	assert.match(await skipOf('class A {\n'), /^it does not parse: line 1: } expected/);
});

test('skipped files: directives outside the allowed places, unbalanced ones, and detached documentation comments', DOTNET, async () => {
	const cases: [string, string][] = [
		[NS('#if DEBUG\npublic class A { }\n#endif\n'), `it has #if on line 5, ${NOT_SPLIT}`],
		[TYPE('#if DEBUG\n    int x;\n#endif\n'), `it has #if on line 7 inside a type, ${NOT_SPLIT}`],
		[NS('#region Types\npublic class A { }\n#endregion\n'), `it has #region on line 5, ${NOT_SPLIT}`],
		[`#define TRACE\n${NS('public class A { }\n')}`, `it has #define on line 1 among its usings, ${NOT_SPLIT}`],
		[TYPE('#line 200\n    int x;\n'), `it has #line on line 7 inside a type, ${NOT_SPLIT}`],
		[TYPE('#nullable disable\n    string x;\n'), `it has #nullable on line 7 inside a type, ${NOT_SPLIT}`],
		[TYPE('#pragma warning disable CS0168\n    void M() { }\n'),
			'#pragma warning disable CS0168 in A is not restored inside the type, so it reaches what follows'],
		[NS('/// <summary>Lost.</summary>\n\npublic class A { }\n'),
			'it has a documentation comment outside every type (line 5), which would document whatever follows it'],
		[TYPE('    #region M\n#pragma warning disable CS0168\n    void M() { int x; }\n#pragma warning restore CS0168\n    #endregion\n'), 'no'],
	];
	for (const [text, reason] of cases) { assert.equal(await skipOf(text), reason, text); }
});

test('directiveProblem: a restore without a disable and an #endregion without a #region inside the type', DOTNET, async () => {
	const restore = await csFacts('A.cs', TYPE('#pragma warning restore CS0168\n'));
	assert.equal(directiveProblem(restore.facts), '#pragma warning restore CS0168 in A (line 7) restores what the type did not disable');
	const region = await csFacts('B.cs', TYPE('    #region M\n    #endregion\n    #endregion\n'));
	assert.match(directiveProblem(region.facts) ?? '', /^an #endregion in A \(line 9\) has no #region in the type$/);
});

test('skipped files: bytes, names, partners and resources', DOTNET, async () => {
	const plain = 'class A { }\n';
	assert.equal(await skipOf(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(plain, 'utf16le')])), 'it is UTF-16');
	assert.equal(await skipOf(Buffer.from([0x63, 0xff, 0x0a])), 'it is not valid UTF-8');
	assert.equal(await skipOf('class A { }\r\nclass B { }\n'), 'it has mixed line endings');
	assert.equal(await skipOf(`class A { }\n// ${'x'.repeat(1001)}\n`), 'it has a line over 1,000 characters');
	assert.equal(await skipOf(`class A { }\n${'// filler line\n'.repeat(40_000)}`), 'it is over 512 KB');
	assert.equal(await skipOf(plain, 'Form1.cs', { entries: ['Form1.cs', 'Form1.resx'] }), 'Form1.resx sits beside it: MSBuild names a resource '
		+ 'after the first class of the .cs file with its name, and designers pair files by name');
	assert.equal(await skipOf(plain, 'Big.cs', { dependentUpon: 'Resources/Strings.resx' }),
		'Resources/Strings.resx names it in DependentUpon, so MSBuild names that resource after its first class');
	assert.equal(await skipOf(plain, 'Foo.Bar.cs'), 'its name has a dot, which MSBuild and IDEs use to pair files');
	assert.equal(await skipOf(plain, 'MainPage.xaml.cs'), 'it is the code-behind of a markup file');
	assert.equal(await skipOf(plain, 'Index.razor.cs'), 'it is the code-behind of a markup file');
	assert.equal(await skipOf(plain, 'Form1.Designer.cs'), 'its name marks it as generated code');
	assert.equal(await skipOf(plain, 'obj/Debug/X.cs'), 'it is build output (under obj/ or bin/)');
	assert.equal(await skipOf(plain, 'Big.cs', { linguistGenerated: true }), 'it is marked linguist-generated');
	assert.equal(await skipOf(plain, 'Big.cs', { projectSkip: 'src/App.csproj is a test project' }), 'src/App.csproj is a test project');
	assert.equal(await skipOf(plain, 'Big.cs', { symlink: true }), 'it is a symbolic link');
});

test('interceptors: calls the project\'s generators rewrite skip the file; without the generator they do not', DOTNET, async () => {
	const map = NS('public static class Routes\n{\n    public static void Add(dynamic app) { app.MapGet("/", () => 1); }\n}\n');
	assert.equal(await skipOf(map, 'Big.cs', { interceptors: { rdg: true, binder: false } }),
		'it calls MapGet (line 7), which the ASP.NET Core request delegate generator intercepts by file and position');
	assert.equal(await skipOf(map), 'no');
	const bind = NS('public class Settings\n{\n    public void Load(dynamic config) { config.Bind(this); }\n}\n');
	assert.equal(await skipOf(bind, 'Big.cs', { interceptors: { rdg: false, binder: true } }),
		'it calls Bind (line 7), which the configuration binding generator intercepts by file and position');
});

const SHOP = NS(`public class Big { }

public record Line(string Sku);

public record struct Money(decimal Amount);

public interface IPrices { }

public enum State { Open }

public delegate void Changed();

public partial class Generated { }

public class Init
{
    [System.Runtime.CompilerServices.ModuleInitializer]
    internal static void Run() { }
}

public class Pair { } public class Other { }

public class Result { }

public class Result<TValue> { }
`);

test('movability, the keeper and the plan: one movable type per new file, generic names in braces', DOTNET, async () => {
	const parsed = await csFacts('Big.cs', SHOP);
	const info = csFileInfoView('Big.cs', parsed.facts, { ...CTX, entries: ['Big.cs', 'Line.cs'] }, undefined);
	assert.deepEqual(info.declarations.map(d => `${d.names[0]}: ${d.movable ? 'moves' : d.reason}`), [
		'Big: it is the type the file is named after, so it stays',
		'Line: no file name is free: Line.cs: Line.cs is taken',
		'Money: moves', 'IPrices: moves', 'State: moves', 'Changed: moves',
		'Generated: it is partial; its other parts may be generated or in other files',
		'Init: it has a [ModuleInitializer] method, and module initializers run in compile order',
		'Pair: it shares a line with other code', 'Other: it shares a line with other code',
		'Result: moves', 'Result<TValue>: moves',
	]);
	assert.deepEqual(csPlan(info)?.map(group => `${group.file} ${group.declarations.join(',')}`),
		['Money.cs 2', 'IPrices.cs 3', 'State.cs 4', 'Changed.cs 5', 'Result.cs 10', 'Result{TValue}.cs 11']);
	assert.equal(info.prelude?.end, parsed.facts.prelude);
});

test('the keeper without a type named after the file is the first; a name the editor config treats differently keeps its type', DOTNET,
	async () => {
		const facts = (await csFacts('Shop.cs', NS('public class A { }\n\npublic class B { }\n'))).facts;
		const first = csFileInfoView('Shop.cs', facts, CTX, undefined);
		assert.deepEqual(first.declarations.map(d => d.movable), [false, true]);
		assert.equal(first.declarations[0].reason, 'it stays so the file keeps a type (no type is named after the file)');
		const settings = (name: string) => (name === 'B.cs' ? ['the editor config gives it other settings (cs0168 severity Suppress)'] : []);
		const editor = csFileInfoView('Shop.cs', facts, CTX, undefined, settings);
		assert.equal(editor.declarations[1].reason, 'no file name is free: B.cs: the editor config gives it other settings (cs0168 severity Suppress)');
		assert.equal(csPlan(editor), undefined);
	});

const SCANNED = NS('public class Big { }\n\npublic class Handler : IHandler { }\n\npublic class Derived : Big { }\n\n'
	+ '[Serializable]\npublic class Tagged { }\n\npublic class OrdersController { }\n\npublic interface IHandler { }\n\n'
	+ 'public enum E { A }\n\npublic class Plain { }\n');

test('assembly scanning: a base, an interface, an attribute or a Controller name keeps a class; interfaces, enums and plain classes move', DOTNET,
	async () => {
		const parsed = await csFacts('Big.cs', SCANNED);
		const info = csFileInfoView('Big.cs', parsed.facts, { ...CTX, scanning: 'App/Setup.cs:2 uses typeof(…).Assembly' }, undefined);
		assert.deepEqual(info.declarations.map(d => `${d.names[0]} ${d.movable}`),
			['Big false', 'Handler false', 'Derived false', 'Tagged false', 'OrdersController false', 'IHandler true', 'E true', 'Plain true']);
		assert.match(info.declarations[1].reason ?? '', /scanners select a class, struct or record by its base type, interfaces, attributes or a Controller name/);
		assert.equal(info.narrowed, 'only interfaces, enums, delegates and classes, structs or records without a base type, interface, attribute or '
			+ 'Controller name may move (the project may scan its assembly for types: App/Setup.cs:2 uses typeof(…).Assembly)');
		const plain = csFileInfoView('Big.cs', parsed.facts, CTX, undefined);
		assert.deepEqual(plain.declarations.map(d => d.movable), [false, true, true, true, true, true, true, true]);
		assert.equal(plain.narrowed, undefined);
		assert.match(csFileInfoView('Big.cs', parsed.facts, { ...CTX, unusedUsings: true }, undefined).narrowed ?? '', /enforces unused-using warnings/);
	});

test('file names: letters with {T} for type parameters, nothing that pairs, special or a device name', () => {
	assert.deepEqual(csFileNameProblems('Order.cs', ['Big.cs']), []);
	assert.deepEqual(csFileNameProblems('Result{TValue,TError}.cs', []), []);
	assert.deepEqual(csFileNameProblems('Foo.cs', ['Foo.resx']), ['Foo.resx would pair with it by name']);
	assert.deepEqual(csFileNameProblems('Foo.cs', ['foo.Designer.cs']), ['foo.Designer.cs would pair with it by name']);
	assert.deepEqual(csFileNameProblems('CON.cs', []), ['CON is a Windows device name']);
	assert.deepEqual(csFileNameProblems('Program.cs', []), ['Program.cs is a name tools treat as special']);
	assert.deepEqual(csFileNameProblems('SharedAssemblyInfo.cs', []), ['SharedAssemblyInfo.cs is a name tools treat as special']);
	assert.equal(csFileNameProblems('Foo.g.cs', []).length, 1);
	assert.equal(csFileNameProblems('../Foo.cs', []).length, 1);
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/csRules.test.ts(3,107): error TS2307: Cannot find module '../src/aiready/csRules' or its corresponding type declarations.
```

- [ ] **Step 3: Implement.**

Create `src/aiready/csRules.ts`:

````ts
import * as path from 'path';
import type { CsFacts, CsType } from './csAst';
import type { Declaration, FileInfo, Span, SplitPlan } from './language';

/** What the rules need to know about a file's place in the repository (from MSBuild and the folder). */
export interface CsFileContext {
	/** Names in the file's folder. */
	readonly entries: readonly string[];
	/** Why its project, ownership or paths keep it from being split. */
	readonly projectSkip?: string;
	/** A resource names it in `DependentUpon`. */
	readonly dependentUpon?: string;
	/** Interceptor generators its project turns on. */
	readonly interceptors: { readonly rdg: boolean; readonly binder: boolean };
	/** Why the project may scan its assembly for types; only unselectable types move then. */
	readonly scanning?: string;
	/** Its project's build reports unused usings (IDE0005). */
	readonly unusedUsings?: boolean;
	/** `.gitattributes` marks it `linguist-generated`. */
	readonly linguistGenerated?: boolean;
	readonly symlink?: boolean;
}

/** A C# file as the core sees it, with the helper's facts and the new file each movable type goes to. */
export interface CsFileInfo extends FileInfo {
	readonly facts: CsFacts;
	readonly targets: ReadonlyMap<number, string>;
}

const MAX_BYTES = 512 * 1024;
const GENERATED_NAME = /(?:\.g|\.g\.i|\.designer|\.generated|\.AssemblyInfo)\.cs$|^TemporaryGeneratedFile_/i;
const CODE_BEHIND = /\.(?:xaml|axaml|razor|cshtml|aspx|ascx|master|asax)\.cs$/i;
const RESERVED = new Set(['globalusings', 'program', 'startup', 'app', 'mainwindow', 'mauiprogram', 'usings']);
const DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const CS_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\{[A-Za-z_][A-Za-z0-9_]*(,[A-Za-z_][A-Za-z0-9_]*)*\})?\.cs$/;
/** The interceptor generators the static rule knows, and the calls each rewrites, by method name. */
const GENERATORS: Record<'rdg' | 'binder', { label: string; calls: readonly string[] }> = {
	rdg: {
		label: 'the ASP.NET Core request delegate generator',
		calls: ['MapGet', 'MapPost', 'MapPut', 'MapDelete', 'MapPatch', 'MapMethods', 'Map', 'MapFallback'],
	},
	binder: { label: 'the configuration binding generator', calls: ['Bind', 'Get', 'GetValue', 'Configure', 'BindConfiguration'] },
};

/**
 * The first directive the splitter does not allow: in the using region only `#nullable` and `#pragma warning`; inside
 * one type's span only balanced `#region`/`#endregion` and `#pragma warning disable` restored for the same ids;
 * nothing anywhere else.
 */
export function directiveProblem(facts: CsFacts): string | undefined {
	for (const d of facts.directives) {
		const pragma = d.kind === 'pragma warning';
		if (d.inUsingRegion) {
			if (d.kind === 'nullable' || pragma) { continue; }
		} else if (d.type >= 0 && (pragma || d.kind === 'region' || d.kind === 'endregion')) {
			continue;
		}
		const where = d.type >= 0 ? ' inside a type' : d.inUsingRegion ? ' among its usings' : '';
		return `it has #${d.kind} on line ${d.line}${where}, which version 1 does not split around`;
	}
	for (const type of facts.types) {
		let depth = 0;
		const disabled = new Map<string, number>();
		for (const d of facts.directives.filter(x => x.type === type.id)) {
			if (d.kind === 'region') { depth++; }
			if (d.kind === 'endregion' && --depth < 0) { return `an #endregion in ${type.name} (line ${d.line}) has no #region in the type`; }
			for (const id of d.kind === 'pragma warning' ? (d.ids.length ? d.ids : ['*']) : []) {
				const count = (disabled.get(id) ?? 0) + (d.action === 'disable' ? 1 : -1);
				if (count < 0) { return `#pragma warning restore ${id} in ${type.name} (line ${d.line}) restores what the type did not disable`; }
				disabled.set(id, count);
			}
		}
		if (depth) { return `a #region in ${type.name} is not closed inside the type`; }
		const open = [...disabled].find(([, count]) => count);
		if (open) { return `#pragma warning disable ${open[0]} in ${type.name} is not restored inside the type, so it reaches what follows`; }
	}
	return undefined;
}

/** Why a file is never split, or undefined. */
export function csSkipReason(file: string, facts: CsFacts, ctx: CsFileContext): string | undefined {
	const base = path.posix.basename(file);
	const stem = base.slice(0, -3);
	if (ctx.symlink) { return 'it is a symbolic link'; }
	if (/(?:^|\/)(?:obj|bin)\//.test(file)) { return 'it is build output (under obj/ or bin/)'; }
	if (GENERATED_NAME.test(base)) { return 'its name marks it as generated code'; }
	if (CODE_BEHIND.test(base)) { return 'it is the code-behind of a markup file'; }
	if (stem.includes('.')) { return 'its name has a dot, which MSBuild and IDEs use to pair files'; }
	const partner = ctx.entries.find(name => name.toLowerCase().startsWith(`${stem.toLowerCase()}.`) && name.toLowerCase() !== base.toLowerCase());
	if (partner) {
		return `${partner} sits beside it: MSBuild names a resource after the first class of the .cs file with its name, and designers pair files by name`;
	}
	if (ctx.dependentUpon) { return `${ctx.dependentUpon} names it in DependentUpon, so MSBuild names that resource after its first class`; }
	if (ctx.linguistGenerated) { return 'it is marked linguist-generated'; }
	if (ctx.projectSkip) { return ctx.projectSkip; }
	if (facts.encoding === 'utf16') { return 'it is UTF-16'; }
	if (facts.encoding === 'invalid') { return 'it is not valid UTF-8'; }
	if (facts.eol === 'mixed') { return 'it has mixed line endings'; }
	if (facts.size > MAX_BYTES) { return 'it is over 512 KB'; }
	if (facts.longLine) { return 'it has a line over 1,000 characters'; }
	if (facts.error) { return `it does not parse: ${facts.error}`; }
	if (facts.generated) { return 'it has an <auto-generated> header'; }
	if (facts.fileTypes) { return 'it declares a file-local type, which wins name lookup only inside its file'; }
	if (facts.topLevelStatements) { return 'it has top-level statements'; }
	if (facts.globalUsings) { return 'it has a global using, which belongs in one place'; }
	if (facts.namespaces.length > 1) {
		return facts.namespaces.some(n => n.nested) ? 'it has a namespace inside another' : 'it has more than one namespace declaration';
	}
	if (facts.namespaces.length === 1 && facts.types.some(type => type.namespace < 0)) { return 'it has types outside its namespace'; }
	if (facts.layout) { return facts.layout; }
	const directive = directiveProblem(facts);
	if (directive) { return directive; }
	if (facts.detachedDocs.length) {
		return `it has a documentation comment outside every type (line ${facts.detachedDocs[0]}), which would document whatever follows it`;
	}
	for (const key of ['rdg', 'binder'] as const) {
		const call = ctx.interceptors[key] ? facts.intercepted.find(c => GENERATORS[key].calls.includes(c.name)) : undefined;
		if (call) { return `it calls ${call.name} (line ${call.line}), which ${GENERATORS[key].label} intercepts by file and position`; }
	}
	return undefined;
}

/** Scanners select by base type, interface, attribute or the `Controller` suffix; such classes, structs and records stay in a scanning project. */
function selectable(type: CsType): boolean {
	return !['interface', 'enum', 'delegate'].includes(type.kind) && (type.bases.length > 0 || type.attributes.length > 0 || type.name.endsWith('Controller'));
}

/** Why a type may not move, or undefined. */
function stays(type: CsType, ctx: CsFileContext): string | undefined {
	if (type.modifiers.includes('partial')) { return 'it is partial; its other parts may be generated or in other files'; }
	if (type.modifiers.includes('file')) { return 'it is file-local'; }
	if (type.moduleInitializer) { return 'it has a [ModuleInitializer] method, and module initializers run in compile order'; }
	if (type.sharesLine) { return 'it shares a line with other code'; }
	if (ctx.scanning && selectable(type)) {
		return 'the project may scan its assembly for types, and scanners select a class, struct or record by its base type, interfaces, attributes or a '
			+ 'Controller name';
	}
	return undefined;
}

/** The new file names a type may take, in order: `Name.cs`, then `Name{T,U}.cs` for a generic type. */
export function candidateNames(type: CsType): string[] {
	return [`${type.name}.cs`, ...(type.arity ? [`${type.name}{${type.typeParameters.join(',')}}.cs`] : [])];
}

/** Why a new file in the original's folder may not have this name (its editor settings are checked separately). */
export function csFileNameProblems(name: string, entries: readonly string[]): string[] {
	const problems: string[] = [];
	if (!CS_NAME.test(name)) { problems.push('use letters, digits and underscores, with `{T,U}` for type parameters, and end in .cs'); }
	const stem = name.replace(/\.cs$/i, '').replace(/\{.*\}$/, '');
	const paired = entries.find(entry => entry.toLowerCase().startsWith(`${name.slice(0, -3).toLowerCase()}.`) && entry.toLowerCase() !== name.toLowerCase());
	if (paired) { problems.push(`${paired} would pair with it by name`); }
	if (/AssemblyInfo$/i.test(stem) || RESERVED.has(stem.toLowerCase())) { problems.push(`${name} is a name tools treat as special`); }
	if (DEVICE.test(stem)) { problems.push(`${stem} is a Windows device name`); }
	return problems;
}

/** The type that stays: the one named after the file; else, when every type could move, the first. */
function keeper(file: string, types: readonly CsType[], movable: (type: CsType) => boolean): CsType | undefined {
	const stem = path.posix.basename(file).slice(0, -3);
	return types.find(type => type.name === stem) ?? (types.every(movable) ? types[0] : undefined);
}

/**
 * The neutral view of a C# file, and each movable type's new file: `<Name>.cs`, else `<Name>{T}.cs`, else it stays with
 * the reason. `nameProblems` adds the per-name checks the adapter ran (editor settings).
 */
export function csFileInfoView(file: string, facts: CsFacts, ctx: CsFileContext, skip: string | undefined,
	nameProblems: (name: string) => string[] = () => []): CsFileInfo {
	const reasons = new Map(facts.types.map(type => [type.id, stays(type, ctx)]));
	const kept = keeper(file, facts.types, type => !reasons.get(type.id));
	if (kept && !reasons.get(kept.id)) {
		reasons.set(kept.id, kept.name === path.posix.basename(file).slice(0, -3) ? 'it is the type the file is named after, so it stays'
			: 'it stays so the file keeps a type (no type is named after the file)');
	}
	const targets = new Map<number, string>();
	const taken = new Set(ctx.entries.map(entry => entry.toLowerCase()));
	for (const type of facts.types.filter(t => !reasons.get(t.id))) {
		const tried = candidateNames(type).map(name => ({ name, problems: taken.has(name.toLowerCase()) ? [`${name} is taken`]
			: [...csFileNameProblems(name, ctx.entries), ...nameProblems(name)] }));
		const free = tried.find(candidate => !candidate.problems.length);
		if (!free) {
			reasons.set(type.id, `no file name is free: ${tried.map(c => `${c.name}: ${c.problems.join('; ')}`).join('; ')}`);
			continue;
		}
		targets.set(type.id, free.name);
		taken.add(free.name.toLowerCase());
	}
	const declarations: Declaration[] = facts.types.map(type => ({
		id: type.id, kind: type.kind, names: [type.arity ? `${type.name}<${type.typeParameters.join(',')}>` : type.name],
		span: { start: type.span[0], end: type.span[1] }, lines: type.lines, doc: type.doc, docText: type.docText, uses: [],
		movable: !reasons.get(type.id), ...(reasons.get(type.id) ? { reason: reasons.get(type.id) } : {}),
	}));
	const ns = facts.namespaces[0];
	const frame: Span[] = [{ start: 0, end: facts.prelude }, { start: facts.usingRegion[0], end: facts.usingRegion[1] },
		...(ns ? [{ start: ns.header[0], end: ns.header[1] }] : []), ...(ns?.close ? [{ start: ns.close[0], end: ns.close[1] }] : [])].filter(s => s.end > s.start);
	const narrowed = [
		...(ctx.scanning ? [`only interfaces, enums, delegates and classes, structs or records without a base type, interface, attribute or Controller name `
			+ `may move (the project may scan its assembly for types: ${ctx.scanning})`] : []),
		...(ctx.unusedUsings ? ['this project enforces unused-using warnings in its build; version 1 copies all usings into new files, so splits will be undone']
			: []),
	];
	return {
		path: file, facts, targets, declarations, frame, imports: [], prelude: { start: 0, end: facts.prelude },
		...(skip ? { skip } : {}), ...(narrowed.length ? { narrowed: narrowed.join('; ') } : {}),
	};
}

/** The host's plan: every movable type to its own new file, in file order; undefined when nothing may move. */
export function csPlan(info: CsFileInfo): SplitPlan | undefined {
	const plan = info.declarations.filter(d => d.movable && info.targets.has(d.id)).map(d => ({ file: info.targets.get(d.id)!, declarations: [d.id] }));
	return plan.length ? plan : undefined;
}
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/csScan.ts",
    "src/aiready/csProject.ts"
  ]
````

with:

````json
    "src/aiready/csScan.ts",
    "src/aiready/csProject.ts",
    "src/aiready/csRules.ts"
  ]
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 402
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/csRules.ts test/csAst.test.ts test/csRules.test.ts tsconfig.test.json
git commit -m "C#: skip reasons, movability and the host plan"
```

### Task 6: New files and the original

**Files:**
- Create: `src/aiready/csSplit.ts`, `test/csSplit.test.ts`
- Modify: `tsconfig.test.json`

A new file is the header (BOM, license header or one line, blank line), the using region, the namespace frame and the moved span, all byte for byte in the original's line ending; the original loses the spans and collapses blank lines with the core's own `collapse` in `braces` mode, so the move check and the split agree by construction.

- [ ] **Step 1: Write the failing tests.**

Create `test/csSplit.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CsFileInfo, csFileInfoView, csFileNameProblems, csPlan } from '../src/aiready/csRules';
import { buildCsSplit, csSplitHeader } from '../src/aiready/csSplit';
import type { LanguageAdapter } from '../src/aiready/language';
import { oversizeNotes, planProblems } from '../src/aiready/splitPlan';
import { csFacts, DOTNET } from './csFixture';

/** Parses `text` as `name` and returns its bytes and view. */
async function view(name: string, text: string | Buffer): Promise<{ source: Buffer; info: CsFileInfo }> {
	const parsed = await csFacts(name, text);
	const ctx = { entries: [name], interceptors: { rdg: false, binder: false } };
	return { source: parsed.source, info: csFileInfoView(name, parsed.facts, ctx, undefined) };
}

test('split: a license header, the using region and a file-scoped namespace are copied; the original loses the spans', DOTNET, async () => {
	const text = '// Copyright (c) Acme. MIT license.\n\nusing System;\nusing static System.Math;\n#nullable enable\n\n[assembly: System.CLSCompliant(false)]\n\n'
		+ 'namespace Shop.Models;\n\n/// <summary>The big one.</summary>\npublic class Big { }\n\n/// <summary>A line.</summary>\n[Serializable]\n'
		+ 'public record Line(string Sku); // trailing\n\n// Stays: a detached comment.\n\npublic enum State { Open }\n';
	const parsed = await view('Big.cs', text);
	const result = buildCsSplit(parsed.source, parsed.info, csPlan(parsed.info)!);
	assert.deepEqual(result.files.map(f => f.name), ['Line.cs', 'State.cs']);
	assert.equal(result.files[0].text.toString(), '// Copyright (c) Acme. MIT license.\n\nusing System;\nusing static System.Math;\n#nullable enable\n\n'
		+ 'namespace Shop.Models;\n\n/// <summary>A line.</summary>\n[Serializable]\npublic record Line(string Sku); // trailing\n');
	assert.equal(result.original.toString(), '// Copyright (c) Acme. MIT license.\n\nusing System;\nusing static System.Math;\n#nullable enable\n\n'
		+ '[assembly: System.CLSCompliant(false)]\n\nnamespace Shop.Models;\n\n/// <summary>The big one.</summary>\npublic class Big { }\n\n'
		+ '// Stays: a detached comment.\n');
});

test('split: a header naming the file is not copied; a block namespace keeps its inner usings, indentation, BOM and CRLF', DOTNET, async () => {
	const text = '﻿// <copyright file="Big.cs" company="Acme">Copyright Acme</copyright>\r\nusing System;\r\n\r\nnamespace Shop\r\n{\r\n'
		+ '    using System.Text;\r\n\r\n    public class Big { }\r\n\r\n    public class Order\r\n    {\r\n        public int Id;\r\n    }\r\n} // Shop\r\n';
	const parsed = await view('Big.cs', text);
	assert.equal(csSplitHeader('Big.cs', parsed.source, parsed.info.facts), '﻿// Split from Big.cs by my_editor.\r\n\r\n');
	const result = buildCsSplit(parsed.source, parsed.info, csPlan(parsed.info)!);
	assert.equal(result.files[0].text.toString(), '﻿// Split from Big.cs by my_editor.\r\n\r\nusing System;\r\n\r\nnamespace Shop\r\n{\r\n'
		+ '    using System.Text;\r\n\r\n    public class Order\r\n    {\r\n        public int Id;\r\n    }\r\n} // Shop\r\n');
	assert.equal(result.original.toString(), '﻿// <copyright file="Big.cs" company="Acme">Copyright Acme</copyright>\r\nusing System;\r\n\r\n'
		+ 'namespace Shop\r\n{\r\n    using System.Text;\r\n\r\n    public class Big { }\r\n} // Shop\r\n');
});

test('split: a type removed first in a block namespace leaves no blank line after the brace; the global namespace has no frame', DOTNET, async () => {
	const parsed = await view('Shop.cs', 'namespace Shop\n{\n    public class A { }\n\n    public class Shop { }\n}\n');
	const result = buildCsSplit(parsed.source, parsed.info, csPlan(parsed.info)!);
	assert.equal(result.original.toString(), 'namespace Shop\n{\n    public class Shop { }\n}\n');
	assert.equal(result.files[0].text.toString(), '// Split from Shop.cs by my_editor.\n\nnamespace Shop\n{\n    public class A { }\n}\n');
	const global = await view('G.cs', 'using System;\n\npublic class G { }\n\npublic class H { }\n');
	const split = buildCsSplit(global.source, global.info, csPlan(global.info)!);
	assert.equal(split.files[0].text.toString(), '// Split from G.cs by my_editor.\n\nusing System;\n\npublic class H { }\n');
	assert.equal(split.original.toString(), 'using System;\n\npublic class G { }\n');
});

test('plan checks: a single type over 400 lines stays a suggestion; the original keeps what may not move', DOTNET, async () => {
	const members = Array.from({ length: 420 }, (_, i) => `    public int F${i};`).join('\n');
	const parsed = await view('Big.cs', `namespace Shop;\n\npublic class Big { }\n\npublic class Huge\n{\n${members}\n}\n\npublic class Small { }\n`);
	const adapter = { fileNameProblems: (name: string) => csFileNameProblems(name, ['Big.cs']), buildSplit: buildCsSplit } as unknown as LanguageAdapter;
	const plan = csPlan(parsed.info)!;
	assert.deepEqual(planProblems(adapter, { source: parsed.source, info: parsed.info, existing: ['Big.cs'] }, plan), []);
	const notes = oversizeNotes(buildCsSplit(parsed.source, parsed.info, plan), parsed.info, plan);
	assert.deepEqual(notes, ['Huge.cs stays at 427 lines: class Huge alone is 423 lines and needs a real refactor.']);
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/csSplit.test.ts(4,45): error TS2307: Cannot find module '../src/aiready/csSplit' or its corresponding type declarations.
```

- [ ] **Step 3: Implement.**

Create `src/aiready/csSplit.ts`:

````ts
import * as path from 'path';
import type { CsFacts } from './csAst';
import type { CsFileInfo } from './csRules';
import type { SplitPlan, SplitResult } from './language';
import { collapse } from './moveCheck';

const lineEnd = (facts: CsFacts) => (facts.eol === 'crlf' ? '\r\n' : '\n');
const bytes = (source: Buffer, range: readonly [number, number]) => source.subarray(range[0], range[1]).toString('utf8');

/**
 * The exact start of a file split from this one: the original's BOM, then its leading comment block when it is a
 * license header that does not name the file (else `// Split from <name> by my_editor.`), then a blank line, in the
 * original's line ending.
 */
export function csSplitHeader(file: string, source: Buffer, facts: CsFacts): string {
	const eol = lineEnd(facts);
	const header = bytes(source, facts.header);
	const keep = facts.license && !facts.namesFile && header.endsWith('\n');
	return `${facts.bom ? '﻿' : ''}${keep ? header : `// Split from ${path.posix.basename(file)} by my_editor.${eol}`}${eol}`;
}

/**
 * Applies a C# split plan, without AI. A new file is the header, the original's using region byte for byte, the
 * namespace frame (a file-scoped `namespace X;` line, or a block namespace's header and closing line), and the moved
 * spans byte for byte. The original keeps everything else byte for byte; blank lines around a removed span collapse to
 * one, and to none next to a namespace brace.
 */
export function buildCsSplit(source: Buffer, info: CsFileInfo, plan: SplitPlan): SplitResult {
	const facts = info.facts;
	const eol = lineEnd(facts);
	const ns = facts.namespaces[0];
	const byId = new Map(info.declarations.map(d => [d.id, d]));
	const usings = bytes(source, facts.usingRegion);
	const head = `${csSplitHeader(info.path, source, facts)}${usings ? `${usings}${eol}` : ''}`;
	const files = plan.map(group => {
		const spans = group.declarations.map(id => {
			const declaration = byId.get(id);
			if (!declaration) { throw new Error(`Declaration ${id} does not exist.`); }
			return declaration;
		}).sort((a, b) => a.id - b.id).map(d => source.subarray(d.span.start, d.span.end).toString('utf8'));
		const body = `${spans.join(`\n${eol}`)}\n`;
		let text = head + body;
		if (ns?.kind === 'file') { text = `${head}${bytes(source, ns.header)}${eol}${body}`; }
		if (ns?.kind === 'block') {
			const header = bytes(source, ns.header);
			const close = bytes(source, ns.close!);
			text = `${head}${header}${/\{[\s\S]*\b(?:using|extern)\b/.test(header) ? eol : ''}${body}${close}${close.endsWith('\n') ? '' : eol}`;
		}
		return { name: group.file, text: Buffer.from(text) };
	});
	const moved = plan.flatMap(group => group.declarations.map(id => byId.get(id)!.span));
	const items: (string | undefined)[] = [];
	let offset = 0;
	for (let at = source.indexOf(10); offset < source.length; at = source.indexOf(10, offset)) {
		const end = at < 0 ? source.length : at;
		items.push(moved.some(span => offset >= span.start && end <= span.end) ? undefined : source.subarray(offset, end).toString('utf8'));
		offset = end + 1;
	}
	const kept = collapse(items, 'braces');
	const final = source.length > 0 && source[source.length - 1] === 10 && kept.length ? '\n' : '';
	return { original: Buffer.from(`${kept.join('\n')}${final}`), files };
}
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/csProject.ts",
    "src/aiready/csRules.ts"
  ]
````

with:

````json
    "src/aiready/csProject.ts",
    "src/aiready/csRules.ts",
    "src/aiready/csSplit.ts"
  ]
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 406
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/csSplit.ts test/csSplit.test.ts tsconfig.test.json
git commit -m "C#: apply a split"
```

### Task 7: Move rules 2 and 4 for C#

**Files:**
- Create: `src/aiready/csMoveCheck.ts`, `test/csMoveCheck.test.ts`
- Modify: `tsconfig.test.json`

Rule 2's C# part compares the using region and namespace frame byte for byte; rule 4 compares the types (namespace, kind, name, arity, modifiers, attribute names, doc comment) as a multiset. Rule 4's project part is `membershipProblems` (Task 12).

- [ ] **Step 1: Write the failing tests.**

Create `test/csMoveCheck.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { csImportProblems, csSameDeclarations } from '../src/aiready/csMoveCheck';
import { CsFileInfo, csFileInfoView, csPlan } from '../src/aiready/csRules';
import { buildCsSplit, csSplitHeader } from '../src/aiready/csSplit';
import type { ParsedFile } from '../src/aiready/language';
import { checkMove } from '../src/aiready/moveCheck';
import { csFacts, DOTNET } from './csFixture';

const BIG = '// Copyright (c) Acme. MIT license.\n\nusing System;\nusing System.Text;\n\nnamespace Shop\n{\n    /// <summary>Big.</summary>\n'
	+ '    public class Big { }\n\n    /// <summary>An order.</summary>\n    public class Order\n    {\n'
	+ '        public string Name => new StringBuilder().ToString();\n    }\n\n    public enum State { Open }\n}\n';

async function parse(name: string, text: Buffer | string): Promise<ParsedFile> {
	const parsed = await csFacts(name, text);
	const ctx = { entries: [name], interceptors: { rdg: false, binder: false } };
	return { text: parsed.source, info: csFileInfoView(name, parsed.facts, ctx, undefined) };
}

/** Every move rule on a split of BIG after `edit` changed the written files; empty means it passes. */
async function moveProblems(edit: (texts: Record<string, string>) => void = () => undefined): Promise<string> {
	const before = await parse('Big.cs', BIG);
	const info = before.info as CsFileInfo;
	const plan = csPlan(info)!;
	const result = buildCsSplit(before.text, info, plan);
	const texts: Record<string, string> = { 'Big.cs': result.original.toString() };
	for (const file of result.files) { texts[file.name] = file.text.toString(); }
	edit(texts);
	const after = await parse('Big.cs', texts['Big.cs']);
	const files = await Promise.all(plan.map(group => parse(group.file, texts[group.file])));
	const header = csSplitHeader('Big.cs', before.text, info.facts);
	return [
		...checkMove({ before, after, files, plan, header, importProblems: csImportProblems, blankLines: 'braces' }),
		...csSameDeclarations([before.info], [after.info, ...files.map(f => f.info)]),
	].join(' ');
}

/** Replaces text in one written file. */
function change(file: string, from: string, to: string): (texts: Record<string, string>) => void {
	return texts => {
		texts[file] = texts[file].replace(from, to);
	};
}

test('move check: a clean split passes every rule', DOTNET, async () => {
	assert.equal(await moveProblems(), '');
});

test('move check: an edited body fails rule 1', DOTNET, async () => {
	assert.match(await moveProblems(change('Order.cs', 'ToString()', 'ToString().Trim()')), /Rule 1: Order\.cs does not hold exactly its moved declarations/);
});

test('move check: a changed using region in a new file, or a dropped using in the original, fails rule 2', DOTNET, async () => {
	const added = await moveProblems(change('Order.cs', 'using System.Text;\n', 'using System.Text;\nusing System.Linq;\n'));
	assert.match(added, /Rule 2: Order\.cs does not have the original's using region byte for byte/);
	const dropped = await moveProblems(change('Big.cs', 'using System.Text;\n', ''));
	assert.match(dropped, /Rule 2: the using region of Big\.cs changed/);
	assert.match(dropped, /Rule 2: Big\.cs changed beyond the moved spans/);
});

test('move check: an extra type, a changed namespace line or a lost doc comment fails rules 1, 2 and 4', DOTNET, async () => {
	const extra = await moveProblems(change('State.cs', '    public enum State', '    public class Extra { }\n\n    public enum State'));
	assert.match(extra, /Rule 1: State\.cs does not hold exactly its moved declarations/);
	assert.match(extra, /Rule 4: public class Shop\.Extra appears 1 time after the move, 0 before/);
	const renamed = await moveProblems(change('State.cs', 'namespace Shop', 'namespace Shop.Models'));
	assert.match(renamed, /Rule 2: State\.cs does not have the original's namespace declaration byte for byte/);
	assert.match(renamed, /Rule 4: public enum Shop\.State appears 0 times after the move, 1 before/);
	const undocumented = await moveProblems(change('Order.cs', '    /// <summary>An order.</summary>\n', ''));
	assert.match(undocumented, /Rule 4: public class Shop\.Order \(with its doc comment\) appears 0 times after the move, 1 before/);
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/csMoveCheck.test.ts(3,54): error TS2307: Cannot find module '../src/aiready/csMoveCheck' or its corresponding type declarations.
```

- [ ] **Step 3: Implement.**

Create `src/aiready/csMoveCheck.ts`:

````ts
import type { CsFacts } from './csAst';
import type { CsFileInfo } from './csRules';
import type { FileInfo, ParsedFile } from './language';

const facts = (file: ParsedFile) => (file.info as CsFileInfo).facts;
const bytes = (file: ParsedFile, range: readonly [number, number] | null | undefined) =>
	(range ? file.text.subarray(range[0], range[1]).toString('utf8') : '');

/** The frame a new file copies: the using region, and the namespace's kind, header and closing line. */
function frame(file: ParsedFile): { usings: string; ns: string } {
	const ns = facts(file).namespaces;
	return { usings: bytes(file, facts(file).usingRegion), ns: ns.map(n => `${n.kind}\n${bytes(file, n.header)}\n${bytes(file, n.close)}`).join('\n') };
}

/**
 * Move rule 2's C# part: each new file's using region and namespace frame are the original's byte for byte, and the
 * original's own using region and namespace frame are unchanged (its usings are never removed).
 */
export function csImportProblems(before: ParsedFile, after: ParsedFile, files: readonly ParsedFile[]): string[] {
	const was = frame(before);
	const problems: string[] = [];
	const now = frame(after);
	if (now.usings !== was.usings) { problems.push(`Rule 2: the using region of ${before.info.path} changed.`); }
	if (now.ns !== was.ns) { problems.push(`Rule 2: the namespace declaration of ${before.info.path} changed.`); }
	for (const file of files) {
		const copy = frame(file);
		if (copy.usings !== was.usings) { problems.push(`Rule 2: ${file.info.path} does not have the original's using region byte for byte.`); }
		if (copy.ns !== was.ns) { problems.push(`Rule 2: ${file.info.path} does not have the original's namespace declaration byte for byte.`); }
		if (facts(file).globalAttributes.length) { problems.push(`Rule 3: ${file.info.path} has global attributes.`); }
	}
	return problems;
}

/** A type as rule 4 compares it: namespace, kind, name, arity, modifiers, attribute names and doc comment. */
function key(f: CsFacts, id: number): string {
	const type = f.types.find(t => t.id === id)!;
	const ns = f.namespaces[type.namespace]?.name ?? '(global)';
	return `${type.modifiers.join(' ')} ${type.kind} ${ns}.${type.name}${type.arity ? `\`${type.arity}` : ''}`
		+ `${type.attributes.length ? ` [${type.attributes.join(', ')}]` : ''}\n${type.docText}`;
}

/** Move rule 4's declaration part: the same multiset of types before and after, apart from their file. */
export function csSameDeclarations(before: readonly FileInfo[], after: readonly FileInfo[]): string[] {
	const count = (infos: readonly FileInfo[]) => {
		const counts = new Map<string, number>();
		for (const info of infos as readonly CsFileInfo[]) {
			for (const type of info.facts.types) { counts.set(key(info.facts, type.id), (counts.get(key(info.facts, type.id)) ?? 0) + 1); }
		}
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
			problems.push(`Rule 4: ${title.trim()}${doc ? ' (with its doc comment)' : ''} appears ${b} time${b === 1 ? '' : 's'} after the move, ${a} before.`);
		}
	}
	return problems;
}
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/csRules.ts",
    "src/aiready/csSplit.ts"
  ]
````

with:

````json
    "src/aiready/csRules.ts",
    "src/aiready/csSplit.ts",
    "src/aiready/csMoveCheck.ts"
  ]
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 410
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/csMoveCheck.ts test/csMoveCheck.test.ts tsconfig.test.json
git commit -m "C#: move rules 2 and 4"
```

## Chunk 6: Test results, the type count and editor config

### Task 8: TRX results

**Files:**
- Create: `src/aiready/csTests.ts`, `test/csTests.test.ts`, `test/trxFixture.ts`
- Modify: `tsconfig.test.json`

No test framework was in the offline NuGet cache, so the fixtures are written by hand from the TRX schema and the vstest TRX logger's naming (reviewer note 3), for xUnit (theory rows sharing a method), NUnit (arguments in the name, entities) and MSTest (inner results, the artifacts layout), plus a crashed run. A missing TRX file or an aborted summary fails its package.

- [ ] **Step 1: Write the failing tests.**

Create `test/trxFixture.ts`:

````ts
/**
 * TRX files as `dotnet test --logger trx` writes them for xUnit, NUnit and MSTest, written by hand: no test framework
 * was in the offline NuGet cache when this was built, so they follow the TRX schema (vstst.xsd) and the vstest TRX
 * logger's naming. `UnitTest/@name` and `UnitTestResult/@testName` are the display name. `TestMethod/@className` is
 * the fully qualified name minus its last part and `TestMethod/@name` the rest: the method for xUnit and MSTest, the
 * method with its arguments for NUnit. `codeBase` is the test assembly's path, `storage` that path lower-cased.
 * `/w` stands for the worktree.
 */

const NS = 'xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010"';
const LIST = '8c84fa94-04c1-424b-9868-57a2d4851a1d';
const TYPE = '13cdc9d9-ddb5-4fa4-a97d-d965ccfc6d4b';
const TIMES = 'startTime="2026-10-10T10:00:00.1000000+02:00" endTime="2026-10-10T10:00:00.1012000+02:00"';

/** One data row of a data-driven test. */
interface InnerRow {
	readonly name: string;
	readonly outcome: string;
}

/** One test result and its definition. */
interface Row {
	readonly id: string;
	readonly name: string;
	readonly className: string;
	readonly method: string;
	readonly outcome: string;
	readonly inner?: readonly InnerRow[];
}

/** An attribute value as an XML writer escapes it. */
function esc(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const FAILURE = '      <Output>\n        <ErrorInfo>\n          <Message>Assert.Equal() Failure: Values differ&#xD;\nExpected: 3&#xD;\nActual:   4</Message>\n'
	+ '          <StackTrace>   at Shop.Tests.Prices.Adds() in /w/tests/Shop.Tests/PriceTests.cs:line 12</StackTrace>\n'
	+ '        </ErrorInfo>\n      </Output>\n';

/** The attributes every UnitTestResult has. */
function resultAttributes(execution: string, row: Row | InnerRow, testId: string): string {
	return `executionId="${execution}" testId="${testId}" testName="${esc(row.name)}" computerName="mac" duration="00:00:00.0012000" ${TIMES} `
		+ `testType="${TYPE}" outcome="${row.outcome}" testListId="${LIST}" relativeResultsDirectory="${execution}"`;
}

function result(row: Row, i: number): string {
	const head = `    <UnitTestResult ${resultAttributes(`e${i}`, row, row.id)}`;
	if (row.inner) {
		const inner = row.inner.map((r, j) => `        <UnitTestResult ${resultAttributes(`e${i}-${j}`, r, row.id)} parentExecutionId="e${i}" `
			+ `dataRowInfo="${j + 1}" resultType="DataDrivenDataRow" />\n`).join('');
		return `${head} resultType="DataDrivenTest">\n      <InnerResults>\n${inner}      </InnerResults>\n    </UnitTestResult>\n`;
	}
	return row.outcome === 'Failed' ? `${head}>\n${FAILURE}    </UnitTestResult>\n` : `${head} />\n`;
}

function definition(row: Row, adapter: string, assembly: string, execution: number): string {
	return `    <UnitTest name="${esc(row.name)}" storage="${assembly.toLowerCase()}" id="${row.id}">\n      <Execution id="e${execution}" />\n`
		+ `      <TestMethod codeBase="${assembly}" adapterTypeName="${adapter}" className="${row.className}" name="${esc(row.method)}" />\n`
		+ '    </UnitTest>\n';
}

function summary(rows: readonly Row[], outcome: string): string {
	const count = (o: string) => rows.filter(row => row.outcome === o).length;
	return `  <ResultSummary outcome="${outcome}">\n    <Counters total="${rows.length}" executed="${rows.length}" passed="${count('Passed')}" `
		+ `failed="${count('Failed')}" error="0" timeout="0" aborted="0" inconclusive="0" passedButRunAborted="0" notRunnable="0" `
		+ `notExecuted="${count('NotExecuted')}" disconnected="0" warning="0" completed="0" inProgress="0" pending="0" />\n`
		+ '    <Output>\n      <StdOut>[xUnit.net 00:00:00.00] Discovering: Shop.Tests</StdOut>\n    </Output>\n  </ResultSummary>\n';
}

function trx(adapter: string, assembly: string, rows: readonly Row[], outcome: string): string {
	const unique = [...new Map(rows.map(row => [row.id, row])).values()];
	const entries = rows.map((row, i) => `    <TestEntry testId="${row.id}" executionId="e${i}" testListId="${LIST}" />\n`).join('');
	return '<?xml version="1.0" encoding="utf-8"?>\n'
		+ `<TestRun id="1f6b0b1e-0000-4000-8000-000000000001" name="dev@mac 2026-10-10 10:00:00" runUser="dev" ${NS}>\n`
		+ '  <Times creation="2026-10-10T10:00:00.0000000+02:00" queuing="2026-10-10T10:00:00.0000000+02:00" '
		+ 'start="2026-10-10T09:59:59.0000000+02:00" finish="2026-10-10T10:00:01.0000000+02:00" />\n'
		+ '  <TestSettings name="default" id="1f6b0b1e-0000-4000-8000-000000000002">\n'
		+ '    <Deployment runDeploymentRoot="dev_mac_2026-10-10_10_00_00" />\n  </TestSettings>\n'
		+ `  <Results>\n${rows.map(result).join('')}  </Results>\n`
		+ `  <TestDefinitions>\n${unique.map(row => definition(row, adapter, assembly, rows.indexOf(row))).join('')}  </TestDefinitions>\n`
		+ `  <TestEntries>\n${entries}  </TestEntries>\n`
		+ `  <TestLists>\n    <TestList name="Results Not in a List" id="${LIST}" />\n`
		+ '    <TestList name="All Loaded Results" id="19431567-8539-422a-85d7-44ee4e166bda" />\n  </TestLists>\n'
		+ `${summary(rows, outcome)}</TestRun>\n`;
}

const PRICES = 'Shop.Tests.PriceTests';
const XUNIT_ADAPTER = 'executor://xunit/VsTestRunner2/netcoreapp';
const NET9 = '/w/tests/Shop.Tests/bin/Debug/net9.0/Shop.Tests.dll';
const id = (prefix: string, n: number) => `${prefix}0000000-0000-0000-0000-00000000000${n}`;

/** xUnit: a theory's rows share `TestMethod/@name` (the method) and differ only by display name; one row fails, a fact is skipped. */
export const XUNIT = trx(XUNIT_ADAPTER, NET9, [
	{ id: id('a', 1), name: `${PRICES}.Adds(a: 1, b: 2)`, className: PRICES, method: 'Adds', outcome: 'Passed' },
	{ id: id('a', 2), name: `${PRICES}.Adds(a: 2, b: 2)`, className: PRICES, method: 'Adds', outcome: 'Failed' },
	{ id: id('a', 3), name: `${PRICES}.Rounds`, className: PRICES, method: 'Rounds', outcome: 'Passed' },
	{ id: id('a', 4), name: 'Shop.Tests.OrderTests.Later', className: 'Shop.Tests.OrderTests', method: 'Later', outcome: 'NotExecuted' },
], 'Failed');

/** NUnit: parameterized cases keep their arguments in `TestMethod/@name`; the same project as xUnit's, but net8.0. */
export const NUNIT = trx('executor://NUnit3TestExecutor', '/w/tests/Shop.Tests/bin/Debug/net8.0/Shop.Tests.dll', [
	{ id: id('b', 1), name: 'Adds(1,2)', className: PRICES, method: 'Adds(1,2)', outcome: 'Passed' },
	{ id: id('b', 2), name: 'Adds(2,2)', className: PRICES, method: 'Adds(2,2)', outcome: 'Passed' },
	{ id: id('b', 3), name: 'Escapes("a&b")', className: PRICES, method: 'Escapes("a&b")', outcome: 'Passed' },
], 'Completed');

/** MSTest: a data-driven test reported once with inner results (one row fails), and a plain test; the artifacts layout's folders. */
export const MSTEST = trx('executor://mstestadapter/v2', '/w/artifacts/bin/Shop.Specs/debug/Shop.Specs.dll', [
	{ id: id('c', 1), name: 'Rounds', className: 'Shop.Specs.MoneySpecs', method: 'Rounds', outcome: 'Failed',
		inner: [{ name: 'Rounds (1.5)', outcome: 'Passed' }, { name: 'Rounds (2.5)', outcome: 'Failed' }] },
	{ id: id('c', 2), name: 'Formats', className: 'Shop.Specs.MoneySpecs', method: 'Formats', outcome: 'Passed' },
], 'Failed');

/** A test host that crashed: the summary says Aborted, after one test passed. */
export const ABORTED = trx(XUNIT_ADAPTER, NET9, [
	{ id: id('a', 3), name: `${PRICES}.Rounds`, className: PRICES, method: 'Rounds', outcome: 'Passed' },
], 'Aborted');
````

Create `test/csTests.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { compareWithBaseline } from '../src/aiready/baseline';
import { parseTrx, readXml, TestTarget, trxOutcome } from '../src/aiready/csTests';
import { ABORTED, MSTEST, NUNIT, XUNIT } from './trxFixture';

const TARGETS: TestTarget[] = [
	{ label: 'Shop.Tests@net8.0', assembly: '/w/tests/Shop.Tests/bin/Debug/net8.0/Shop.Tests.dll' },
	{ label: 'Shop.Tests@net9.0', assembly: '/w/tests/Shop.Tests/bin/Debug/net9.0/Shop.Tests.dll' },
	{ label: 'Shop.Specs@net9.0', assembly: '/w/artifacts/bin/Shop.Specs/debug/Shop.Specs.dll' },
];

test('readXml reads elements and decoded attributes, and ignores text, comments and CDATA', () => {
	const root = readXml('<?xml version="1.0"?>\n<!-- x --><a k="1 &amp; &#x41;"><b/><![CDATA[<c/>]]>text<c n=\'2\'></c></a>');
	const children = [{ name: 'b', attrs: {}, children: [] }, { name: 'c', attrs: { n: '2' }, children: [] }];
	assert.deepEqual(root, { name: 'a', attrs: { k: '1 & A' }, children });
});

test('outcomes: Passed passes, NotExecuted and Inconclusive skip, everything else fails', () => {
	assert.deepEqual(['Passed', 'NotExecuted', 'Inconclusive', 'Failed', 'Error', 'Timeout', 'Aborted', 'PassedButRunAborted'].map(trxOutcome),
		['pass', 'skip', 'skip', 'fail', 'fail', 'fail', 'fail', 'fail']);
});

test('xUnit: className@method keys, theory rows with the same method numbered, the framework from codeBase', () => {
	assert.deepEqual(parseTrx([{ name: 'a.trx', text: XUNIT }], TARGETS.slice(1, 2)), {
		tests: {
			'Shop.Tests@net9.0 Shop.Tests.PriceTests@Adds': 'pass', 'Shop.Tests@net9.0 Shop.Tests.PriceTests@Adds#2': 'fail',
			'Shop.Tests@net9.0 Shop.Tests.PriceTests@Rounds': 'pass', 'Shop.Tests@net9.0 Shop.Tests.OrderTests@Later': 'skip',
		},
		packages: { 'Shop.Tests@net9.0': 'fail' },
	});
});

test('NUnit: arguments stay in the name, entities are decoded, and the same project on another framework is another package', () => {
	const run = parseTrx([{ name: 'n.trx', text: NUNIT }, { name: 'x.trx', text: XUNIT }], TARGETS.slice(0, 2))!;
	assert.deepEqual(Object.keys(run.tests).filter(key => key.startsWith('Shop.Tests@net8.0')),
		['Adds(1,2)', 'Adds(2,2)', 'Escapes("a&b")'].map(name => `Shop.Tests@net8.0 Shop.Tests.PriceTests@${name}`));
	assert.deepEqual(run.packages, { 'Shop.Tests@net8.0': 'pass', 'Shop.Tests@net9.0': 'fail' });
});

test('MSTest: inner results are expanded under their parent, and the artifacts layout is matched by the evaluated TargetPath', () => {
	assert.deepEqual(parseTrx([{ name: 'm.trx', text: MSTEST }], TARGETS.slice(2)), {
		tests: {
			'Shop.Specs@net9.0 Shop.Specs.MoneySpecs@Rounds/Rounds (1.5)': 'pass', 'Shop.Specs@net9.0 Shop.Specs.MoneySpecs@Rounds/Rounds (2.5)': 'fail',
			'Shop.Specs@net9.0 Shop.Specs.MoneySpecs@Formats': 'pass',
		},
		packages: { 'Shop.Specs@net9.0': 'fail' },
	});
	assert.deepEqual(Object.keys(parseTrx([{ name: 'm.trx', text: MSTEST }], [])!.packages), ['Shop.Specs@debug']);
});

test('a missing TRX file or an aborted run fails its package, so a crash after a split never reads as "no tests ran"', () => {
	const before = parseTrx([{ name: 'n.trx', text: NUNIT }, { name: 'x.trx', text: XUNIT }], TARGETS.slice(0, 2));
	const missing = parseTrx([{ name: 'n.trx', text: NUNIT }], TARGETS.slice(0, 2))!;
	assert.equal(missing.packages['Shop.Tests@net9.0'], 'fail');
	const aborted = parseTrx([{ name: 'n.trx', text: NUNIT }, { name: 'x.trx', text: ABORTED }], TARGETS.slice(0, 2))!;
	assert.equal(aborted.packages['Shop.Tests@net9.0'], 'fail');
	const result = (tests: typeof before) => ({ command: 'dotnet test Shop.sln', label: 'test', code: 1, failures: [], tail: '', log: '', tests });
	assert.match(compareWithBaseline([result(before), result(before)], result(missing)).problems.join(' '),
		/Shop\.Tests@net9\.0 Shop\.Tests\.PriceTests@Adds: pass before, missing now/);
	assert.match(compareWithBaseline([result(before), result(before)], result(aborted)).problems.join(' '),
		/Shop\.Tests@net9\.0 Shop\.Tests\.PriceTests@Adds: pass before, missing now/);
	assert.deepEqual(parseTrx([], TARGETS.slice(0, 1)), { tests: {}, packages: { 'Shop.Tests@net8.0': 'fail' } });
	assert.equal(parseTrx([], []), undefined);
	assert.equal(parseTrx([{ name: 'notes.txt', text: 'x' }], []), undefined);
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/csTests.test.ts(4,59): error TS2307: Cannot find module '../src/aiready/csTests' or its corresponding type declarations.
```

- [ ] **Step 3: Implement.**

Create `src/aiready/csTests.ts`:

````ts
import * as path from 'path';
import type { Outcome, TestRun } from './baseline';
import { samePath } from './csEval';
import type { ResultFile } from './language';

/** A test assembly the run should report on: one per test project and target framework, named `<AssemblyName>@<framework>`. */
export interface TestTarget {
	readonly label: string;
	/** Its TargetPath, which TRX files name as each test's `codeBase`. */
	readonly assembly: string;
}

interface Element {
	readonly name: string;
	readonly attrs: Readonly<Record<string, string>>;
	readonly children: Element[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

function decode(value: string): string {
	return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, entity: string) => {
		if (entity[0] !== '#') { return ENTITIES[entity] ?? whole; }
		return String.fromCodePoint(entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
	});
}

/** A small XML reader for TRX: elements and attributes only (text, comments, CDATA and declarations are dropped). */
export function readXml(text: string): Element | undefined {
	const stripped = text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/g, '');
	const root: Element = { name: '#root', attrs: {}, children: [] };
	const stack = [root];
	for (const match of stripped.matchAll(/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g)) {
		const [, closing, name, attrText, selfClosing] = match;
		if (closing) {
			if (stack.length > 1) { stack.pop(); }
			continue;
		}
		const attrs: Record<string, string> = {};
		for (const attr of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) { attrs[attr[1]] = decode(attr[2] ?? attr[3]); }
		const element: Element = { name: name.replace(/^.*:/, ''), attrs, children: [] };
		stack[stack.length - 1].children.push(element);
		if (!selfClosing) { stack.push(element); }
	}
	return root.children[0];
}

const all = (element: Element, name: string): Element[] => element.children.filter(child => child.name === name);
const first = (element: Element | undefined, name: string): Element | undefined => element?.children.find(child => child.name === name);

/** `Passed` passes; `NotExecuted` and `Inconclusive` are skipped; anything else (`Failed`, `Error`, `Timeout`, `Aborted`…) fails. */
export function trxOutcome(outcome: string | undefined): Outcome {
	if (outcome === 'Passed') { return 'pass'; }
	return outcome === 'NotExecuted' || outcome === 'Inconclusive' ? 'skip' : 'fail';
}

/** The label of a test assembly: the expected target with this path, else `<file name>@<framework folder>`. */
function labelOf(codeBase: string, targets: readonly TestTarget[]): string {
	const known = targets.find(target => samePath(target.assembly, codeBase));
	if (known) { return known.label; }
	const parts = codeBase.split(/[\\/]/);
	return `${path.basename(codeBase).replace(/\.(dll|exe)$/i, '')}@${parts[parts.length - 2] ?? ''}`;
}

/**
 * Per-test results from TRX files (one per test project and target framework). A test is keyed `<label>
 * <className>@<name>`, from its definition's TestMethod, numbered `#2`, `#3`… when the key repeats (data rows with
 * equal names); inner results (MSTest data rows, retries) are keyed by their parent and their own name. A target with
 * no TRX file, or whose run summary says it aborted, fails as a package.
 */
export function parseTrx(files: readonly ResultFile[], targets: readonly TestTarget[]): TestRun | undefined {
	const tests: Record<string, Outcome> = {};
	const packages: Record<string, Outcome> = {};
	for (const file of files.filter(f => f.name.toLowerCase().endsWith('.trx'))) {
		const run = readXml(file.text);
		if (!run || run.name !== 'TestRun') { continue; }
		const definitions = new Map<string, { key: string; label: string }>();
		for (const unit of all(first(run, 'TestDefinitions') ?? run, 'UnitTest')) {
			const method = first(unit, 'TestMethod');
			definitions.set(unit.attrs.id, { key: `${method?.attrs.className ?? ''}@${method?.attrs.name ?? unit.attrs.name ?? ''}`,
				label: labelOf(method?.attrs.codeBase ?? unit.attrs.storage ?? '', targets) });
		}
		const seen = new Map<string, number>();
		const labels = new Set<string>();
		const record = (label: string, key: string, outcome: Outcome) => {
			const n = (seen.get(`${label} ${key}`) ?? 0) + 1;
			seen.set(`${label} ${key}`, n);
			tests[`${label} ${key}${n > 1 ? `#${n}` : ''}`] = outcome;
		};
		for (const result of all(first(run, 'Results') ?? run, 'UnitTestResult')) {
			const definition = definitions.get(result.attrs.testId);
			const label = definition?.label ?? labelOf('', targets);
			const key = definition?.key ?? `@${result.attrs.testName ?? ''}`;
			labels.add(label);
			const inner = all(first(result, 'InnerResults') ?? { name: '', attrs: {}, children: [] }, 'UnitTestResult');
			if (inner.length) { for (const row of inner) { record(label, `${key}/${row.attrs.testName ?? ''}`, trxOutcome(row.attrs.outcome)); } }
			else { record(label, key, trxOutcome(result.attrs.outcome)); }
		}
		const summary = first(run, 'ResultSummary')?.attrs.outcome ?? '';
		for (const label of labels) {
			const failed = ['Aborted', 'Error', 'Timeout'].includes(summary)
				|| Object.entries(tests).some(([key, outcome]) => key.startsWith(`${label} `) && outcome === 'fail');
			packages[label] = failed ? 'fail' : 'pass';
		}
	}
	for (const target of targets) { packages[target.label] ??= 'fail'; }
	return Object.keys(tests).length || Object.keys(packages).length ? { tests, packages } : undefined;
}
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/csSplit.ts",
    "src/aiready/csMoveCheck.ts"
  ]
````

with:

````json
    "src/aiready/csSplit.ts",
    "src/aiready/csMoveCheck.ts",
    "src/aiready/csTests.ts"
  ]
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 416
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/csTests.ts test/csTests.test.ts test/trxFixture.ts tsconfig.test.json
git commit -m "C#: TRX results"
```

### Task 9: Stage 1 type count for `.cs` files

**Files:**
- Create: `src/aiready/csHealth.ts`, `test/csHealth.test.ts`
- Modify: `src/aiready/health.ts`, `tsconfig.test.json`

`many-classes` for C# counts every top-level type kind but `partial` ones, with a small scanner that skips comments, every string form and directives. The shared `classDeclarations` (Pair's source policy) is not changed.

- [ ] **Step 1: Write the failing tests.**

Create `test/csHealth.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { csTypeCount } from '../src/aiready/csHealth';
import { fileStats } from '../src/aiready/health';
import { classDeclarations } from '../src/quality/sourcePolicy';

const names = (text: string) => csTypeCount(text).map(type => `${type.name}:${type.line}`);

test('csTypeCount counts every top-level type kind in a block namespace, a file-scoped one and none', () => {
	const block = 'namespace Shop\n{\n    public class A { }\n    public record B(int X);\n    public record struct C(int Y);\n    internal struct D { }\n'
		+ '    public interface IE { }\n    public enum F { G }\n    public delegate void H(int x);\n}\n';
	assert.deepEqual(names(block), ['A:3', 'B:4', 'C:5', 'D:6', 'IE:7', 'F:8', 'H:9']);
	assert.deepEqual(names('namespace Shop;\n\npublic sealed class A { }\n\npublic record class R;\n'), ['A:3', 'R:5']);
	assert.deepEqual(names('class A { }\nclass B { }\n'), ['A:1', 'B:2']);
});

test('csTypeCount leaves out nested and partial types, and generic constraints', () => {
	const text = 'namespace Shop;\n\npublic partial class Gen { }\n\npublic class Outer<T> where T : class, new()\n{\n    public class Inner { }\n'
		+ '    public enum Kind { A }\n    void M<U>() where U : struct { }\n}\n\npublic static partial class Logs { }\n';
	assert.deepEqual(names(text), ['Outer:5']);
});

test('csTypeCount ignores type words in comments, strings, chars, verbatim, raw and interpolated strings, and directives', () => {
	const text = '// class Comment { }\n/* class Block\n{ */\n#region class Region\nclass Real\n{\n    string a = "class S {";\n'
		+ '    string b = @"class ""V"" {";\n    string c = $"{(true ? "class X {" : "y")} {{ class";\n    string d = """\n        class Raw {\n        """;\n'
		+ '    char e = \'{\';\n}\n#endregion\nenum After { A }\n';
	assert.deepEqual(names(text), ['Real:5', 'After:16']);
});

test('fileStats uses csTypeCount for .cs files; the shared classDeclarations is unchanged', () => {
	const text = 'namespace Shop;\n\npublic class A { }\n\npublic enum B { X }\n\npublic partial class C { }\n';
	assert.deepEqual(fileStats('Shop/A.cs', text).classes.map(c => c.name), ['A', 'B']);
	assert.deepEqual(classDeclarations(text, 'Shop/A.cs').map(c => c.name), ['A', 'C']);
	assert.deepEqual(fileStats('a.py', 'class A:\n    pass\n\nclass B:\n    pass\n').classes.map(c => c.name), ['A', 'B']);
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/csHealth.test.ts(3,29): error TS2307: Cannot find module '../src/aiready/csHealth' or its corresponding type declarations.
```

- [ ] **Step 3: Implement.**

Create `src/aiready/csHealth.ts`:

````ts
/** A word or one punctuation character of C# code, with its line; comments and literals are already gone. */
interface Token {
	readonly text: string;
	readonly line: number;
}

/** Where a skipped stretch of text ends, and how many newlines it held. */
interface Skipped {
	readonly end: number;
	readonly lines: number;
}

const TYPE_WORDS = new Set(['class', 'struct', 'interface', 'enum', 'record', 'delegate']);
const BOUNDARY = new Set([';', '{', '}', ']']);
/** Tokens after which a type word is not a declaration (`where T : class`, `typeof(…)`). */
const NOT_A_DECLARATION = new Set([':', ',', '<', '(', '.']);
const LITERAL_START = /^(?:[$@]{1,2}"|"|')/;

/** Skips a string or char literal starting at `i` (regular, verbatim, raw or interpolated). */
function skipLiteral(text: string, i: number): Skipped {
	let j = i;
	let interpolated = false;
	let verbatim = false;
	for (; text[j] === '$' || text[j] === '@'; j++) {
		interpolated ||= text[j] === '$';
		verbatim ||= text[j] === '@';
	}
	let quotes = 1;
	while (text[j] === '"' && text[j + quotes] === '"') { quotes++; }
	const raw = quotes >= 3;
	const close = raw ? '"'.repeat(quotes) : text[j];
	let lines = 0;
	for (let k = j + (raw ? quotes : 1); k < text.length;) {
		const c = text[k];
		const escaped = !raw && !verbatim && c === '\\';
		const doubled = (verbatim && !raw && c === '"' && text[k + 1] === '"') || (interpolated && c === '{' && text[k + 1] === '{');
		if (escaped || doubled) {
			lines += text[k + 1] === '\n' ? 1 : 0;
			k += 2;
		} else if (interpolated && c === '{') {
			const hole = skipCode(text, k + 1);
			lines += hole.lines;
			k = hole.end + 1;
		} else if (text.startsWith(close, k)) {
			return { end: k + close.length, lines };
		} else {
			lines += c === '\n' ? 1 : 0;
			k++;
		}
	}
	return { end: text.length, lines };
}

/** Skips the code of an interpolation hole up to its closing `}`, stepping over nested braces and literals. */
function skipCode(text: string, i: number): Skipped {
	let depth = 0;
	let lines = 0;
	for (let k = i; k < text.length;) {
		const c = text[k];
		if (c === '}' && depth === 0) { return { end: k, lines }; }
		if (LITERAL_START.test(text.slice(k, k + 3))) {
			const literal = skipLiteral(text, k);
			lines += literal.lines;
			k = literal.end;
			continue;
		}
		depth += c === '{' ? 1 : c === '}' ? -1 : 0;
		lines += c === '\n' ? 1 : 0;
		k++;
	}
	return { end: text.length, lines };
}

/** The end of a comment or preprocessor line starting at `i`, or undefined when none starts there. */
function skipComment(text: string, i: number): Skipped | undefined {
	const directive = text[i] === '#' && /^\s*$/.test(text.slice(text.lastIndexOf('\n', i - 1) + 1, i));
	if (text.startsWith('//', i) || directive) {
		const end = text.indexOf('\n', i);
		return { end: end < 0 ? text.length : end, lines: 0 };
	}
	if (!text.startsWith('/*', i)) { return undefined; }
	const close = text.indexOf('*/', i + 2);
	const end = close < 0 ? text.length : close + 2;
	return { end, lines: (text.slice(i, end).match(/\n/g) ?? []).length };
}

/** The code as tokens, without comments, strings, chars and preprocessor lines. */
function tokens(text: string): Token[] {
	const out: Token[] = [];
	let line = 1;
	for (let i = 0; i < text.length;) {
		const skipped = skipComment(text, i) ?? (LITERAL_START.test(text.slice(i, i + 3)) ? skipLiteral(text, i) : undefined);
		const word = skipped ? undefined : /^@?[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i, i + 200));
		if (skipped) {
			line += skipped.lines;
			i = skipped.end;
		} else if (word) {
			out.push({ text: word[0].replace(/^@/, ''), line });
			i += word[0].length;
		} else {
			if (text[i] === '\n') { line++; }
			if (!/\s/.test(text[i])) { out.push({ text: text[i], line }); }
			i++;
		}
	}
	return out;
}

/** The modifiers before token `i`, back to the previous `;`, `{`, `}` or `]`. */
function modifiers(list: readonly Token[], i: number): string[] {
	const out: string[] = [];
	for (let j = i - 1; j >= 0 && !BOUNDARY.has(list[j].text); j--) { out.push(list[j].text); }
	return out;
}

/** The declared name after a type keyword at token `i`: the next word, or for a delegate the word before its `(`. */
function typeName(list: readonly Token[], i: number): string {
	if (list[i].text === 'delegate') {
		const open = list.findIndex((t, j) => j > i && t.text === '(');
		const before = open > 0 ? list.slice(i + 1, open).filter(t => /^\w/.test(t.text)) : [];
		return before[before.length - 1]?.text ?? '?';
	}
	const next = list[i].text === 'record' && ['class', 'struct'].includes(list[i + 1]?.text ?? '') ? i + 2 : i + 1;
	return list[next]?.text ?? '?';
}

/** Whether token `i` declares a type that counts: a type word that is not part of `record class`, a constraint, or a partial type. */
function declaresType(list: readonly Token[], i: number): boolean {
	const token = list[i].text;
	const previous = list[i - 1]?.text ?? '';
	if (!TYPE_WORDS.has(token) || NOT_A_DECLARATION.has(previous)) { return false; }
	if (previous === 'record' && (token === 'class' || token === 'struct')) { return false; }
	return !modifiers(list, i).includes('partial');
}

/**
 * Stage 1's `many-classes` count for a C# file, without the helper: every top-level type (class, struct, record,
 * record struct, interface, enum, delegate) in a block or file-scoped namespace or none, leaving out nested types and
 * `partial` types (version 1 never moves them). Keywords in comments, strings and generic constraints do not count.
 */
export function csTypeCount(text: string): { name: string; line: number }[] {
	const list = tokens(text);
	const found: { name: string; line: number }[] = [];
	const stack: ('namespace' | 'other')[] = [];
	let pendingNamespace = false;
	for (let i = 0; i < list.length; i++) {
		const token = list[i].text;
		if (token === '{') {
			stack.push(pendingNamespace ? 'namespace' : 'other');
		} else if (token === '}') {
			stack.pop();
		} else if (stack.every(kind => kind === 'namespace') && declaresType(list, i)) {
			found.push({ name: typeName(list, i), line: list[i].line });
		}
		pendingNamespace = token === 'namespace' || (pendingNamespace && token !== ';' && token !== '{');
	}
	return found;
}
````

In `src/aiready/health.ts`, replace:

````ts
import type { DetectedCommands } from './commandDetect';

````

with:

````ts
import type { DetectedCommands } from './commandDetect';
import { csTypeCount } from './csHealth';

````

In `src/aiready/health.ts`, replace:

````ts
	return {
		path: filePath, lines: sourceLines(text), classes: classDeclarations(text, filePath),
		inlineTests: filePath.endsWith('.rs') && /#\[cfg\(test\)\]/.test(text),
````

with:

````ts
	return {
		// C#: every top-level type kind but partial ones, which a split never moves; the shared classDeclarations stays as it is.
		path: filePath, lines: sourceLines(text), classes: filePath.endsWith('.cs') ? csTypeCount(text) : classDeclarations(text, filePath),
		inlineTests: filePath.endsWith('.rs') && /#\[cfg\(test\)\]/.test(text),
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/csMoveCheck.ts",
    "src/aiready/csTests.ts"
  ]
````

with:

````json
    "src/aiready/csMoveCheck.ts",
    "src/aiready/csTests.ts",
    "src/aiready/csHealth.ts"
  ]
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 420
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/csHealth.ts src/aiready/health.ts test/csHealth.test.ts tsconfig.test.json
git commit -m "C#: stage 1 type count"
```

### Task 10: Editor config through Roslyn

**Files:**
- Create: `resources/csast/Config.cs`
- Modify: `resources/csast/Program.cs`, `src/aiready/csAst.ts`, `test/csAst.test.ts`

The helper's `config` command builds an `AnalyzerConfigSet` from the files MSBuild lists and compares the options a new name would get with the original's. Roslyn's own section matching is used; for example `[**/Legacy*.cs]` does not match a file directly in the config's folder.

- [ ] **Step 1: Write the failing tests.**

In `test/csAst.test.ts`, replace:

````ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { csFacts, DOTNET, slice } from './csFixture';

const BIG = `// Copyright (c) Acme Ltd. Licensed under the MIT license.
````

with:

````ts
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { csConfig } from '../src/aiready/csAst';
import { csFacts, DOTNET, dotnetTools, slice } from './csFixture';

const BIG = `// Copyright (c) Acme Ltd. Licensed under the MIT license.
````

In `test/csAst.test.ts`, replace:

````ts
	assert.deepEqual(facts.intercepted.map(c => `${c.name} ${c.line}`), ['MapGet 18', 'Bind 18']);
});
````

with:

````ts
	assert.deepEqual(facts.intercepted.map(c => `${c.name} ${c.line}`), ['MapGet 18', 'Bind 18']);
});

test('config: a section naming the original, or a glob matching only some names, differs; [*.cs] does not', DOTNET, async () => {
	const tools = await dotnetTools();
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-config-'));
	writeFileSync(path.join(dir, '.editorconfig'), 'root = true\n\n[*.cs]\nindent_style = tab\n\n[Big.cs]\ndotnet_diagnostic.CA1000.severity = none\n\n'
		+ '[Legacy*.cs]\ngenerated_code = true\n');
	writeFileSync(path.join(dir, '.globalconfig'), 'is_global = true\n\ndotnet_diagnostic.CS0168.severity = error\n');
	const at = (name: string) => path.join(dir, name);
	const result = await csConfig(tools, at('Big.cs'), [at('Order.cs'), at('LegacyOrder.cs')], [at('.editorconfig'), at('.globalconfig')]);
	assert.match(result[at('Order.cs')] ?? '', /ca1000 severity Suppress/);
	writeFileSync(path.join(dir, '.editorconfig'), 'root = true\n\n[*.cs]\nindent_style = tab\n\n[Legacy*.cs]\ngenerated_code = true\n');
	const plain = await csConfig(tools, at('Big.cs'), [at('Order.cs'), at('LegacyOrder.cs')], [at('.editorconfig'), at('.globalconfig')]);
	assert.equal(plain[at('Order.cs')], null);
	assert.match(plain[at('LegacyOrder.cs')] ?? '', /generated_code = true/);
	writeFileSync(path.join(dir, '.globalconfig'), `is_global = true\n\n[${at('Big.cs')}]\ndotnet_diagnostic.CS0168.severity = none\n`);
	const global = await csConfig(tools, at('Big.cs'), [at('Order.cs')], [at('.editorconfig'), at('.globalconfig')]);
	assert.match(global[at('Order.cs')] ?? '', /cs0168 severity Suppress/);
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/csAst.test.ts(6,10): error TS2305: Module '"../src/aiready/csAst"' has no exported member 'csConfig'.
```

- [ ] **Step 3: Implement.**

Create `resources/csast/Config.cs`:

````cs
using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Text;

namespace Csast;

/// <summary>
/// Whether new files would get the same analyzer configuration as the original: the compiler's own AnalyzerConfigSet
/// over the project's .editorconfig and .globalconfig files, never a reimplementation of their globs.
/// </summary>
static class Config
{
	/// <summary>Arguments: the original, then candidates, then `--with` and the config files. Each candidate maps to its first difference, or null.</summary>
	public static Dictionary<string, string?> Compare(string[] args)
	{
		var split = Array.IndexOf(args, "--with");
		var paths = (split < 0 ? args : args[..split]).Select(Path.GetFullPath).ToArray();
		var files = split < 0 ? Array.Empty<string>() : args[(split + 1)..];
		var configs = files.Where(File.Exists).Distinct()
			.Select(file => AnalyzerConfig.Parse(SourceText.From(File.ReadAllText(file)), Path.GetFullPath(file))).ToImmutableArray();
		var set = AnalyzerConfigSet.Create(configs);
		var original = Describe(set.GetOptionsForSourcePath(paths[0]));
		var result = new Dictionary<string, string?>();
		foreach (var candidate in paths.Skip(1)) {
			var options = Describe(set.GetOptionsForSourcePath(candidate));
			var differs = original.Except(options).Concat(options.Except(original)).OrderBy(line => line, StringComparer.Ordinal).FirstOrDefault();
			result[candidate] = differs;
		}
		return result;
	}

	static HashSet<string> Describe(AnalyzerConfigOptionsResult options)
	{
		var lines = new HashSet<string>(StringComparer.Ordinal);
		foreach (var (id, severity) in options.TreeOptions) { lines.Add($"{id} severity {severity}"); }
		foreach (var (key, value) in options.AnalyzerOptions) { lines.Add($"{key} = {value}"); }
		return lines;
	}
}
````

In `resources/csast/Program.cs`, replace:

````cs
					return 0;
				case "cultures" when args.Length == 1:
````

with:

````cs
					return 0;
				case "config" when args.Length >= 3:
					Console.Out.Write(JsonSerializer.Serialize(Config.Compare(args.Skip(1).ToArray()), Json));
					return 0;
				case "cultures" when args.Length == 1:
````

In `resources/csast/Program.cs`, replace:

````cs
				default:
					Console.Error.WriteLine("usage: csast parse <file> | cultures");
					return 2;
````

with:

````cs
				default:
					Console.Error.WriteLine("usage: csast parse <file> | config <original> <candidate>… [--with <config file>…] | cultures");
					return 2;
````

In `src/aiready/csAst.ts`, replace:

````ts
	catch { throw new Error(`${path.basename(file)} could not be parsed: the helper printed no JSON.`); }
}
````

with:

````ts
	catch { throw new Error(`${path.basename(file)} could not be parsed: the helper printed no JSON.`); }
}

/** For each candidate path: the first analyzer option or severity that differs from the original's, or null when none does. */
export async function csConfig(tools: Pick<CsTools, 'dotnet' | 'helper'>, original: string, candidates: readonly string[], configs: readonly string[]):
	Promise<Record<string, string | null>> {
	const output = await runHelper(tools, ['config', original, ...candidates, '--with', ...configs], path.dirname(original));
	return JSON.parse(output) as Record<string, string | null>;
}
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 421
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add resources/csast/Config.cs resources/csast/Program.cs src/aiready/csAst.ts test/csAst.test.ts
git commit -m "C# helper: editor config comparison"
```

## Chunk 7: Rule 6

### Task 11: Rule 6: the assembly dump and its check

**Files:**
- Create: `resources/csast/Dump.cs`, `resources/csast/DumpIl.cs`, `resources/csast/DumpNames.cs`, `src/aiready/csAssembly.ts`, `test/csAssembly.test.ts`
- Modify: `resources/csast/Program.cs`, `src/aiready/csAst.ts`, `tsconfig.test.json`

The helper's `dump` prints an assembly's metadata and IL with every token resolved to a name (System.Reflection.Metadata, nothing loaded). `csAssemblyCheck` records both baseline builds per project (reproducible or skipped for the run), builds the reference at the last commit before each split, and compares after the checks pass. These tests build real projects (about 35 s).

- [ ] **Step 1: Write the failing tests.**

Create `test/csAssembly.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import type { CheckResult } from '../src/aiready/baseline';
import { BuiltProject, csAssemblyCheck, firstDifference } from '../src/aiready/csAssembly';
import { csDump } from '../src/aiready/csAst';
import { evaluateProject } from '../src/aiready/csEval';
import { buildCheck } from '../src/aiready/csProject';
import { CsTools, DOTNET_ENV } from '../src/aiready/csTools';
import type { AssemblyCheck } from '../src/aiready/language';
import { runCommand, runTool, tail } from '../src/aiready/projectCommands';
import { DOTNET, dotnetTools, library, repository } from './csFixture';

const PROGRAM = 'namespace Lab;\n\npublic static class Program\n{\n    public static object Shape() => new { A = 1, B = "x" };\n'
	+ '    public static object Default() => (string s = "a") => s;\n}\n';
const ZETA = 'namespace Lab;\n\npublic class Z1\n{\n    public static int Twice(int x) => x * 2;\n}\n\n/// <summary>Big two.</summary>\npublic class Big2\n{\n'
	+ '    static readonly System.Func<int, int> F = x => Z1.Twice(x) + 1;\n    public static string Shape()\n    {\n        var o = new { C = 1 };\n'
	+ '        var d = (int a = 3) => a;\n        return o.GetType().Name + F(2) + d() + new[] { 1, 2, 3, 4, 5 }.Sum();\n    }\n}\n';

interface Lab {
	readonly root: string;
	readonly check: AssemblyCheck;
	readonly run: (command: string, label: string) => Promise<CheckResult>;
	readonly built: BuiltProject;
	readonly write: (files: Record<string, string>) => void;
	readonly git: (...args: string[]) => string;
}

/** A restored project with an assembly check whose baseline has run twice. */
async function lab(tools: CsTools, files: Record<string, string>, csproj = library(), baseline = true): Promise<Lab> {
	const root = repository({ 'App/App.csproj': csproj, ...files }, 'my-editor-csasm-');
	const restored = await runTool(tools.dotnet, ['restore', 'App/App.csproj'], root, DOTNET_ENV);
	assert.equal(restored.code, 0, restored.stdout);
	const build = buildCheck('App/App.csproj').command;
	const evaluation = await evaluateProject(tools, root, 'App/App.csproj');
	const targets = evaluation.pairs.filter(pair => pair.configuration === 'Debug').map(pair => ({ framework: pair.framework, path: pair.properties.TargetPath }));
	const built = { project: 'App/App.csproj', build, targets };
	const logs = mkdtempSync(path.join(os.tmpdir(), 'my-editor-csasm-logs-'));
	const run = async (command: string, label: string): Promise<CheckResult> => {
		const out = await runCommand(command, { cwd: root, approved: [build], timeoutMs: 300_000, env: DOTNET_ENV, logFile: path.join(logs, `${Date.now()}.log`) });
		return { command, label, code: out.code, failures: [], tail: tail(out.output), log: '' };
	};
	const storageDir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-csasm-store-'));
	const projectBuiltBy = (command: string) => (command === build ? built : undefined);
	const check = csAssemblyCheck({ tools: { ...tools, storageDir }, root, projectOf: () => built, projectBuiltBy });
	for (const round of baseline ? [1, 2] : []) {
		await check.baseline(build, round, await run(build, 'build'));
	}
	const write = (more: Record<string, string>) => {
		for (const [name, text] of Object.entries(more)) { writeFileSync(path.join(root, name), text); }
	};
	return { root, check, run, built, write, git: (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }) };
}

/** Snapshot at HEAD, write the split, build it as the checks would, compare; then put the files back. */
async function step(l: Lab, file: string, files: Record<string, string>): Promise<string[]> {
	assert.deepEqual(await l.check.snapshot(file, l.run), []);
	l.write(files);
	assert.equal((await l.run(l.built.build, 'build')).code, 0);
	const problems = await l.check.compare(file, Object.keys(files).filter(name => name !== file), l.run);
	l.git('checkout', '--', '.');
	l.git('clean', '-fdq', 'App');
	return problems;
}

test('firstDifference names the type and member, and spots caller-info constants', () => {
	const before = ['type Lab.User flags=Public', '  method Lab.User::Say() : void flags=Public', '      IL_0000 ldstr "/w/App/Big.cs"'];
	const after = [...before.slice(0, 2), '      IL_0000 ldstr "/w/App/User.cs"'];
	assert.equal(firstDifference(before, after, { original: 'Big.cs', files: ['User.cs'] }), 'in type Lab.User, method Lab.User::Say() : void: '
		+ '"IL_0000 ldstr \\"/w/App/Big.cs\\"" became "IL_0000 ldstr \\"/w/App/User.cs\\"" '
		+ '(likely a [CallerFilePath] or [CallerLineNumber] argument, compiled in as a constant)');
	assert.equal(firstDifference(before, before, { original: '', files: [] }), undefined);
	assert.match(firstDifference(before, before.slice(0, 2), { original: '', files: [] }) ?? '', /became "\(end\)"/);
});

test('rule 6 passes a moved type with anonymous types and delegates and a lambda, across a commit that changes the version stamp', DOTNET, async () => {
	const tools = await dotnetTools();
	const l = await lab(tools, { 'App/Program.cs': PROGRAM, 'App/Zeta.cs': ZETA });
	const baseline = (await csDump(tools, l.built.targets[0].path)).split('\n');
	writeFileSync(path.join(l.root, 'README.md'), 'A later commit.\n');
	l.git('add', 'README.md');
	l.git('commit', '-qm', 'later');
	const big2 = ZETA.indexOf('/// <summary>Big two');
	const problems = await step(l, 'App/Zeta.cs', { 'App/Zeta.cs': ZETA.slice(0, big2 - 1), 'App/Big2.cs': `namespace Lab;\n\n${ZETA.slice(big2)}` });
	assert.deepEqual(problems, []);
	const later = (await csDump(tools, l.built.targets[0].path)).split('\n');
	assert.match(firstDifference(baseline, later, { original: '', files: [] }) ?? '', /AssemblyInformationalVersionAttribute/);
	assert.ok(later.some(line => line.startsWith('type <anon A,B>`2')) && later.some(line => line.startsWith('type <anondelegate')));
});

test('rule 6 fails a moved [CallerFilePath] caller, a changed constant, a renamed resource and a reordered module initializer', DOTNET, async () => {
	const tools = await dotnetTools();
	const big = 'namespace Lab;\n\npublic class User\n{\n    public string Where() => Logger.Log();\n}\n\npublic class Mid\n{\n'
		+ '    [System.Runtime.CompilerServices.ModuleInitializer]\n    internal static void Init() => System.Console.WriteLine("init Mid");\n}\n\n'
		+ 'public class Other { }\n';
	const logger = 'namespace Lab;\n\npublic static class Logger\n{\n    public const int Limit = 3;\n'
		+ '    public static string Log([System.Runtime.CompilerServices.CallerFilePath] string file = "") => file;\n}\n';
	const resx = '<?xml version="1.0" encoding="utf-8"?>\n<root>\n  <resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>\n'
		+ '  <resheader name="version"><value>2.0</value></resheader>\n'
		+ '  <resheader name="reader"><value>System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, '
		+ 'PublicKeyToken=b77a5c561934e089</value></resheader>\n'
		+ '  <resheader name="writer"><value>System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, '
		+ 'PublicKeyToken=b77a5c561934e089</value></resheader>\n'
		+ '  <data name="Hello" xml:space="preserve"><value>Hi</value></data>\n</root>\n';
	const res = 'namespace Lab;\n\npublic class Named { }\n\npublic class Rest { }\n';
	const center = 'namespace Lab;\n\npublic class Center\n{\n    [System.Runtime.CompilerServices.ModuleInitializer]\n'
		+ '    internal static void Init() => System.Console.WriteLine("init Center");\n}\n';
	const l = await lab(tools, { 'App/Big.cs': big, 'App/Logger.cs': logger, 'App/Res.cs': res, 'App/Res.resx': resx, 'App/Center.cs': center });
	const user = big.slice(big.indexOf('public class User'), big.indexOf('public class Mid'));
	const caller = await step(l, 'App/Big.cs', { 'App/Big.cs': big.replace(user, ''), 'App/User.cs': `namespace Lab;\n\n${user.trimEnd()}\n` });
	assert.match(caller.join(' '), /^Rule 6: the compiled assembly differs for net9\.0: in type Lab\.User, method Lab\.User::Where\(\)/);
	assert.match(caller.join(' '), /Big\.cs.*User\.cs.*CallerFilePath/);
	const constant = await step(l, 'App/Logger.cs', { 'App/Logger.cs': logger.replace('Limit = 3', 'Limit = 4') });
	assert.match(constant.join(' '), /field Limit.*const=Int32:03000000.*const=Int32:04000000/);
	const named = 'namespace Lab;\n\npublic class Named { }\n';
	const resource = await step(l, 'App/Res.cs', { 'App/Res.cs': 'namespace Lab;\n\npublic class Rest { }\n', 'App/Named.cs': named });
	assert.match(resource.join(' '), /resource Lab\.Named\.resources.*became.*resource Lab\.Rest\.resources/);
	const mid = big.slice(big.indexOf('public class Mid'), big.indexOf('public class Other'));
	const order = await step(l, 'App/Big.cs', { 'App/Big.cs': big.replace(mid, ''), 'App/Zed.cs': `namespace Lab;\n\n${mid.trimEnd()}\n` });
	assert.match(order.join(' '), /in type <Module>, method <Module>::\.cctor\(\)/);
});

test('the dump compares attributes on interface implementations, generic parameters and return values', DOTNET, async () => {
	const tools = await dotnetTools();
	const source = 'namespace Lab;\n\npublic class Tag : System.Attribute { }\n\npublic class Box<T> : System.IComparable<string>\n{\n'
		+ '    public int CompareTo(string? other) => 0;\n\n    public string Get() => "";\n}\n';
	const l = await lab(tools, { 'App/Box.cs': source }, library(), false);
	assert.equal((await l.run(l.built.build, 'build')).code, 0);
	const dump = async () => (await csDump(tools, l.built.targets[0].path)).split('\n');
	const before = await dump();
	l.write({ 'App/Box.cs': source.replace('Box<T> : System.IComparable<string>', 'Box<[Tag] T> : System.IComparable<string?>')
		.replace('    public string Get()', '    [return: Tag]\n    public string Get()') });
	assert.equal((await l.run(l.built.build, 'build')).code, 0);
	const after = await dump();
	const changed = after.filter(line => !before.includes(line)).map(line => line.trim().split(' ')[0]);
	assert.ok(['generic', 'implements', 'param'].every(kind => changed.includes(kind)), changed.join(', '));
});

test('a project whose two baseline builds differ is skipped for the run; a multi-target project is dumped per framework', DOTNET, async () => {
	const tools = await dotnetTools();
	const stamp = '  <Target Name="Stamp" BeforeTargets="CoreCompile">\n    <WriteLinesToFile File="$(IntermediateOutputPath)Stamp.cs" Overwrite="true" '
		+ 'Lines="namespace Lab%3B public static class Stamp { public const long Ticks = $([System.DateTime]::Now.Ticks)%3B }" />\n'
		+ '    <ItemGroup>\n      <Compile Include="$(IntermediateOutputPath)Stamp.cs" />\n    </ItemGroup>\n  </Target>\n';
	const l = await lab(tools, { 'App/A.cs': 'namespace Lab;\n\npublic class A { }\n' }, library().replace('</Project>', `${stamp}</Project>`));
	const skipped = await l.check.snapshot('App/A.cs', l.run);
	assert.match(skipped.join(' '), /^Building App\/App\.csproj twice at the same commit gave different assemblies \(net9\.0: in type Lab\.Stamp, field Ticks/);
	const multi = await lab(tools, { 'App/A.cs': 'namespace Lab;\n\npublic class A { }\n\npublic class B { }\n' },
		library().replace('<TargetFramework>net9.0</TargetFramework>', '<TargetFrameworks>net8.0;net9.0</TargetFrameworks>'));
	assert.deepEqual(multi.built.targets.map(target => target.framework), ['net8.0', 'net9.0']);
	const changed = await step(multi, 'App/A.cs', { 'App/A.cs': 'namespace Lab;\n\npublic class A { }\n\npublic class B { public int X; }\n' });
	assert.match(changed.join(' '), /^Rule 6: the compiled assembly differs for net8\.0: in type Lab\.B/);
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/csAssembly.test.ts(8,64): error TS2307: Cannot find module '../src/aiready/csAssembly' or its corresponding type declarations.
```

- [ ] **Step 3: Implement.**

Create `resources/csast/DumpNames.cs`:

````cs
using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Csast;

/// <summary>
/// Names every type, member and signature of one assembly by what it is, never by its token or row number, so two
/// builds that differ only in type order print the same text. Anonymous types and delegates, which the compiler numbers
/// in compile order, are named by their shape.
/// </summary>
sealed class DumpNames : ISignatureTypeProvider<string, object?>, ICustomAttributeTypeProvider<string>
{
	static readonly Regex AnonymousType = new(@"^<>f__AnonymousType\d+(`\d+)?$");
	static readonly Regex AnonymousDelegate = new(@"^<>f__AnonymousDelegate\d+(`\d+)?$");
	readonly MetadataReader md;
	readonly Dictionary<TypeDefinitionHandle, string> defs = new();

	public DumpNames(MetadataReader md)
	{
		this.md = md;
		foreach (var handle in md.TypeDefinitions) { defs[handle] = RawName(handle); }
		foreach (var handle in md.TypeDefinitions) {
			var type = md.GetTypeDefinition(handle);
			var name = md.GetString(type.Name);
			var match = AnonymousType.Match(name);
			if (!match.Success) { continue; }
			var props = type.GetProperties().Select(p => md.GetString(md.GetPropertyDefinition(p).Name));
			defs[handle] = Rename(handle, $"<anon {string.Join(",", props)}>{match.Groups[1].Value}");
		}
		foreach (var handle in md.TypeDefinitions) {
			var type = md.GetTypeDefinition(handle);
			var match = AnonymousDelegate.Match(md.GetString(type.Name));
			if (!match.Success) { continue; }
			// Anonymous delegates are generic over their types; their shape also holds parameter names, ref kinds and default values.
			var invoke = type.GetMethods().Select(md.GetMethodDefinition).FirstOrDefault(m => md.GetString(m.Name) == "Invoke");
			var signature = invoke.Signature.IsNil ? "?" : Signature(invoke.DecodeSignature(this, null));
			var parameters = invoke.Signature.IsNil ? [] : invoke.GetParameters().Select(md.GetParameter).Select(p => $"{md.GetString(p.Name)} {p.Attributes}"
				+ (p.GetDefaultValue().IsNil ? "" : $"={Convert.ToHexString(md.GetBlobBytes(md.GetConstant(p.GetDefaultValue()).Value))}"));
			defs[handle] = Rename(handle, $"<anondelegate {signature} {string.Join(", ", parameters)}>{match.Groups[1].Value}");
		}
	}

	string Rename(TypeDefinitionHandle handle, string name)
	{
		var type = md.GetTypeDefinition(handle);
		var parent = type.GetDeclaringType();
		return parent.IsNil ? Join(md.GetString(type.Namespace), name) : $"{defs[parent]}+{name}";
	}

	static string Join(string ns, string name) => ns.Length == 0 ? name : $"{ns}.{name}";

	string RawName(TypeDefinitionHandle handle)
	{
		var type = md.GetTypeDefinition(handle);
		var parent = type.GetDeclaringType();
		var name = md.GetString(type.Name);
		return parent.IsNil ? Join(md.GetString(type.Namespace), name) : $"{RawName(parent)}+{name}";
	}

	public string Type(TypeDefinitionHandle handle) => defs[handle];

	public string Reference(TypeReferenceHandle handle)
	{
		var type = md.GetTypeReference(handle);
		var name = Join(md.GetString(type.Namespace), md.GetString(type.Name));
		var scope = type.ResolutionScope;
		return scope.Kind switch {
			HandleKind.TypeReference => $"{Reference((TypeReferenceHandle)scope)}+{name}",
			HandleKind.AssemblyReference => $"[{md.GetString(md.GetAssemblyReference((AssemblyReferenceHandle)scope).Name)}]{name}",
			HandleKind.ModuleReference => $"[.module {md.GetString(md.GetModuleReference((ModuleReferenceHandle)scope).Name)}]{name}",
			_ => name,
		};
	}

	/// <summary>Any token an instruction, attribute or member list can hold, by name.</summary>
	public string Entity(EntityHandle handle)
	{
		switch (handle.Kind) {
			case HandleKind.TypeDefinition: return defs[(TypeDefinitionHandle)handle];
			case HandleKind.TypeReference: return Reference((TypeReferenceHandle)handle);
			case HandleKind.TypeSpecification: return md.GetTypeSpecification((TypeSpecificationHandle)handle).DecodeSignature(this, null);
			case HandleKind.MethodDefinition: return Method((MethodDefinitionHandle)handle);
			case HandleKind.FieldDefinition: {
				var field = md.GetFieldDefinition((FieldDefinitionHandle)handle);
				return $"{defs[field.GetDeclaringType()]}::{md.GetString(field.Name)}";
			}
			case HandleKind.MemberReference: {
				var member = md.GetMemberReference((MemberReferenceHandle)handle);
				var parent = Entity(member.Parent);
				var name = md.GetString(member.Name);
				return member.GetKind() == MemberReferenceKind.Method
					? $"{parent}::{name}{Signature(member.DecodeMethodSignature(this, null))}"
					: $"{parent}::{name} : {member.DecodeFieldSignature(this, null)}";
			}
			case HandleKind.MethodSpecification: {
				var spec = md.GetMethodSpecification((MethodSpecificationHandle)handle);
				return $"{Entity(spec.Method)}<{string.Join(", ", spec.DecodeSignature(this, null))}>";
			}
			case HandleKind.StandaloneSignature: {
				var signature = md.GetStandaloneSignature((StandaloneSignatureHandle)handle);
				return signature.GetKind() == StandaloneSignatureKind.Method
					? $"method {Signature(signature.DecodeMethodSignature(this, null))}"
					: $"locals({string.Join(", ", signature.DecodeLocalSignature(this, null))})";
			}
			case HandleKind.ModuleReference: return $".module {md.GetString(md.GetModuleReference((ModuleReferenceHandle)handle).Name)}";
			case HandleKind.AssemblyReference: return $"[{md.GetString(md.GetAssemblyReference((AssemblyReferenceHandle)handle).Name)}]";
			default: return $"<{handle.Kind}>";
		}
	}

	public string Method(MethodDefinitionHandle handle)
	{
		var method = md.GetMethodDefinition(handle);
		return $"{defs[method.GetDeclaringType()]}::{md.GetString(method.Name)}{Signature(method.DecodeSignature(this, null))}";
	}

	public static string Signature(MethodSignature<string> signature)
	{
		var header = signature.Header;
		var generic = signature.GenericParameterCount > 0 ? $"`{signature.GenericParameterCount}" : "";
		var parameters = signature.ParameterTypes.Select((p, i) => i == signature.RequiredParameterCount ? $"..., {p}" : p);
		return $"{generic}({string.Join(", ", parameters)}) : {signature.ReturnType} [{header.CallingConvention}{(header.IsInstance ? " instance" : "")}"
			+ $"{(header.HasExplicitThis ? " explicit" : "")}]";
	}

	/// <summary>A custom attribute: its constructor, its decoded value, and a hash of the exact blob.</summary>
	public string Attribute(CustomAttributeHandle handle)
	{
		var attribute = md.GetCustomAttribute(handle);
		var blob = md.GetBlobBytes(attribute.Value);
		string value;
		try {
			var decoded = attribute.DecodeValue(this);
			var named = decoded.NamedArguments.Select(a => $"{a.Kind} {a.Name}={Value(a.Value)}");
			value = string.Join(", ", decoded.FixedArguments.Select(a => Value(a.Value)).Concat(named));
		} catch (Exception) {
			value = Convert.ToHexString(blob);
		}
		return $"[{Entity(attribute.Constructor)}({value}) #{Hash(blob)}]";
	}

	static string Value(object? value) => value switch {
		null => "null",
		string text => $"\"{text}\"",
		ImmutableArray<CustomAttributeTypedArgument<string>> items => $"{{{string.Join(", ", items.Select(i => Value(i.Value)))}}}",
		_ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? "",
	};

	public static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes))[..16];

	public string Attributes(CustomAttributeHandleCollection handles) => string.Join(" ", handles.Select(Attribute));

	public string GetPrimitiveType(PrimitiveTypeCode typeCode) => typeCode.ToString().ToLowerInvariant();
	public string GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind) => defs[handle];
	public string GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind) => Reference(handle);
	public string GetTypeFromSpecification(MetadataReader reader, object? genericContext, TypeSpecificationHandle handle, byte rawTypeKind) =>
		md.GetTypeSpecification(handle).DecodeSignature(this, genericContext);
	public string GetSZArrayType(string elementType) => $"{elementType}[]";
	public string GetArrayType(string elementType, ArrayShape shape) =>
		$"{elementType}[{shape.Rank}; {string.Join(",", shape.Sizes)}; {string.Join(",", shape.LowerBounds)}]";
	public string GetByReferenceType(string elementType) => $"{elementType}&";
	public string GetPointerType(string elementType) => $"{elementType}*";
	public string GetGenericInstantiation(string genericType, ImmutableArray<string> typeArguments) => $"{genericType}<{string.Join(", ", typeArguments)}>";
	public string GetGenericTypeParameter(object? genericContext, int index) => $"!{index}";
	public string GetGenericMethodParameter(object? genericContext, int index) => $"!!{index}";
	public string GetFunctionPointerType(MethodSignature<string> signature) => $"method {Signature(signature)}";
	public string GetModifiedType(string modifier, string unmodifiedType, bool isRequired) =>
		$"{unmodifiedType} {(isRequired ? "modreq" : "modopt")}({modifier})";
	public string GetPinnedType(string elementType) => $"{elementType} pinned";
	public string GetSystemType() => "[System.Runtime]System.Type";
	public bool IsSystemType(string type) => type == "System.Type" || type.EndsWith("]System.Type", StringComparison.Ordinal);
	public string GetTypeFromSerializedName(string name) => name;

	/// <summary>An enum's underlying type: read from this assembly's own enums; others are assumed to be int (the blob hash keeps the comparison exact).</summary>
	public PrimitiveTypeCode GetUnderlyingEnumType(string type)
	{
		foreach (var (handle, name) in defs) {
			if (name != type) { continue; }
			foreach (var fieldHandle in md.GetTypeDefinition(handle).GetFields()) {
				var field = md.GetFieldDefinition(fieldHandle);
				if (md.GetString(field.Name) != "value__") { continue; }
				return field.DecodeSignature(this, null) switch {
					"byte" => PrimitiveTypeCode.Byte, "sbyte" => PrimitiveTypeCode.SByte, "int16" => PrimitiveTypeCode.Int16,
					"uint16" => PrimitiveTypeCode.UInt16, "uint32" => PrimitiveTypeCode.UInt32, "int64" => PrimitiveTypeCode.Int64,
					"uint64" => PrimitiveTypeCode.UInt64, "char" => PrimitiveTypeCode.Char, "boolean" => PrimitiveTypeCode.Boolean,
					_ => PrimitiveTypeCode.Int32,
				};
			}
		}
		return PrimitiveTypeCode.Int32;
	}
}
````

Create `resources/csast/DumpIl.cs`:

````cs
using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;

namespace Csast;

/// <summary>A method body as text: header, locals, exception regions and every instruction with its operand resolved to a name.</summary>
static class DumpIl
{
	static readonly Dictionary<short, OpCode> Codes = typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static)
		.Select(f => (OpCode)f.GetValue(null)!).ToDictionary(code => code.Value);

	public static void Body(List<string> lines, PEReader pe, MetadataReader md, DumpNames names, MethodDefinition method)
	{
		if (method.RelativeVirtualAddress == 0) { return; }
		var body = pe.GetMethodBody(method.RelativeVirtualAddress);
		var locals = body.LocalSignature.IsNil ? "" : names.Entity(body.LocalSignature);
		lines.Add($"      body maxstack={body.MaxStack} initlocals={body.LocalVariablesInitialized} {locals}");
		foreach (var region in body.ExceptionRegions) {
			var catchType = region.CatchType.IsNil ? "" : $" catch={names.Entity(region.CatchType)}";
			lines.Add($"      region {region.Kind} try={region.TryOffset}+{region.TryLength} handler={region.HandlerOffset}+{region.HandlerLength}"
				+ $" filter={region.FilterOffset}{catchType}");
		}
		var il = body.GetILReader();
		while (il.RemainingBytes > 0) {
			var offset = il.Offset;
			int first = il.ReadByte();
			var value = first == 0xFE ? (short)(0xFE00 | il.ReadByte()) : (short)first;
			lines.Add(Codes.TryGetValue(value, out var code)
				? $"      IL_{offset:x4} {code.Name}{Operand(ref il, code, md, names)}"
				: $"      IL_{offset:x4} ?{value:x4}");
		}
	}

	static string Operand(ref BlobReader il, OpCode code, MetadataReader md, DumpNames names)
	{
		switch (code.OperandType) {
			case OperandType.InlineNone: return "";
			case OperandType.ShortInlineBrTarget: return $" IL_{il.ReadSByte() + il.Offset:x4}";
			case OperandType.InlineBrTarget: return $" IL_{il.ReadInt32() + il.Offset:x4}";
			case OperandType.ShortInlineI: return code == OpCodes.Ldc_I4_S ? $" {il.ReadSByte()}" : $" {il.ReadByte()}";
			case OperandType.ShortInlineVar: return $" {il.ReadByte()}";
			case OperandType.InlineVar: return $" {il.ReadUInt16()}";
			case OperandType.InlineI: return $" {il.ReadInt32()}";
			case OperandType.InlineI8: return $" {il.ReadInt64()}";
			case OperandType.ShortInlineR: return $" {BitConverter.SingleToInt32Bits(il.ReadSingle()):x8}";
			case OperandType.InlineR: return $" {BitConverter.DoubleToInt64Bits(il.ReadDouble()):x16}";
			case OperandType.InlineString: {
				var text = md.GetUserString(MetadataTokens.UserStringHandle(il.ReadInt32() & 0xFFFFFF));
				return $" \"{text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r")}\"";
			}
			case OperandType.InlineSwitch: {
				var count = il.ReadInt32();
				var targets = new int[count];
				for (var i = 0; i < count; i++) { targets[i] = il.ReadInt32(); }
				var end = il.Offset;
				return $" ({string.Join(", ", targets.Select(t => $"IL_{t + end:x4}"))})";
			}
			default: return $" {names.Entity(MetadataTokens.EntityHandle(il.ReadInt32()))}";
		}
	}
}
````

Create `resources/csast/Dump.cs`:

````cs
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;

namespace Csast;

/// <summary>
/// Rule 6's dump: an assembly's metadata and IL as text, without loading it. Tokens are resolved to names, types are
/// sorted by name, anonymous types and delegates are named by shape, members of PrivateImplementationDetails are sorted;
/// the MVID, timestamps, debug data and the assembly's own version are left out. Nothing else is normalized.
/// </summary>
static class Dump
{
	public static List<string> Assembly(string file)
	{
		using var stream = File.OpenRead(file);
		using var pe = new PEReader(stream);
		var md = pe.GetMetadataReader();
		var names = new DumpNames(md);
		var lines = new List<string>();
		if (md.IsAssembly) {
			var assembly = md.GetAssemblyDefinition();
			lines.Add($"assembly {md.GetString(assembly.Name)} culture={md.GetString(assembly.Culture)} flags={assembly.Flags}"
				+ $" hash={assembly.HashAlgorithm} key={Convert.ToHexString(md.GetBlobBytes(assembly.PublicKey))}");
			foreach (var attribute in assembly.GetCustomAttributes()) { lines.Add($"  assembly-attribute {names.Attribute(attribute)}"); }
		}
		lines.Add($"module {md.GetString(md.GetModuleDefinition().Name)}");
		foreach (var attribute in md.GetCustomAttributes(EntityHandle.ModuleDefinition)) { lines.Add($"  module-attribute {names.Attribute(attribute)}"); }
		// Reference rows follow first use in compile order, so they are sorted like types.
		foreach (var reference in md.AssemblyReferences.Select(md.GetAssemblyReference).OrderBy(r => md.GetString(r.Name), StringComparer.Ordinal)) {
			lines.Add($"reference {md.GetString(reference.Name)} {reference.Version} culture={md.GetString(reference.Culture)} flags={reference.Flags}"
				+ $" key={Convert.ToHexString(md.GetBlobBytes(reference.PublicKeyOrToken))} {names.Attributes(reference.GetCustomAttributes())}");
		}
		foreach (var handle in md.ExportedTypes) {
			var exported = md.GetExportedType(handle);
			lines.Add($"exported {md.GetString(exported.Namespace)}.{md.GetString(exported.Name)} flags={exported.Attributes}"
				+ $" forwarder={exported.IsForwarder} in={names.Entity(exported.Implementation)}");
		}
		Resources(lines, pe, md);
		foreach (var (name, handle) in md.TypeDefinitions.Select(h => (names.Type(h), h)).OrderBy(t => t.Item1, StringComparer.Ordinal)) {
			Type(lines, pe, md, names, name, handle);
		}
		return lines;
	}

	static void Resources(List<string> lines, PEReader pe, MetadataReader md)
	{
		var directory = pe.PEHeaders.CorHeader?.ResourcesDirectory;
		foreach (var handle in md.ManifestResources) {
			var resource = md.GetManifestResource(handle);
			var hash = "external";
			if (resource.Implementation.IsNil && directory is { RelativeVirtualAddress: > 0 } dir) {
				var block = pe.GetSectionData(dir.RelativeVirtualAddress);
				var reader = block.GetReader((int)resource.Offset, block.Length - (int)resource.Offset);
				hash = DumpNames.Hash(reader.ReadBytes(reader.ReadInt32()));
			}
			lines.Add($"resource {md.GetString(resource.Name)} flags={resource.Attributes} {hash}");
		}
	}

	static void Type(List<string> lines, PEReader pe, MetadataReader md, DumpNames names, string name, TypeDefinitionHandle handle)
	{
		var type = md.GetTypeDefinition(handle);
		var layout = type.GetLayout();
		var baseType = type.BaseType.IsNil ? "" : names.Entity(type.BaseType);
		lines.Add($"type {name} flags={type.Attributes} base={baseType} layout={layout.PackingSize},{layout.Size}");
		GenericParameters(lines, md, names, type.GetGenericParameters(), "  ");
		foreach (var attribute in type.GetCustomAttributes()) { lines.Add($"  attribute {names.Attribute(attribute)}"); }
		foreach (var implHandle in type.GetInterfaceImplementations()) {
			var impl = md.GetInterfaceImplementation(implHandle);
			lines.Add($"  implements {names.Entity(impl.Interface)} {names.Attributes(impl.GetCustomAttributes())}");
		}
		foreach (var security in type.GetDeclarativeSecurityAttributes()) { lines.Add($"  {Security(md, security)}"); }
		foreach (var implHandle in type.GetMethodImplementations()) {
			var impl = md.GetMethodImplementation(implHandle);
			lines.Add($"  override {names.Entity(impl.MethodDeclaration)} with {names.Entity(impl.MethodBody)}");
		}
		var sorted = name == "<PrivateImplementationDetails>";
		var fields = type.GetFields().Select(md.GetFieldDefinition).ToList();
		var methods = type.GetMethods().Select(h => (h, md.GetMethodDefinition(h))).ToList();
		if (sorted) {
			fields = fields.OrderBy(f => md.GetString(f.Name), StringComparer.Ordinal).ToList();
			methods = methods.OrderBy(m => names.Method(m.h), StringComparer.Ordinal).ToList();
		}
		foreach (var field in fields) { Field(lines, pe, md, names, field); }
		foreach (var (methodHandle, method) in methods) { Method(lines, pe, md, names, methodHandle, method); }
		foreach (var propertyHandle in type.GetProperties()) {
			var property = md.GetPropertyDefinition(propertyHandle);
			var accessors = property.GetAccessors();
			lines.Add($"  property {md.GetString(property.Name)} flags={property.Attributes} {DumpNames.Signature(property.DecodeSignature(names, null))}"
				+ $" get={Accessor(names, accessors.Getter)} set={Accessor(names, accessors.Setter)} {Constant(md, property.GetDefaultValue())}"
				+ $" {string.Join(",", accessors.Others.Select(names.Method))} {names.Attributes(property.GetCustomAttributes())}");
		}
		foreach (var eventHandle in type.GetEvents()) {
			var ev = md.GetEventDefinition(eventHandle);
			var accessors = ev.GetAccessors();
			lines.Add($"  event {md.GetString(ev.Name)} flags={ev.Attributes} type={names.Entity(ev.Type)} add={Accessor(names, accessors.Adder)}"
				+ $" remove={Accessor(names, accessors.Remover)} raise={Accessor(names, accessors.Raiser)}"
				+ $" {string.Join(",", accessors.Others.Select(names.Method))} {names.Attributes(ev.GetCustomAttributes())}");
		}
	}

	static string Accessor(DumpNames names, MethodDefinitionHandle handle) => handle.IsNil ? "-" : names.Method(handle);

	static void GenericParameters(List<string> lines, MetadataReader md, DumpNames names, GenericParameterHandleCollection handles, string indent)
	{
		foreach (var handle in handles) {
			var parameter = md.GetGenericParameter(handle);
			var constraints = parameter.GetConstraints().Select(c => md.GetGenericParameterConstraint(c))
				.Select(c => $"{names.Entity(c.Type)} {names.Attributes(c.GetCustomAttributes())}".TrimEnd());
			lines.Add($"{indent}generic {parameter.Index} {md.GetString(parameter.Name)} flags={parameter.Attributes} where ({string.Join("; ", constraints)})"
				+ $" {names.Attributes(parameter.GetCustomAttributes())}");
		}
	}

	static string Constant(MetadataReader md, ConstantHandle handle)
	{
		if (handle.IsNil) { return ""; }
		var constant = md.GetConstant(handle);
		return $"const={constant.TypeCode}:{Convert.ToHexString(md.GetBlobBytes(constant.Value))}";
	}

	static string Security(MetadataReader md, DeclarativeSecurityAttributeHandle handle)
	{
		var security = md.GetDeclarativeSecurityAttribute(handle);
		return $"security {security.Action} {Convert.ToHexString(md.GetBlobBytes(security.PermissionSet))}";
	}

	static string Marshal(MetadataReader md, BlobHandle handle) => handle.IsNil ? "" : $"marshal={Convert.ToHexString(md.GetBlobBytes(handle))}";

	static void Field(List<string> lines, PEReader pe, MetadataReader md, DumpNames names, FieldDefinition field)
	{
		var rva = field.GetRelativeVirtualAddress();
		var data = rva == 0 ? "" : $"data={FieldData(pe, md, field, rva)}";
		lines.Add($"  field {md.GetString(field.Name)} flags={field.Attributes} : {field.DecodeSignature(names, null)} offset={field.GetOffset()}"
			+ $" {Constant(md, field.GetDefaultValue())} {Marshal(md, field.GetMarshallingDescriptor())} {data} {names.Attributes(field.GetCustomAttributes())}");
	}

	/// <summary>The hash of a field's initial data (array initializers); its size comes from the field's type.</summary>
	static string FieldData(PEReader pe, MetadataReader md, FieldDefinition field, int rva)
	{
		var reader = md.GetBlobReader(field.Signature);
		reader.ReadSignatureHeader();
		var code = reader.ReadSignatureTypeCode();
		var size = code switch {
			SignatureTypeCode.Boolean or SignatureTypeCode.SByte or SignatureTypeCode.Byte => 1,
			SignatureTypeCode.Char or SignatureTypeCode.Int16 or SignatureTypeCode.UInt16 => 2,
			SignatureTypeCode.Int32 or SignatureTypeCode.UInt32 or SignatureTypeCode.Single => 4,
			SignatureTypeCode.Int64 or SignatureTypeCode.UInt64 or SignatureTypeCode.Double => 8,
			_ => 0,
		};
		if (code == SignatureTypeCode.TypeHandle) {
			var typeHandle = reader.ReadTypeHandle();
			if (typeHandle.Kind == HandleKind.TypeDefinition) { size = md.GetTypeDefinition((TypeDefinitionHandle)typeHandle).GetLayout().Size; }
		}
		if (size <= 0) { return "unknown-size"; }
		var block = pe.GetSectionData(rva);
		return DumpNames.Hash(block.GetReader(0, Math.Min(size, block.Length)).ReadBytes(Math.Min(size, block.Length)));
	}

	static void Method(List<string> lines, PEReader pe, MetadataReader md, DumpNames names, MethodDefinitionHandle handle, MethodDefinition method)
	{
		lines.Add($"  method {names.Method(handle)} flags={method.Attributes} impl={method.ImplAttributes} {names.Attributes(method.GetCustomAttributes())}");
		GenericParameters(lines, md, names, method.GetGenericParameters(), "    ");
		foreach (var parameterHandle in method.GetParameters()) {
			var parameter = md.GetParameter(parameterHandle);
			lines.Add($"    param {parameter.SequenceNumber} {md.GetString(parameter.Name)} flags={parameter.Attributes} {Constant(md, parameter.GetDefaultValue())}"
				+ $" {Marshal(md, parameter.GetMarshallingDescriptor())} {names.Attributes(parameter.GetCustomAttributes())}");
		}
		var import = method.GetImport();
		if (!import.Name.IsNil) {
			lines.Add($"    pinvoke {md.GetString(import.Name)} from {names.Entity(import.Module)} flags={import.Attributes}");
		}
		foreach (var security in method.GetDeclarativeSecurityAttributes()) { lines.Add($"    {Security(md, security)}"); }
		DumpIl.Body(lines, pe, md, names, method);
	}
}
````

In `resources/csast/Program.cs`, replace:

````cs
using System.Globalization;
using System.Text.Json;
````

with:

````cs
using System.Globalization;
using System.Text;
using System.Text.Json;
````

In `resources/csast/Program.cs`, replace:

````cs
					return 0;
				case "cultures" when args.Length == 1:
````

with:

````cs
					return 0;
				case "dump" when args.Length == 2:
					var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { NewLine = "\n" };
					foreach (var line in Dump.Assembly(args[1])) { output.WriteLine(line.TrimEnd()); }
					output.Flush();
					return 0;
				case "cultures" when args.Length == 1:
````

In `resources/csast/Program.cs`, replace:

````cs
				default:
					Console.Error.WriteLine("usage: csast parse <file> | config <original> <candidate>… [--with <config file>…] | cultures");
					return 2;
````

with:

````cs
				default:
					Console.Error.WriteLine("usage: csast parse <file> | config <original> <candidate>… [--with <config file>…] | dump <assembly> | cultures");
					return 2;
````

In `src/aiready/csAst.ts`, replace:

````ts
	return JSON.parse(output) as Record<string, string | null>;
}
````

with:

````ts
	return JSON.parse(output) as Record<string, string | null>;
}

/** Rule 6's normalized dump of one assembly. */
export function csDump(tools: Pick<CsTools, 'dotnet' | 'helper'>, assembly: string): Promise<string> {
	return runHelper(tools, ['dump', assembly], path.dirname(assembly));
}
````

Create `src/aiready/csAssembly.ts`:

````ts
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import type { CheckResult } from './baseline';
import { csDump } from './csAst';
import type { CsTools } from './csTools';
import type { AssemblyCheck, CheckRunner } from './language';

/** One assembly a project builds: its target framework and TargetPath in the Debug configuration. */
export interface AssemblyTarget {
	readonly framework: string;
	readonly path: string;
}

/** A project as rule 6 needs it: its approved build command and what that command builds. */
export interface BuiltProject {
	readonly project: string;
	readonly build: string;
	readonly targets: readonly AssemblyTarget[];
}

/** What rule 6 needs from the adapter. */
export interface AssemblyDeps {
	readonly tools: Pick<CsTools, 'dotnet' | 'helper' | 'storageDir'>;
	readonly root: string;
	/** The project that compiles a file, once known. */
	readonly projectOf: (file: string) => BuiltProject | undefined;
	/** The project a build command builds. */
	readonly projectBuiltBy: (command: string) => BuiltProject | undefined;
}

type Dumps = Map<string, string[]>;

/** The first line where two dumps differ, with the type and member it belongs to; undefined when they are equal. */
export function firstDifference(before: readonly string[], after: readonly string[], hint: { original: string; files: readonly string[] }): string | undefined {
	const at = before.findIndex((line, i) => line !== after[i]);
	const index = at >= 0 ? at : before.length !== after.length ? Math.min(before.length, after.length) : -1;
	if (index < 0) { return undefined; }
	const owner = (lines: readonly string[]) => {
		const type = [...lines.slice(0, index + 1)].reverse().find(line => line.startsWith('type '));
		const member = [...lines.slice(0, index + 1)].reverse().find(line => /^ {2}(?:method|field|property|event) /.test(line));
		return [type, member].filter(Boolean).map(line => line!.trim().split(' flags=')[0]).join(', ');
	};
	const was = before[index] ?? '(end)';
	const now = after[index] ?? '(end)';
	const caller = was.includes(hint.original) && hint.files.some(file => now.includes(file))
		? ' (likely a [CallerFilePath] or [CallerLineNumber] argument, compiled in as a constant)' : '';
	return `in ${owner(before) || 'the assembly header'}: ${JSON.stringify(was.trim().slice(0, 200))} became ${JSON.stringify(now.trim().slice(0, 200))}${caller}`;
}

/**
 * Rule 6 (C#): the project's assembly, dumped by the helper for each target framework, must be the same before and
 * after a split. The reference is built at the last commit for every step (version stamps change per commit), and a
 * project whose two baseline builds differ (a time stamp, a random seed) is skipped for the run.
 */
export function csAssemblyCheck(deps: AssemblyDeps): AssemblyCheck {
	const records = path.join(deps.tools.storageDir, 'csast-runs', `${createHash('sha1').update(path.resolve(deps.root)).digest('hex').slice(0, 16)}.json`);
	const firstRound = new Map<string, Dumps>();
	const snapshots = new Map<string, Dumps>();
	const readRecords = (): Record<string, string> => {
		try {
			return JSON.parse(readFileSync(records, 'utf8')) as Record<string, string>;
		} catch {
			return {};
		}
	};
	const dumpAll = async (project: BuiltProject): Promise<Dumps | string> => {
		const dumps: Dumps = new Map();
		for (const target of project.targets) {
			if (!existsSync(target.path)) { return `${target.path} was not built`; }
			dumps.set(target.framework, (await csDump(deps.tools, target.path)).split('\n'));
		}
		return dumps;
	};
	const compareAll = (before: Dumps, after: Dumps, hint: { original: string; files: readonly string[] }): string | undefined => {
		for (const [framework, lines] of before) {
			const difference = firstDifference(lines, after.get(framework) ?? [], hint);
			if (difference) { return `${framework || 'the assembly'}: ${difference}`; }
		}
		return undefined;
	};
	return {
		async baseline(command: string, round: number, result: CheckResult) {
			const project = deps.projectBuiltBy(command);
			if (!project || result.code !== 0) { return; }
			const dumps = await dumpAll(project);
			if (round === 1) {
				firstRound.set(project.project, typeof dumps === 'string' ? new Map() : dumps);
				return;
			}
			const first = firstRound.get(project.project);
			const verdict = typeof dumps === 'string' || !first ? 'the baseline build could not be dumped'
				: compareAll(first, dumps, { original: '', files: [] }) ?? 'same';
			mkdirSync(path.dirname(records), { recursive: true });
			writeFileSync(records, JSON.stringify({ ...readRecords(), [project.project]: verdict }));
		},
		async snapshot(file: string, run: CheckRunner) {
			const project = deps.projectOf(file);
			if (!project) { return [`No project builds ${file}.`]; }
			const verdict = readRecords()[project.project];
			if (verdict !== 'same') {
				return [`Building ${project.project} twice at the same commit gave different assemblies (${verdict ?? 'it was not built in the baseline'}), `
					+ 'so the assembly check cannot prove its splits; they are skipped for this run.'];
			}
			const built = await run(project.build, 'build');
			if (built.code !== 0) { return [`\`${project.build}\` failed before the split.`]; }
			const dumps = await dumpAll(project);
			if (typeof dumps === 'string') { return [`Rule 6: ${dumps}.`]; }
			snapshots.set(file, dumps);
			return [];
		},
		async compare(file: string, newFiles: readonly string[]) {
			const project = deps.projectOf(file);
			const before = snapshots.get(file);
			snapshots.delete(file);
			if (!project || !before) { return [`Rule 6: no assembly was recorded for ${file} before the split.`]; }
			const after = await dumpAll(project);
			if (typeof after === 'string') { return [`Rule 6: ${after}.`]; }
			const difference = compareAll(before, after, { original: path.posix.basename(file), files: newFiles.map(f => path.posix.basename(f)) });
			return difference ? [`Rule 6: the compiled assembly differs for ${difference}.`] : [];
		},
	};
}
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/csTests.ts",
    "src/aiready/csHealth.ts"
  ]
````

with:

````json
    "src/aiready/csTests.ts",
    "src/aiready/csHealth.ts",
    "src/aiready/csAssembly.ts"
  ]
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 426
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add resources/csast/Dump.cs resources/csast/DumpIl.cs resources/csast/DumpNames.cs resources/csast/Program.cs src/aiready/csAssembly.ts src/aiready/csAst.ts test/csAssembly.test.ts tsconfig.test.json
git commit -m "C#: rule 6, the assembly dump"
```

## Chunk 8: The adapter

### Task 12: The C# adapter and its registration

**Files:**
- Create: `src/aiready/csAdapter.ts`, `src/aiready/csContext.ts`, `test/csAdapter.test.ts`, `test/csContext.test.ts`, `test/languages.test.ts`
- Modify: `src/aiready/languages.ts`, `tsconfig.test.json`

`csContext` gathers a file's place (folder, resources naming it, `.gitattributes`, symlink, project facts); `csAdapter` wires everything into `LanguageAdapter`; `languages.ts` registers C# after Go, TS/JS and Python, adds its markers, the language note, Unity and Godot, and lets a language name the findings a split fixes.

- [ ] **Step 1: Write the failing tests.**

Create `test/csContext.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { symlinkSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { builtProject, fileContext, folderEntries, projectOfFile, testTargets } from '../src/aiready/csContext';
import { csRepo } from '../src/aiready/csProject';
import { DOTNET, dotnetTools, library, repository, tracked } from './csFixture';

const CLASS = (name: string) => `namespace Lab;\n\npublic class ${name} { }\n`;

test('fileContext: the folder, a resource naming the file, linguist-generated, a symlink, and the project\'s facts', DOTNET, async () => {
	const tools = await dotnetTools();
	const root = repository({
		'App/App.csproj': library('', '    <EmbeddedResource Update="Resources/Strings.resx" DependentUpon="../Big.cs" />\n'),
		'App/Big.cs': CLASS('Big'), 'App/Other.cs': CLASS('Other'), 'App/Resources/Strings.resx': '<root />\n', 'App/Generated/Model.cs': CLASS('Model'),
		'.gitattributes': 'App/Generated/** linguist-generated\n',
	});
	symlinkSync(path.join(root, 'App', 'Other.cs'), path.join(root, 'App', 'Link.cs'));
	const repo = await csRepo(root, tools, tracked(root));
	const big = fileContext(root, repo, 'App/Big.cs');
	assert.deepEqual([[...big.entries].sort(), big.dependentUpon, big.linguistGenerated, big.symlink, big.projectSkip],
		[['App.csproj', 'Big.cs', 'Generated', 'Link.cs', 'Other.cs', 'Resources'], 'Resources/Strings.resx', false, false, undefined]);
	assert.equal(fileContext(root, repo, 'App/Generated/Model.cs').linguistGenerated, true);
	assert.equal(fileContext(root, repo, 'App/Link.cs').symlink, true);
	assert.equal(fileContext(root, repo, 'App/Other.cs').dependentUpon, undefined);
	assert.equal(fileContext(root, { ...repo, pathProblem: 'the path x has a space' }, 'App/Big.cs').projectSkip, 'the path x has a space');
	assert.equal(fileContext(root, { ...repo, scanning: 'App/Big.cs:1 uses x' }, 'App/Big.cs').scanning, 'App/Big.cs:1 uses x');
	assert.equal(fileContext(root, repo, 'Nowhere/X.cs').projectSkip, 'no tracked project compiles it');
	assert.deepEqual(folderEntries(root, 'Nowhere/X.cs'), []);
});

test('the project rule 6 builds, and the test assemblies a run reports on, by AssemblyName and framework', DOTNET, async () => {
	const tools = await dotnetTools();
	const specs = library('    <IsTestProject>true</IsTestProject>\n    <AssemblyName>Shop.Specs</AssemblyName>\n')
		.replace('<TargetFramework>net9.0</TargetFramework>', '<TargetFrameworks>net8.0;net9.0</TargetFrameworks>');
	const root = repository({ 'App/App.csproj': library(), 'App/Big.cs': CLASS('Big'), 'tests/Specs/Specs.csproj': specs, 'tests/Specs/T.cs': CLASS('T') });
	const repo = await csRepo(root, tools, tracked(root));
	const built = projectOfFile(repo, root, 'App/Big.cs')!;
	assert.equal(built.project, 'App/App.csproj');
	assert.match(built.build, /^dotnet build App\/App\.csproj --no-restore --no-incremental /);
	assert.deepEqual(built.targets.map(target => [target.framework, path.basename(target.path)]), [['net9.0', 'App.dll']]);
	assert.equal(projectOfFile(repo, root, 'Nowhere/X.cs'), undefined);
	assert.deepEqual(builtProject(repo.projects[0]), built);
	assert.deepEqual(testTargets(repo).map(target => `${target.label} ${target.assembly.split('/').slice(-4).join('/')}`),
		['Shop.Specs@net8.0 bin/Debug/net8.0/Shop.Specs.dll', 'Shop.Specs@net9.0 bin/Debug/net9.0/Shop.Specs.dll']);
});
````

Create `test/csAdapter.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CheckResult, flakyTests, runBaseline, runSetup } from '../src/aiready/baseline';
import { checkResult } from '../src/aiready/checkResult';
import { createCsAdapter } from '../src/aiready/csAdapter';
import type { CheckOptions, LanguageAdapter } from '../src/aiready/language';
import { emptyResults, readResults, runCommand } from '../src/aiready/projectCommands';
import { runSplit } from '../src/aiready/steps';
import { changedFiles, prepare, remove, trackedFiles } from '../src/aiready/worktree';
import { DOTNET, dotnetTools, library, repository, tracked } from './csFixture';

const BIG = 'namespace Shop;\n\n/// <summary>The big one.</summary>\npublic class Big\n{\n    public int Size => new Order().Lines.Count;\n}\n\n'
	+ '/// <summary>An order.</summary>\npublic class Order\n{\n    public System.Collections.Generic.List<Line> Lines { get; } = new();\n}\n\n'
	+ 'public record Line(string Sku, decimal Price);\n\npublic enum State { Open, Closed }\n';

test('adapter: commands are dotnet only, with the listed environment; nothing reaches git or a remote', DOTNET, async () => {
	const tools = await dotnetTools();
	const root = repository({ 'Shop.sln': '', 'src/Shop/Shop.csproj': library(), 'src/Shop/Big.cs': BIG });
	const adapter = createCsAdapter(root, tools, tracked(root));
	assert.throws(() => adapter.checks('src/Shop/Big.cs'), /The C# projects were not read yet/);
	await adapter.parse('src/Shop/Big.cs');
	const commands = [...adapter.setup!(), ...adapter.checks('src/Shop/Big.cs')];
	assert.deepEqual(commands.map(c => c.command), ['dotnet restore Shop.sln --disable-build-servers',
		'dotnet build src/Shop/Shop.csproj --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false']);
	assert.ok(commands.every(c => c.env === undefined && !/\bgit\b|push|fetch|remote/.test(c.command)));
	assert.deepEqual(Object.keys(adapter.commandEnv!).sort(), ['DOTNET_CLI_TELEMETRY_OPTOUT', 'DOTNET_CLI_UI_LANGUAGE', 'DOTNET_GENERATE_ASPNET_CERTIFICATE',
		'DOTNET_NOLOGO', 'DOTNET_SKIP_FIRST_TIME_EXPERIENCE', 'MSBUILDDISABLENODEREUSE']);
	assert.deepEqual([adapter.fixes, adapter.splitFindings, adapter.blankLines], [['split'], ['too-long', 'many-classes'], 'braces']);
	assert.match(adapter.installNote ?? '', /dotnet restore.*NuGet sources/);
});

test('adapter: a call the request delegate generator intercepts skips the file when Directory.Build.props turns it on', DOTNET, async () => {
	const tools = await dotnetTools();
	const routes = 'namespace Shop;\n\npublic static class Routes\n{\n    public static void Add(dynamic app) => app.MapGet("/", 1);\n}\n\n'
		+ 'public class Other { }\n';
	const props = '<Project>\n  <PropertyGroup>\n    <EnableRequestDelegateGenerator>true</EnableRequestDelegateGenerator>\n  </PropertyGroup>\n</Project>\n';
	const on = repository({ 'Directory.Build.props': props, 'Shop/Shop.csproj': library(), 'Shop/Routes.cs': routes });
	const info = await createCsAdapter(on, tools, tracked(on)).parse('Shop/Routes.cs');
	assert.equal(info.skip, 'it calls MapGet (line 5), which the ASP.NET Core request delegate generator intercepts by file and position');
	const off = repository({ 'Shop/Shop.csproj': library(), 'Shop/Routes.cs': routes });
	assert.equal((await createCsAdapter(off, tools, tracked(off)).parse('Shop/Routes.cs')).skip, undefined);
});

test('adapter: an .editorconfig section for one new name keeps that type in place', DOTNET, async () => {
	const tools = await dotnetTools();
	const editorconfig = 'root = true\n\n[Order.cs]\ndotnet_diagnostic.CA1822.severity = none\n';
	const root = repository({ '.editorconfig': editorconfig, 'Shop/Shop.csproj': library(), 'Shop/Big.cs': BIG });
	const adapter = createCsAdapter(root, tools, tracked(root));
	const info = await adapter.parse('Shop/Big.cs');
	assert.match(info.declarations.find(d => d.names[0] === 'Order')?.reason ?? '', /^no file name is free: Order\.cs: the editor config gives it other settings/);
	assert.deepEqual(adapter.plan!(info), [{ file: 'Line.cs', declarations: [2] }, { file: 'State.cs', declarations: [3] }]);
	assert.deepEqual(adapter.fileNameProblems('Order.cs', 'Shop/Big.cs').length, 1);
	assert.deepEqual(adapter.fileNameProblems('Nowhere.cs', 'Shop/Big.cs'), ['its editor settings were not checked']);
});

test('adapter: when CI runs dotnet format, a file the formatter would change is named', DOTNET, async () => {
	const tools = await dotnetTools();
	const bad = 'namespace Shop;\n\npublic class Bad {\n      public int X;  \n}\n';
	const root = repository({ '.github/workflows/ci.yml': 'steps:\n  - run: dotnet format --verify-no-changes\n', 'Shop/Shop.csproj': library(),
		'Shop/Big.cs': BIG, 'Shop/Bad.cs': bad });
	const adapter = createCsAdapter(root, tools, tracked(root));
	await adapter.parse('Shop/Big.cs');
	assert.deepEqual(await adapter.unformatted(['Shop/Big.cs', 'Shop/Bad.cs']), ['Shop/Bad.cs']);
	const quiet = repository({ 'Shop/Shop.csproj': library(), 'Shop/Bad.cs': bad });
	const unused = createCsAdapter(quiet, tools, tracked(quiet));
	await unused.parse('Shop/Bad.cs');
	assert.deepEqual(await unused.unformatted(['Shop/Bad.cs']), []);
});

/** Runs one approved command the way fixSetup's runCheck does, without VS Code. */
function runner(adapter: LanguageAdapter, worktree: string, approved: readonly string[]) {
	const logs = mkdtempSync(path.join(os.tmpdir(), 'my-editor-cssteps-logs-'));
	return async (command: string, label: string, _env?: unknown, options: CheckOptions = {}): Promise<CheckResult> => {
		const results = options.results && path.join(worktree, options.results);
		if (results) { emptyResults(results); }
		const logFile = path.join(logs, `${Date.now()}.log`);
		const output = await runCommand(command, { cwd: worktree, approved, timeoutMs: 600_000, env: adapter.commandEnv, logFile });
		return checkResult(command, label, output, adapter, { ...options, files: results ? readResults(results) : undefined });
	};
}

test('steps: a C# file is split one type per file by the host, checked by the build and the assembly dump, and committed', DOTNET, async () => {
	const tools = await dotnetTools();
	const root = repository({ 'Shop/Shop.csproj': library(), 'Shop/Big.cs': BIG });
	const wt = await prepare(root);
	const adapter = createCsAdapter(wt.path, tools, await trackedFiles(wt.path));
	const approved = [...adapter.setup!().map(c => c.command), 'dotnet build Shop/Shop.csproj --no-restore --no-incremental --disable-build-servers '
		+ '-nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false'];
	const check = runner(adapter, wt.path, approved);
	const progress = { cancelled: () => false, progress: () => undefined };
	assert.equal(await runSetup(adapter.setup!(), { check, ...progress }, () => changedFiles(wt.path), () => adapter.ready!()), undefined);
	await adapter.parse('Shop/Big.cs');
	const outcome = await runBaseline(adapter.checks('Shop/Big.cs'), { check, ...progress },
		(command, round, result) => adapter.assemblyCheck!.baseline(command, round, result));
	assert.ok('baseline' in outcome);
	const baseline = outcome.baseline;
	const flaky = Object.values(baseline).flatMap(([a, b]) => flakyTests(a.tests, b.tests));
	const ask = async (): Promise<string> => {
		throw new Error('the model must not be asked');
	};
	const ctx = { adapter, worktree: wt.path, baseline, flaky, check, ask, ...progress };
	const step = await runSplit(ctx, { file: 'Shop/Big.cs', kind: 'split', lines: 0 });
	assert.equal(step !== 'stopped' && step.status, 'committed', JSON.stringify(step));
	assert.deepEqual(step !== 'stopped' && step.moved, [{ file: 'Order.cs', names: ['Order'] }, { file: 'Line.cs', names: ['Line'] },
		{ file: 'State.cs', names: ['State'] }]);
	assert.equal(readFileSync(path.join(wt.path, 'Shop/Order.cs'), 'utf8'), '// Split from Big.cs by my_editor.\n\nnamespace Shop;\n\n'
		+ '/// <summary>An order.</summary>\npublic class Order\n{\n    public System.Collections.Generic.List<Line> Lines { get; } = new();\n}\n');
	assert.equal(readFileSync(path.join(wt.path, 'Shop/Big.cs'), 'utf8'), BIG.slice(0, BIG.indexOf('/// <summary>An order')).trimEnd() + '\n');
	writeFileSync(path.join(root, 'untouched.txt'), 'the user folder is not the worktree\n');
	await remove(root, wt.path);
});
````

Create `test/languages.test.ts`:

````ts
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { adapterFor, csharpProject, fixableFinding, gameEngineProblem, languageNote } from '../src/aiready/languages';
import { DOTNET, EXTENSION } from './csFixture';

function folder(files: Record<string, string>): string {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-languages-'));
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
		writeFileSync(path.join(root, name), text);
	}
	return root;
}

test('C# is found by a root solution or project, or a Directory.Build.props with a project below it', () => {
	assert.ok(csharpProject(folder({ 'Shop.sln': '' })) && csharpProject(folder({ 'Shop.slnx': '' })) && csharpProject(folder({ 'Shop.csproj': '' })));
	assert.ok(csharpProject(folder({ 'Directory.Build.props': '<Project />', 'src/Shop/Shop.csproj': '' })));
	assert.ok(!csharpProject(folder({ 'Directory.Build.props': '<Project />', 'node_modules/x/x.csproj': '' })));
	assert.ok(!csharpProject(folder({ 'src/Shop/Shop.csproj': '' })));
});

test('a mixed folder keeps the earlier language and names C# in the note; C# offers a split for many-classes too', () => {
	assert.equal(languageNote(folder({ 'package.json': '{}', 'Shop.sln': '' })),
		'This folder has both TypeScript/JavaScript and C# in its top folder; TypeScript/JavaScript is chosen, so only TypeScript/JavaScript files are offered.');
	assert.equal(languageNote(folder({ 'Shop.sln': '' })), undefined);
	assert.ok(fixableFinding('Shop/Big.cs', 'too-long') && fixableFinding('Shop/Big.cs', 'many-classes'));
	assert.ok(!fixableFinding('Shop/Big.cs', 'untested') && !fixableFinding('src/a.ts', 'many-classes') && !fixableFinding('a.go', 'many-classes'));
});

test('Unity and Godot stop the run with a plain message', () => {
	assert.match(gameEngineProblem(folder({ 'project.godot': '', 'Game.csproj': '' })) ?? '', /^This is a Godot project/);
	assert.match(gameEngineProblem(folder({ 'Game.csproj': '<Project Sdk="Godot.NET.Sdk/4.3.0">' })) ?? '', /^This is a Godot project/);
	const unity = folder({ 'ProjectSettings/ProjectVersion.txt': '', 'Assets/A.cs.meta': '', 'Game.sln': '' });
	assert.match(gameEngineProblem(unity) ?? '', /^This is a Unity project/);
	assert.equal(gameEngineProblem(folder({ 'Shop.sln': '' })), undefined);
});

test('adapterFor: a C# folder gets the C# adapter; a folder with no known marker gets the list of languages', DOTNET, async () => {
	const none = await adapterFor(folder({ 'README.md': '' }), { extensionPath: EXTENSION, storageDir: folder({}), version: 'test', appRoot: '' });
	assert.match(String(none), /Go, TypeScript, JavaScript, Python and C# projects .*`manage\.py` in the top folder, or a `\.sln`, `\.slnx` or `\.csproj`\)\./);
	assert.match(String(none), /Rust and C\/C\+\+ come next\.$/);
	const storageDir = path.join(os.tmpdir(), 'my-editor-csast-cache');
	const factory = await adapterFor(folder({ 'Shop.sln': '' }), { extensionPath: EXTENSION, storageDir, version: 'test', appRoot: '' });
	assert.equal(typeof factory, 'function');
	const missing = await adapterFor(folder({ 'Shop.sln': '', 'global.json': '{ "sdk": { "version": "1.0.100", "rollForward": "disable" } }' }),
		{ extensionPath: EXTENSION, storageDir, version: 'test', appRoot: '' });
	assert.match(String(missing), /^`dotnet --version` failed in this folder: .*Requested SDK version: 1\.0\.100/);
});
````

- [ ] **Step 2: Run them to see them fail.**

Run: `npm test 2>&1 | grep -m1 'error TS'`

Expected:

```text
test/csAdapter.test.ts(8,33): error TS2307: Cannot find module '../src/aiready/csAdapter' or its corresponding type declarations.
```

- [ ] **Step 3: Implement.**

Create `src/aiready/csContext.ts`:

````ts
import { lstatSync, readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import type { BuiltProject } from './csAssembly';
import { samePath } from './csEval';
import { buildCheck, CsProjectFacts, CsRepo, ownerOf } from './csProject';
import type { CsFileContext } from './csRules';
import { linguistGenerated } from './csScan';
import type { TestTarget } from './csTests';

/** Names in a file's folder (empty when it cannot be read). */
export function folderEntries(root: string, file: string): string[] {
	try {
		return readdirSync(path.join(root, path.posix.dirname(file)));
	} catch {
		return [];
	}
}

function isSymlink(file: string): boolean {
	try {
		return lstatSync(file).isSymbolicLink();
	} catch {
		return false;
	}
}

function readText(file: string): string {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		return '';
	}
}

/** The resource whose `DependentUpon` names this file, in any project, configuration and target framework. */
function namedByResource(repo: CsRepo, full: string): string | undefined {
	for (const project of repo.projects) {
		for (const item of project.evaluation.pairs.flatMap(pair => pair.items.EmbeddedResource)) {
			if (item.dependentUpon && samePath(path.resolve(path.dirname(item.path), item.dependentUpon), full)) { return item.identity; }
		}
	}
	return undefined;
}

/** What the rules need to know about a file's place: its project's facts, its folder, its resources and attributes. */
export function fileContext(root: string, repo: CsRepo, file: string): CsFileContext {
	const full = path.join(root, file);
	const owner = ownerOf(repo, root, file);
	const project = typeof owner === 'string' ? undefined : owner;
	const projectSkip = repo.pathProblem ?? (typeof owner === 'string' ? owner : owner.skip);
	const dependentUpon = namedByResource(repo, full);
	return {
		entries: folderEntries(root, file), interceptors: project?.interceptors ?? { rdg: false, binder: false }, symlink: isSymlink(full),
		linguistGenerated: linguistGenerated(readText(path.join(root, '.gitattributes')), file), unusedUsings: project?.unusedUsings ?? false,
		...(projectSkip ? { projectSkip } : {}), ...(dependentUpon ? { dependentUpon } : {}), ...(repo.scanning ? { scanning: repo.scanning } : {}),
	};
}

/** The Debug assemblies a project builds, one per target framework. */
function debugTargets(project: CsProjectFacts): { framework: string; path: string }[] {
	return project.evaluation.pairs.filter(pair => pair.configuration === 'Debug' && pair.properties.TargetPath)
		.map(pair => ({ framework: pair.framework, path: pair.properties.TargetPath }));
}

/** A project as rule 6 sees it: its build command and its assemblies. */
export function builtProject(project: CsProjectFacts): BuiltProject {
	return { project: project.path, build: buildCheck(project.path).command, targets: debugTargets(project) };
}

/** The project that compiles a file, as rule 6 sees it. */
export function projectOfFile(repo: CsRepo, root: string, file: string): BuiltProject | undefined {
	const owner = ownerOf(repo, root, file);
	return typeof owner === 'string' ? undefined : builtProject(owner);
}

/** The test assemblies a test run should report on: `<AssemblyName>@<framework>` for each test project's Debug build. */
export function testTargets(repo: CsRepo): TestTarget[] {
	return repo.projects.filter(p => p.test).flatMap(project => debugTargets(project).map(target => ({
		label: `${project.evaluation.pairs[0]?.properties.AssemblyName || path.posix.basename(project.path, '.csproj')}@${target.framework || 'default'}`,
		assembly: target.path,
	})));
}
````

Create `src/aiready/csAdapter.ts`:

````ts
import { readFileSync, realpathSync } from 'fs';
import * as path from 'path';
import { csAssemblyCheck } from './csAssembly';
import { csConfig, csFileFacts } from './csAst';
import { builtProject, fileContext, folderEntries, projectOfFile, testTargets } from './csContext';
import { evaluateProject, mapLimit, membership, samePath } from './csEval';
import { csImportProblems, csSameDeclarations } from './csMoveCheck';
import { buildCheck, csRepo, CsRepo, ownerOf, readyProblem, restoreChecks, restoreStamp, testChecks } from './csProject';
import { candidateNames, CsFileInfo, csFileInfoView, csFileNameProblems, csPlan, csSkipReason } from './csRules';
import { whitespaceProblems } from './csScan';
import { buildCsSplit, csSplitHeader } from './csSplit';
import { parseTrx } from './csTests';
import { CsTools, DOTNET_ENV } from './csTools';
import type { LanguageAdapter, LanguageInfo } from './language';
import { runTool } from './projectCommands';

/** C# as the core sees it before an adapter exists. */
export const CS_LANGUAGE: LanguageInfo = {
	label: 'C#', extensions: ['.cs'], fixes: ['split'], splitFindings: ['too-long', 'many-classes'],
	mayDiffer: 'Moved types keep their namespace, name and assembly; the assembly check compared the compiled metadata and IL before and after each split. '
		+ 'What may still differ: the order of `Assembly.GetTypes()`, `DefinedTypes` and anything built from it (in projects that scan their assembly, '
		+ 'only types a scanner would not select moved), anonymous type names such as `<>f__AnonymousType1`, `MemberInfo.MetadataToken` values, file '
		+ 'names and line numbers in stack traces and the debugger, the order of the XML documentation file and of generated OpenAPI operations, '
		+ 'and the order in which test frameworks find test classes. Release builds were not compared, only Debug; the branch may also have been '
		+ 'built with newer package versions than your folder when the project uses floating versions.',
};

const INSTALL = 'my_editor runs `dotnet restore` once. It may download packages from the NuGet sources this repository configures (or your default '
	+ 'ones) into your NuGet packages folder, and building runs MSBuild targets that come with those packages, as your own builds do. ';
const UNSUPPORTED = 'C# has no add-tests fix yet.';

/**
 * The C# language adapter for one root (the user's folder for the picker, the worktree for fixes). MSBuild evaluation
 * is read once, by the first async call (`parse` or `ready`); the host plans every split (one type per file) and
 * proves it with the move check and the assembly dump.
 */
export function createCsAdapter(root: string, tools: CsTools, tracked: readonly string[]): LanguageAdapter {
	let repo: CsRepo | undefined;
	let loading: Promise<CsRepo> | undefined;
	const load = () => (loading ??= csRepo(root, tools, tracked).then(read => (repo = read)));
	const known = (): CsRepo => {
		if (!repo) { throw new Error('The C# projects were not read yet.'); }
		return repo;
	};
	const settings = new Map<string, string | null>();
	const facts = new Map<string, CsFileInfo>();
	// MSBuild lists config files under their real path (/private/var/… on macOS), and Roslyn matches sections by path prefix.
	const realPath = (file: string, name = path.posix.basename(file)) => path.join(realpathSync(path.join(root, path.posix.dirname(file))), name);
	const settingsProblems = (name: string, original: string): string[] => {
		const checked = settings.get(realPath(original, name));
		if (checked === undefined) { return ['its editor settings were not checked']; }
		return checked ? [`the editor config gives it other settings than the original (${checked})`] : [];
	};
	const checkSettings = async (file: string, names: readonly string[], project: string | undefined) => {
		const pairs = known().projects.find(p => p.path === project)?.evaluation.pairs ?? [];
		const configs = [...new Set(pairs.flatMap(pair => [...pair.items.EditorConfigFiles, ...pair.items.GlobalAnalyzerConfigFiles]).map(item => item.path))];
		const candidates = names.map(name => realPath(file, name));
		const result = names.length ? await csConfig(tools, realPath(file), candidates, configs) : {};
		candidates.forEach(candidate => settings.set(candidate, result[candidate] ?? null));
	};
	return {
		id: 'cs', ...CS_LANGUAGE, commandEnv: DOTNET_ENV, blankLines: 'braces', installNote: INSTALL,
		async parse(file) {
			const read = await load();
			const parsed = await csFileFacts(tools, path.join(root, file));
			const ctx = fileContext(root, read, file);
			const skip = csSkipReason(file, parsed, ctx);
			if (!skip) {
				const owner = ownerOf(read, root, file);
				await checkSettings(file, parsed.types.flatMap(candidateNames), typeof owner === 'string' ? undefined : owner.path);
			}
			const info = csFileInfoView(file, parsed, ctx, skip, name => (skip ? [] : settingsProblems(name, file)));
			facts.set(file, info);
			return info;
		},
		plan: info => csPlan(info as CsFileInfo),
		fileNameProblems: (name, original) => [...csFileNameProblems(name, folderEntries(root, original)), ...settingsProblems(name, original)],
		splitHeader(file) {
			const info = facts.get(file);
			if (!info) { throw new Error(`${file} was not parsed before its split.`); }
			return csSplitHeader(file, readFileSync(path.join(root, file)), info.facts);
		},
		buildSplit: (source, info, plan) => buildCsSplit(source, info as CsFileInfo, plan),
		importProblems: csImportProblems,
		sameDeclarations: csSameDeclarations,
		async membershipProblems(file, newFiles) {
			const owner = ownerOf(known(), root, file);
			if (typeof owner === 'string') { return [`Rule 4: ${owner}.`]; }
			const evaluations = await mapLimit(tracked.filter(f => f.endsWith('.csproj')), 2, project => evaluateProject(tools, root, project));
			return membership(evaluations, owner.path, newFiles.map(name => ({ name, path: path.join(root, name) })));
		},
		async unitFiles(file) {
			const dir = path.posix.dirname(file);
			const untracked = folderEntries(root, file).filter(name => name.endsWith('.cs')).map(name => (dir === '.' ? name : `${dir}/${name}`))
				.filter(name => name !== file && !tracked.includes(name));
			return [file, ...untracked];
		},
		async unformatted(files) {
			if (!files.length || !known().formatUsed) { return []; }
			const result = await runTool(tools.dotnet, ['format', 'whitespace', '--folder', '--verify-no-changes', '--include', ...files], root, DOTNET_ENV);
			const named = whitespaceProblems(`${result.stdout}\n${result.stderr}`).map(name => path.resolve(root, name));
			return files.filter(file => named.some(name => samePath(name, path.join(root, file))));
		},
		checks(file) {
			const owner = ownerOf(known(), root, file);
			return typeof owner === 'string' ? [] : [buildCheck(owner.path), ...testChecks(known())];
		},
		setup: () => restoreChecks(tracked),
		ready: async () => readyProblem(await load()),
		setupStamp: () => (repo ? restoreStamp(repo) : undefined),
		parseTests: (_output, files) => (repo && !repo.mtp && files ? parseTrx(files, testTargets(repo)) : undefined),
		assemblyCheck: csAssemblyCheck({
			tools, root, projectOf: file => projectOfFile(known(), root, file),
			projectBuiltBy: command => known().projects.map(builtProject).find(project => project.build === command),
		}),
		testFileName: file => file.replace(/\.cs$/, 'Tests.cs'),
		testNames: () => [],
		testProblems: () => [UNSUPPORTED],
		splitPrompt: () => ({ system: UNSUPPORTED, text: 'The host plans C# splits; the model is not asked.' }),
		testPrompt: () => ({ system: UNSUPPORTED, text: UNSUPPORTED }),
	};
}
````

In `src/aiready/languages.ts`, replace:

````ts
import { existsSync, readdirSync } from 'fs';
import * as path from 'path';
import { createGoAdapter, GO_LANGUAGE, goTools, goVersionProblem } from './goAdapter';
````

with:

````ts
import { Dirent, existsSync, readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { createCsAdapter, CS_LANGUAGE } from './csAdapter';
import { csTools, sdkProblem } from './csTools';
import { createGoAdapter, GO_LANGUAGE, goTools, goVersionProblem } from './goAdapter';
````

In `src/aiready/languages.ts`, replace:

````ts
/** Every language with an adapter, in the order a folder's language is chosen. */
const LANGUAGES = [GO_LANGUAGE, TS_LANGUAGE, PY_LANGUAGE];
const TS_MARKERS = ['package.json', 'tsconfig.json', 'jsconfig.json'];
````

with:

````ts
/** Every language with an adapter, in the order a folder's language is chosen. */
const LANGUAGES = [GO_LANGUAGE, TS_LANGUAGE, PY_LANGUAGE, CS_LANGUAGE];
const TS_MARKERS = ['package.json', 'tsconfig.json', 'jsconfig.json'];
````

In `src/aiready/languages.ts`, replace:

````ts

/** Whether a health finding has a fix on a branch, from the adapters' extensions and fix kinds. */
export function fixableFinding(file: string, kind: string): boolean {
	const fix = kind === 'too-long' ? 'split' : kind === 'untested' ? 'tests' : undefined;
	return !!fix && LANGUAGES.some(language => language.extensions.includes(path.extname(file)) && language.fixes.includes(fix));
}
````

with:

````ts

const SKIPPED_DIRS = new Set(['node_modules', 'bin', 'obj', 'artifacts', 'packages']);

/** Whether a folder holds a `.csproj` at most `depth` levels down (hidden and build folders skipped). */
function hasProject(dir: string, depth: number): boolean {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return false;
	}
	if (entries.some(entry => entry.isFile() && entry.name.endsWith('.csproj'))) { return true; }
	return depth > 0 && entries.some(entry => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name)
		&& hasProject(path.join(dir, entry.name), depth - 1));
}

/** Whether the top folder looks like a C# project: a `.sln`, `.slnx` or `.csproj`, or a `Directory.Build.props` with a `.csproj` below it. */
export function csharpProject(root: string): boolean {
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		return false;
	}
	return names.some(name => /\.(?:sln|slnx|csproj)$/.test(name)) || (names.includes('Directory.Build.props') && hasProject(root, 4));
}

/** Unity and Godot bind scripts to files by path or GUID, so a C# run stops there with a plain message. */
export function gameEngineProblem(root: string): string | undefined {
	const godot = existsSync(path.join(root, 'project.godot')) || readdirSync(root).filter(name => name.endsWith('.csproj'))
		.some(name => readFileSync(path.join(root, name), 'utf8').includes('Godot.NET.Sdk'));
	if (godot) { return 'This is a Godot project. Godot binds scripts to files by path, so my_editor does not split its C# files.'; }
	if (existsSync(path.join(root, 'ProjectSettings')) && existsSync(path.join(root, 'Assets'))) {
		return 'This is a Unity project. Unity binds scripts to files by path and GUID, so my_editor does not split its C# files.';
	}
	return undefined;
}

/** Whether a health finding has a fix on a branch, from the adapters' extensions, fix kinds and the findings a split fixes. */
export function fixableFinding(file: string, kind: string): boolean {
	return LANGUAGES.some(language => language.extensions.includes(path.extname(file)) && (kind === 'untested'
		? language.fixes.includes('tests') : language.fixes.includes('split') && (language.splitFindings ?? ['too-long']).includes(kind)));
}
````

In `src/aiready/languages.ts`, replace:

````ts
	const found = [existsSync(path.join(root, 'go.mod')) && GO_LANGUAGE, TS_MARKERS.some(name => existsSync(path.join(root, name))) && TS_LANGUAGE,
		pythonProject(root) && PY_LANGUAGE].filter((l): l is LanguageInfo => !!l).map(l => l.label);
	if (found.length < 2) { return undefined; }
````

with:

````ts
	const found = [existsSync(path.join(root, 'go.mod')) && GO_LANGUAGE, TS_MARKERS.some(name => existsSync(path.join(root, name))) && TS_LANGUAGE,
		pythonProject(root) && PY_LANGUAGE, csharpProject(root) && CS_LANGUAGE].filter((l): l is LanguageInfo => !!l).map(l => l.label);
	if (found.length < 2) { return undefined; }
````

In `src/aiready/languages.ts`, replace:

````ts
/**
 * The adapter for the project's language, or a plain message. Go, TS/JS and Python so far (a mixed repository keeps that
 * order); C#, Rust and C/C++ follow, each in its own `<language>Adapter.ts` registered here.
 */
````

with:

````ts
/**
 * The adapter for the project's language, or a plain message. Go, TS/JS, Python and C# so far (a mixed repository keeps
 * that order); Rust and C/C++ follow, each in its own `<language>Adapter.ts` registered here.
 */
````

In `src/aiready/languages.ts`, replace:

````ts
	}
	return 'Fixing on a branch works for Go, TypeScript, JavaScript and Python projects (a `go.mod`, `package.json`, `tsconfig.json`, '
		+ '`pyproject.toml`, `setup.py`, `setup.cfg`, `requirements.txt`, `Pipfile` or `manage.py` in the top folder). C#, Rust and C/C++ come next.';
}
````

with:

````ts
	}
	if (csharpProject(root)) {
		const engine = gameEngineProblem(root);
		if (engine) { return engine; }
		const tools = await csTools(host.extensionPath, host.storageDir, host.version);
		if (typeof tools === 'string') { return tools; }
		return await sdkProblem(tools.dotnet, root) ?? ((dir, tracked) => createCsAdapter(dir, tools, tracked));
	}
	return 'Fixing on a branch works for Go, TypeScript, JavaScript, Python and C# projects (a `go.mod`, `package.json`, `tsconfig.json`, '
		+ '`pyproject.toml`, `setup.py`, `setup.cfg`, `requirements.txt`, `Pipfile` or `manage.py` in the top folder, or a `.sln`, `.slnx` or `.csproj`). '
		+ 'Rust and C/C++ come next.';
}
````

In `tsconfig.test.json`, replace:

````json
    "src/aiready/csHealth.ts",
    "src/aiready/csAssembly.ts"
  ]
````

with:

````json
    "src/aiready/csHealth.ts",
    "src/aiready/csAssembly.ts",
    "src/aiready/csContext.ts",
    "src/aiready/csAdapter.ts"
  ]
````

- [ ] **Step 4: Run the tests.**

Run: `npm test 2>&1 | grep '^ℹ \(pass\|fail\)'`

Expected:

```text
ℹ pass 437
ℹ fail 0
```

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/csAdapter.ts src/aiready/csContext.ts src/aiready/languages.ts test/csAdapter.test.ts test/csContext.test.ts test/languages.test.ts tsconfig.test.json
git commit -m "C#: the adapter, registered after Python"
```

## Chunk 9: Dry run on fixture projects, and verification

### Task 13: The whole pipeline without VS Code

**Files:** none in the repository. Everything runs in a scratch folder on generated fixture repositories, offline (`nuget.config` clears every package source); the host plans, so no model is involved.

Three repositories, each a Git repository with one commit: **plain** (a solution and a class library whose `src/Shop/Models.cs` has 614 lines and 11 types: a static entry class, records, a record struct, an enum, an interface, a delegate, three 190-line service classes and a class with anonymous types, an anonymous delegate with a default value and a lambda), **scanner** (the same file plus a line calling `typeof(Models).Assembly.GetTypes()`, and `Discounts` implementing `IComparable<Discounts>`; found as C# through its `Directory.Build.props`), and **refuse** (three projects: `Big.cs` like Models.cs, `Form1.cs` beside `Form1.resx`, `#if` in `Platform.cs`, only `partial` types in `Parts.cs`, a moved caller of a `[CallerFilePath]` method in `Caller.cs`, a project whose build writes `DateTime.Now` into a generated file, and a project with `Strings.de.resx`). No test framework was available offline, so these projects have no tests and no test command.

- [ ] **Step 1: Write the scripts and generate the fixtures.**

```bash
EXT=$PWD   # overlay/extensions/my-editor-core
W=$(mktemp -d) && mkdir -p "$W/check/logs" && cd "$W/check"
export EXT
(cd "$EXT" && npm test >/dev/null 2>&1)             # fills out-test/ with the compiled modules
```

Create `$W/check/gen-fixtures.js`:

````js
// Writes the dry-run fixture repositories (each a Git repository with one commit and a nuget.config that clears every
// package source, so restores stay offline). Usage: node gen-fixtures.js <out folder>
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const out = path.resolve(process.argv[2]);
const NUGET = '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n    <clear />\n  </packageSources>\n</configuration>\n';
const LIB = (extra = '') => `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net9.0</TargetFramework>\n    <Nullable>enable</Nullable>\n`
	+ `    <ImplicitUsings>enable</ImplicitUsings>\n${extra}  </PropertyGroup>\n</Project>\n`;
const methods = (type, n) => Array.from({ length: n }, (_, i) => `    /// <summary>Rule ${i} of ${type}.</summary>\n    public decimal Rule${i}(decimal amount)\n    {\n`
	+ `        var scaled = amount * ${i + 1}m;\n        return scaled > Limit ? Limit : scaled;\n    }\n`).join('\n');
const service = (name, n) => `/// <summary>The ${name} service.</summary>\npublic sealed class ${name}\n{\n    private const decimal Limit = 1000m;\n\n${methods(name, n)}}\n`;
const MODELS = `// Copyright (c) Acme Shop. Licensed under the MIT license.\n\nusing System.Text;\n\nnamespace Shop.Models;\n\n`
	+ `/// <summary>The models' entry point.</summary>\npublic static class Models\n{\n    public static string Describe(Order order) => new StringBuilder().Append(order.Id).ToString();\n}\n\n`
	+ `/// <summary>An order.</summary>\npublic record Order(int Id, IReadOnlyList<Line> Lines, State State);\n\n`
	+ `/// <summary>One line of an order.</summary>\npublic record Line(string Sku, int Quantity, decimal Price);\n\n`
	+ `/// <summary>Where an order is.</summary>\npublic enum State\n{\n    Open,\n    Paid,\n    Shipped,\n}\n\n`
	+ `/// <summary>Prices things.</summary>\npublic interface IPricing\n{\n    decimal Price(Line line);\n}\n\n`
	+ `/// <summary>Raised when an order changes.</summary>\npublic delegate void OrderChanged(Order order);\n\n`
	+ `/// <summary>Money with a currency.</summary>\npublic readonly record struct Money(decimal Amount, string Currency);\n\n`
	+ `${service('Discounts', 26)}\n${service('Taxes', 26)}\n${service('Shipping', 26)}\n`
	+ `/// <summary>Anonymous shapes and lambdas, as the assembly check's probe had them.</summary>\npublic static class Shapes\n{\n`
	+ `    private static readonly Func<int, int> Twice = x => x * 2;\n\n    public static string Shape()\n    {\n        var o = new { C = 1, D = "d" };\n`
	+ `        var d = (int a = 3) => a;\n        return o.GetType().Name + Twice(d());\n    }\n}\n`;
const GUID = '{6F1B8D7E-0B4C-4C55-9E2A-1F7B3D2C1A01}';
const SLN = 'Microsoft Visual Studio Solution File, Format Version 12.00\n# Visual Studio Version 17\nVisualStudioVersion = 17.0.31903.59\n'
	+ 'MinimumVisualStudioVersion = 10.0.40219.1\n'
	+ `Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Shop", "src\\Shop\\Shop.csproj", "${GUID}"\nEndProject\nGlobal\n`
	+ '\tGlobalSection(SolutionConfigurationPlatforms) = preSolution\n\t\tDebug|Any CPU = Debug|Any CPU\n\t\tRelease|Any CPU = Release|Any CPU\n\tEndGlobalSection\n'
	+ '\tGlobalSection(ProjectConfigurationPlatforms) = postSolution\n'
	+ ['Debug', 'Release'].map(c => `\t\t${GUID}.${c}|Any CPU.ActiveCfg = ${c}|Any CPU\n\t\t${GUID}.${c}|Any CPU.Build.0 = ${c}|Any CPU\n`).join('')
	+ '\tEndGlobalSection\nEndGlobal\n';
function repo(name, files) {
	const root = path.join(out, name);
	for (const [file, text] of Object.entries({ 'nuget.config': NUGET, '.gitignore': 'bin/\nobj/\n.my_editor/\n', ...files })) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), text);
	}
	const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	git('init', '--quiet');
	git('config', 'user.email', 'dry@example.com');
	git('config', 'user.name', 'Dry Run');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	const lines = Object.entries(files).filter(([f]) => f.endsWith('.cs')).map(([f, t]) => `${f} ${t.split('\n').length - 1}`);
	console.log(`${name}: ${lines.join(', ')}`);
}
repo('plain', { 'Shop.sln': SLN, 'src/Shop/Shop.csproj': LIB(), 'src/Shop/Models.cs': MODELS });
repo('scanner', { 'Directory.Build.props': '<Project />\n', 'src/Shop/Shop.csproj': LIB(), 'src/Shop/Models.cs': MODELS.replace('public static string Describe(Order order) =>',
	'public static Type[] All() => typeof(Models).Assembly.GetTypes();\n\n    public static string Describe(Order order) =>')
	.replace('public sealed class Discounts', 'public sealed class Discounts : IComparable<Discounts>').replace('    private const decimal Limit = 1000m;\n\n    /// <summary>Rule 0 of Discounts',
		'    private const decimal Limit = 1000m;\n\n    public int CompareTo(Discounts? other) => 0;\n\n    /// <summary>Rule 0 of Discounts') });
const RESX = '<?xml version="1.0" encoding="utf-8"?>\n<root>\n  <resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>\n'
	+ '  <resheader name="version"><value>2.0</value></resheader>\n  <data name="Hello" xml:space="preserve"><value>Hi</value></data>\n</root>\n';
const CALLER = 'namespace Shop;\n\npublic static class Log\n{\n    public static string Where([System.Runtime.CompilerServices.CallerFilePath] string file = "") => file;\n}\n\n'
	+ 'public class User\n{\n    public string Origin() => Log.Where();\n}\n';
repo('refuse', {
	'Directory.Build.props': '<Project />\n',
	'src/Shop/Shop.csproj': LIB(), 'src/Shop/Big.cs': MODELS, 'src/Shop/Form1.cs': 'namespace Shop;\n\npublic class Form1 { }\n\npublic class Helper { }\n',
	'src/Shop/Form1.resx': RESX, 'src/Shop/Platform.cs': 'namespace Shop;\n\n#if DEBUG\npublic class DebugOnly { }\n#endif\n\npublic class Always { }\n',
	'src/Shop/Parts.cs': 'namespace Shop;\n\npublic partial class Parts { }\n\npublic partial class More { }\n', 'src/Shop/Caller.cs': CALLER,
	'src/Stamp/Stamp.csproj': LIB().replace('</Project>', '  <Target Name="Stamp" BeforeTargets="CoreCompile">\n'
		+ '    <WriteLinesToFile File="$(IntermediateOutputPath)Stamp.cs" Overwrite="true" Lines="namespace Stamped%3B public static class When { public const long Ticks = '
		+ '$([System.DateTime]::Now.Ticks)%3B }" />\n    <ItemGroup>\n      <Compile Include="$(IntermediateOutputPath)Stamp.cs" />\n    </ItemGroup>\n  </Target>\n</Project>'),
	'src/Stamp/Two.cs': 'namespace Stamped;\n\npublic class Two { }\n\npublic class Three { }\n',
	'src/Intl/Intl.csproj': LIB(), 'src/Intl/Strings.resx': RESX, 'src/Intl/Strings.de.resx': RESX, 'src/Intl/Texts.cs': 'namespace Intl;\n\npublic class Texts { }\n\npublic class Words { }\n',
});
````

Create `$W/check/pipeline-check.js`:

````js
// Runs the real C# step pipeline without VS Code on a fixture repository: the picker's parse (skips, narrowing), the
// approved commands, worktree and branch, the restore and ready(), the baseline twice with the assembly dumps, one
// host-planned split per file, the change note, and worktree removal. Usage: EXT=<extension> node pipeline-check.js <project> <file>…
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const EXT = process.env.EXT;
const [root, ...files] = process.argv.slice(2);
const m = name => require(path.join(EXT, 'out-test/src/aiready', name));
const { adapterFor } = m('languages');
const { runSplit } = m('steps');
const { flakyTests, runBaseline, runSetup } = m('baseline');
const { checkResult } = m('checkResult');
const { emptyResults, readResults, runCommand } = m('projectCommands');
const { prepare, trackedFiles, commit, remove, changedFiles } = m('worktree');
const { renderChangeNote, noteFileName } = m('changeNote');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
(async () => {
	const user = () => JSON.stringify([git('branch', '--show-current'), git('rev-parse', 'HEAD'), git('status', '--porcelain')]);
	const userBefore = user();
	const storageDir = path.join(os.tmpdir(), 'my-editor-csast-dry-run');
	const factory = await adapterFor(root, { extensionPath: EXT, storageDir, version: 'check', appRoot: '' });
	if (typeof factory === 'string') { console.log(`refused: ${factory}`); return; }
	const local = factory(root, git('ls-files').split('\n'));
	for (const file of files) {
		const info = await local.parse(file);
		console.log(`${file}: ${info.declarations.length} types, ${info.declarations.filter(d => d.movable).length} movable, skip: ${info.skip ?? 'no'}`
			+ `${info.narrowed ? `, narrowed: ${info.narrowed}` : ''}`);
	}
	const checks = [...new Map(files.flatMap(file => local.checks(file)).map(c => [c.command, c])).values()];
	const setup = local.setup();
	const approved = [...setup, ...checks].map(c => c.command);
	const wt = await prepare(root);
	console.log(`worktree ${path.basename(wt.path)} on ${wt.branch}; approved:\n  ${approved.join('\n  ')}`);
	let n = 0;
	const runner = adapter => ({
		check: async (command, label, env, options = {}) => {
			const results = options.results && path.join(wt.path, options.results);
			if (results) { emptyResults(results); }
			const logFile = path.join(__dirname, 'logs', `${n++}-${label}.log`);
			const output = await runCommand(command, { cwd: wt.path, approved, timeoutMs: 600_000, env: { ...adapter.commandEnv, ...env }, logFile });
			return checkResult(command, label, output, adapter, { ...options, files: results ? readResults(results) : undefined });
		},
		cancelled: () => false, progress: () => undefined,
	});
	const adapter = factory(wt.path, await trackedFiles(wt.path));
	const ready = await runSetup(adapter.setup(), runner(adapter), () => changedFiles(wt.path), () => adapter.ready());
	console.log(`ready: ${ready ?? 'yes'}`);
	if (ready) { await remove(root, wt.path); git('branch', '-D', wt.branch); return; }
	const outcome = await runBaseline(checks, runner(adapter), (command, round, result) => adapter.assemblyCheck.baseline(command, round, result));
	const baseline = outcome.baseline;
	for (const [command, [run]] of Object.entries(baseline)) {
		console.log(`baseline \`${command.split(' ').slice(0, 3).join(' ')}\`: exit ${run.code}, ${Object.keys(run.warnings ?? {}).length} warning kinds`);
	}
	const flaky = Object.values(baseline).flatMap(([a, b]) => flakyTests(a.tests, b.tests));
	const steps = [];
	for (const file of files) {
		const ctx = { adapter, worktree: wt.path, baseline, flaky, ask: async () => { throw new Error('the model was asked'); }, check: runner(adapter).check,
			cancelled: () => false, progress: () => undefined };
		await adapter.parse(file);
		const step = await runSplit(ctx, { file, kind: 'split', lines: 0 });
		console.log(`split ${file}: ${step.status}${step.commit ? ' <sha>' : ''}${step.reason ? ` (${step.reason})` : ''}`);
		if (step.moved) { console.log(`  moved: ${step.moved.map(x => `${x.file} (${x.names.join(', ')})`).join(', ')}`); }
		if (step.checks) { console.log(`  checks: ${step.checks}`); }
		for (const note of step.notes ?? []) { console.log(`  note: ${note}`); }
		steps.push(step);
	}
	const fixes = files.map(file => ({ file, kind: 'split', lines: 0 }));
	const state = { version: 1, root, language: adapter.label, worktree: wt, startedAt: new Date().toISOString(), approved, fixes, next: fixes.length, steps,
		baseline, skippedFiles: [] };
	const at = new Date();
	const note = noteFileName(at);
	fs.mkdirSync(path.dirname(path.join(wt.path, note)), { recursive: true });
	fs.writeFileSync(path.join(wt.path, note), renderChangeNote(state, at, adapter.mayDiffer));
	await commit(wt.path, [note], 'my_editor: change note for the AI-ready fixes', 'Check run.');
	console.log(git('log', '--format=%s', `${wt.base}..${wt.branch}`));
	for (const line of git('diff', '--stat', `${wt.base}..${wt.branch}`, '--', 'src').split('\n').filter(Boolean)) { console.log(`  ${line.trim()}`); }
	if (process.env.DUMP) {
		// Independent of rule 6: build the base commit and the split commit, dump both, and list the lines that differ.
		const tools = await m('csTools').csTools(EXT, storageDir, 'check');
		const wgit = (...args) => execFileSync('git', args, { cwd: wt.path, encoding: 'utf8' });
		const dumpAt = async ref => {
			wgit('checkout', '--quiet', ref);
			execFileSync(tools.dotnet, ['build', process.env.DUMP, '--no-restore', '--no-incremental', '-nologo', '-v:q'], { cwd: wt.path, env: { ...process.env, ...adapter.commandEnv } });
			const dll = path.join(wt.path, path.dirname(process.env.DUMP), 'bin/Debug/net9.0', `${path.basename(process.env.DUMP, '.csproj')}.dll`);
			return (await m('csAst').csDump(tools, dll)).split('\n');
		};
		const before = await dumpAt(wt.base);
		const after = await dumpAt(`${wt.branch}~1`);
		const differing = after.filter((line, i) => line !== before[i]);
		console.log(`dumps of the base and the split commit: ${before.length} and ${after.length} lines; differing: ${differing.length}`);
		for (const line of differing) { console.log(`  ${line.trim().replace(/[0-9a-f]{40}/g, '<commit>').slice(0, 150)}`); }
		wgit('checkout', '--quiet', wt.branch);
	}
	await remove(root, wt.path);
	console.log(`user folder unchanged: ${user() === userBefore}; worktree removed: ${!fs.existsSync(wt.path)}`);
})().catch(error => { console.error(error); process.exit(1); });
````

Then:

```bash
node gen-fixtures.js fx
```

Expected:

```text
plain: src/Shop/Models.cs 614
scanner: src/Shop/Models.cs 618
refuse: src/Shop/Big.cs 614, src/Shop/Form1.cs 5, src/Shop/Platform.cs 7, src/Shop/Parts.cs 5, src/Shop/Caller.cs 11, src/Stamp/Two.cs 5, src/Intl/Texts.cs 5
```

- [ ] **Step 2: plain: ten types move to their own files; build, warnings and the assembly dump are the same, and an independent dump of the base and the split commit differs only in the SourceLink stamp.**

```bash
DUMP=src/Shop/Shop.csproj node pipeline-check.js "$PWD/fx/plain" src/Shop/Models.cs
git -C fx/plain show my_editor/ai-ready~1:src/Shop/State.cs
```

Expected:

```text
src/Shop/Models.cs: 11 types, 10 movable, skip: no
worktree plain.ai-ready on my_editor/ai-ready; approved:
  dotnet restore Shop.sln --disable-build-servers
  dotnet build src/Shop/Shop.csproj --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false
ready: yes
baseline `dotnet build src/Shop/Shop.csproj`: exit 0, 0 warning kinds
split src/Shop/Models.cs: committed <sha>
  moved: Order.cs (Order), Line.cs (Line), State.cs (State), IPricing.cs (IPricing), OrderChanged.cs (OrderChanged), Money.cs (Money), Discounts.cs (Discounts), Taxes.cs (Taxes), Shipping.cs (Shipping), Shapes.cs (Shapes)
  checks: `dotnet build src/Shop/Shop.csproj --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false`: passed.
my_editor: change note for the AI-ready fixes
my_editor: split into 10 files (src/Shop/Models.cs)
  src/Shop/Discounts.cs    | 193 +++++++++++++++
  src/Shop/IPricing.cs     |  11 +
  src/Shop/Line.cs         |   8 +
  src/Shop/Models.cs       | 603 -----------------------------------------------
  src/Shop/Money.cs        |   8 +
  src/Shop/Order.cs        |   8 +
  src/Shop/OrderChanged.cs |   8 +
  src/Shop/Shapes.cs       |  18 ++
  src/Shop/Shipping.cs     | 193 +++++++++++++++
  src/Shop/State.cs        |  13 +
  src/Shop/Taxes.cs        | 193 +++++++++++++++
  11 files changed, 653 insertions(+), 603 deletions(-)
dumps of the base and the split commit: 2744 and 2744 lines; differing: 1
  assembly-attribute [[System.Runtime]System.Reflection.AssemblyInformationalVersionAttribute::.ctor(string) : void [Default instance]("1.0.0+<commit>")
user folder unchanged: true; worktree removed: true
// Copyright (c) Acme Shop. Licensed under the MIT license.

using System.Text;

namespace Shop.Models;

/// <summary>Where an order is.</summary>
public enum State
{
    Open,
    Paid,
    Shipped,
}
```

- [ ] **Step 3: scanner: a file acquires the assembly, so the class implementing an interface stays and the rest moves.**

```bash
node pipeline-check.js "$PWD/fx/scanner" src/Shop/Models.cs
```

Expected:

```text
src/Shop/Models.cs: 11 types, 9 movable, skip: no, narrowed: only interfaces, enums, delegates and classes, structs or records without a base type, interface, attribute or Controller name may move (the project may scan its assembly for types: src/Shop/Models.cs:10 uses typeof(…).Assembly)
worktree scanner.ai-ready on my_editor/ai-ready; approved:
  dotnet restore src/Shop/Shop.csproj --disable-build-servers
  dotnet build src/Shop/Shop.csproj --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false
ready: yes
baseline `dotnet build src/Shop/Shop.csproj`: exit 0, 0 warning kinds
split src/Shop/Models.cs: committed <sha>
  moved: Order.cs (Order), Line.cs (Line), State.cs (State), IPricing.cs (IPricing), OrderChanged.cs (OrderChanged), Money.cs (Money), Taxes.cs (Taxes), Shipping.cs (Shipping), Shapes.cs (Shapes)
  checks: `dotnet build src/Shop/Shop.csproj --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false`: passed.
my_editor: change note for the AI-ready fixes
my_editor: split into 9 files (src/Shop/Models.cs)
  src/Shop/IPricing.cs     |  11 ++
  src/Shop/Line.cs         |   8 +
  src/Shop/Models.cs       | 415 -----------------------------------------------
  src/Shop/Money.cs        |   8 +
  src/Shop/Order.cs        |   8 +
  src/Shop/OrderChanged.cs |   8 +
  src/Shop/Shapes.cs       |  18 ++
  src/Shop/Shipping.cs     | 193 ++++++++++++++++++++++
  src/Shop/State.cs        |  13 ++
  src/Shop/Taxes.cs        | 193 ++++++++++++++++++++++
  10 files changed, 460 insertions(+), 415 deletions(-)
user folder unchanged: true; worktree removed: true
```

- [ ] **Step 4: refusals: a resource partner, `#if`, partial types, a `[CallerFilePath]` constant caught by rule 6, a build that is not reproducible, and culture resources.**

```bash
node pipeline-check.js "$PWD/fx/refuse" src/Shop/Big.cs src/Shop/Form1.cs src/Shop/Platform.cs src/Shop/Parts.cs src/Shop/Caller.cs \
  src/Stamp/Two.cs src/Intl/Texts.cs
```

Expected (`$W` stands for the scratch folder):

```text
src/Shop/Big.cs: 11 types, 10 movable, skip: no
src/Shop/Form1.cs: 2 types, 1 movable, skip: Form1.resx sits beside it: MSBuild names a resource after the first class of the .cs file with its name, and designers pair files by name
src/Shop/Platform.cs: 1 types, 0 movable, skip: it has #if on line 3, which version 1 does not split around
src/Shop/Parts.cs: 2 types, 0 movable, skip: no
src/Shop/Caller.cs: 2 types, 1 movable, skip: no
src/Stamp/Two.cs: 2 types, 1 movable, skip: no
src/Intl/Texts.cs: 2 types, 1 movable, skip: src/Intl/Intl.csproj has culture-specific resources (Strings.de.resx), whose satellite assemblies the assembly check does not compare
worktree refuse.ai-ready on my_editor/ai-ready; approved:
  dotnet restore src/Intl/Intl.csproj --disable-build-servers
  dotnet restore src/Shop/Shop.csproj --disable-build-servers
  dotnet restore src/Stamp/Stamp.csproj --disable-build-servers
  dotnet build src/Shop/Shop.csproj --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false
  dotnet build src/Stamp/Stamp.csproj --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false
  dotnet build src/Intl/Intl.csproj --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false
ready: yes
baseline `dotnet build src/Shop/Shop.csproj`: exit 0, 0 warning kinds
baseline `dotnet build src/Stamp/Stamp.csproj`: exit 0, 0 warning kinds
baseline `dotnet build src/Intl/Intl.csproj`: exit 0, 0 warning kinds
split src/Shop/Big.cs: committed <sha>
  moved: Order.cs (Order), Line.cs (Line), State.cs (State), IPricing.cs (IPricing), OrderChanged.cs (OrderChanged), Money.cs (Money), Discounts.cs (Discounts), Taxes.cs (Taxes), Shipping.cs (Shipping), Shapes.cs (Shapes)
  checks: `dotnet build src/Shop/Shop.csproj --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false`: passed.
split src/Shop/Form1.cs: skipped (Never split: Form1.resx sits beside it: MSBuild names a resource after the first class of the .cs file with its name, and designers pair files by name.)
split src/Shop/Platform.cs: skipped (Never split: it has #if on line 3, which version 1 does not split around.)
split src/Shop/Parts.cs: refused (Nothing in it may move.)
split src/Shop/Caller.cs: refused (The move check failed: Rule 6: the compiled assembly differs for net9.0: in type Shop.User, method Shop.User::Origin() : string [Default instance]: "IL_0000 ldstr \"$W/check/fx/refuse.ai-ready/src/Shop/Caller.cs\"" became "IL_0000 ldstr \"$W/check/fx/refuse.ai-ready/src/Shop/User.cs\"" (likely a [CallerFilePath] or [CallerLineNumber] argument, compiled in as a constant).)
split src/Stamp/Two.cs: skipped (Building src/Stamp/Stamp.csproj twice at the same commit gave different assemblies (net9.0: in type Stamped.When, field Ticks: "field Ticks flags=Public, Static, Literal, HasDefault : int64 offset=-1 const=Int64:<ticks>" became "field Ticks flags=Public, Static, Literal, HasDefault : int64 offset=-1 const=Int64:<ticks>"), so the assembly check cannot prove its splits; they are skipped for this run.)
split src/Intl/Texts.cs: skipped (Never split: src/Intl/Intl.csproj has culture-specific resources (Strings.de.resx), whose satellite assemblies the assembly check does not compare.)
my_editor: change note for the AI-ready fixes
my_editor: split into 10 files (src/Shop/Big.cs)
  src/Shop/Big.cs          | 603 -----------------------------------------------
  src/Shop/Discounts.cs    | 193 +++++++++++++++
  src/Shop/IPricing.cs     |  11 +
  src/Shop/Line.cs         |   8 +
  src/Shop/Money.cs        |   8 +
  src/Shop/Order.cs        |   8 +
  src/Shop/OrderChanged.cs |   8 +
  src/Shop/Shapes.cs       |  18 ++
  src/Shop/Shipping.cs     | 193 +++++++++++++++
  src/Shop/State.cs        |  13 +
  src/Shop/Taxes.cs        | 193 +++++++++++++++
  11 files changed, 653 insertions(+), 603 deletions(-)
user folder unchanged: true; worktree removed: true
```

- [ ] **Step 5: Throw the scratch folder away.** `rm -rf "$W"`. Nothing to commit.

### Task 14: Final verification

- [ ] **Step 1: Everything, from `overlay/extensions/my-editor-core`.**

```bash
rm -rf out-test && npx tsc --noEmit -p ./ && npm test 2>&1 | grep '^ℹ \(pass\|fail\)'
(cd resources/goast && GOTOOLCHAIN=local go test ./...)
(cd resources/pyast && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest 2>&1 | tail -1)
wc -l src/chat/view.ts src/aiready/cs*.ts resources/csast/*.cs | sort -n | tail -3
git diff -U0 90dd44b -- src test resources tsconfig.test.json | grep '^+[^+]' | awk 'length > 161' | wc -l
git status --short
```

Expected:

```text
ℹ pass 437
ℹ fail 0
ok  	goast	…
OK
     314 resources/csast/FileReader.cs
     399 src/chat/view.ts
    2976 total
       0
```

and a clean tree (every task committed): no new line over 160 characters, `src/chat/view.ts` still 399 lines, no file over 400.

- [ ] **Step 2: Live check (after the user confirms my_editor is closed):** `scripts/install.sh`, open a C# repository with a committed solution and a clean tree, run **Check AI-Readiness**, then **Fix on a local branch** → the picker offers splits for long files and files with several types (narrowed ones say why); the modal shows `dotnet restore`, the build commands and the restore wording; afterwards `git status` and the current branch of the project are unchanged and `git log my_editor/ai-ready` has one commit per split plus the change note. Do not push.

## Dry run of this plan

Applied task by task, mechanically, to a fresh copy of `overlay/extensions/my-editor-core` at `90dd44b` (`git archive`, the extension's `node_modules` linked in, and a local `git init` so each Step 5 commit ran). Every `In … replace` block matched exactly once; each Step 2 failed with the line shown; each Step 4 passed with the count shown (348 before, then 356, 366, 374, 392, 402, 406, 410, 416, 420, 421, 426 and 437, none failing). After Task 12 the tree was byte-identical to the implementation this plan was generated from (`diff -r`, without `node_modules`, `out-test`, `bin` and `obj`). `npx tsc --noEmit -p ./` stayed clean, `go test` in `resources/goast` stayed `ok` and the `resources/pyast` tests stayed `OK`. Task 13 ran on that copy with the outputs shown, on .NET SDK 9.0.108 (Roslyn 4.12, MSBuild 17.12) on macOS arm64, offline.

The plan's dry run found one problem in its first draft, fixed above: in Task 10, `npm test` failed 12 tests because two test processes building the same helper at once replaced each other's `out` folder; now the first build stays. (While building the implementation, the editor-config check also had to resolve `/var/…` against MSBuild's `/private/var/…` with `realpath`.) It could not run xUnit, NUnit or MSTest: none was in the offline NuGet cache, so the TRX parsing is checked against the hand-written fixtures only, and the fixture projects have no test command.

Related: [C# design](2026-10-10-ai-ready-csharp-design.md), [Python plan](2026-10-10-ai-ready-python-plan.md), [TS/JS plan](2026-10-09-ai-ready-ts-plan.md), [Go plan](2026-10-09-ai-ready-stage2-go-plan.md).
