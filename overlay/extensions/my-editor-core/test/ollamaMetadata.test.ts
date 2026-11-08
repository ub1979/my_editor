import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cloudContextTokens } from '../src/models/ollamaMetadata';

test('cloud model capacity uses provider metadata and caches discovery', async t => {
	const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
	let requests = 0;
	globalThis.fetch = async (_url, options) => {
		requests++; assert.deepEqual(JSON.parse(String(options?.body)), { model: 'deepseek:cloud' });
		return new Response(JSON.stringify({ model_info: { 'deepseek.context_length': 1048576 } }));
	};
	assert.deepEqual(await Promise.all([cloudContextTokens('http://capacity-fixture', 'deepseek:cloud'),
		cloudContextTokens('http://capacity-fixture', 'deepseek:cloud')]), [1048576, 1048576]);
	assert.equal(requests, 1);
});

test('missing or invalid cloud metadata keeps a conservative context budget', async t => {
	const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
	for (const [index, value] of [null, -1, 1e12, '1048576'].entries()) {
		globalThis.fetch = async () => new Response(JSON.stringify({ model_info: { 'model.context_length': value } }));
		assert.equal(await cloudContextTokens('http://invalid-' + index, 'fixture:cloud'), 32000);
	}
	globalThis.fetch = async () => { throw Error('unavailable'); };
	assert.equal(await cloudContextTokens('http://unavailable', 'fixture:cloud'), 32000);
});
