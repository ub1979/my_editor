import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CheckResult, checkSummary, compareWithBaseline, runSetup } from '../src/aiready/baseline';
import { renderChangeNote, reportPath, writeRunReport } from '../src/aiready/changeNote';
import type { RunState } from '../src/aiready/fixState';
import { GO_LANGUAGE } from '../src/aiready/goAdapter';
import type { LanguageAdapter } from '../src/aiready/language';
import { fixableFinding, languageNote } from '../src/aiready/languages';
import { planProblems } from '../src/aiready/splitPlan';
import { TS_LANGUAGE } from '../src/aiready/tsAdapter';
import { parseTsTests } from '../src/aiready/tsTests';

const ROOTS = ['/w'];

test('unknown test output gives no test results, so the run is compared by exit code alone and the summary says so', () => {
	assert.equal(parseTsTests('> x test\n> ava\n\n  ✔ adds\n  1 test passed\n', ROOTS), undefined);
	const run = (code: number): CheckResult => ({ command: 'npm test', label: 'test', code, failures: [], tail: '', log: '', tests: undefined });
	const passing = { 'npm test': [run(0), run(0)] as const };
	assert.deepEqual(compareWithBaseline(passing['npm test'], run(0)).problems, []);
	assert.equal(compareWithBaseline(passing['npm test'], run(1)).problems.length, 1);
	assert.equal(checkSummary([run(0)], [], passing), '`npm test`: passed; exit code only (test output not recognised).');
	const failing = { 'npm test': [run(1), run(1)] as const };
	const summary = checkSummary([run(1)], [], failing);
	assert.equal(summary, '`npm test`: already failing before this run (not a check); exit code only (test output not recognised).');
	assert.doesNotMatch(summary, /one by one/);
});

test('Jest focused tests count as skipped, not failed', () => {
	const jest = '{"testResults":[{"name":"/w/a.test.js","status":"passed","assertionResults":[{"ancestorTitles":[],"title":"t","status":"focused"}]}]}';
	assert.deepEqual(parseTsTests(jest, ROOTS), { tests: { 'a.test.js t': 'skip' }, packages: { 'a.test.js': 'pass' } });
});

test('node --test TAP keys take the file from the YAML location when Node prints one (failures), else node:test', () => {
	const tap = 'TAP version 13\n# Subtest: same\nok 1 - same\n  ---\n  duration_ms: 1\n  ...\n# Subtest: same\nnot ok 2 - same\n  ---\n'
		+ "  duration_ms: 1\n  location: '/w/test/b test.mjs:2:1'\n  failureType: 'testCodeFailure'\n  ...\n# Subtest: g\n    # Subtest: inner\n"
		+ "    not ok 1 - inner\n      ---\n      location: '/w/test/c.test.mjs:3:5'\n      ...\n"
		+ "not ok 3 - g\n  ---\n  location: '/w/test/c.test.mjs:1:1'\n  ...\n1..3\n";
	assert.deepEqual(parseTsTests(tap, ROOTS), {
		tests: { 'node:test same': 'pass', 'test/b_test.mjs same': 'fail', 'test/c.test.mjs g › inner': 'fail', 'test/c.test.mjs g': 'fail' },
		packages: { 'node:test': 'pass', 'test/b_test.mjs': 'fail', 'test/c.test.mjs': 'fail' },
	});
});

test('plan problems quote a model-written file name as JSON, cut to 60 characters, and are capped in number', () => {
	const adapter = { fileNameProblems: () => ['use letters'] } as unknown as LanguageAdapter;
	const declaration = { id: 0, kind: 'function', names: ['a'], span: { start: 0, end: 1 }, lines: 1, doc: '', docText: '', uses: [], movable: true };
	const input = { source: Buffer.from('a'), info: { path: 'src/a.ts', declarations: [declaration], frame: [], imports: [] }, existing: [] };
	const evil = `${'x'.repeat(100)}\n## Injected heading\n- [click](http://example.com)`;
	const problems = planProblems(adapter, input, [{ file: evil, declarations: [] }]);
	assert.ok(problems.length >= 2);
	for (const problem of problems) {
		assert.doesNotMatch(problem, /\n|Injected/);
		assert.ok(problem.startsWith(JSON.stringify(evil).slice(0, 60)), problem);
	}
	const many = planProblems(adapter, input, Array.from({ length: 30 }, (_, i) => ({ file: `f${i}.ts`, declarations: [] })));
	assert.equal(many.length, 11);
	assert.match(many[10], /^and 50 more problems\.$/);
});

test('setup is skipped when its result is still in place (Continue after an install), but the worktree is still checked', async () => {
	let ran = 0;
	const runner = { check: async (): Promise<CheckResult> => { ran++; return { command: 'npm ci', code: 1, failures: [], tail: 'x', log: '' }; },
		cancelled: () => false, progress: () => undefined };
	const install = [{ label: 'install' as const, command: 'npm ci' }];
	assert.equal(await runSetup(install, runner, async () => [], () => 'pkg-a resolves outside', true), 'pkg-a resolves outside');
	assert.equal(await runSetup(install, runner, async () => [], () => undefined, true), undefined);
	assert.equal(ran, 0);
	assert.match(await runSetup(install, runner, async () => [], () => undefined) ?? '', /failed \(exit 1\)/);
});

test('fixable findings come from the adapters\' extensions and fixes; a mixed Go and TS folder says Go is chosen first', () => {
	assert.ok(fixableFinding('src/a.ts', 'too-long') && fixableFinding('src/a.mjs', 'too-long') && fixableFinding('a.go', 'untested'));
	assert.ok(!fixableFinding('src/a.ts', 'untested') && !fixableFinding('a.rs', 'too-long') && !fixableFinding('a.go', 'design'));
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-mixed-'));
	writeFileSync(path.join(dir, 'go.mod'), 'module x\n');
	assert.equal(languageNote(dir), undefined);
	writeFileSync(path.join(dir, 'package.json'), '{}');
	assert.match(languageNote(dir) ?? '', /both Go and TypeScript\/JavaScript.*Go is chosen, so only Go files/);
	const django = mkdtempSync(path.join(os.tmpdir(), 'my-editor-mixed-'));
	writeFileSync(path.join(django, 'manage.py'), '');
	assert.equal(languageNote(django), undefined);
	writeFileSync(path.join(django, 'package.json'), '{}');
	assert.equal(languageNote(django), 'This folder has both TypeScript/JavaScript and Python in its top folder; TypeScript/JavaScript is chosen, '
		+ 'so only TypeScript/JavaScript files are offered.');
	writeFileSync(path.join(django, 'go.mod'), 'module x\n');
	assert.match(languageNote(django) ?? '', /^This folder has Go, TypeScript\/JavaScript and Python in its top folder; Go is chosen, so only Go files/);
});

test('the change note takes what may differ from the adapter and stays neutral without one', () => {
	const state: RunState = {
		version: 1, root: '/p/shop', language: 'Go', worktree: { branch: 'b', path: '/p/w', base: '0123456789abcdef' }, startedAt: '2026-10-09T10:00:00Z',
		approved: [], fixes: [], next: 0, steps: [], baseline: {}, skippedFiles: [],
	};
	const at = new Date('2026-10-09T12:34:00Z');
	const neutral = renderChangeNote(state, at);
	assert.match(neutral, /File names and line numbers in error traces may differ for moved code\./);
	assert.doesNotMatch(neutral, /runtime\.Caller|console\.trace/);
	assert.match(renderChangeNote(state, at, GO_LANGUAGE.mayDiffer), /runtime\.Caller/);
	assert.match(renderChangeNote({ ...state, language: TS_LANGUAGE.label }, at, TS_LANGUAGE.mayDiffer), /`console\.trace`/);
});

test('the change note names types-only moves and the health report only when they apply', () => {
	const fix = { file: 'a.ts', kind: 'split' as const, lines: 500 };
	const step = { file: 'a.ts', kind: 'split' as const, status: 'committed' as const, commit: 'abcdef1234', moved: [] };
	const state: RunState = {
		version: 1, root: '/p/shop', language: 'TypeScript/JavaScript', worktree: { branch: 'b', path: '/p/w', base: '0123456789abcdef' },
		startedAt: '2026-10-09T10:00:00Z',
		approved: [], fixes: [fix], next: 1, steps: [step], baseline: {}, skippedFiles: [],
	};
	const at = new Date('2026-10-09T12:34:00Z');
	const plain = renderChangeNote(state, at, TS_LANGUAGE.mayDiffer);
	assert.doesNotMatch(plain, /types-only|health report/);
	const types = renderChangeNote({ ...state, fixes: [{ ...fix, narrowed: 'only types may move (x)' }] }, at, TS_LANGUAGE.mayDiffer, true);
	assert.match(types, /moved in a types-only project/);
	assert.match(types, /from the health report are suggestions/);
});

test('a run summary creates the health report when there was none', () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-report-'));
	const state = { worktree: { branch: 'b' }, steps: [] } as unknown as RunState;
	assert.equal(writeRunReport(root, state, 'n.md'), true);
	assert.match(readFileSync(reportPath(root), 'utf8'), /^# AI-ready health report[\s\S]*## Fixes on a local branch/);
});
