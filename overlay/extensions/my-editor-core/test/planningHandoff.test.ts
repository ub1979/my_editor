import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChatConversations } from '../src/chat/chatConversations';
import { ChatState } from '../src/chat/chatState';
import { render } from '../src/chat/presentation';
import { answerReplyChoice, planningNextStep, replyChoices } from '../src/chat/replyChoices';
import { architecture, requirements, tree } from './planningFixture';

function completed(state: ChatState, stage = 'requirements') {
	const reply = state.addReply('reply', stage);
	reply.done = true;
	reply.markdown = 'Your document is ready.';
	return reply;
}

test('a requirements proposal explains Keep first, then gains an Architecture handoff as soon as it is saved', () => {
	const state = new ChatState(undefined);
	const reply = completed(state);
	reply.proposals.push({ id: 'p', file: '.my_editor/specs/requirements.md', state: 'open', added: 10, removed: 0, isNewFile: true });
	assert.match(render(reply).nextStep!, /Keep.*Architecture/);
	assert.deepEqual(replyChoices(reply).choices, []);
	assert.deepEqual(state.refreshPlanningStatus({}), []);
	state.applyProposal({ id: 'p', state: 'kept' });
	assert.deepEqual(state.refreshPlanningStatus({ requirements }).map(message => message.id), ['reply']);
	assert.equal(render(reply).choices[0].label, 'Continue to Architecture');
	assert.match(render(reply).nextStep!, /saved requirements/);
	assert.equal(reply.markdown, 'Your document is ready.', 'Host guidance must not rewrite the model history');
});

test('a pending revision cannot advance even when the previous saved document is valid', () => {
	const state = new ChatState(undefined);
	const reply = completed(state);
	reply.proposals.push({ id: 'p', file: '.my_editor/specs/requirements.md', state: 'open', added: 10, removed: 0, isNewFile: false });
	state.refreshPlanningStatus({ requirements });
	assert.match(planningNextStep(reply)!, /review and Keep/);
	assert.deepEqual(replyChoices(reply).choices, []);
});

test('Architecture and Flow hand off to the next saved workflow stage without another model response', async () => {
	for (const [stage, docs, next] of [
		['architecture', { requirements, architecture }, 'Flow & tree'],
		['tree', { requirements, architecture, tree }, 'Build'],
	] as const) {
		const state = new ChatState(undefined);
		const reply = completed(state, stage);
		state.refreshPlanningStatus(docs);
		assert.equal(replyChoices(reply).choices[0].label, `Continue to ${next}`);
		assert.match(render(reply).nextStep!, new RegExp(next));
		if (stage === 'tree') {
			let request = '';
			await answerReplyChoice(state, reply.id, 0, false, async text => { request = text; });
			assert.equal(request, '/build', 'Build must use the existing run chooser');
		}
	}
});

test('a handoff opens the destination agent without changing the Requirements agent mode or history', async () => {
	const chats = new ChatConversations();
	chats.selectAgent('soki');
	const source = chats.state;
	const reply = completed(source);
	chats.refreshPlanningStatus({ requirements });
	let request = '';
	await answerReplyChoice(source, reply.id, 0, false, async text => {
		request = text;
		assert.equal(chats.id, 'lisko');
		assert.equal(chats.state.mode, 'architecture');
	}, mode => { assert.equal(mode, 'architecture'); chats.selectAgent('lisko'); });
	assert.match(request, /Write the complete architecture document/);
	assert.equal(source.mode, 'requirements');
	assert.deepEqual(chats.state.messages, []);
	chats.selectAgent('soki');
	assert.equal(chats.state.messages[0], reply);
});

test('Keep refreshes hidden agents and a restored chat recovers its next step from saved documents', () => {
	const chats = new ChatConversations();
	chats.selectAgent('soki');
	const reply = completed(chats.state);
	chats.selectAgent('lisko');
	chats.refreshPlanningStatus({ requirements });
	assert.equal(reply.planningStatus?.next, 'architecture');
	const restored = new ChatConversations(chats.snapshot());
	restored.selectAgent('soki');
	restored.refreshPlanningStatus({ requirements, architecture });
	assert.equal(render(restored.state.messages[0]).choices[0].label, 'Continue to Flow & tree');
	restored.refreshPlanningStatus({ requirements: 'Status: Draft' });
	assert.equal(restored.state.messages[0].planningStatus, undefined);
	assert.equal(render(restored.state.messages[0]).nextStep, undefined);
});

test('unfinished, failed, draft and undone documents do not advertise a completed stage', () => {
	const state = new ChatState(undefined);
	const reply = completed(state);
	state.refreshPlanningStatus({ requirements: 'Status: Draft' });
	assert.equal(planningNextStep(reply), undefined);
	reply.done = false;
	state.refreshPlanningStatus({ requirements });
	assert.equal(reply.planningStatus, undefined);
	reply.done = true;
	reply.error = 'Provider failed';
	state.refreshPlanningStatus({ requirements });
	assert.equal(planningNextStep(reply), undefined);
	delete reply.error;
	reply.proposals.push({ id: 'p', file: '.my_editor/specs/requirements.md', state: 'undone', added: 10, removed: 0, isNewFile: true });
	state.refreshPlanningStatus({});
	assert.equal(planningNextStep(reply), undefined);
});

test('saving a plan does not add new suggestions to every older interview answer', () => {
	const state = new ChatState(undefined);
	const older = completed(state);
	const latest = completed(state);
	state.refreshPlanningStatus({ requirements });
	assert.equal(older.planningStatus, undefined);
	assert.equal(latest.planningStatus?.next, 'architecture');
});
