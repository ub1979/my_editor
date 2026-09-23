import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projectVisuals } from '../src/project/visualPlan';

test('project visuals link architecture parts through the saved file map', () => {
	const architecture = '# Dialer\n\nA calling service.\n\n## API {#internal-api}\n\nAccepts requests.\n\n## Store {#internal-store}\n\nPersists data.\n\n## Decisions\n\nKeep it simple.\n';
	const tree = JSON.stringify([
		{ path: 'internal/api/server.go', section: 'internal-api', status: 'done' },
		{ path: 'internal/store/db.go', section: 'internal-store', status: 'in-progress' },
	]);
	const brain = JSON.stringify({ files: {
		'internal/api/server.go': { imports: ['internal/store/db.go'] },
		'internal/store/db.go': { imports: [] },
	} });
	const result = projectVisuals(architecture, tree, brain);
	assert.equal(result.overview, 'A calling service.');
	assert.deepEqual(result.parts.map(part => [part.id, part.fileCount, part.uses]), [
		['internal-api', 1, [{ id: 'internal-store', count: 1 }]],
		['internal-store', 1, []],
	]);
	assert.equal(result.files[1].status, 'in-progress');
});

test('project visuals tolerate missing or unfinished specs', () => {
	assert.deepEqual(projectVisuals('', '', '').parts, []);
	assert.deepEqual(projectVisuals('## API {#api}\n\nHandles requests.', 'invalid JSON').files, []);
});
