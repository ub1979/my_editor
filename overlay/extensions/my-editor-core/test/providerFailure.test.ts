import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamCodexCli } from '../src/models/cli';
import { streamOpenAICompatible } from '../src/models/openaiCompatible';
import { streamOllama } from '../src/models/ollama';
import type { StreamRequest } from '../src/models/types';

const request: StreamRequest = {
	entry: { key: 'custom:test', provider: 'custom', model: 'test', label: 'Test', detail: '', maxInputTokens: 1000, maxOutputTokens: 1000 },
	system: '', turns: [], onText: () => undefined,
	token: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
};

test('stream errors and output limits reject the response before any file proposal can use it', async t => {
	const original = globalThis.fetch;
	t.after(() => { globalThis.fetch = original; });
	for (const [chunk, message] of [
		[{ error: { message: 'Quota exceeded' } }, /Quota exceeded/],
		[{ choices: [{ finish_reason: 'length' }] }, /output limit/],
	] as const) {
		globalThis.fetch = async () => new Response(`data: ${JSON.stringify(chunk)}\n\n`);
		await assert.rejects(streamOpenAICompatible('custom', 'http://fixture', undefined, request), message);
	}
	globalThis.fetch = async () => new Response(JSON.stringify({ done: true, done_reason: 'length' }) + '\n');
	await assert.rejects(streamOllama('http://fixture', false, request), /output limit/);
});

test('a request cancelled before startup never contacts the endpoint', async t => {
	const original = globalThis.fetch;
	t.after(() => { globalThis.fetch = original; });
	globalThis.fetch = async () => { throw new Error('Should not call fetch'); };
	await streamOpenAICompatible('custom', 'http://fixture', undefined, { ...request, token: { ...request.token, isCancellationRequested: true } });
});

test('a model process failure rejects even after it has emitted partial text', async t => {
	const dir = mkdtempSync(join(tmpdir(), 'my-editor-provider-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const script = join(dir, 'fixture');
	writeFileSync(script, '#!/usr/bin/env node\n' +
		'process.stdout.write(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"partial file"}})+"\\n",()=>process.exit(1));\n');
	chmodSync(script, 0o755);
	let text = '';
	await assert.rejects(streamCodexCli(script, { ...request, onText: chunk => { text += chunk; } }), /exited with code 1/);
	assert.equal(text, 'partial file');
});
