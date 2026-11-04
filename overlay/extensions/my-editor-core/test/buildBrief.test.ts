import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildFileBrief, firstBuildFile } from '../src/project/buildBrief';
import type { BuildGuideState } from '../src/project/buildStore';

function fixture(): BuildGuideState {
	return { root: undefined as unknown as BuildGuideState['root'], files: [
		{ path: 'package.json', role: 'Configure workspace scripts.', requirements: ['FR-001'] },
		{ path: 'tsconfig.json', role: 'Configure strict compilation.' }], problems: [],
		snapshots: new Map([['package.json', { hash: 'a', stub: true }], ['tsconfig.json', { hash: 'b', stub: true }]]),
		steps: [{ step: { id: 'root', title: 'Set up the workspace root', files: ['package.json', 'tsconfig.json'],
			dependsOn: [], tasks: ['Configure the workspace and strict compilation.'], checks: ['Run the compiler.'] },
			status: 'ready', signature: 'current', missing: [], dirty: [] }] };
}

test('a setup stub explains its place, purpose, next action and checks without a model', () => {
	const guide = fixture(), brief = buildFileBrief(guide, 'package.json')!;
	assert.match(brief.title, /Step 1 of 1/);
	assert.match(brief.instruction, /configuration before the code/);
	assert.equal(brief.purpose, 'Configure workspace scripts.');
	assert.deepEqual(brief.checks, ['Run the compiler.']);
	assert.equal(brief.next, 'tsconfig.json');
});

test('resume chooses unfinished work without treating existing content as checked', () => {
	const guide = fixture();
	guide.snapshots.set('package.json', { hash: 'code' });
	assert.equal(firstBuildFile(guide, guide.steps[0]), 'tsconfig.json');
	assert.match(buildFileBrief(guide, 'package.json')!.instruction, /does not mean its checks passed/);
	guide.snapshots.set('package.json', { hash: 'unsaved', dirty: true });
	assert.equal(firstBuildFile(guide, guide.steps[0]), 'package.json');
});

test('blocked, completed and absent files do not receive a misleading start instruction', () => {
	const guide = fixture();
	guide.steps[0].status = 'blocked';
	guide.steps[0].step.dependsOn = ['missing'];
	assert.equal(buildFileBrief(guide, 'package.json')!.blocked, true);
	assert.match(buildFileBrief(guide, 'package.json')!.instruction, /Prerequisite implementation/);
	guide.steps[0].step.dependsOn = [];
	guide.steps[0].status = 'verified';
	assert.match(buildFileBrief(guide, 'package.json')!.instruction, /You confirmed/);
	assert.equal(buildFileBrief(guide, 'unplanned.ts'), undefined);
	assert.equal(buildFileBrief(guide, 'tsconfig.json')!.next, undefined);
	guide.problems.push('Invalid plan');
	assert.equal(buildFileBrief(guide, 'package.json'), undefined);
});
