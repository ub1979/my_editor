import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { queryTerms, rankPaths, sourceExcerpt } from '../src/project/relevance';

test('database questions find store and Redis paths from a brain map', () => {
	const terms = queryTerms('Can this database process hundreds of millions of rows in seconds?');
	const ranked = rankPaths({
		'internal/api/server.go': 'HTTP handlers',
		'internal/store/queries.go': 'Postgres persistence',
		'internal/infra/redis.go': 'Redis coordination and cache',
	}, terms, value => value);
	assert.deepEqual(new Set(ranked.slice(0, 2)), new Set(['internal/store/queries.go', 'internal/infra/redis.go']));
});

test('source excerpts retain original line numbers and bound output', () => {
	const source = Array.from({ length: 100 }, (_, i) => i === 48 ? 'INSERT INTO cdr VALUES ($1)' : `line ${i + 1}`).join('\n');
	const excerpt = sourceExcerpt(source, ['insert'], 300);
	assert.match(excerpt, /49\| INSERT INTO cdr/);
	assert.ok(excerpt.length <= 300);
	assert.doesNotMatch(excerpt, /1\| line 1/);
});
