import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CheckResult, checkSummary, compareWithBaseline, failureLines, flakyTests, Outcome, runBaseline, unverified } from '../src/aiready/baseline';

const tests = (outcomes: Record<string, Outcome>, packages: Record<string, Outcome> = {}) => ({ tests: outcomes, packages });
const testRun = (code: number, outcomes: Record<string, Outcome>, packages: Record<string, Outcome> = {}): CheckResult =>
	({ command: 'go test -count=1 -json ./a', code, failures: [], tests: tests(outcomes, packages), tail: '', log: '' });
const checkRun = (code: number, output: string): CheckResult =>
	({ command: 'go vet ./internal/store', code, failures: failureLines(output), tail: '', log: '' });

test('failureLines drops file positions so a moved declaration compares equal', () => {
	assert.deepEqual(failureLines('a/b.go:12:3: undefined: X\n./c.go:4: bad\n\n# pkg\nundefined: X\n'), ['# pkg', 'bad', 'undefined: X']);
});

test('the baseline excludes flaky tests, and failing tests must fail the same way', () => {
	const baseline: [CheckResult, CheckResult] = [
		testRun(1, { 'm/a TestX': 'pass', 'm/a TestFlaky': 'pass', 'm/a TestBroken': 'fail' }, { 'm/a': 'fail' }),
		testRun(1, { 'm/a TestX': 'pass', 'm/a TestFlaky': 'fail', 'm/a TestBroken': 'fail' }, { 'm/a': 'fail' }),
	];
	assert.deepEqual(flakyTests(baseline[0].tests, baseline[1].tests), ['m/a TestFlaky']);
	assert.deepEqual(compareWithBaseline(baseline, baseline[1]).problems, []);
	const changed = testRun(1, { 'm/a TestX': 'fail', 'm/a TestFlaky': 'pass', 'm/a TestBroken': 'fail' }, { 'm/a': 'fail' });
	assert.match(compareWithBaseline(baseline, changed).problems.join(' '), /m\/a TestX: pass before, fail now/);
	const fixed = testRun(1, { 'm/a TestX': 'pass', 'm/a TestBroken': 'pass' }, { 'm/a': 'fail' });
	assert.match(compareWithBaseline(baseline, fixed).problems.join(' '), /TestBroken: fail before, pass now/);
	const added = testRun(1, { ...baseline[0].tests!.tests, 'm/a TestAiNew': 'fail' }, { 'm/a': 'fail' });
	assert.deepEqual(compareWithBaseline(baseline, added, ['TestAiNew']), { problems: [], newFailing: ['m/a TestAiNew'] });
	assert.match(compareWithBaseline(baseline, added).problems.join(' '), /TestAiNew: a test that did not exist before/);
	assert.match(compareWithBaseline(baseline, { ...changed, code: undefined, timedOut: true }).problems[0], /timed out/);
});

test('a package that gains tests may go from no test files to pass, or fail only through its new tests', () => {
	const empty = testRun(0, {}, { 'm/b': 'skip' });
	const gained = testRun(1, { 'm/b TestAiOk': 'pass', 'm/b TestAiBad': 'fail' }, { 'm/b': 'fail' });
	assert.deepEqual(compareWithBaseline([empty, empty], gained, ['TestAiOk', 'TestAiBad']), { problems: [], newFailing: ['m/b TestAiBad'] });
	assert.deepEqual(compareWithBaseline([empty, empty], testRun(0, { 'm/b TestAiOk': 'pass' }, { 'm/b': 'pass' }), ['TestAiOk']).problems, []);
});

test('new tests count only when they passed: a test binary that did not build verifies nothing', () => {
	const run = tests({ 'm TestAiX': 'pass', 'm TestAiY': 'pass', 'm TestAiY/sub': 'fail' });
	assert.deepEqual(unverified(['TestAiX', 'TestAiY', 'TestAiZ'], run), ['TestAiY', 'TestAiZ']);
	assert.deepEqual(unverified(['TestAiX'], undefined), ['TestAiX']);
});

test('a vet failure that existed before must stay the same, wherever its line moved', () => {
	const before = '# m/internal/vad\nsilero_engine.c:6:10: fatal error: \'onnxruntime_c_api.h\' file not found\n';
	const baseline: [CheckResult, CheckResult] = [checkRun(1, before), checkRun(1, before)];
	assert.deepEqual(compareWithBaseline(baseline, checkRun(1, before.replace(':6:10:', ':9:2:'))).problems, []);
	assert.match(compareWithBaseline(baseline, checkRun(1, `${before}store/a.go:3:1: undefined: x\n`)).problems[0], /failed differently: \+ undefined: x/);
	assert.match(compareWithBaseline(baseline, checkRun(0, '')).problems[0], /now passes but failed before/);
	assert.match(compareWithBaseline([checkRun(0, ''), checkRun(0, '')], checkRun(2, 'x')).problems[0], /failed \(exit 2\) but passed before/);
	const downloading: [CheckResult, CheckResult] = [checkRun(1, `go: downloading golang.org/x/sys v0.33.0\n${before}`), checkRun(1, before)];
	assert.deepEqual(compareWithBaseline(downloading, checkRun(1, before)).problems, [], 'a line in only one baseline run is volatile');
});

test('checkSummary names each command once and counts the last test run', () => {
	const summary = checkSummary([checkRun(0, ''), testRun(0, { 'm A': 'pass', 'm B': 'skip' }), testRun(0, { 'm A': 'pass', 'm B': 'pass' })], ['m C']);
	assert.equal(summary, '`go vet ./internal/store`, `go test -count=1 -json ./a`: same as before (2 of 2 tests passing); 1 flaky excluded.');
});

test('a baseline run that timed out or did not start stops the run with what to do', async () => {
	const checks = [{ label: 'build' as const, command: 'go build ./...' }, { label: 'test' as const, command: 'go test ./a' }];
	const ok = (command: string): CheckResult => ({ command, code: 0, failures: [], tail: '', log: '' });
	const run = (bad: Partial<CheckResult>, cancelled = false) => runBaseline(checks, {
		check: async command => (command === 'go test ./a' ? { ...ok(command), ...bad } : ok(command)), cancelled: () => cancelled, progress: () => undefined,
	});
	const good = await run({});
	assert.ok('baseline' in good && good.baseline['go test ./a'][1].code === 0);
	const timedOut = await run({ code: undefined, timedOut: true });
	assert.ok('problem' in timedOut);
	assert.match(timedOut.problem, /`go test \.\/a` timed out[\s\S]*commandTimeoutMinutes/);
	const unstarted = await run({ code: undefined, tail: 'go was not found.' });
	assert.ok('problem' in unstarted);
	assert.match(unstarted.problem, /`go test \.\/a` did not start: go was not found\.[\s\S]*fix the command/);
	assert.deepEqual(await run({}, true), { stopped: true });
});
