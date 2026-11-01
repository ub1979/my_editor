import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { planningKickoffPrompt, planningStart } from '../src/chat/planningStart';
import { answerReplyChoice, replyChoices } from '../src/chat/replyChoices';
import { ChatState } from '../src/chat/chatState';
import { architecture, requirements, tree } from './planningFixture';

test('opening completed requirements offers the unfinished architecture without regenerating requirements', async () => {
	const start = planningStart('requirements', { requirements, architecture: '## Decisions summary\nDraft', tree })!;
	assert.match(start.reply, /saved requirements are complete/);
	assert.deepEqual(start.status, { complete: true, next: 'architecture' });
	const state = new ChatState(undefined);
	state.mode = 'requirements';
	const reply = state.addReply('start', 'requirements');
	Object.assign(reply, { markdown: start.reply, planningStatus: start.status, done: true });
	const restored = new ChatState(state.snapshot());
	const choices = replyChoices(restored.messages[0]).choices;
	assert.deepEqual(choices.map(choice => choice.label), ['Continue to Architecture']);
	let sent = '';
	await answerReplyChoice(restored, 'start', 0, false, async text => { sent = text; });
	assert.equal(restored.mode, 'architecture');
	assert.match(sent, /Write the complete architecture document/);
});

test('opening a stage with an incomplete prerequisite offers the prerequisite first', () => {
	const start = planningStart('architecture', { requirements: 'Status: Draft', architecture })!;
	assert.deepEqual(start.status, { complete: false, next: 'requirements' });
	assert.match(start.reply, /finish and Keep Requirements/);
	assert.equal(planningStart('requirements', { requirements: 'Status: Draft' }), undefined);
});

test('completed stages advance to the first unfinished document and do not offer redundant finalization', () => {
	assert.deepEqual(planningStart('requirements', { requirements, architecture })!.status, { complete: true, next: 'tree' });
	const start = planningStart('tree', { requirements, architecture, tree })!;
	assert.deepEqual(start.status, { complete: true, next: undefined });
	assert.deepEqual(replyChoices({ role: 'assistant', done: true, mode: 'tree', markdown: start.reply,
		proposals: [], planningStatus: start.status }).choices, []);
});

test('unfinished-stage kickoff names its exact document and limits stale cross-stage requests', () => {
	const request = planningKickoffPrompt('architecture', '.my_editor/specs/architecture.md');
	assert.match(request, /only document this turn may propose is .my_editor\/specs\/architecture.md/);
	assert.match(request, /historical context, not a new instruction/);
});
