import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChatState, MAX_KEPT_MESSAGES, MAX_VISIBLE_MESSAGES, SavedChat } from '../src/chat/chatState';
import type { Message } from '../src/chat/presentation';

function message(id: string, extra: Partial<Message> = {}): Message {
	return { id, role: 'user', markdown: id, proposals: [], actions: [], done: true, ...extra };
}

test('a fresh chat starts empty with the default character', () => {
	const state = new ChatState(undefined);
	assert.deepEqual(state.messages, []);
	assert.equal(state.mode, undefined);
	assert.deepEqual(state.memory, { brief: '' });
	assert.equal(state.characterId, 'bamboo');
	assert.equal(state.pinned, false);
});

test('a typed request switches the active planning skill and persists it for follow-up turns', () => {
	const state = new ChatState(undefined);
	state.mode = 'requirements';
	assert.equal(state.selectPlanningMode('Regenerate architecture.md'), true);
	assert.equal(new ChatState(state.snapshot()).mode, 'architecture');
	assert.equal(state.selectPlanningMode('Yes, include notifications.'), false);
	assert.equal(state.mode, 'architecture');
});

test('restoring finishes interrupted replies and expires only open proposals', () => {
	const card = (id: string, state: 'open' | 'kept' | 'undone') => ({ id, file: `${id}.ts`, added: 1, removed: 0, isNewFile: false, state });
	const saved: SavedChat = {
		messages: [message('a', { role: 'assistant', done: false, progress: 'Thinking…', proposals: [card('p1', 'open'), card('p2', 'kept')] })],
		mode: 'review', memory: { brief: 'b', throughId: 'x' }, characterId: 'diji', pinned: true,
	};
	const state = new ChatState(saved);
	const [restored] = state.messages;
	assert.equal(restored.done, true);
	assert.equal(restored.progress, undefined);
	assert.deepEqual(restored.proposals.map(p => p.state), ['expired', 'kept']);
	assert.equal(saved.messages[0].proposals[0].state, 'open', 'the stored copy is not changed');
	assert.equal(state.mode, 'review');
	assert.equal(state.characterId, 'diji');
	assert.equal(state.pinned, true);
	assert.deepEqual(state.memory, { brief: 'b', throughId: 'x' });
});

test('an unknown saved character falls back to the default one', () => {
	const state = new ChatState({ messages: [], characterId: 'nobody' as SavedChat['characterId'] });
	assert.equal(state.characterId, 'bamboo');
});

test('a snapshot keeps the newest messages and does not share arrays with live messages', () => {
	const state = new ChatState(undefined);
	for (let i = 0; i < MAX_KEPT_MESSAGES + 5; i++) { state.messages.push(message(`m${i}`)); }
	const snapshot = state.snapshot();
	assert.equal(state.messages.length, MAX_KEPT_MESSAGES);
	assert.equal(snapshot.messages[0].id, 'm5');
	state.messages[0].actions.push({ label: 'Go', command: 'x', args: [] });
	assert.equal(snapshot.messages[0].actions.length, 0);
	assert.equal(state.visibleMessages().length, MAX_VISIBLE_MESSAGES);
	assert.equal(state.visibleMessages().at(-1)?.id, `m${MAX_KEPT_MESSAGES + 4}`);
});

test('a user line without text shows the skill label; text is trimmed', () => {
	const state = new ChatState(undefined);
	state.addUserMessage('1', '  hello  ');
	state.addUserMessage('2', '   ', 'skill:refactor');
	state.addUserMessage('3', '', 'review');
	assert.deepEqual(state.messages.map(m => m.markdown), ['hello', 'Refactor', 'Review']);
	assert.equal(state.messages[1].mode, 'skill:refactor');
});

test('a reply speaks as the current character and starts unfinished', () => {
	const state = new ChatState(undefined);
	state.characterId = 'ada';
	const reply = state.addReply('r', 'feature');
	assert.equal(state.messages.at(-1), reply);
	assert.deepEqual({ role: reply.role, characterId: reply.characterId, mode: reply.mode, done: reply.done, markdown: reply.markdown },
		{ role: 'assistant', characterId: 'ada', mode: 'feature', done: false, markdown: '' });
});

test('history keeps finished turns with text and can leave out the request just added', () => {
	const state = new ChatState(undefined);
	state.messages.push(message('a'), message('b', { done: false }), message('c', { markdown: '' }), message('d', { role: 'assistant' }));
	state.addUserMessage('e', 'now');
	assert.deepEqual(state.history(true).map(m => m.id), ['a', 'd']);
	assert.deepEqual(state.history(false), [
		{ id: 'a', role: 'user', text: 'a' }, { id: 'd', role: 'assistant', text: 'd' }, { id: 'e', role: 'user', text: 'now' },
	]);
});

test('generated documents remain available to history tools after the display is shortened and the chat restored', () => {
	const state = new ChatState(undefined);
	const full = 'Ready for Keep.\n```md\n# Architecture\n## Notifications {#notifications}\nFR-001\n```';
	state.messages.push(message('document', { role: 'assistant', markdown: 'Ready for Keep.', historyText: full }));
	const restored = new ChatState(state.snapshot());
	assert.equal(restored.visibleMessages()[0].markdown, 'Ready for Keep.');
	assert.equal(restored.history(false)[0].text, full);
});

test('proposal states list the latest twelve cards across messages', () => {
	const state = new ChatState(undefined);
	for (let i = 0; i < 14; i++) {
		state.messages.push(message(`m${i}`, { proposals: [{ id: `p${i}`, file: `f${i}.ts`, added: 0, removed: 0, isNewFile: false, state: 'open' }] }));
	}
	const lines = state.proposalStates().split('\n');
	assert.equal(lines.length, 12);
	assert.equal(lines[0], 'f2.ts: open');
	assert.equal(lines[11], 'f13.ts: open');
	assert.equal(new ChatState(undefined).proposalStates(), '');
});

test('a changed proposal updates its cards and returns only the messages holding it', () => {
	const state = new ChatState(undefined);
	const card = { id: 'p', file: 'a.ts', added: 1, removed: 1, isNewFile: false, state: 'open' as const };
	state.messages.push(message('a', { proposals: [{ ...card }] }), message('b'), message('c', { proposals: [{ ...card, id: 'q' }] }));
	const changed = state.applyProposal({ id: 'p', state: 'kept' });
	assert.deepEqual(changed.map(m => m.id), ['a']);
	assert.equal(state.messages[0].proposals[0].state, 'kept');
	assert.equal(state.messages[2].proposals[0].state, 'open');
	assert.deepEqual(state.applyProposal({ id: 'missing', state: 'undone' }), []);
});

test('reset empties the conversation but keeps the character and its pin', () => {
	const state = new ChatState({ messages: [message('a')], mode: 'review', memory: { brief: 'x' }, characterId: 'poppy', pinned: true });
	state.pendingPlaceholder = 'Describe it';
	state.reset();
	assert.deepEqual([state.messages, state.mode, state.pendingPlaceholder, state.memory], [[], undefined, undefined, { brief: '' }]);
	assert.deepEqual([state.characterId, state.pinned], ['poppy', true]);
	state.mode = 'qa';
	state.pendingPlaceholder = 'p';
	state.clearMode();
	assert.deepEqual([state.mode, state.pendingPlaceholder], [undefined, undefined]);
});
