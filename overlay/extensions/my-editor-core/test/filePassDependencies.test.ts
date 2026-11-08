import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { prioritizeDependencies, requestedDependencies } from '../src/project/filePassDependencies';
import { checkpointDue, checkpointFiles } from '../src/project/filePassPlan';

test('dependency conclusions require an explicit bounded list, never inferred prose', () => {
	assert.deepEqual(requestedDependencies('BLOCKED\nDEPENDENCIES_REQUIRED ["src/core.ts"]'), ['src/core.ts']);
	assert.equal(requestedDependencies('BLOCKED\nImplement core.ts first or choose a contract.'), undefined);
	assert.equal(requestedDependencies('FILE_REVIEWED\nDone.'), undefined);
	for (const json of ['[]', '[1]', '[""]', '["a","a"]', '{}', 'not-json', JSON.stringify(Array.from({ length: 21 }, (_, i) => String(i)))]) {
		assert.throws(() => requestedDependencies('BLOCKED\nDEPENDENCIES_REQUIRED ' + json));
	}
});

test('unbuilt dependencies move before their consumer, preserving module membership and checkpoints', () => {
	const modules = [{ title: 'Service', files: ['config.json', 'main.ts', 'core.ts', 'routes.ts', 'test.ts'] },
		{ title: 'UI', files: ['ui.ts'] }];
	const next = prioritizeDependencies(modules, { path: 'main.ts', dependencies: ['routes.ts', 'core.ts'] }, ['config.json'], []);
	assert.deepEqual(next[0].files, ['config.json', 'core.ts', 'routes.ts', 'main.ts', 'test.ts']);
	assert.deepEqual(modules[0].files, ['config.json', 'main.ts', 'core.ts', 'routes.ts', 'test.ts']);
	assert.equal(checkpointDue(next, 'main.ts', 1), false);
	assert.equal(checkpointDue(next, 'test.ts', 1), true);
	assert.deepEqual(checkpointFiles(next, 'test.ts', 1), next[0].files);
	assert.deepEqual(next[1], modules[1]);
});

test('dependency requests cannot expand selected scope, revisit completed files or cross modules', () => {
	const modules = [{ title: 'Service', files: ['main.ts', 'core.ts'] }, { title: 'UI', files: ['ui.ts'] }];
	for (const dependency of ['main.ts', 'ui.ts', '../secret.ts', '.my_editor/specs/tree.json', 'new.ts']) {
		assert.throws(() => prioritizeDependencies(modules, { path: 'main.ts', dependencies: [dependency] }, [], []), /unfinished files/);
	}
	assert.throws(() => prioritizeDependencies(modules, { path: 'main.ts', dependencies: ['core.ts'] }, ['core.ts'], []));
	assert.throws(() => prioritizeDependencies([{ title: 'Selected', files: ['main.ts'] }],
		{ path: 'main.ts', dependencies: ['core.ts'] }, [], []));
});

test('dependency chains may advance, but direct and transitive cycles and repeated requests stop', () => {
	const modules = [{ title: 'Service', files: ['a.ts', 'b.ts', 'c.ts', 'test.ts'] }];
	const first = { path: 'a.ts', dependencies: ['b.ts'] };
	const next = prioritizeDependencies(modules, first, [], []);
	const second = { path: 'b.ts', dependencies: ['c.ts'] };
	assert.deepEqual(prioritizeDependencies(next, second, [], [first])[0].files, ['c.ts', 'b.ts', 'a.ts', 'test.ts']);
	assert.throws(() => prioritizeDependencies(next, { path: 'b.ts', dependencies: ['a.ts'] }, [], [first]), /circular/);
	assert.throws(() => prioritizeDependencies(next, { path: 'c.ts', dependencies: ['a.ts'] }, [], [first, second]), /circular/);
	assert.throws(() => prioritizeDependencies(next, first, [], [first]), /repeated/);
});
