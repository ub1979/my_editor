import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { FileConversations } from '../src/coding/fileConversations';

test('same basenames in different folders retain isolated messages and drafts across restoration', () => {
	const chats = new FileConversations();
	const a = 'file:///project/a/index.ts', b = 'file:///project/b/index.ts';
	chats.add(a, 'user', 'Only A'); chats.add(b, 'assistant', 'Only B');
	chats.get(a).draft = 'Unsent A'; chats.get(b).draft = 'Unsent B';
	const restored = new FileConversations(chats.snapshot());
	assert.deepEqual(restored.history(a), [{ role: 'user', text: 'Only A' }]);
	assert.deepEqual(restored.history(b), [{ role: 'assistant', text: 'Only B' }]);
	assert.equal(restored.get(a).draft, 'Unsent A');
	assert.equal(restored.get(b).draft, 'Unsent B');
	restored.reset(a);
	assert.deepEqual(restored.history(a), []);
	assert.equal(restored.get(b).messages[0].text, 'Only B');
});

test('renaming retains the chat without merging a different file and snapshots are independent', () => {
	const chats = new FileConversations();
	chats.add('a', 'user', 'hello');
	const saved = chats.snapshot();
	chats.rename('a', 'b');
	assert.equal(chats.history('b')[0].text, 'hello');
	chats.add('b', 'assistant', 'answer');
	assert.equal(saved.a.messages.length, 1);
	chats.add('c', 'user', 'unrelated');
	chats.rename('b', 'c');
	assert.equal(chats.history('b')[0].text, 'hello');
	assert.equal(chats.history('c')[0].text, 'unrelated');
});

test('long file conversations have bounded request history and redact secrets at rest', () => {
	const chats = new FileConversations();
	for (let i = 0; i < 100; i++) { chats.add('a', 'user', `message ${i} ` + 'a'.repeat(2000)); }
	assert.equal(chats.get('a').messages.length, 80);
	assert.ok(chats.history('a').map(item => item.text).join('').length <= 24000);
	chats.add('b', 'user', 'api_key=sk-abcdefghijklmnopqrstuvwxyz1234567890');
	assert.ok(!chats.history('b')[0].text.includes('sk-abcdefghijklmnopqrstuvwxyz1234567890'));
});
