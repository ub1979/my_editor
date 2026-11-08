import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { streamOllama } from '../src/models/ollama';
import type { StreamRequest } from '../src/models/types';

function request(onText: (text: string) => void): StreamRequest {
	return { entry: { key: 'ollama:fixture', provider: 'ollama', model: 'fixture', label: 'Fixture', detail: 'local', maxInputTokens: 1000, maxOutputTokens: 1000 },
		system: 'Use the project tools.', turns: [{ role: 'user', text: 'Read a file' }],
		token: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }, onText };
}

test('Ollama streams split NDJSON chunks without treating thinking text as a file action', async t => {
	const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
	const response = JSON.stringify({ message: { thinking: 'private', content: '{"action":"tool",' } }) + '\n'
		+ JSON.stringify({ message: { content: '"name":"read_file","arguments":{"path":"a.py"}}' }, done: true }) + '\n';
	globalThis.fetch = async (_url, options) => {
		const body = JSON.parse(String(options?.body));
		assert.equal(body.messages[0].role, 'system');
		return new Response(new ReadableStream({ start(controller) {
			controller.enqueue(new TextEncoder().encode(response.slice(0, 25)));
			controller.enqueue(new TextEncoder().encode(response.slice(25)));
			controller.close();
		} }));
	};
	let text = ''; await streamOllama('http://fixture', false, request(chunk => { text += chunk; }));
	assert.equal(text, '{"action":"tool","name":"read_file","arguments":{"path":"a.py"}}');
});

test('an unresponsive Ollama request ends with a useful timeout instead of waiting forever', async t => {
	const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
	globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
		options?.signal?.addEventListener('abort', () => reject(options.signal?.reason));
	});
	// AbortSignal.timeout does not keep Node alive on its own.
	const keepAlive = setTimeout(() => undefined, 1000); t.after(() => clearTimeout(keepAlive));
	await assert.rejects(streamOllama('http://fixture', false, request(() => undefined), 20), /model request timed out/);
});

test('GLM 5 uses native thinking separation even when the general thinking preference is off', async t => {
	const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
	globalThis.fetch = async (_url, options) => {
		assert.equal(JSON.parse(String(options?.body)).think, true);
		return new Response(JSON.stringify({ message: { thinking: '```python\nwrong()\n```', content: '```python\ndef doubled(value):\n    return value * 2\n```' }, done: true }) + '\n');
	};
	let text = '';
	const base = request(chunk => { text += chunk; });
	await streamOllama('http://fixture', false, { ...base, entry: { ...base.entry, model: 'glm-5.3-flash:cloud' } });
	assert.equal(text, '```python\ndef doubled(value):\n    return value * 2\n```');
});

test('Ollama forwards native tool requests separately from content and private thinking', async t => {
	const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
	globalThis.fetch = async () => new Response(JSON.stringify({ message: { content: '', thinking: 'private',
		tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.ts', start: 1 } } }] }, done: true }) + '\n');
	const calls: unknown[] = [];
	let text = '';
	await streamOllama('http://fixture', false, { ...request(chunk => { text += chunk; }), onToolCalls: items => calls.push(...items) });
	assert.equal(text, '');
	assert.deepEqual(calls, [{ name: 'read_file', arguments: { path: 'a.ts', start: 1 } }]);
	await assert.rejects(streamOllama('http://fixture', false, request(() => undefined)), /without project tools/);
	globalThis.fetch = async () => new Response(JSON.stringify({ message: { tool_calls: [
		{ function: { name: 'read_file', arguments: { arguments: { path: 'b.ts' } } } },
	] }, done: true }) + '\n');
	const wrapped: unknown[] = [];
	await streamOllama('http://fixture', false, { ...request(() => undefined), onToolCalls: items => wrapped.push(...items) });
	assert.deepEqual(wrapped, [{ name: 'read_file', arguments: { path: 'b.ts' } }]);
});

test('Ollama rejects malformed native arguments instead of treating them as executable requests', async t => {
	const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
	for (const args of [null, [], 42, { arguments: null }, { arguments: [] }]) {
		globalThis.fetch = async () => new Response(JSON.stringify({ message: {
			tool_calls: [{ function: { name: 'read_file', arguments: args } }] }, done: true }) + '\n');
		await assert.rejects(streamOllama('http://fixture', false, { ...request(() => undefined),
			onToolCalls: () => assert.fail('Malformed arguments cannot reach the agent') }), /malformed native tool arguments/);
	}
});
