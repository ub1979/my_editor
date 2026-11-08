import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkpointDue, checkpointFiles, passTargets } from '../src/project/filePassPlan';
import { companionTest, eligibleFile, fileContentProblem } from '../src/project/filePassPolicy';

const modules = [{ title: 'Store', files: ['store.ts', 'store.test.ts'] },
	{ title: 'API', files: ['api.ts'] }, { title: 'App', files: ['main.ts'] }];

test('file and module checkpoints use the chosen boundary even for uneven modules', () => {
	assert.deepEqual(modules.flatMap(m => m.files).filter(p => checkpointDue(modules, p, 2)), ['api.ts']);
	assert.equal(checkpointDue(modules, 'store.ts', 1), false);
	assert.equal(checkpointDue(modules, 'store.test.ts', 1), true);
	assert.equal(checkpointDue(modules, 'store.ts', 'file'), true);
	assert.equal(checkpointDue(modules, 'main.ts', 0), false);
	assert.deepEqual(checkpointFiles(modules, 'api.ts', 2), ['store.ts', 'store.test.ts', 'api.ts']);
	assert.deepEqual(checkpointFiles(modules, 'main.ts', 2), ['main.ts']);
	assert.deepEqual(checkpointFiles(modules, 'main.ts', 0), ['store.ts', 'store.test.ts', 'api.ts', 'main.ts']);
	assert.deepEqual(passTargets(modules, 'store.test.ts'), [{ title: 'Store', files: ['store.test.ts'] }]);
	assert.deepEqual(passTargets(modules, 'other.py'), [{ title: 'Selected file', files: ['other.py'] }]);
});

test('companion changes are limited to explicit new test paths in the project', () => {
	for (const path of ['svc/store.test.ts', 'tests/test_store.py', 'lib/store_test.go', 'StoreTest.java']) { assert.ok(companionTest(path), path); }
	for (const path of ['../store.test.ts', 'x/../lib.test.ts', '.git/config', 'dir/.my_editor/store.test.ts', '.env', 'src/store.ts']) { assert.equal(companionTest(path), false, path); }
	assert.equal(eligibleFile('config/.env.local'), false);
	assert.equal(eligibleFile('src/main.ts'), true);
});

test('all generated files, including configuration and tests, are limited at 600 actual lines', () => {
	for (const path of ['foo.py', 'foo.toml', 'info.md', 'store.test.ts']) {
		assert.equal(fileContentProblem(path, 'x\n'.repeat(600)), undefined);
		assert.match(fileContentProblem(path, 'x\n'.repeat(601))!, /600 lines/);
	}
	for (const ext of ['js', 'py', 'cpp', 'kt', 'dart', 'rb']) {
		assert.match(fileContentProblem('test.' + ext, 'class One {}\nclass Two {}')!, /one class/);
	}
	assert.match(fileContentProblem('config.json', '{"unclosed"')!, /invalid JSON/);
	assert.match(fileContentProblem('source.ts', '// ... existing code')!, /omissions/);
	assert.ok(fileContentProblem('source.ts', '[REDACTED]'));
	assert.ok(fileContentProblem('source.ts', '   '));
});

test('generated content rejects the same unsafe data before saving as the source reader', () => {
	assert.match(fileContentProblem('server.test.ts', 'const data = { token: "fixture-credential-value" };')!, /look like credentials/);
	assert.match(fileContentProblem('source.ts', 'value\0text')!, /binary content/);
	assert.equal(fileContentProblem('server.test.ts', 'const data = { token: "tok123" };'), undefined);
	assert.equal(fileContentProblem('server.test.ts', 'const data = { token: FAKE.token, password: FAKE.password };'), undefined);
	assert.equal(fileContentProblem('server.test.ts', 'const token = process.env.TEST_VALUE;'), undefined);
	assert.match(fileContentProblem('server.test.ts', '// token: fixture-credential-value')!, /look like credentials/);
	assert.match(fileContentProblem('server.test.ts', 'const data = { token: FAKE./* token: fixture-credential-value */token };')!, /look like credentials/);
	assert.match(fileContentProblem('config.yaml', 'token: fixture-credential-value')!, /look like credentials/);
	assert.match(fileContentProblem('server.test.ts', 'const token = ghp_' + 'A'.repeat(24) + ';')!, /look like credentials/);
});
