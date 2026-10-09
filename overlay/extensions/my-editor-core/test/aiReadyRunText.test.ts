import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CheckResult, checkSummary, compareWithBaseline } from '../src/aiready/baseline';
import type { LanguageAdapter } from '../src/aiready/language';
import { planProblems } from '../src/aiready/splitPlan';
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
		+ "    not ok 1 - inner\n      ---\n      location: '/w/test/c.test.mjs:3:5'\n      ...\nnot ok 3 - g\n  ---\n  location: '/w/test/c.test.mjs:1:1'\n  ...\n1..3\n";
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
