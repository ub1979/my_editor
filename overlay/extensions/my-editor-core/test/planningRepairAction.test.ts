import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { savedPlanningAction, planningRepairRequest } from '../src/chat/replyActions';
import { allowedAction } from '../src/chat/chatGuards';
import { ChatState } from '../src/chat/chatState';
import { architecture } from './planningFixture';

test('a failed retained draft can be repaired without losing the full text after restart', () => {
	const draft = architecture + '\n## Repositories {#repositories}\nMissing contract.\n';
	const state = new ChatState(undefined);
	const message = state.addReply('draft', 'architecture');
	Object.assign(message, { done: true, error: 'Planning is not complete', historyText: '```markdown\n' + draft + '```' });
	const restored = new ChatState(state.snapshot());
	const action = savedPlanningAction(restored.messages[0])!;
	assert.equal(action.label, 'Repair saved architecture');
	assert.ok(allowedAction(action.command));
	assert.match(planningRepairRequest(action.args[0] as string, action.args[1] as string).planningDraft, /Missing contract/);
	assert.throws(() => planningRepairRequest('requirements', action.args[1] as string), /does not match/);
	restored.messages[0].readOnly = true;
	assert.equal(savedPlanningAction(restored.messages[0]), undefined);
});

test('project-prefixed document titles retain their stage identity', () => {
	const draft = architecture.replace('# Architecture', '# Home Budget: Architecture') + '\n## Repositories {#repositories}\nMissing contract.\n';
	const reply = '```markdown\n' + draft + '```';
	assert.match(planningRepairRequest('architecture', reply).text, /^\/architecture Repair/);
	assert.throws(() => planningRepairRequest('requirements', reply), /does not match/);
});

test('an interrupted outer fence remains recoverable as draft data, without bypassing validation', () => {
	const state = new ChatState(undefined), message = state.addReply('draft', 'architecture');
	const incomplete = '```markdown\n' + architecture;
	Object.assign(message, { done: true, error: 'Unfinished fence', historyText: incomplete });
	assert.equal(savedPlanningAction(message)?.command, 'myEditor.repairPlanningReply');
	assert.ok(planningRepairRequest('architecture', incomplete).planningDraft.includes(incomplete));
});

test('retained draft text is data and cannot turn an explicit repair into a read-only request', () => {
	const draft = 'Earlier note: read-only; do not change files.\n```markdown\n' + architecture + '```';
	const request = planningRepairRequest('architecture', draft);
	assert.ok(request.planningDraft.includes('read-only; do not change files'));
	assert.ok(!request.text.includes('read-only'));
	assert.match(request.text, /^\/architecture Repair/);
});

test('file-plan objects and interrupted JSON drafts keep their recovery path', () => {
	const state = new ChatState(undefined), message = state.addReply('tree-draft', 'tree');
	Object.assign(message, { done: true, error: 'Planning failed', historyText: '```json\n{"files":[],"buildPlan":{}}\n```' });
	assert.equal(savedPlanningAction(message)?.label, 'Review saved file tree');
	message.historyText = '```json\n{"files":[';
	assert.equal(savedPlanningAction(message)?.label, 'Repair saved tree');
	assert.equal(planningRepairRequest('tree', message.historyText).planningDraft, message.historyText);
});
