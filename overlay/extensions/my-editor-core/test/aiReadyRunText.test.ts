import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CheckResult, checkSummary, compareWithBaseline } from '../src/aiready/baseline';
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
