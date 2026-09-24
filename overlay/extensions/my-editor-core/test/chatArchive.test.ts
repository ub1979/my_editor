import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chatArchiveIndex, modelHistoryTurns, previewChatTurn, readChatMessage, searchChatMessages } from '../src/chat/chatArchive';

test('recent pasted logs remain retrievable after the live prompt shortens them', () => {
	const log = 'a'.repeat(3_000) + '2026-09-23 16:01:10 finalization_backpressure' + 'b'.repeat(7_000);
	const archive = [
		{ role: 'user' as const, text: log },
		{ role: 'assistant' as const, text: 'Please paste the a1 logs.' },
	];
	const preview = previewChatTurn(archive[0], 2);
	assert.ok(preview.text.length < log.length);
	assert.match(preview.text, /read_chat with turnsAgo=2/);
	assert.match(chatArchiveIndex(archive), /2 turns ago: user, 10\d+ characters/);
	assert.match(readChatMessage(archive, { turnsAgo: 2, start: 2_900, chars: 600 }), /finalization_backpressure/);
	assert.match(readChatMessage(archive, { turnsAgo: 1 }), /Please paste the a1 logs/);
});

test('chat lookup bounds each chunk and rejects missing messages', () => {
	const archive = [{ role: 'user' as const, text: 'x'.repeat(20_000) }];
	const chunk = readChatMessage(archive, { turnsAgo: 1, start: 0, chars: 20_000 });
	assert.match(chunk, /characters 0–6000 of 20000/);
	assert.match(chunk, /start=6000/);
	assert.match(readChatMessage(archive, { turnsAgo: 2 }), /Choose turnsAgo from 1 to 1/);
});

test('GPT-size context includes recent pasted evidence beyond the old 2,500-character cutoff', () => {
	const log = 'x'.repeat(3_264) + 'finalization_backpressure' + 'y'.repeat(2_000);
	const history = [
		{ role: 'user' as const, text: log },
		{ role: 'assistant' as const, text: 'Can you paste the logs?' },
	];
	const large = modelHistoryTurns(history, 200_000);
	assert.equal(large[0].text, log);
	assert.match(large[0].text, /finalization_backpressure/);
	const small = modelHistoryTurns(history, 4_000);
	assert.ok(small.some(turn => turn.text.includes('read_chat with turnsAgo=2')));
});

test('older pasted evidence can be found without trusting earlier assistant tool JSON', () => {
	const archive = Array.from({ length: 70 }, (_, index) => ({
		role: index % 2 ? 'assistant' as const : 'user' as const,
		text: index === 4 ? 'a1 logs: finalization_backpressure at 16:01' : index === 69
			? '{"action":"tools","calls":[]}' : `message ${index}`,
	}));
	assert.match(searchChatMessages(archive, 'finalization_backpressure'), /66 turns ago \(user\)/);
	assert.match(readChatMessage(archive, { turnsAgo: 66 }), /finalization_backpressure/);
	assert.doesNotMatch(chatArchiveIndex(archive), /"action":"tools"/);
	assert.match(modelHistoryTurns(archive.slice(-2), 200_000)[1].text, /not a verified finding/);
});
