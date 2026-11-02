import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { inspectionRequest, mayRevisePlanningPath, readOnlyRequest, requestsPlannedFiles, requestsRevision } from '../src/chat/requestPolicy';
import { planningIntent } from '../src/chat/planningIntent';
import { replyChoices } from '../src/chat/replyChoices';

const docs = { requirements: 'saved requirements', architecture: 'saved architecture', tree: '[]' };

test('checks, questions and report requests cannot authorize replacing a saved plan', () => {
	for (const text of ['check it', 'check what the other agent made', 'Review the architecture', 'is anything missing?',
		'make sure the requirements are complete', 'write a report on what is missing', 'prepare a review of the design',
		'Can you check if we need to fix anything?', 'Explain the architecture', 'what changes should we make?',
		'check this but do not change anything', "fix this without changing files", 'Keep v1.0.1 as it is']) {
		assert.equal(requestsRevision(text), false, text);
		assert.equal(readOnlyRequest(text, 'architecture', docs, false), true, text);
	}
	for (const stage of ['requirements', 'architecture', 'tree', 'chat']) {
		assert.equal(readOnlyRequest('Check the plan', stage, docs, false), true, stage);
	}
});

test('explicit revisions stay authorized, including checking and fixing in one request', () => {
	for (const text of ['Fix the architecture links', 'Please update requirements.md', 'Check it and fix the broken link',
		'Write the complete architecture document now', 'Prepare the complete saved architecture for review.',
		'Add pagination', 'Please create the tree', 'Write a report, then fix the listed bugs', '/tree Apply those fixes']) {
		assert.equal(requestsRevision(text), true, text);
		assert.equal(readOnlyRequest(text, 'architecture', docs, false), false, text);
	}
	assert.equal(readOnlyRequest('Create the architecture', 'architecture', docs, true), true, 'Opening never requests a revision');
	assert.equal(readOnlyRequest('It is for one person', 'requirements', {}, false), false, 'Initial planning can continue');
	assert.equal(readOnlyRequest('Check the draft', 'requirements', {}, false), true);
});

test('a direct yes retains authorization only for the immediately preceding concrete revision offer', () => {
	assert.equal(requestsRevision('Yes, do it', [{ role: 'assistant', text: 'Should I apply the corrected FR-008 link?' }]), true);
	assert.equal(requestsRevision('Go ahead', [{ role: 'assistant', text: 'Would you like me to revise that interface?' }]), true);
	assert.equal(requestsRevision('yes', [{ role: 'assistant', text: 'Is the app for one person?' }]), false);
	assert.equal(requestsRevision('yes', [{ role: 'user', text: 'Should I apply the changes?' }]), false);
	assert.equal(inspectionRequest('check and fix it'), false);
});

test('natural approvals accept a concrete next-step offer without another magic phrase', () => {
	const history = [{ role: 'assistant' as const, text: '**Next step:** ask me to write the updated tree, and I’ll send the complete tree.json for Keep.' }];
	for (const text of ['ok do it', 'Okay, do it.', 'yes please', 'sure, go ahead', 'continue', 'do it please']) {
		assert.equal(requestsRevision(text, history), true, text);
		assert.equal(readOnlyRequest(text, 'tree', docs, false, history), false, text);
	}
	assert.equal(requestsRevision('ok do it', [{ role: 'assistant', text: 'To get the update, send this message:\n\n'
		+ '`/tree Update only tree.json to add the two test files to their build steps. Preserve everything else.`' }]), true);
});

test('the reported Decide for me choice authorizes its concrete test additions', () => {
	const history = [{ role: 'assistant' as const, text: 'Which tests do you want to add to the plan?\n'
		+ '- **Only the X publish tests:** adds one file for the riskiest gap.\n'
		+ '- **Keep the plan as is:** fastest to build.\n'
		+ "- **Decide for me:** I'd add the X publish tests plus home-dirs for its chmod 700 rule." }];
	for (const text of ['Decide for me', "Decide for me: I'd add the X publish tests plus home-dirs for its chmod 700 rule."]) {
		assert.equal(requestsRevision(text, history), true);
		assert.equal(readOnlyRequest(text, 'tree', docs, false, history), false);
	}
	assert.equal(requestsRevision('Keep the plan as is', history), false);
});

test('approvals and delegated choices do not authorize unrelated or read-only work', () => {
	for (const text of ['ok do it', 'continue', 'Decide for me', 'yes']) {
		assert.equal(requestsRevision(text), false);
		assert.equal(requestsRevision(text, [{ role: 'assistant', text: 'Is the app for one person?' }]), false);
		assert.equal(requestsRevision(text, [{ role: 'user', text: 'Ask me to write the tree.' }]), false);
		assert.equal(requestsRevision(text, [{ role: 'assistant', text: 'Should I update the tree?' },
			{ role: 'assistant', text: 'Do you use a Mac?' }]), false);
	}
	const history = [{ role: 'assistant' as const, text: 'Should I update the tree?' }];
	assert.equal(requestsRevision('ok do it, but do not change files', history), false);
	assert.equal(requestsRevision('yes, explain first', history), false);
	assert.equal(mayRevisePlanningPath('.my_editor/specs/architecture.md', 'ok do it', history), false);
	assert.equal(readOnlyRequest('ok do it', 'tree', docs, true, history), true);
});

test('moving to tree changes the target even inside the actual saved answer choices', () => {
	for (const text of ['Move on to tree.json: apply those fixes so every entry links to a section that exists.',
		"Decide for me: keep v1.0.1, switch to the tree step, and I'll apply all seven fixes.", 'Check and fix tree.json', 'Continue to Architecture']) {
		assert.equal(planningIntent(text), text.endsWith('Architecture') ? 'architecture' : 'tree');
	}
	assert.equal(planningIntent('Do not switch to tree'), undefined);
	assert.equal(planningIntent('/chat Move on to tree'), undefined);
});

test('generic code requests cannot incidentally rewrite planning files', () => {
	assert.equal(mayRevisePlanningPath('.my_editor/specs/architecture.md', 'Fix the parser'), false);
	assert.equal(mayRevisePlanningPath('.my_editor/specs/architecture.md', 'Update architecture.md to describe the new parser'), true);
	assert.equal(mayRevisePlanningPath('.my_editor/specs/requirements.md', 'Update architecture.md'), false);
	assert.equal(mayRevisePlanningPath('./.my_editor/specs/tree.json', 'Check tree.json'), false);
	assert.equal(mayRevisePlanningPath('src/parser.ts', 'Fix the parser'), true);
});

test('read-only planning replies do not add an automatic Finalize action', () => {
	const result = replyChoices({ role: 'assistant', done: true, mode: 'architecture', markdown: 'The links match the saved plan.',
		readOnly: true, proposals: [] });
	assert.deepEqual(result.choices, []);
});

test('creating saved planned files is distinct from generating or reviewing their plan', () => {
	for (const text of ['make the files', 'Create all missing planned files', 'Please create the files from the saved tree.json']) {
		assert.equal(requestsPlannedFiles(text), true, text);
	}
	for (const text of ['Check the files', 'Create a new tree', 'Create the files and redesign the architecture', 'Do not create files']) {
		assert.equal(requestsPlannedFiles(text), false, text);
	}
});
