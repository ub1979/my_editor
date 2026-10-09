import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BRIEF_SYSTEM, briefRequest, cleanBrief, fallbackBrief, liveTurns, memoryBatch } from '../src/chat/memory';
import { parseCommits } from '../src/project/commitParse';

test('conversation compaction keeps every turn visible until summarized', () => {
	const turns = Array.from({ length: 17 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' as const : 'user' as const, text: `turn ${i}` }));
	assert.equal(memoryBatch(turns, { brief: '' }).length, 8);
	assert.equal(liveTurns(turns, { brief: 'earlier', throughId: '7' })[0].id, '8');
	assert.equal(memoryBatch(turns, { brief: 'earlier', throughId: '7' }).length, 0);
	assert.match(fallbackBrief('', turns.slice(0, 2)), /User requested: turn 0/);
	assert.equal(cleanBrief('<think>private reasoning</think>Keep the live campaign safe.'), 'Keep the live campaign safe.');
});

test('the brief request labels older turns, cuts long ones and masks a leaked tool request', () => {
	const leaked = '{"action":"read_file","path":"src/a.ts"}';
	const request = briefRequest('', [
		{ role: 'user', text: 'x'.repeat(2000) },
		{ role: 'assistant', text: 'Added the index.' },
		{ role: 'assistant', text: leaked },
	]);
	assert.match(request, /^Previous working brief:\n\(none\)\n\nOlder turns to incorporate:\nUser: x{1600}\n\nPair: Added the index\.\n\nPair: \[internal tool request/);
	assert.doesNotMatch(request, /x{1601}/);
	assert.match(briefRequest('Goal: ship', []), /^Previous working brief:\nGoal: ship\n/);
	assert.match(BRIEF_SYSTEM, /at most 4,500 characters/);
	assert.match(BRIEF_SYSTEM, /Return only the brief\.$/);
});

test('Git history parser associates changed paths with each commit', () => {
	const records = parseCommits('COMMIT\tabc123\t2026-09-23\tAdd indexes\ninternal/store/migrate.sql\n\nCOMMIT\tdef456\t2026-09-22\tFix Redis\ninternal/infra/redis.go\n');
	assert.deepEqual(records.map(record => [record.hash, record.paths]), [
		['abc123', ['internal/store/migrate.sql']],
		['def456', ['internal/infra/redis.go']],
	]);
});
