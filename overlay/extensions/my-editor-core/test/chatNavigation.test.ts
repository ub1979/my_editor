import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChatConversations } from '../src/chat/chatConversations';

const Module = require('node:module') as { _load: (name: string, parent: unknown, main: boolean) => unknown };
const originalLoad = Module._load;
let ChatNavigation: typeof import('../src/chat/chatNavigation').ChatNavigation;
try {
	Module._load = (name, parent, main) => {
		if (name === 'vscode') { return { workspace: { workspaceFolders: [] } }; }
		if (name === '../project/state') { return { readProjectState: async () => ({ hasWorkspace: false }) }; }
		if (name === './skillCards') {
			return { skillCards: async () => ['requirements', 'architecture', 'tree'].map(id => ({ id, start: 'kickoff' })) };
		}
		return originalLoad(name, parent, main);
	};
	ChatNavigation = require('../src/chat/chatNavigation').ChatNavigation;
} finally { Module._load = originalLoad; }

function fixture() {
	const conversations = new ChatConversations();
	const sent: unknown[] = [];
	let running = false;
	const navigation = new ChatNavigation({ conversations, context: { extensionUri: {} }, running: () => running,
		save() {}, broadcast: { conversation() {}, post() {} },
		send: async (text: string, kickoff?: boolean) => { sent.push({ text, kickoff, id: conversations.id }); }, analyse: async () => {},
	} as unknown as ConstructorParameters<typeof ChatNavigation>[0]);
	return { conversations, navigation, sent, busy: (value: boolean) => { running = value; } };
}

test('explicit planning requests switch to the target agent before history is assembled', () => {
	const { conversations: chats, navigation } = fixture();
	navigation.chooseCharacter('soki');
	chats.state.addUserMessage('r', 'requirements secret', 'requirements');
	navigation.prepare('Regenerate architecture.md');
	assert.equal(chats.id, 'lisko');
	assert.equal(chats.state.mode, 'architecture');
	assert.equal(chats.state.history(false).length, 0);
	navigation.prepare('Include test coverage and error handling');
	assert.equal(chats.id, 'lisko', 'Keywords in a follow-up must not switch agents');
	navigation.prepare('/requirements Update acceptance criteria');
	assert.equal(chats.id, 'soki');
	assert.equal(chats.state.history(false)[0].text, 'requirements secret');
});

test('reopening an agent resumes without another kickoff or model request', async () => {
	const { conversations: chats, navigation, sent } = fixture();
	await navigation.pickSkill('requirements');
	assert.deepEqual(sent, [{ text: '', kickoff: true, id: 'soki' }]);
	chats.state.addUserMessage('r', 'Decisions already made', 'requirements');
	await navigation.pickSkill('architecture');
	assert.equal(sent.length, 2);
	await navigation.pickSkill('requirements');
	assert.equal(sent.length, 2);
	assert.equal(chats.id, 'soki');
	assert.equal(chats.state.messages[0].markdown, 'Decisions already made');
});

test('agent and layout navigation is blocked during a reply and preserves the current history', async () => {
	const { conversations: chats, navigation, busy, sent } = fixture();
	navigation.chooseCharacter('soki'); busy(true);
	navigation.chooseCharacter('lisko'); navigation.setLayout('shared');
	await navigation.pickSkill('architecture');
	await navigation.autoCharacter();
	assert.equal(chats.id, 'soki');
	assert.equal(chats.layout, 'agents');
	assert.equal(sent.length, 0);
	busy(false); navigation.setLayout('shared');
	navigation.chooseCharacter('lisko');
	assert.equal(chats.id, 'shared');
	assert.equal(chats.state.mode, 'architecture');
	navigation.setLayout('bogus'); assert.equal(chats.layout, 'shared');
	navigation.setLayout('agents'); assert.equal(chats.id, 'soki');
});

test('ordinary shared-chat routing keeps its transcript while switching agents', () => {
	const { conversations: chats, navigation } = fixture();
	navigation.setLayout('shared');
	chats.state.addUserMessage('original', 'shared context');
	navigation.prepare('/architecture Design the app');
	assert.equal(chats.id, 'shared');
	assert.equal(chats.state.characterId, 'lisko');
	assert.equal(chats.state.history(false)[0].text, 'shared context');
});
