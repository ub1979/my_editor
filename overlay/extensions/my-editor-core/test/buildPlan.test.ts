import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BuildPlan, buildPlanProblems, orderedSteps } from '../src/project/buildPlan';
import { BuildProgress, digest, stepStates } from '../src/project/buildProgress';
import { planningProblems } from '../src/project/planning';
import { requirements, architecture } from './planningFixture';

const files = [
	{ path: 'src/main.ts', role: 'Compose the application.', section: 'composer', requirements: ['FR-001'], estimatedLines: 100 },
	{ path: 'src/store.ts', role: 'Store drafts.', section: 'store', requirements: ['FR-001'], estimatedLines: 160 },
	{ path: 'test/store.test.ts', role: 'Test storage.', section: 'store', requirements: ['FR-001'], estimatedLines: 120 },
];
const plan = (): BuildPlan => ({ version: 1, entryPoint: 'src/main.ts', steps: [
	{ id: 'app', title: 'Wire the application', files: ['src/main.ts'], dependsOn: ['store'],
		tasks: ['Connect the store and startup.'], checks: ['Start the app and reopen a saved draft.'] },
	{ id: 'store', title: 'Build the storage library', files: ['src/store.ts', 'test/store.test.ts'], dependsOn: [],
		tasks: ['Implement storage and its tests.'], checks: ['Run the storage tests: saves survive reopening and corrupt drafts report a typed error.'] },
] });

test('new guidance plans full source sizes and dependency order while old trees stay valid', () => {
	assert.deepEqual(buildPlanProblems({ files, buildPlan: plan() }, files), []);
	assert.deepEqual(orderedSteps(plan().steps).map(step => step.id), ['store', 'app']);
	assert.deepEqual(buildPlanProblems(files, files), []);
	assert.deepEqual(planningProblems('tree', { requirements, architecture, tree: JSON.stringify({ files, buildPlan: plan() }) }), []);
	const oversized = files.map(file => ({ ...file, estimatedLines: 450 }));
	assert.ok(buildPlanProblems({ buildPlan: plan() }, oversized).every(problem => problem.includes('split oversized responsibilities')));
	const legacy = files.map(({ estimatedLines, ...file }) => file);
	assert.equal(planningProblems('tree', { requirements, architecture, tree: JSON.stringify(legacy) }).length, 0);
	assert.equal(buildPlanProblems({ buildPlan: plan() }, legacy).length, 3);
});

test('unknown paths, cycles, missing checks and unassigned files cannot form a build plan', () => {
	const cyclic = plan(); cyclic.steps[1].dependsOn = ['app'];
	assert.ok(buildPlanProblems({ buildPlan: cyclic }, files).some(problem => problem.includes('cycle')));
	const unknown = plan(); unknown.steps[0].dependsOn = ['unplanned'];
	assert.ok(buildPlanProblems({ buildPlan: unknown }, files).some(problem => problem.includes('unknown prerequisite')));
	const missing = plan(); missing.steps[0].checks = [];
	assert.ok(buildPlanProblems({ buildPlan: missing }, files).some(problem => problem.includes('verification checks')));
	const unassigned = plan(); unassigned.steps[1].files = ['src/store.ts'];
	assert.ok(buildPlanProblems({ buildPlan: unassigned }, files).some(problem => problem.includes('test/store.test.ts needs a build step')));
	const unsafe = [...files, { path: '../escape.ts', estimatedLines: 20 }];
	assert.ok(buildPlanProblems({ buildPlan: plan() }, unsafe).some(problem => problem.includes('Unsafe planned path')));
});

test('checks require explicit evidence and dependency confirmation, never a done file status', () => {
	const steps = orderedSteps(plan().steps);
	const snapshots = new Map(files.map(file => [file.path, { hash: digest(file.path) }]));
	const progress: BuildProgress = { version: 1, steps: {} };
	let states = stepStates(steps, snapshots, progress);
	assert.deepEqual(states.map(state => state.status), ['ready', 'blocked']);
	progress.steps.store = { signature: states[0].signature, confirmedAt: 'now', evidence: 'user-confirmed' };
	states = stepStates(steps, snapshots, progress);
	assert.deepEqual(states.map(state => state.status), ['verified', 'ready']);
	progress.steps.app = { signature: states[1].signature, confirmedAt: 'now', evidence: 'user-confirmed' };
	assert.deepEqual(stepStates(steps, snapshots, progress).map(state => state.status), ['verified', 'verified']);
	snapshots.set('src/store.ts', { hash: 'changed' });
	states = stepStates(steps, snapshots, progress);
	assert.deepEqual(states.map(state => state.status), ['changed', 'blocked']);
	progress.steps.store.signature = states[0].signature;
	assert.deepEqual(stepStates(steps, snapshots, progress).map(state => state.status), ['verified', 'changed']);
});

test('missing files, dirty buffers and changed check instructions invalidate recorded confirmation', () => {
	const steps = orderedSteps(plan().steps), snapshots = new Map(files.map(file => [file.path, { hash: digest(file.path), dirty: false }]));
	const progress: BuildProgress = { version: 1, steps: {} };
	const [first] = stepStates(steps, snapshots, progress);
	progress.steps.store = { signature: first.signature, confirmedAt: 'now', evidence: 'user-confirmed' };
	snapshots.get('src/store.ts')!.dirty = true;
	assert.equal(stepStates(steps, snapshots, progress)[0].status, 'changed');
	snapshots.delete('src/store.ts');
	assert.deepEqual(stepStates(steps, snapshots, progress)[0].missing, ['src/store.ts']);
	snapshots.set('src/store.ts', { hash: digest('src/store.ts'), dirty: false });
	steps[0].checks.push('Also verify the new failure mode.');
	assert.equal(stepStates(steps, snapshots, progress)[0].status, 'changed');
});
