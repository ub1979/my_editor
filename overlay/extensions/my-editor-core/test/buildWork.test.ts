import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildPlanIdentity, canImplement, nextImplementation, wantsProjectBuild } from '../src/project/buildWork';
import { firstBuildFile } from '../src/project/buildBrief';
import type { BuildGuideState } from '../src/project/buildStore';

function fixture(): BuildGuideState {
	const files = ['package.json', 'lib/package.json', 'lib/client.ts'].map(path => ({ path, role: `Own ${path}`, status: 'stub' }));
	const steps = [{ id: 'root', title: 'Setup', files: ['package.json'], dependsOn: [], tasks: ['Setup'], checks: ['Check'] },
		{ id: 'lib', title: 'Library', files: ['lib/package.json', 'lib/client.ts'], dependsOn: ['root'], tasks: ['Code'], checks: ['Test'] }];
	return { root: undefined as unknown as BuildGuideState['root'], files, plan: { version: 1, entryPoint: 'lib/client.ts', steps },
		problems: [], snapshots: new Map(files.map(file => [file.path, { hash: 'stub', stub: true }])),
		steps: steps.map((step, index) => ({ step, status: index ? 'blocked' : 'ready', signature: 'unverified', missing: [], dirty: [] })) };
}

test('whole-project intent recognizes the reported request but excludes questions and reviews', () => {
	for (const text of ['ok code everything for me', '/chat Build the whole project', 'Please implement all remaining files.', 'write all code']) {
		assert.equal(wantsProjectBuild(text), true, text);
	}
	for (const text of ['why did you not build everything?', 'do not build everything', 'review the whole project', '/tree build the whole project', 'build src/a.ts']) {
		assert.equal(wantsProjectBuild(text), false, text);
	}
});

test('saved prerequisite code unlocks coding without falsely confirming tests; source wins over manifests', () => {
	const guide = fixture();
	assert.equal(nextImplementation(guide)?.step.id, 'root');
	assert.equal(canImplement(guide, guide.steps[1]), false);
	guide.snapshots.set('package.json', { hash: 'code' });
	assert.equal(nextImplementation(guide)?.step.id, 'lib');
	assert.equal(firstBuildFile(guide, guide.steps[1]), 'lib/client.ts');
	assert.equal(guide.steps[1].status, 'blocked');
	guide.snapshots.set('package.json', { hash: 'unsaved', dirty: true });
	assert.equal(canImplement(guide, guide.steps[1]), false);
	assert.equal(nextImplementation(guide)?.step.id, 'root');
});

test('a missing or cyclic prerequisite cannot unlock downstream code', () => {
	const guide = fixture();
	guide.steps[0].step.dependsOn = ['lib'];
	assert.equal(canImplement(guide, guide.steps[1]), false);
	guide.steps[0].step.dependsOn = ['unknown'];
	assert.equal(canImplement(guide, guide.steps[1]), false);
});

test('build queue plan identity ignores routine status writes but detects scope changes', () => {
	const guide = fixture(), before = buildPlanIdentity(guide);
	guide.files[0].status = 'in-progress';
	assert.equal(buildPlanIdentity(guide), before);
	guide.files[0].role = 'A changed responsibility';
	assert.notEqual(buildPlanIdentity(guide), before);
});
