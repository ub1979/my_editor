# AI-ready Stage 1 (health report) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a folder my_editor did not create is opened, offer to get to know it and write a health report (`.my_editor/ai-ready/report.md`) that lists oversized files, multi-class files, untested files, design notes and possible bugs, without changing any code.

**Architecture:** Five pure modules in `src/aiready/` (offer choice, command detection, deterministic health scan, AI review with injected model call, report rendering) are unit-tested with `node --test`. One VS Code-facing orchestrator (`healthRun.ts`) runs the existing Analyse, then the scan, review and report. The existing first-open offer card gains an AI-ready variant; the Project view and the command palette get a **Make This Project AI-Ready** entry.

**Tech Stack:** TypeScript (strict, CommonJS), VS Code extension API, `node:test`, esbuild. Design: [`2026-10-07-ai-ready-design.md`](2026-10-07-ai-ready-design.md).

**Ground rules for every task**
- Work in `overlay/extensions/my-editor-core/` unless a path says otherwise. Paths below are relative to it.
- Indent with tabs. Match the surrounding comment density: one short `/** … */` line on exported functions.
- No file may exceed 400 lines. `src/chat/view.ts` is at exactly 400 now; Task 6 keeps it at 398.
- Commits stay **local**. Never run `git push`.
- Pure modules must not import `vscode` (tests run in plain Node).
- Run commands from `overlay/extensions/my-editor-core`: `npm test` compiles to `out-test/` and runs every test.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/aiready/offer.ts` | new, pure | Which offer a folder gets |
| `src/aiready/commandDetect.ts` | new, pure | Build and test commands from top-level project files |
| `src/aiready/health.ts` | new, pure | File stats, test-file matching, deterministic findings |
| `src/aiready/healthReview.ts` | new, pure | Excerpts, model reply parsing, the per-part review loop |
| `src/aiready/report.ts` | new, pure | Render `report.md` |
| `src/aiready/healthRun.ts` | new, VS Code | Run Analyse, then scan, review, write and open the report |
| `src/quality/sourcePolicy.ts` | modify | Add `classDeclarations` (names with lines); `classNames` uses it |
| `src/brain/analyse.ts` | modify | Export its `ask` helper |
| `src/chat/analysisOffer.ts` | modify | Return `{ files, kind }` |
| `src/chat/view.ts` | modify | `analyse(aiReady)`, `aiReady` message; drop `analyseOffer()` |
| `src/extension.ts` | modify | Register `myEditor.aiReady`; call `analysisOffer` directly |
| `src/project/view.ts`, `media/project.js` | modify | Health row in the Project view |
| `media/chatCards.js` | modify | AI-ready offer card |
| `package.json` | modify | `myEditor.aiReady` command |
| `tsconfig.test.json` | modify | Include the pure modules |
| `test/aiReadyHealth.test.ts`, `test/aiReadyReview.test.ts` | new | Unit tests |
| `README.md`, `CHANGELOG.md`, `docs/progress.md`, design doc | modify (repo root) | Docs |

---

## Chunk 1: Pure modules

### Task 1: Class declarations with line numbers

**Files:**
- Modify: `src/quality/sourcePolicy.ts` (the `classNames` function)
- Create: `test/aiReadyHealth.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/aiReadyHealth.test.ts`:

```ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classDeclarations } from '../src/quality/sourcePolicy';

test('classDeclarations reports names with one-based lines', () => {
	assert.deepEqual(classDeclarations('export class A {}\n\nclass B {}\n', 'src/a.ts'), [{ name: 'A', line: 1 }, { name: 'B', line: 3 }]);
	assert.deepEqual(classDeclarations('class A {}', 'src/a.go'), []);
});
```

- [ ] **Step 2: Run it and see it fail.** `npm test 2>&1 | tail -5` → compile error: `classDeclarations` is not exported.

- [ ] **Step 3: Implement.** In `src/quality/sourcePolicy.ts` replace the whole `classNames` function (its doc comment through its closing brace) with:

```ts
/** Named, top-level class declarations in class-based languages, with their one-based lines. */
export function classDeclarations(text: string, filePath: string): { name: string; line: number }[] {
	if (!hasClassSyntax(filePath)) { return []; }
	const found: { name: string; line: number }[] = [];
	const declaration = /^(?:(?:export|default|declare|abstract|public|private|protected|internal|sealed|final|open|data|partial|static)\s+)*class\s+([A-Za-z_$][\w$]*)\b/;
	text.split(/\r\n|\r|\n/).forEach((line, index) => {
		const match = declaration.exec(line);
		if (match) { found.push({ name: match[1], line: index + 1 }); }
	});
	return found;
}

/** Count named, top-level class declarations in class-based languages. */
export function classNames(text: string, filePath: string): string[] {
	return classDeclarations(text, filePath).map(declaration => declaration.name);
}
```

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | tail -8` → all pass (the existing source-policy tests still pass).

- [ ] **Step 5: Commit.**

```bash
git add src/quality/sourcePolicy.ts test/aiReadyHealth.test.ts
git commit -m "Report class declarations with their lines"
```

### Task 2: Offer choice and command detection

**Files:**
- Create: `src/aiready/offer.ts`, `src/aiready/commandDetect.ts`
- Modify: `test/aiReadyHealth.test.ts`, `tsconfig.test.json`

- [ ] **Step 1: Write the failing tests.** Append to `test/aiReadyHealth.test.ts`, and add these imports at the top:

```ts
import { detectCommands } from '../src/aiready/commandDetect';
import { offerKind } from '../src/aiready/offer';
```

```ts
const NO_COMMANDS = { languages: [], checks: [], tests: [] };

test('a folder my_editor did not create gets the AI-ready offer; a brain means no offer', () => {
	assert.equal(offerKind(false, false), 'ai-ready');
	assert.equal(offerKind(true, false), 'analyse');
	assert.equal(offerKind(true, true), undefined);
	assert.equal(offerKind(false, true), undefined);
});

test('detectCommands reads build files and ignores the npm placeholder test script', () => {
	assert.deepEqual(detectCommands({ names: ['package.json', 'tsconfig.json'], packageJson: '{"scripts":{"test":"node --test"}}' }),
		{ languages: ['JavaScript/TypeScript'], checks: ['npx tsc --noEmit'], tests: ['npm test'] });
	assert.deepEqual(detectCommands({ names: ['package.json'], packageJson: '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }).tests, []);
	assert.deepEqual(detectCommands({ names: ['package.json'], packageJson: 'not json' }).tests, []);
	assert.deepEqual(detectCommands({ names: ['pyproject.toml'], pyproject: '[tool.pytest.ini_options]' }).tests, ['pytest -q -rA']);
	assert.deepEqual(detectCommands({ names: ['pyproject.toml'], pyproject: '[project]' }).tests, []);
	assert.deepEqual(detectCommands({ names: ['conftest.py'] }).tests, ['pytest -q -rA']);
	assert.deepEqual(detectCommands({ names: ['go.mod'] }), { languages: ['Go'], checks: ['go build ./...', 'go vet ./...'], tests: ['go test -json ./...'] });
	assert.deepEqual(detectCommands({ names: ['Cargo.toml'] }), { languages: ['Rust'], checks: ['cargo check'], tests: ['cargo test'] });
	assert.deepEqual(detectCommands({ names: ['README.md'] }), NO_COMMANDS);
});
```

- [ ] **Step 2: Run and see it fail.** `npm test 2>&1 | tail -5` → cannot find module `../src/aiready/offer`.

- [ ] **Step 3: Implement.** Create `src/aiready/offer.ts`:

```ts
/** Which first-open offer a folder with code gets. */
export type OfferKind = 'ai-ready' | 'analyse';

/**
 * A folder without `.my_editor/` was not made with my_editor, so it gets the AI-ready offer; one with `.my_editor/`
 * but no brain gets the plain Analyse offer; one with a brain gets none.
 */
export function offerKind(hasMyEditorFolder: boolean, hasBrain: boolean): OfferKind | undefined {
	if (hasBrain) { return undefined; }
	return hasMyEditorFolder ? 'analyse' : 'ai-ready';
}
```

Create `src/aiready/commandDetect.ts`:

```ts
/** The project files that show how a project is built and tested. */
export interface RootFiles {
	/** File names in the project's top folder. */
	readonly names: readonly string[];
	readonly packageJson?: string;
	readonly pyproject?: string;
}

export interface DetectedCommands {
	readonly languages: readonly string[];
	/** Build and type checks, as exact command lines. */
	readonly checks: readonly string[];
	readonly tests: readonly string[];
}

const NPM_PLACEHOLDER_TEST = /no test specified/;

/** Build and test commands for the languages a project's top-level files reveal. */
export function detectCommands(root: RootFiles): DetectedCommands {
	const has = (name: string) => root.names.includes(name);
	const languages: string[] = [];
	const checks: string[] = [];
	const tests: string[] = [];
	if (has('package.json')) {
		languages.push('JavaScript/TypeScript');
		if (has('tsconfig.json')) { checks.push('npx tsc --noEmit'); }
		if (npmTestScript(root.packageJson)) { tests.push('npm test'); }
	}
	if (['pyproject.toml', 'setup.py', 'requirements.txt', 'pytest.ini', 'conftest.py'].some(has)) {
		languages.push('Python');
		checks.push('python -m compileall -q');
		if (has('pytest.ini') || has('conftest.py') || /pytest/.test(root.pyproject ?? '')) { tests.push('pytest -q -rA'); }
	}
	if (has('go.mod')) {
		languages.push('Go');
		checks.push('go build ./...', 'go vet ./...');
		tests.push('go test -json ./...');
	}
	if (has('Cargo.toml')) {
		languages.push('Rust');
		checks.push('cargo check');
		tests.push('cargo test');
	}
	return { languages, checks, tests };
}

function npmTestScript(packageJson: string | undefined): string | undefined {
	try {
		const test = (JSON.parse(packageJson ?? '{}') as { scripts?: Record<string, unknown> }).scripts?.test;
		return typeof test === 'string' && test.trim() && !NPM_PLACEHOLDER_TEST.test(test) ? test : undefined;
	} catch {
		return undefined;
	}
}
```

In `tsconfig.test.json`, add these two lines to the end of the `include` array. Keep the JSON valid by adding a comma after `"src/brain/analysisPlan.ts"`. Tasks 3–5 each add their own file the same way.

```json
    "src/aiready/offer.ts",
    "src/aiready/commandDetect.ts"
```

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | tail -8` → all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/offer.ts src/aiready/commandDetect.ts test/aiReadyHealth.test.ts tsconfig.test.json
git commit -m "Choose the first-open offer and detect project commands"
```

### Task 3: Deterministic health scan

**Files:**
- Create: `src/aiready/health.ts`
- Modify: `test/aiReadyHealth.test.ts`, `tsconfig.test.json` (add `"src/aiready/health.ts"`)

- [ ] **Step 1: Write the failing tests.** Add the import `import { fileStats, needsTests, scanHealth, testSubject } from '../src/aiready/health';` and append:

```ts
test('testSubject names what a test file is about, by language convention', () => {
	assert.equal(testSubject('src/cart.test.ts'), 'cart');
	assert.equal(testSubject('web/cart.spec.jsx'), 'cart');
	assert.equal(testSubject('src/__tests__/cart.ts'), 'cart');
	assert.equal(testSubject('tests/test_cart.py'), 'cart');
	assert.equal(testSubject('cart_test.py'), 'cart');
	assert.equal(testSubject('pkg/cart_test.go'), 'cart');
	assert.equal(testSubject('src/cart.ts'), undefined);
});

test('needsTests checks TS/JS, Python, Go and Rust source only', () => {
	assert.equal(needsTests('src/cart.ts'), true);
	assert.equal(needsTests('app/cart.py'), true);
	assert.equal(needsTests('src/lib.rs'), true);
	for (const path of ['src/cart.test.ts', 'src/types.d.ts', 'vite.config.ts', 'setup.py', 'conftest.py', 'pkg/__init__.py',
		'tests/helpers.py', 'tests/it.rs', 'styles/a.css', 'src/a.c']) {
		assert.equal(needsTests(path), false, path);
	}
});

test('scanHealth flags long files, extra classes and untested files', () => {
	const stats = [
		fileStats('src/big.ts', 'x\n'.repeat(450)),
		fileStats('src/near.ts', 'x\n'.repeat(370)),
		fileStats('src/two.ts', 'class A {}\nclass B {}\n'),
		fileStats('src/cart.ts', 'export const total = 1;\n'),
		fileStats('src/lib.rs', 'fn a() {}\n#[cfg(test)]\nmod tests {}\n'),
	];
	const paths = ['src/cart.ts', 'src/cart.test.ts', 'src/big.ts', 'src/near.ts', 'src/two.ts', 'src/lib.rs'];
	const findings = scanHealth(stats, paths, { languages: ['TS'], checks: [], tests: ['npm test'] }, ['vendor/huge.js is too large to read.']);
	const kinds = findings.map(f => `${f.kind}:${f.file ?? ''}`);
	assert.ok(kinds.includes('too-long:src/big.ts'));
	assert.ok(kinds.includes('near-limit:src/near.ts'));
	assert.ok(kinds.includes('many-classes:src/two.ts'));
	assert.equal(findings.find(f => f.kind === 'many-classes')?.line, 2);
	assert.ok(kinds.includes('untested:src/big.ts'));
	assert.ok(!kinds.includes('untested:src/cart.ts'));
	assert.ok(!kinds.includes('untested:src/lib.rs'));
	assert.ok(kinds.includes('not-covered:'));
	assert.ok(!kinds.includes('no-test-runner:'));
	assert.ok(scanHealth([], [], NO_COMMANDS, []).some(f => f.kind === 'no-test-runner'));
});
```

- [ ] **Step 2: Run and see it fail.** `npm test 2>&1 | tail -5` → cannot find module `../src/aiready/health`.

- [ ] **Step 3: Implement.** Create `src/aiready/health.ts`:

```ts
import * as path from 'path';
import { classDeclarations, isSourceFile, MAX_SOURCE_LINES, sourceLines, WARN_SOURCE_LINES } from '../quality/sourcePolicy';
import type { DetectedCommands } from './commandDetect';

/** What the health report can say, from deterministic checks and from the model's review. */
export type FindingKind = 'too-long' | 'near-limit' | 'many-classes' | 'untested' | 'no-test-runner' | 'not-covered'
	| 'mixed-job' | 'design' | 'bug' | 'poor-code';

export interface HealthFinding {
	readonly kind: FindingKind;
	readonly file?: string;
	readonly line?: number;
	readonly text: string;
	/** For a file doing more than one job: how its definitions could be grouped. */
	readonly grouping?: string;
}

export interface FileStats {
	readonly path: string;
	readonly lines: number;
	readonly classes: readonly { name: string; line: number }[];
	/** Rust only: the file has its own `#[cfg(test)]` module. */
	readonly inlineTests: boolean;
}

const TESTABLE = /\.(?:[cm]?[jt]sx?|py|go|rs)$/;
const NOT_CHECKED = /(^|\/)(?:[^/]*\.config\.[^/]+|setup\.py|conftest\.py|__init__\.py)$|(^|\/)(?:tests?|__tests__)\//;

export function fileStats(filePath: string, text: string): FileStats {
	return {
		path: filePath, lines: sourceLines(text), classes: classDeclarations(text, filePath),
		inlineTests: filePath.endsWith('.rs') && /#\[cfg\(test\)\]/.test(text),
	};
}

/** The name a test file is about, or undefined when the path is not a test file. */
export function testSubject(filePath: string): string | undefined {
	const base = path.posix.basename(filePath);
	const js = /^(.+)\.(?:test|spec)\.[cm]?[jt]sx?$/.exec(base);
	if (js) { return js[1]; }
	if (/(^|\/)__tests__\//.test(filePath) && /\.[cm]?[jt]sx?$/.test(base)) { return base.replace(/\.[^.]+$/, ''); }
	const py = /^test_(.+)\.py$/.exec(base) ?? /^(.+)_test\.py$/.exec(base);
	if (py) { return py[1]; }
	return /^(.+)_test\.go$/.exec(base)?.[1];
}

/** Source files whose tests the report checks: TS/JS, Python, Go and Rust; not tests, declarations or config. */
export function needsTests(filePath: string): boolean {
	return TESTABLE.test(filePath) && !filePath.endsWith('.d.ts') && !NOT_CHECKED.test(filePath) && testSubject(filePath) === undefined;
}

/** Findings that need no model: size, classes per file, missing tests and test command, analysis gaps. */
export function scanHealth(stats: readonly FileStats[], allPaths: readonly string[], commands: DetectedCommands,
	notCovered: readonly string[]): HealthFinding[] {
	const subjects = new Set(allPaths.map(testSubject).filter((s): s is string => !!s).map(s => s.toLowerCase()));
	const findings: HealthFinding[] = [];
	for (const file of stats) {
		if (!isSourceFile(file.path)) { continue; }
		if (file.lines > MAX_SOURCE_LINES) {
			findings.push({ kind: 'too-long', file: file.path, text: `${file.lines} lines; the limit is ${MAX_SOURCE_LINES}.` });
		} else if (file.lines >= WARN_SOURCE_LINES) {
			findings.push({ kind: 'near-limit', file: file.path, text: `${file.lines} lines, close to the ${MAX_SOURCE_LINES}-line limit.` });
		}
		if (file.classes.length > 1) {
			findings.push({ kind: 'many-classes', file: file.path, line: file.classes[1].line,
				text: `${file.classes.length} classes: ${file.classes.map(c => c.name).join(', ')}.` });
		}
		const name = path.posix.basename(file.path).replace(/\.[^.]+$/, '').toLowerCase();
		if (needsTests(file.path) && !file.inlineTests && !subjects.has(name)) {
			findings.push({ kind: 'untested', file: file.path, text: 'No test file for it was found.' });
		}
	}
	if (!commands.tests.length) {
		findings.push({ kind: 'no-test-runner', text: 'No test command was found, so changes cannot be checked by tests yet.' });
	}
	for (const gap of notCovered) { findings.push({ kind: 'not-covered', text: gap }); }
	return findings;
}
```

Add `"src/aiready/health.ts"` to `tsconfig.test.json` `include`.

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | tail -8` → all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/health.ts test/aiReadyHealth.test.ts tsconfig.test.json
git commit -m "Scan a project for long, multi-class and untested files"
```

### Task 4: Model review with excerpts and location checks

**Files:**
- Create: `src/aiready/healthReview.ts`, `test/aiReadyReview.test.ts`
- Modify: `tsconfig.test.json` (add `"src/aiready/healthReview.ts"`)

- [ ] **Step 1: Write the failing tests.** Create `test/aiReadyReview.test.ts`:

```ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { excerpt, parseReview, reviewParts, ReviewPart } from '../src/aiready/healthReview';

const numbered = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');
const LIMITS = { maxCalls: 40, fileChars: 6_000, callChars: 40_000 };

test('excerpt shows the flagged lines first, then the top, numbered and within budget', () => {
	const cut = excerpt(numbered(300), [200], 1_000);
	assert.equal(cut.ranges[0][0], 1);
	assert.ok(cut.ranges.some(([from, to]) => from <= 200 && to >= 200));
	assert.ok(cut.text.length <= 1_010);
	assert.match(cut.text, /^1: line 1$/m);
	assert.match(cut.text, /^200: line 200$/m);
	assert.match(cut.text, /\n…\n/);
	assert.deepEqual(excerpt('a\nb', [], 1_000), { text: '1: a\n2: b', ranges: [[1, 2]] });
});

test('parseReview keeps only findings at lines the model was shown', () => {
	const shown = new Map([['src/a.ts', [[1, 20], [100, 120]] as [number, number][]]]);
	const reply = 'Here you go:\n[{"file":"src/a.ts","line":105,"kind":"bug","text":"Off by one."},'
		+ '{"file":"src/a.ts","line":50,"kind":"bug","text":"Not shown."},'
		+ '{"file":"src/b.ts","line":2,"kind":"design","text":"Unknown file."},'
		+ '{"file":"src/a.ts","line":3,"kind":"style","text":"Unknown kind."},'
		+ '{"file":"src/a.ts","line":4,"kind":"mixed-job","text":"Two jobs.","grouping":"io: read, write; math: sum"}]';
	assert.deepEqual(parseReview(reply, shown), [
		{ kind: 'bug', file: 'src/a.ts', line: 105, text: 'Off by one.' },
		{ kind: 'mixed-job', file: 'src/a.ts', line: 4, text: 'Two jobs.', grouping: 'io: read, write; math: sum' },
	]);
	assert.equal(parseReview('no json here', shown), undefined);
	assert.deepEqual(parseReview('[]', shown), []);
});

const part = (name: string, priority: number): ReviewPart =>
	({ name, priority, files: [{ path: `${name}/a.ts`, text: numbered(30), focusLines: [] }] });

test('reviewParts reviews high-priority parts first, retries once, and stops at the call limit', async () => {
	const asked: string[] = [];
	const replies = ['not json', '[{"file":"hot/a.ts","line":2,"kind":"design","text":"Split it."}]', '[]'];
	const result = await reviewParts([part('cold', 1), part('hot', 9), part('warm', 5)],
		async (_system, text) => { asked.push(text.split('\n')[0]); return replies.shift() ?? '[]'; },
		{ ...LIMITS, maxCalls: 3 }, () => false);
	assert.deepEqual(asked, ['Part: hot', 'Part: hot', 'Part: warm']);
	assert.deepEqual(result.reviewed, ['hot', 'warm']);
	assert.deepEqual(result.notReviewed, ['cold']);
	assert.equal(result.findings.length, 1);
	assert.equal(result.partial, false);
});

test('reviewParts treats a failed model call like an unreadable reply', async () => {
	const result = await reviewParts([part('a', 1)], async () => { throw new Error('timeout'); }, LIMITS, () => false);
	assert.deepEqual(result.notReviewed, ['a']);
});

test('reviewParts marks the result partial when stopped', async () => {
	const result = await reviewParts([part('a', 1)], async () => '[]', LIMITS, () => true);
	assert.deepEqual(result.notReviewed, ['a']);
	assert.equal(result.partial, true);
});
```

- [ ] **Step 2: Run and see it fail.** `npm test 2>&1 | tail -5` → cannot find module `../src/aiready/healthReview`.

- [ ] **Step 3: Implement.** Create `src/aiready/healthReview.ts`:

```ts
import type { FindingKind, HealthFinding } from './health';

export interface ReviewFile {
	readonly path: string;
	readonly summary?: string;
	/** Redacted source text. */
	readonly text: string;
	/** One-based lines to show first, such as extra class declarations. */
	readonly focusLines: readonly number[];
}

export interface ReviewPart {
	readonly name: string;
	readonly files: readonly ReviewFile[];
	/** Higher parts are reviewed first. */
	readonly priority: number;
}

export interface ReviewLimits {
	readonly maxCalls: number;
	readonly fileChars: number;
	readonly callChars: number;
}

export type LineRange = readonly [number, number];

export interface Excerpt {
	readonly text: string;
	readonly ranges: readonly LineRange[];
}

export interface ReviewResult {
	readonly findings: HealthFinding[];
	readonly reviewed: string[];
	readonly notReviewed: string[];
	readonly partial: boolean;
}

export const DEFAULT_LIMITS: ReviewLimits = { maxCalls: 40, fileChars: 6_000, callChars: 40_000 };
const WINDOW = 60;
const AI_KINDS = new Set<FindingKind>(['mixed-job', 'design', 'bug', 'poor-code']);

export const REVIEW_SYSTEM = `You review one part of an existing software project so it becomes easier to maintain.
You get file summaries and numbered excerpts. Report only what the excerpts show:
- "mixed-job": a file doing more than one job; put a proposed grouping of its definitions in "grouping".
- "design": tangled responsibilities, duplicated logic, or a design pattern that would clearly simplify the code.
- "bug": a likely bug.
- "poor-code": code that is hard to read or fragile.
Use each file path exactly as given and a line number from its excerpt. Keep "text" to one or two plain sentences.
Reply with only a JSON array of {"file", "line", "kind", "text", "grouping"?} objects, or [] when nothing is worth reporting.`;

/** Lines around the flagged places first, then the file from the top, numbered, within a character budget. */
export function excerpt(text: string, focusLines: readonly number[], maxChars: number): Excerpt {
	const lines = text.split('\n');
	const windows: LineRange[] = [...focusLines.map(line => [line, line + WINDOW - 1] as LineRange), [1, lines.length]];
	const chosen = new Set<number>();
	let used = 0;
	fill: for (const [from, to] of windows) {
		for (let line = Math.max(1, from); line <= Math.min(to, lines.length); line++) {
			if (chosen.has(line)) { continue; }
			const cost = lines[line - 1].length + String(line).length + 3;
			if (used + cost > maxChars) { break fill; }
			chosen.add(line);
			used += cost;
		}
	}
	const ranges: [number, number][] = [];
	for (const line of [...chosen].sort((a, b) => a - b)) {
		const last = ranges[ranges.length - 1];
		if (last && last[1] === line - 1) { last[1] = line; } else { ranges.push([line, line]); }
	}
	const body = ranges.map(([from, to]) => lines.slice(from - 1, to).map((line, i) => `${from + i}: ${line}`).join('\n')).join('\n…\n');
	return { text: body, ranges };
}

/** Findings from a model reply, kept only when they point at a line the model was shown; undefined if unreadable. */
export function parseReview(reply: string, shown: ReadonlyMap<string, readonly LineRange[]>): HealthFinding[] | undefined {
	const start = reply.indexOf('[');
	const end = reply.lastIndexOf(']');
	if (start < 0 || end <= start) { return undefined; }
	let raw: unknown;
	try { raw = JSON.parse(reply.slice(start, end + 1)); } catch { return undefined; }
	if (!Array.isArray(raw)) { return undefined; }
	const findings: HealthFinding[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') { continue; }
		const { file, line, kind, text, grouping } = item as Record<string, unknown>;
		const ranges = typeof file === 'string' ? shown.get(file) : undefined;
		if (!ranges || typeof line !== 'number' || !Number.isInteger(line) || !ranges.some(([from, to]) => line >= from && line <= to)) { continue; }
		if (typeof kind !== 'string' || !AI_KINDS.has(kind as FindingKind) || typeof text !== 'string' || !text.trim()) { continue; }
		findings.push({
			kind: kind as FindingKind, file: file as string, line, text: text.trim().slice(0, 400),
			...(typeof grouping === 'string' && grouping.trim() ? { grouping: grouping.trim().slice(0, 400) } : {}),
		});
	}
	return findings;
}

/** One part's request: excerpts of its most flagged files that fit the call budget, and what each excerpt shows. */
function partRequest(part: ReviewPart, limits: ReviewLimits): { text: string; shown: Map<string, readonly LineRange[]> } {
	const shown = new Map<string, readonly LineRange[]>();
	const blocks: string[] = [];
	const skipped: string[] = [];
	let used = 0;
	const files = [...part.files].sort((a, b) => b.focusLines.length - a.focusLines.length || b.text.length - a.text.length);
	for (const file of files) {
		const cut = excerpt(file.text, file.focusLines, Math.min(limits.fileChars, limits.callChars - used));
		if (!cut.ranges.length) { skipped.push(file.path); continue; }
		used += cut.text.length;
		shown.set(file.path, cut.ranges);
		blocks.push(`=== ${file.path} ===${file.summary ? `\nSummary: ${file.summary}` : ''}\n${cut.text}`);
	}
	const text = [`Part: ${part.name}`, ...blocks,
		skipped.length ? `Also in this part (no excerpt; do not report on them): ${skipped.join(', ')}` : '',
		'Reply with only the JSON array.'].filter(Boolean).join('\n\n');
	return { text, shown };
}

/** Reviews parts in priority order within the call limit; an unreadable reply gets one retry. */
export async function reviewParts(parts: readonly ReviewPart[], ask: (system: string, text: string) => Promise<string>,
	limits: ReviewLimits, cancelled: () => boolean): Promise<ReviewResult> {
	const findings: HealthFinding[] = [];
	const reviewed: string[] = [];
	const notReviewed: string[] = [];
	let calls = 0;
	for (const part of [...parts].sort((a, b) => b.priority - a.priority)) {
		const { text, shown } = partRequest(part, limits);
		let found: HealthFinding[] | undefined;
		for (let attempt = 0; attempt < 2 && !found && shown.size && calls < limits.maxCalls && !cancelled(); attempt++) {
			calls++;
			let reply = '';
			try {
				reply = await ask(REVIEW_SYSTEM, attempt ? `${text}\n\nYour previous reply was not a valid JSON array. Reply with only the array.` : text);
			} catch {
				reply = '';
			}
			found = parseReview(reply, shown);
		}
		if (found) { reviewed.push(part.name); findings.push(...found); } else { notReviewed.push(part.name); }
	}
	return { findings, reviewed, notReviewed, partial: cancelled() };
}
```

Add `"src/aiready/healthReview.ts"` to `tsconfig.test.json` `include`.

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | tail -8` → all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/healthReview.ts test/aiReadyReview.test.ts tsconfig.test.json
git commit -m "Review project parts with bounded, location-checked model findings"
```

### Task 5: Report rendering

**Files:**
- Create: `src/aiready/report.ts`
- Modify: `test/aiReadyReview.test.ts`, `tsconfig.test.json` (add `"src/aiready/report.ts"`)

- [ ] **Step 1: Write the failing test.** Add imports `import { fileStats } from '../src/aiready/health';` and `import { renderReport } from '../src/aiready/report';`, then append:

```ts
test('renderReport lists files, suggestions, unreviewed parts and the next step', () => {
	const report = renderReport({
		project: 'shop', date: '2026-10-07', model: 'Claude Sonnet',
		stats: [fileStats('src/big.ts', 'x\n'.repeat(450))],
		findings: [
			{ kind: 'too-long', file: 'src/big.ts', text: '450 lines; the limit is 400.' },
			{ kind: 'mixed-job', file: 'src/big.ts', line: 12, text: 'Parses and renders.', grouping: 'parse: a, b; render: c' },
			{ kind: 'bug', file: 'src/big.ts', line: 40, text: 'Total ignores discounts.' },
			{ kind: 'no-test-runner', text: 'No test command was found, so changes cannot be checked by tests yet.' },
		],
		commands: { languages: ['JavaScript/TypeScript'], checks: [], tests: [] },
		review: { reviewed: ['src'], notReviewed: ['lib'], partial: true },
	});
	assert.match(report, /^# AI-ready health report: shop/);
	assert.match(report, /stopped early/);
	assert.match(report, /\| Over 400 lines \| 1 \|/);
	assert.match(report, /### \[src\/big\.ts\]\(\.\.\/\.\.\/src\/big\.ts\)/);
	assert.match(report, /\[src\/big\.ts:12\]\(\.\.\/\.\.\/src\/big\.ts#L12\)/);
	assert.match(report, /Grouping: parse: a, b; render: c/);
	assert.match(report, /Possible bug\*\* \[src\/big\.ts:40\]/);
	assert.match(report, /## Not reviewed by the model\n\nlib\./);
	assert.match(report, /No test command was found/);
	assert.doesNotMatch(report, /\n\n\n/);
});
```

- [ ] **Step 2: Run and see it fail.** `npm test 2>&1 | tail -5` → cannot find module `../src/aiready/report`.

- [ ] **Step 3: Implement.** Create `src/aiready/report.ts`:

```ts
import type { DetectedCommands } from './commandDetect';
import type { FileStats, FindingKind, HealthFinding } from './health';
import type { ReviewResult } from './healthReview';

export interface ReportInput {
	readonly project: string;
	readonly date: string;
	readonly model: string;
	readonly stats: readonly FileStats[];
	readonly findings: readonly HealthFinding[];
	readonly commands: DetectedCommands;
	readonly review: Pick<ReviewResult, 'reviewed' | 'notReviewed' | 'partial'>;
}

const LABELS: Record<FindingKind, string> = {
	'too-long': 'Over 400 lines', 'near-limit': 'Close to 400 lines', 'many-classes': 'More than one class', untested: 'No tests',
	'no-test-runner': 'No test command', 'not-covered': 'Not covered', 'mixed-job': 'More than one job', design: 'Design',
	bug: 'Possible bug', 'poor-code': 'Hard to maintain',
};
const SUGGESTIONS = new Set<FindingKind>(['bug', 'poor-code']);
const SUMMARY_KINDS: FindingKind[] = ['too-long', 'near-limit', 'many-classes', 'untested', 'mixed-job', 'design'];
const NEXT_STEP = [
	'Characterization tests that pin how files behave today, before anything moves',
	'Split long or mixed files into focused files',
	'One class per file',
	'Tests for untested files',
];

/** A link from `.my_editor/ai-ready/report.md` to a project file, at a line when known. */
function link(file: string, line?: number): string {
	return `[${file}${line ? `:${line}` : ''}](../../${encodeURI(file)}${line ? `#L${line}` : ''})`;
}

/** The health report as Markdown: summary, build and test commands, files, suggestions, gaps, next step. */
export function renderReport(input: ReportInput): string {
	const count = (kind: FindingKind) => input.findings.filter(f => f.kind === kind).length;
	const byFile = new Map<string, HealthFinding[]>();
	for (const finding of input.findings) {
		if (finding.file && !SUGGESTIONS.has(finding.kind)) { byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]); }
	}
	const stats = new Map(input.stats.map(s => [s.path, s]));
	const files = [...byFile.keys()].sort((a, b) => byFile.get(b)!.length - byFile.get(a)!.length || a.localeCompare(b));
	const suggestions = input.findings.filter(f => SUGGESTIONS.has(f.kind) && f.file);
	const general = input.findings.filter(f => !f.file);
	const { commands, review } = input;
	const lines = [
		`# AI-ready health report: ${input.project}`, '',
		`${input.date} · ${input.stats.length} source files · reviewed with ${input.model}${review.partial ? ' · **stopped early: this report is partial**' : ''}`, '',
		'Nothing in the code was changed. This report shows what would make the project easier for people and AI models to work on.', '',
		'## Summary', '',
		'| Check | Findings |', '|---|---|',
		...SUMMARY_KINDS.map(kind => `| ${LABELS[kind]} | ${count(kind)} |`),
		`| Suggestions (possible bugs, hard-to-maintain code) | ${suggestions.length} |`, '',
		'## How it is built and tested', '',
		commands.languages.length ? `Languages: ${commands.languages.join(', ')}.` : 'No build files were recognised.',
		commands.checks.length ? `Checks: ${commands.checks.map(c => `\`${c}\``).join(', ')}.` : 'No build or type check was found.',
		commands.tests.length ? `Tests: ${commands.tests.map(c => `\`${c}\``).join(', ')}.` : 'No test command was found.',
		...(general.length ? ['', ...general.map(f => `- ${f.text}`)] : []), '',
		'## Files that need attention', '',
		...(files.length ? files.flatMap(file => {
			const stat = stats.get(file);
			return [`### ${link(file)}`, '', stat ? `${stat.lines} lines · ${stat.classes.length} class${stat.classes.length === 1 ? '' : 'es'}` : '', '',
				...byFile.get(file)!.map(f => `- **${LABELS[f.kind]}**${f.line ? ` (${link(file, f.line)})` : ''}: ${f.text}${f.grouping ? `\n  Grouping: ${f.grouping}` : ''}`), ''];
		}) : ['Every file passed these checks.', '']),
		'## Suggestions for you', '',
		...(suggestions.length
			? [...suggestions.map(f => `- **${LABELS[f.kind]}** ${link(f.file!, f.line)}: ${f.text}`), '', 'This check never changes behavior. To fix one, ask Pair about it.']
			: ['No likely bugs or fragile code were reported.']), '',
		...(review.notReviewed.length ? ['## Not reviewed by the model', '', `${review.notReviewed.join(', ')}. Run the check again to review them.`, ''] : []),
		'## What the fixing step will offer', '',
		...NEXT_STEP.map(item => `- ${item}`), '',
		'Fixes will run on a separate local branch, one per commit, each checked so the program behaves as before. That step is not built yet.', '',
	];
	return lines.filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n');
}
```

Add `"src/aiready/report.ts"` to `tsconfig.test.json` `include`.

- [ ] **Step 4: Run the tests.** `npm test 2>&1 | tail -8` → all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/aiready/report.ts test/aiReadyReview.test.ts tsconfig.test.json
git commit -m "Render the AI-ready health report"
```

---

## Chunk 2: Wiring, UI and docs

### Task 6: Orchestrator and the AI-ready offer

**Files:**
- Create: `src/aiready/healthRun.ts`
- Modify: `src/brain/analyse.ts`, `src/chat/analysisOffer.ts`, `src/chat/view.ts`, `src/extension.ts`, `media/chatCards.js`, `package.json`

- [ ] **Step 1: Export Analyse's model helper.** In `src/brain/analyse.ts` change `async function ask(` to `export async function ask(`. Nothing else changes.

- [ ] **Step 2: Create `src/aiready/healthRun.ts`:**

```ts
import * as vscode from 'vscode';
import { analyseProject, ask } from '../brain/analyse';
import { groupByModule } from '../brain/analysisPlan';
import { BrainMap, describeEntry, readMap, readText } from '../brain/brain';
import type { Sink } from '../chat/engine';
import { Proposals } from '../chat/proposals';
import { loadCatalog, pickDefault } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { isSourceFile } from '../quality/sourcePolicy';
import { redact } from '../records/redact';
import { isSensitiveFile } from '../records/sensitive';
import { detectCommands, RootFiles } from './commandDetect';
import { FileStats, fileStats, HealthFinding, scanHealth, testSubject } from './health';
import { DEFAULT_LIMITS, ReviewPart, reviewParts } from './healthReview';
import { renderReport } from './report';

const REPORT_DIR = ['.my_editor', 'ai-ready'];
const REVIEW_TIMEOUT_MS = 180_000;

/** "Make this project AI-ready", stage 1: get to know the project, then write its health report. Code never changes. */
export async function makeAiReady(keys: ApiKeys, proposals: Proposals, sink: Sink, token: vscode.CancellationToken): Promise<void> {
	await analyseProject(keys, proposals, sink, token);
	if (!token.isCancellationRequested) {
		await writeHealthReport(keys, sink, token);
	}
}

async function writeHealthReport(keys: ApiKeys, sink: Sink, token: vscode.CancellationToken): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const map = await readMap();
	const model = pickDefault(await loadCatalog(keys));
	if (!folder || !map || !model) { return; } // Analyse has already said why.
	sink.progress('Checking file sizes, classes and tests…');
	const paths = Object.keys(map.files);
	const texts = new Map<string, string>();
	for (const path of paths.filter(isSourceFile)) {
		const text = await readText(vscode.Uri.joinPath(folder.uri, path));
		if (text !== undefined) { texts.set(path, text); }
	}
	const stats = [...texts].map(([path, text]) => fileStats(path, text));
	const commands = detectCommands(await rootFiles(folder.uri));
	const notCovered = [
		...(map.tooLarge ?? []).map(path => `${path} is too large to read.`),
		...(map.fileLimitHit ? ['The project has more code files than the brain reads (5,000).'] : []),
	];
	const findings = scanHealth(stats, paths, commands, notCovered);
	const parts = reviewInput(texts, stats, findings, map);
	sink.progress(`Reviewing ${parts.length} part${parts.length === 1 ? '' : 's'} with ${model.label}…`);
	const review = await reviewParts(parts, (system, text) => ask(model, keys, system, text, token, REVIEW_TIMEOUT_MS),
		DEFAULT_LIMITS, () => token.isCancellationRequested);
	const all = [...findings, ...review.findings];
	const dir = vscode.Uri.joinPath(folder.uri, ...REPORT_DIR);
	const uri = vscode.Uri.joinPath(dir, 'report.md');
	await vscode.workspace.fs.createDirectory(dir);
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(renderReport({
		project: folder.name, date: new Date().toISOString().slice(0, 10), model: model.label, stats, findings: all, commands, review,
	})));
	sink.progress('');
	const count = (...kinds: string[]) => all.filter(f => kinds.includes(f.kind)).length;
	sink.text(`\n\n**Health report** written to \`.my_editor/ai-ready/report.md\`: ${count('too-long')} over 400 lines, `
		+ `${count('many-classes')} with more than one class, ${count('untested')} without tests, ${count('mixed-job', 'design')} design notes `
		+ `and ${count('bug', 'poor-code')} suggestions.${review.partial ? ' I stopped early, so the report is partial.' : ''} Nothing in the code changed.`);
	await vscode.commands.executeCommand('markdown.showPreview', uri);
}

/** Non-test, non-secret source grouped by part; the most flagged and largest parts are reviewed first. */
function reviewInput(texts: ReadonlyMap<string, string>, stats: readonly FileStats[], findings: readonly HealthFinding[], map: BrainMap): ReviewPart[] {
	const flagged = new Map<string, number>();
	for (const finding of findings) {
		if (finding.file) { flagged.set(finding.file, (flagged.get(finding.file) ?? 0) + 1); }
	}
	const byPath = new Map(stats.map(s => [s.path, s]));
	const reviewable = [...texts.keys()].filter(path => !isSensitiveFile(path) && testSubject(path) === undefined);
	return [...groupByModule(reviewable)].map(([name, files]) => ({
		name,
		priority: files.reduce((sum, path) => sum + (flagged.get(path) ?? 0) * 100_000 + (byPath.get(path)?.lines ?? 0), 0),
		files: files.map(path => ({
			path, summary: describeEntry(map.files[path]) || undefined, text: redact(texts.get(path) ?? ''),
			focusLines: (byPath.get(path)?.classes ?? []).map(c => c.line),
		})),
	}));
}

async function rootFiles(root: vscode.Uri): Promise<RootFiles> {
	let names: string[] = [];
	try { names = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name); } catch { names = []; }
	return {
		names,
		packageJson: await readText(vscode.Uri.joinPath(root, 'package.json')),
		pyproject: await readText(vscode.Uri.joinPath(root, 'pyproject.toml')),
	};
}
```

- [ ] **Step 3: Replace `src/chat/analysisOffer.ts` entirely with:**

```ts
import * as vscode from 'vscode';
import { EXCLUDE_GLOB, SOURCE_GLOB } from '../brain/brain';
import { OfferKind, offerKind } from '../aiready/offer';

export interface AnalysisOffer {
	readonly files: number;
	readonly kind: OfferKind;
}

/** The one-time first-open offer: AI-ready for folders my_editor did not create, Analyse for ones without a brain. */
export async function analysisOffer(context: vscode.ExtensionContext, answeredKey: string): Promise<AnalysisOffer | undefined> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root || context.workspaceState.get(answeredKey)) { return undefined; }
	const exists = async (uri: vscode.Uri) => {
		try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
	};
	const kind = offerKind(await exists(vscode.Uri.joinPath(root, '.my_editor')),
		await exists(vscode.Uri.joinPath(root, '.my_editor', 'brain', 'map.json')));
	if (!kind) { return undefined; }
	const files = await vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB, 5_000);
	return files.length ? { files: files.length, kind } : undefined;
}
```

- [ ] **Step 4: Edit `src/chat/view.ts` (must end at 398 lines).** Make exactly these replacements:

1. `import { analysisOffer } from './analysisOffer';` → `import { makeAiReady } from '../aiready/healthRun';`
2. `const ANALYSE_ANSWERED = 'myEditor.analyse.answered';` → `export const ANALYSE_ANSWERED = 'myEditor.analyse.answered';`
3. In `analyse()`:
   - `/** Reads the whole project into the brain and drafts its architecture ("Analyse this project"). */` →
     `/** Reads the project into the brain and drafts its architecture; with aiReady, also writes the health report. */`
   - signature → `async analyse(aiReady = false): Promise<void> {`
   - `this.pending = { text: '', mode: ANALYSE };` → `this.pending = { text: '', mode: aiReady ? AI_READY : ANALYSE };`
   - `markdown: 'Analyse this project',` → `markdown: aiReady ? 'Make this project AI-ready' : 'Analyse this project',`
   - `await this.runReply(reply, (sink, token) => analyseProject(this.keys, this.proposals, sink, token));` →
     `await this.runReply(reply, (sink, token) => (aiReady ? makeAiReady : analyseProject)(this.keys, this.proposals, sink, token));`
4. Delete the `analyseOffer()` method: its doc comment `/** Count code files for the one-time project analysis offer. */`, the three method lines, and the blank line after it.
5. In the `'ready'` case replace these two consecutive lines:

```ts
					if (pending.mode === ANALYSE) {
						await this.analyse();
```

with:

```ts
					if (pending.mode === ANALYSE || pending.mode === AI_READY) {
						await this.analyse(pending.mode === AI_READY);
```
6. After the two lines `case 'analyse':` / `return this.analyse();` add:

```ts
			case 'aiReady':
				return this.analyse(true);
```

7. After the last line `const ANALYSE = '#analyse';` add `const AI_READY = '#ai-ready';`

Check: `wc -l src/chat/view.ts` → `398`.

- [ ] **Step 5: Edit `src/extension.ts`.**
   - Change `import { ChatView } from './chat/view';` to `import { ANALYSE_ANSWERED, ChatView } from './chat/view';` and add `import { analysisOffer } from './chat/analysisOffer';` after the `./chat/engine` import.
   - After the line registering `myEditor.analyseProject`, add:
     `vscode.commands.registerCommand('myEditor.aiReady', () => chat.analyse(true)),`
   - Replace `void chat.analyseOffer().then(files => { if (files) { void chat.openLounge(); } });` with
     `void analysisOffer(context, ANALYSE_ANSWERED).then(offer => { if (offer) { void chat.openLounge(); } });`

- [ ] **Step 6: `package.json`:** after the `myEditor.analyseProject` command object add:

```json
      {
        "command": "myEditor.aiReady",
        "title": "Make This Project AI-Ready",
        "category": "my_editor"
      },
```

- [ ] **Step 7: Offer card.** In `media/chatCards.js` replace the whole `renderOffer` function (from its doc comment to its closing brace) with:

```js
/** Asks before reading an existing project: nothing is written until the user says yes. */
function renderOffer(offer) {
	const files = offer.files;
	const aiReady = offer.kind === 'ai-ready';
	const yes = el('button', { type: 'button', class: 'pill primary' }, [icon('book'), aiReady ? 'Yes, make it AI-ready' : 'Analyse this project']);
	const only = el('button', { type: 'button', class: 'pill' }, ['Only get to know it']);
	const no = el('button', { type: 'button', class: 'pill' }, ['Not now']);
	yes.addEventListener('click', () => vscode.postMessage({ type: aiReady ? 'aiReady' : 'analyse' }));
	only.addEventListener('click', () => vscode.postMessage({ type: 'analyse' }));
	no.addEventListener('click', () => vscode.postMessage({ type: 'notNow' }));
	return el('div', { class: 'offer' }, [
		el('p', { class: 'offer-title' }, [aiReady ? 'Shall I get to know this project and make it AI-ready?' : 'Shall I get to know this project?']),
		el('p', {}, [`I’ll read its ${files >= 5000 ? 'code (over 5,000 files, so the first 5,000)' : `${files.toLocaleString('en')} code file${files === 1 ? '' : 's'}`} and write the project brain: a line on every file, a note per part and a draft architecture. Your code stays as it is.`]),
		...(aiReady ? [el('p', {}, ['Then I’ll write a health report: files over 400 lines, files with more than one class or job, missing tests, design notes and possible bugs.'])] : []),
		...(files > 1500 ? [el('p', { class: 'offer-note' }, ['It’s a big project, so I’ll start with the 1,500 most-used files. You can continue later.'])] : []),
		el('p', { class: 'offer-note' }, [`Uses ${state.models.find(m => m.key === state.model)?.label ?? 'the model picked below'}. Change it below first if you like.`]),
		el('div', { class: 'offer-actions' }, aiReady ? [yes, only, no] : [yes, no]),
	]);
}
```

- [ ] **Step 8: Compile and test.** `npm run -s compile 2>&1 | tail -3 && npm test 2>&1 | tail -6` → compile succeeds; all tests pass.

- [ ] **Step 9: Commit.**

```bash
git add src/aiready/healthRun.ts src/brain/analyse.ts src/chat/analysisOffer.ts src/chat/view.ts src/extension.ts media/chatCards.js package.json
git commit -m "Offer to make projects my_editor did not create AI-ready"
```

### Task 7: Project view entry

**Files:**
- Modify: `media/project.js`, `src/project/view.ts`

- [ ] **Step 1:** In `media/project.js`, inside the `memory` list right after the two `Brain` lines (`el('dt', {}, ['Brain']),` and its `el('dd', …)`), add:

```js
		el('dt', {}, ['Health']),
		el('dd', {}, [button('Check AI-readiness', () => vscode.postMessage({ type: 'aiReady' }))]),
```

- [ ] **Step 2:** In `src/project/view.ts`, after the `case 'brain':` block (the `executeCommand('myEditor.analyseProject')` line and its `return;`), add:

```ts
			case 'aiReady':
				await vscode.commands.executeCommand('myEditor.aiReady');
				return;
```

- [ ] **Step 3:** `npm run -s compile 2>&1 | tail -3 && npm test 2>&1 | tail -4` → succeeds, all pass.

- [ ] **Step 4: Commit.**

```bash
git add media/project.js src/project/view.ts
git commit -m "Start the AI-readiness check from the Project view"
```

### Task 8: Docs, app check, and hand-off

**Files (repo root):** `README.md`, `CHANGELOG.md`, `docs/progress.md`, `docs/plans/2026-10-07-ai-ready-design.md`

- [ ] **Step 1: README.** After the **Project brain** bullet in *What works today*, add:

```markdown
- **AI-ready check:** opening a project my_editor did not create asks *Shall I get to know this project and make it
  AI-ready?* Yes runs Analyse, then writes `.my_editor/ai-ready/report.md`: files over 400 lines, files with more than
  one class or job, untested files, the project's build and test commands, design notes and possible bugs at checked
  lines. Nothing in the code changes. Run it again from **Project → Health** or **my_editor: Make This Project
  AI-Ready**. Fixing on a separate local branch is the next stage.
```

- [ ] **Step 2: CHANGELOG.** Under `## Unreleased` add:

```markdown
- Opening a project my_editor did not create offers an AI-ready check: Analyse, then a health report of long files, extra classes, untested files, design notes and possible bugs. It changes no code. Also available from the Project view and the command palette.
```

- [ ] **Step 3: progress.md.** After the FR-089 row add:

```markdown
| FR-090 | Offer to make a foreign project AI-ready (7 October 2026) | 🟡 | Stage 1 health report built and unit-tested; live app check pending. Stage 2 fixes on a local branch are designed in `plans/2026-10-07-ai-ready-design.md`, not built. |
```

- [ ] **Step 4: Design doc.** In `docs/plans/2026-10-07-ai-ready-design.md`, in the *AI findings* list replace `each has an **Ask Pair** link.` with `the report tells the user to ask Pair about it.` In its components table, replace the five Stage 1 rows (`offer.ts`, `commandDetect.ts`, `health.ts`, `healthReview.ts`, `report.ts`) with:

```markdown
| `offer.ts` | 1 | Which offer a folder gets (pure); `chat/analysisOffer.ts` does the file checks | `offerKind(hasMyEditorFolder, hasBrain): 'ai-ready' \| 'analyse' \| undefined` |
| `commandDetect.ts` | 1 | Which build and test commands a project has | `detectCommands(rootFiles): DetectedCommands` (pure) |
| `health.ts` | 1 | File stats, test-file matching, deterministic findings | `fileStats(path, text)`, `scanHealth(stats, allPaths, commands, notCovered): HealthFinding[]` (pure) |
| `healthReview.ts` | 1 | Excerpts, reply parsing, the per-part review loop | `reviewParts(parts, ask, limits, cancelled): Promise<ReviewResult>` (model call passed in) |
| `report.ts` | 1 | Render `report.md` | `renderReport(input): string` (pure) |
| `healthRun.ts` | 1 | Run Analyse, then scan, review, write and open the report | `makeAiReady(keys, proposals, sink, token)` |
```

- [ ] **Step 5: Full verification.** From `overlay/extensions/my-editor-core`: `npm run -s compile && npm test 2>&1 | tail -6` → all pass. `wc -l src/aiready/*.ts src/chat/view.ts` → every file ≤ 400 (view.ts 398).

- [ ] **Step 6: Commit (local only).**

```bash
cd /Users/u/funcoding/my_editor
git add README.md CHANGELOG.md docs/progress.md docs/plans/2026-10-07-ai-ready-design.md docs/plans/2026-10-07-ai-ready-stage1-plan.md
git commit -m "Document the AI-ready health report"
```

- [ ] **Step 7: Install for the user's live check.** Only after the user confirms my_editor is closed: `scripts/install.sh`. Live check for the user: open a cloned project with no `.my_editor/` folder → the Pair offer shows three buttons → **Yes, make it AI-ready** → Analyse runs, then the report opens in a Markdown preview, and `git status` in that project shows only `.my_editor/` changes. Also check:
  - Stop during the review phase still writes a partial report and shows the summary.
  - The Markdown preview opens. If `markdown.showPreview` is missing in the build, open the file in an editor instead.
  - On a big project the report stays readable.

  Do not push.
