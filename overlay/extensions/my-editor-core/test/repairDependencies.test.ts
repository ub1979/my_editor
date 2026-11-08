import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { scheduleRepairDependencies } from '../src/project/repairDependencies';
import type { QueuedRepair } from '../src/project/filePassRepairs';

const modules = [{ title: 'Composer', files: ['publish.ts', 'routes.ts', 'test.ts'] }];
const queue: QueuedRepair[] = ['routes.ts', 'test.ts'].map(path => ({ path, origin: 'publish.ts', reason: 'Use integer IDs',
	decision: { source: 'developer', quote: 'Use integer IDs.' } }));
const request = { path: 'routes.ts', dependencies: ['publish.ts'] };

test('a repair prerequisite runs before the repair, including an unscheduled legacy request', () => {
	for (const history of [[], [request]]) {
		const result = scheduleRepairDependencies(modules, queue, request, [], history, []);
		assert.deepEqual(result.queue.map(item => item.path), ['publish.ts', 'routes.ts', 'test.ts']);
		assert.equal(result.queue[0].decision.quote, 'Use integer IDs.');
		assert.deepEqual(queue.map(item => item.path), ['routes.ts', 'test.ts']);
	}
});

test('repaired existing consumers may request unfinished prerequisites; pending prerequisites are not duplicated', () => {
	const result = scheduleRepairDependencies(modules, queue, { path: 'routes.ts', dependencies: ['test.ts'] }, ['routes.ts'], [], []);
	assert.deepEqual(result.queue.map(item => item.path), ['test.ts', 'routes.ts']);
	assert.equal(result.queue[0], queue[1]);
});

test('repair scheduling still rejects completed prerequisites, scope expansion, actual repeats and cycles', () => {
	assert.throws(() => scheduleRepairDependencies(modules, queue, request, ['publish.ts'], [], []), /unfinished/);
	assert.throws(() => scheduleRepairDependencies(modules, queue, { ...request, dependencies: ['outside.ts'] }, [], [], []), /unfinished/);
	assert.throws(() => scheduleRepairDependencies(modules, queue, request, [], [request], [request]), /repeated/);
	assert.throws(() => scheduleRepairDependencies(modules, queue, request, [], [{ path: 'publish.ts', dependencies: ['routes.ts'] }], []), /circular/);
});
