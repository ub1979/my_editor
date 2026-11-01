import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { answerReplyChoice, questionChoices, replyChoices, selectedReplyChoice } from '../src/chat/replyChoices';
import { render, Message } from '../src/chat/presentation';
import { ChatState } from '../src/chat/chatState';

function reply(markdown: string, extra: Partial<Message> = {}): Message {
	return { id: 'q1', role: 'assistant', done: true, markdown, proposals: [], actions: [], ...extra };
}

test('the pasted planning question becomes answer cards with full descriptions and a routed architecture answer', () => {
	const text = `I read both saved files.

- **The architecture is a summary.** More work remains.
- **The tree has gaps.** Test coverage needs review.

**What should we do first?**

- **Fix the tree's gaps:** add missing tests and confirm IDs.
- **Write the full architecture doc first:** give each block a stable section.
- **Leave the tree as it is:** fix gaps later.
- **Decide for me&#x20;**`;
	const message = reply(text, { mode: 'tree' });
	const result = replyChoices(message);
	assert.equal(result.choices[0].label, "Fix the tree's gaps");
	assert.equal(result.choices[1].mode, 'architecture');
	assert.equal(result.choices[1].description, 'give each block a stable section.');
	assert.equal(result.choices[3].label, 'Decide for me');
	assert.match(result.markdown, /The tree has gaps/);
	assert.doesNotMatch(result.markdown, /fix gaps later/);
	assert.doesNotMatch(render(message).html, /give each block a stable section/);
});

test('ordinary findings and code samples are never converted to choices', () => {
	assert.deepEqual(questionChoices('Findings:\n- Missing tests\n- Bad path').choices, []);
	assert.deepEqual(questionChoices('Example:\n```md\nChoose?\n- A\n- B\n```').choices, []);
});

test('numbered questions accept typed answers and expose selectable labels', () => {
	assert.deepEqual(questionChoices('Choose a store?\n1. Local files\n2. SQLite').choices.map(choice => choice.text), ['Local files', 'SQLite']);
});

test('only the latest completed question accepts one of its host-derived answers', () => {
	const message = reply('Which store?\n- Files\n- SQLite');
	assert.equal(selectedReplyChoice([message], 'q1', 1)?.text, 'SQLite');
	assert.equal(selectedReplyChoice([message], 'q1', -1), undefined);
	assert.equal(selectedReplyChoice([message], 'q1', 1.5), undefined);
	assert.equal(selectedReplyChoice([message, reply('New question', { id: 'q2' })], 'q1', 1), undefined);
	assert.equal(selectedReplyChoice([reply(message.markdown, { done: false })], 'q1', 0), undefined);
});

test('planning replies offer a finalization button and prerequisite errors choose the right stage', () => {
	assert.equal(replyChoices(reply('We agreed on the components.', { mode: 'architecture' })).choices[0].mode, 'architecture');
	assert.equal(replyChoices(reply('', { mode: 'tree', error: 'Planning is not complete. Finalize requirements before continuing.' })).choices[0].mode, 'requirements');
	assert.equal(replyChoices(reply('Saved.', { mode: 'architecture', proposals: [{ id: 'p', file: 'architecture.md', added: 1, removed: 0, isNewFile: true, state: 'open' }] })).choices.length, 0);
});

test('clicking architecture finalization changes the skill and sends the visible answer as a normal user turn', async () => {
	const state = new ChatState(undefined);
	state.mode = 'tree'; state.pinned = true;
	state.messages = [reply('We need the full architecture first.', { mode: 'tree', error: 'Finalize architecture before continuing.' })];
	const sent: string[] = [];
	const send = async (text: string) => { sent.push(text); };
	await answerReplyChoice(state, 'q1', 0, true, send);
	assert.equal(sent.length, 0);
	await answerReplyChoice(state, 'q1', 0, false, send);
	assert.equal(state.mode, 'architecture');
	assert.equal(state.pinned, false);
	assert.match(sent[0], /Write the complete architecture document now/);
});

test('Write it now routes using its architecture description instead of keeping the tree skill', async () => {
	const state = new ChatState(undefined);
	state.mode = 'tree';
	state.messages = [reply('How should we get the architecture doc written?\n\n'
		+ '- **Write it now:** produce the full `architecture.md` with the 14 sections above. I will finish the tree right after.\n'
		+ '- **Review the summary first:** read the current decisions again.', { mode: 'tree' })];
	await answerReplyChoice(state, 'q1', 0, false, async () => {});
	assert.equal(state.mode, 'architecture');
});
