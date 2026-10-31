import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { architectureComponents, documentProblems, planningProblems } from '../src/project/planning';
import { requirements, architecture, tree } from './planningFixture';

test('a complete planning chain is ready, with component bodies and stable references', () => {
	assert.deepEqual(planningProblems('tree', { requirements, architecture, tree }), []);
	assert.deepEqual([...architectureComponents(architecture).keys()], ['composer', 'store']);
});

test('IDs and headings do not make a deferred requirements or architecture summary final', () => {
	const deferred = '\nWhen you say write it, I’ll produce the full architecture doc.\n';
	assert.match(documentProblems('architecture', architecture + deferred).join(' '), /draft or decisions summary/);
	assert.match(documentProblems('requirements', requirements.replace('Acceptance:', 'Details:').replace('Acceptance:', 'Details:')).join(' '), /acceptance criteria/);
	assert.ok(documentProblems('architecture', '# Architecture\n## Decisions summary\nUse a composer for FR-001.').length);
	assert.ok(documentProblems('requirements', '<!-- my_editor: draft -->\n' + requirements).length);
});

test('a component must carry its own requirement links and interface', () => {
	assert.match(documentProblems('architecture', architecture.replace('Interface: saveDraft(text) and loadDraft(id).', 'Saves text.')).join(' '), /#composer/);
});

test('a tree cannot invent missing sections or requirement IDs', () => {
	const files = JSON.parse(tree);
	files[0].section = 'block-kit';
	files[1].requirements = ['FR-008'];
	const problems = planningProblems('tree', { requirements, architecture, tree: JSON.stringify(files) });
	assert.ok(problems.some(problem => problem.reason.includes('block-kit')));
	assert.ok(problems.some(problem => problem.reason.includes('confirmed requirement IDs')));
	assert.ok(planningProblems('tree', { requirements, architecture: architecture + '\nWhen you say write it, I will produce the full document.', tree })
		.some(problem => problem.stage === 'architecture'));
});

test('changing an upstream requirement invalidates its architecture and tree references', () => {
	const changed = requirements.replaceAll('FR-001', 'FR-002');
	assert.ok(planningProblems('tree', { requirements: changed, architecture, tree }).some(problem => /unknown requirement FR-001/.test(problem.reason)));
});
