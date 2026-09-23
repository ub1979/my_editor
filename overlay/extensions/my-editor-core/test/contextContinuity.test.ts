import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cleanBrief, fallbackBrief, liveTurns, memoryBatch } from '../src/chat/memory';
import { parseCommits } from '../src/project/commitParse';

test('conversation compaction keeps every turn visible until summarized', () => {
	const turns = Array.from({ length: 17 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' as const : 'user' as const, text: `turn ${i}` }));
	assert.equal(memoryBatch(turns, { brief: '' }).length, 8);
	assert.equal(liveTurns(turns, { brief: 'earlier', throughId: '7' })[0].id, '8');
	assert.equal(memoryBatch(turns, { brief: 'earlier', throughId: '7' }).length, 0);
	assert.match(fallbackBrief('', turns.slice(0, 2)), /User requested: turn 0/);
	assert.equal(cleanBrief('<think>private reasoning</think>Keep the live campaign safe.'), 'Keep the live campaign safe.');
});

test('Git history parser associates changed paths with each commit', () => {
	const records = parseCommits('COMMIT\tabc123\t2026-09-23\tAdd indexes\ninternal/store/migrate.sql\n\nCOMMIT\tdef456\t2026-09-22\tFix Redis\ninternal/infra/redis.go\n');
	assert.deepEqual(records.map(record => [record.hash, record.paths]), [
		['abc123', ['internal/store/migrate.sql']],
		['def456', ['internal/infra/redis.go']],
	]);
});
