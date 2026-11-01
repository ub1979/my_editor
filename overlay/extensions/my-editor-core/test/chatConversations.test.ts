import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChatConversations } from '../src/chat/chatConversations';
import { CHARACTERS } from '../src/chat/characters';
import { savedPlanningAction } from '../src/chat/replyActions';
import type { Message } from '../src/chat/presentation';

const message = (id: string, extra: Partial<Message> = {}): Message =>
	({ id, role: 'user', markdown: id, proposals: [], actions: [], done: true, ...extra });

test('every agent has an independent history, working brief and selected skill by default', () => {
	const chats = new ChatConversations();
	assert.equal(chats.layout, 'agents');
	for (const { id } of CHARACTERS) {
		chats.selectAgent(id);
		assert.deepEqual(chats.state.history(false), []);
		assert.equal(chats.state.memory.brief, '');
		chats.state.messages.push(message(id));
		chats.state.memory = { brief: `Only ${id}` };
	}
	for (const { id } of CHARACTERS) {
		chats.selectAgent(id);
		assert.deepEqual(chats.state.history(false).map(turn => turn.text), [id]);
		assert.equal(chats.state.memory.brief, `Only ${id}`);
	}
	chats.selectAgent('soki'); assert.equal(chats.state.mode, 'requirements');
	chats.selectAgent('lisko'); assert.equal(chats.state.mode, 'architecture');
	chats.selectAgent('flow'); assert.equal(chats.state.mode, 'tree');
});

test('shared chat is explicit and switching layouts never merges or discards agent chats', () => {
	const chats = new ChatConversations();
	chats.selectAgent('soki'); chats.state.messages.push(message('private requirements'));
	chats.setLayout('shared');
	assert.equal(chats.state.messages.length, 0);
	chats.state.messages.push(message('shared request'));
	chats.selectAgent('lisko');
	assert.equal(chats.state.mode, 'architecture');
	assert.equal(chats.state.history(false)[0].text, 'shared request');
	chats.setLayout('agents');
	assert.equal(chats.id, 'soki');
	assert.equal(chats.state.history(false)[0].text, 'private requirements');
	chats.selectAgent('lisko');
	assert.deepEqual(chats.state.history(false), []);
});

test('restart restores every agent, the active agent and the explicit shared choice', () => {
	const chats = new ChatConversations();
	chats.selectAgent('soki'); chats.state.messages.push(message('req'));
	chats.selectAgent('lisko'); chats.state.messages.push(message('arch'));
	chats.state.memory = { brief: 'architecture only' };
	chats.setLayout('shared'); chats.state.messages.push(message('shared'));
	const restored = new ChatConversations(chats.snapshot());
	assert.equal(restored.layout, 'shared');
	assert.equal(restored.state.messages[0].id, 'shared');
	restored.setLayout('agents');
	assert.equal(restored.id, 'lisko');
	assert.equal(restored.state.memory.brief, 'architecture only');
	restored.selectAgent('soki');
	assert.deepEqual(restored.state.messages.map(item => item.id), ['req']);
	assert.equal(restored.state.memory.brief, '');
});

test('migration preserves complete legacy history and assigns user/reply pairs by document mode', () => {
	const legacy = { messages: [message('u1'), message('a1', { role: 'assistant', mode: 'requirements', characterId: 'soki' }),
		message('u2'), message('a2', { role: 'assistant', mode: 'architecture', characterId: 'soki', historyText: 'full document' })],
		mode: 'architecture', characterId: 'soki' as const, memory: { brief: 'mixed legacy brief' } };
	const chats = new ChatConversations(legacy);
	assert.equal(chats.id, 'lisko');
	assert.equal(chats.state.mode, 'architecture');
	assert.deepEqual(chats.state.messages.map(item => item.id), ['u2', 'a2']);
	assert.equal(chats.state.history(false)[1].text, 'full document');
	assert.equal(chats.state.memory.brief, '');
	chats.selectAgent('soki');
	assert.deepEqual(chats.state.messages.map(item => item.id), ['u1', 'a1']);
	chats.setLayout('shared');
	assert.deepEqual(chats.state.messages.map(item => item.id), ['u1', 'a1', 'u2', 'a2']);
	assert.equal(chats.state.memory.brief, 'mixed legacy brief');
	assert.deepEqual(legacy.messages.map(item => item.id), ['u1', 'a1', 'u2', 'a2']);
});

test('migration retains a failed full architecture for recovery in its own agent chat', () => {
	const doc = '# Architecture\n## Overview\nA local system.\n## Main system flow\nInput → Store.\n'
		+ '## Components\n### Store {#store}\nFR-001. Interface: save(input).\n## Decisions\nLocal storage for simplicity.\n';
	const chats = new ChatConversations({ mode: 'architecture', messages: [message('a', { role: 'assistant', mode: 'architecture',
		error: 'The old validator failed', historyText: '```markdown\n' + doc + '```' })] });
	assert.equal(chats.id, 'lisko');
	assert.equal(savedPlanningAction(chats.state.messages[0])?.label, 'Review saved architecture');
});

test('new chat clears only the active conversation and leaves other agents intact', () => {
	const chats = new ChatConversations();
	chats.selectAgent('soki'); chats.state.messages.push(message('req'));
	chats.selectAgent('lisko'); chats.state.messages.push(message('arch'));
	chats.state.reset();
	assert.equal(chats.state.messages.length, 0);
	chats.selectAgent('soki');
	assert.equal(chats.state.messages[0].id, 'req');
});

test('inactive proposals remain live across agent switches and receive Keep updates', () => {
	const chats = new ChatConversations();
	chats.selectAgent('soki');
	chats.state.messages.push(message('r', { proposals: [{ id: 'p', file: 'requirements.md', added: 1, removed: 0, isNewFile: true, state: 'open' }] }));
	const snapshot = chats.snapshot();
	chats.selectAgent('lisko');
	assert.deepEqual(chats.applyProposal({ id: 'p', state: 'kept' }).map(item => item.id), ['r']);
	assert.equal(chats.state.messages.length, 0);
	chats.selectAgent('soki');
	assert.equal(chats.state.messages[0].proposals[0].state, 'kept');
	assert.equal(snapshot.messages[0].proposals[0].state, 'open', 'queued saves must not mutate');
	assert.equal(new ChatConversations(snapshot).state.messages[0].proposals[0].state, 'expired');
});
