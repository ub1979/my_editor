import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PreparedBatch } from '../src/project/preparedBatch';

const files = ['a.ts', 'b.ts'].map(path => ({ path, hash: 'old', needsCode: true, note: path,
	changes: [{ path, hash: 'old', content: 'export const value = 1;' }] }));

test('related preparations are reused after each validated save without losing independent summaries', async () => {
	const cache = new PreparedBatch(); cache.set(files);
	const disk: Record<string, string> = { 'a.ts': 'old', 'b.ts': 'old' };
	assert.equal((await cache.take('a.ts', async path => disk[path]))?.note, 'a.ts');
	disk['a.ts'] = 'new'; cache.saved('a.ts', 'new');
	assert.equal((await cache.take('b.ts', async path => disk[path]))?.note, 'b.ts');
	cache.saved('b.ts', 'new'); assert.deepEqual(cache.paths(), []);
});

test('a changed sibling invalidates the entire prepared group; clearing drops unsaved work', async () => {
	const cache = new PreparedBatch(); cache.set(files);
	assert.equal(await cache.take('a.ts', async path => path === 'b.ts' ? 'edited' : 'old'), undefined);
	assert.deepEqual(cache.paths(), []);
	cache.set(files); cache.clear();
	assert.equal(await cache.take('a.ts', async () => 'old'), undefined);
});
