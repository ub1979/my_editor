import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MAX_TEST_REPAIR_FILES, parseTestRepairs, TestRepairFormatError, testRepairModules, testRepairProblem, testRepairSignature } from '../src/project/testRepairPlan';

const modules = [{ title: 'Service', files: ['src/service.ts', 'test/service.test.ts'] }];
const format = (files: unknown) => 'TEST_REPAIRS\n' + JSON.stringify({ files });
test('fresh QA discovery adopts existing tests once without adopting arbitrary production or unsafe paths', () => {
	const expanded = testRepairModules(modules, ['test/late.test.ts', 'test/late.test.ts', 'src/unplanned.ts', '../outside.test.ts', '.env']);
	assert.deepEqual(expanded.flatMap(group => group.files), [...modules[0].files, 'test/late.test.ts']);
	assert.deepEqual(testRepairModules(expanded, ['test/late.test.ts']), expanded);
	assert.deepEqual(testRepairModules(modules, []), modules, 'Selected-file callers do not pass a whole-project discovery');
	assert.equal(modules.length, 1, 'Discovery does not mutate the original saved scope');
});
test('failure diagnosis can revisit implementation and tests together but cannot expand scope', () => {
	const files = modules[0].files.map(path => ({ path, reason: 'Observed incompatible return value in failing assertion.' }));
	assert.deepEqual(parseTestRepairs(format(files), modules), files);
	for (const invalid of [[...files, files[0]], [{ path: '../outside.ts', reason: 'fix' }], [], [{ path: files[0].path }]]) {
		assert.throws(() => parseTestRepairs(format(invalid), modules));
	}
	assert.throws(() => parseTestRepairs('All tests pass', modules));
	assert.throws(() => parseTestRepairs('TEST_REPAIRS\ninvalid', modules));
});

test('diagnosis format failures are recoverable but genuine blockers are not', () => {
	const files = Array.from({ length: MAX_TEST_REPAIR_FILES + 1 }, (_, n) => ({ path: `test/${n}.test.ts`, reason: 'Observed failure.' }));
	const scope = [{ title: 'Tests', files: files.map(file => file.path) }];
	assert.equal(parseTestRepairs(format(files.slice(0, MAX_TEST_REPAIR_FILES)), scope).length, MAX_TEST_REPAIR_FILES);
	assert.throws(() => parseTestRepairs(format(files), scope), error => error instanceof TestRepairFormatError && /received 21/.test(error.message));
	assert.throws(() => parseTestRepairs('TEST_REPAIRS\ninvalid', scope), TestRepairFormatError);
	assert.throws(() => parseTestRepairs('I inspected the failure.', scope), TestRepairFormatError);
	assert.throws(() => parseTestRepairs('BLOCKED: environment evidence requires a decision.', scope), error => error instanceof Error && !(error instanceof TestRepairFormatError));
});

test('retry guards use saved source progress, not changing log names or model summaries', () => {
	const results = [{ path: 'src/service.ts', hash: 'a', note: 'old' }, { path: 'test/service.test.ts', hash: 'b', note: '' }];
	const signature = testRepairSignature(results);
	assert.equal(testRepairSignature([...results].reverse().map(row => ({ ...row, note: 'new model claim' }))), signature);
	assert.notEqual(testRepairSignature([{ ...results[0], hash: 'changed' }, results[1]]), signature);
	const attempt = { signature, files: [{ path: results[0].path, reason: 'fix' }] };
	assert.match(testRepairProblem([attempt], signature)!, /No source progress/);
	assert.match(testRepairProblem(Array(5).fill(attempt), 'new')!, /Five/);
	assert.equal(testRepairProblem([attempt], 'new'), undefined);
});
