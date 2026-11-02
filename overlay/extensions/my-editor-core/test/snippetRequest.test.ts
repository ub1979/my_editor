import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { aiMarker, insertAiSnippet, snippetLineBudget } from '../src/coding/inlineCode';
import { requestSnippet } from '../src/coding/snippetRequest';
import { ChatTurn } from '../src/models/types';

const source = '/**\n * createAiClient(baseUrl) with generate, providers, getSettings and putSettings; returns typed errors\n'
	+ ' * Requirements: FR-005.\n * Architecture: #ai-contract.\n */\n//AI make the class \n\nexport {};\n';
const marker = aiMarker(source.split('\n')[5], 5)!;
const fence = (code: string) => `\`\`\`ts\n${code}\n\`\`\``;
const longClass = 'export class AiClient {\n' + Array.from({ length: 110 }, (_, i) => `  value${i} = ${i};`).join('\n') + '\n}';

test('the reported TypeScript stub accepts a complete class longer than 100 lines and preserves its source', () => {
	assert.equal(marker.instruction, 'make the class');
	assert.equal(snippetLineBudget(source), 292);
	const result = insertAiSnippet(source, marker, fence(longClass), 'client.ts');
	assert.equal(result, source.replace('//AI make the class \n', '//AI make the class \n' + longClass + '\n'));
	assert.ok(result.endsWith('\nexport {};\n'));
});

test('snippet budget uses existing source lines and reports exact overflow without truncation', () => {
	const text = '//AI add a method\n' + '// existing\n'.repeat(295);
	const at = aiMarker(text.split('\n')[0], 0)!;
	assert.equal(snippetLineBudget(text), 4);
	assert.doesNotThrow(() => insertAiSnippet(text, at, fence('a();\nb();\nc();\nd();')));
	assert.throws(() => insertAiSnippet(text, at, fence('a();\nb();\nc();\nd();\ne();')), /5 lines.*room for 4/);
});

test('empty, unclosed, omitted and multiple blocks have distinct errors; nested backticks in code are safe', () => {
	assert.throws(() => insertAiSnippet(source, marker, fence('')), /empty code block/);
	assert.throws(() => insertAiSnippet(source, marker, '```ts\nclass Client {'), /before closing/);
	assert.throws(() => insertAiSnippet(source, marker, fence('// ... existing code ...')), /omitted-code placeholder/);
	assert.throws(() => insertAiSnippet(source, marker, fence('a();') + '\n' + fence('b();')), /2 code blocks/);
	assert.ok(insertAiSnippet(source, marker, fence('const markdown = "```";')).includes('const markdown = "```";'));
});

test('invalid model output gets one corrective turn with the exact issue and original request', async () => {
	const calls: ChatTurn[][] = [];
	const result = await requestSnippet({ source, marker, filePath: 'client.ts', language: 'typescript', plan: 'FR-005 client',
		checkCurrent() {}, generate: async (turns, correcting) => {
			calls.push([...turns]);
			return correcting ? fence(longClass) : fence('// ... existing code ...');
		} });
	assert.equal(calls.length, 2);
	assert.match(calls[1][2].text, /omitted-code placeholder/);
	assert.match(calls[1][0].text, /Available lines for the entire snippet: 292/);
	assert.match(calls[1][0].text, /createAiClient/);
	assert.ok(result.includes(longClass));
});

test('a second invalid reply stops; source edits and provider errors never retry', async () => {
	let calls = 0;
	const base = { source, marker, filePath: 'client.ts', language: 'typescript', plan: '', checkCurrent() {},
		generate: async () => { calls++; return fence(''); } };
	await assert.rejects(requestSnippet(base), /empty code block/);
	assert.equal(calls, 2);
	calls = 0;
	await assert.rejects(requestSnippet({ ...base, generate: async () => { calls++; throw new Error('network unavailable'); } }), /network unavailable/);
	assert.equal(calls, 1);
	calls = 0;
	await assert.rejects(requestSnippet({ ...base, checkCurrent: () => { if (calls) { throw new Error('file changed'); } } }), /file changed/);
	assert.equal(calls, 1);
});

test('extra error classes trigger correction and a full file does not call the model', async () => {
	assert.throws(() => insertAiSnippet(source, marker, fence('class Client {}\nclass ClientError extends Error {}'), 'client.ts'), /contains 2 classes/);
	let called = false;
	await assert.rejects(requestSnippet({ source: '//AI request\n' + '// full\n'.repeat(299), marker: aiMarker('//AI request', 0)!,
		filePath: 'client.ts', language: 'typescript', plan: '', checkCurrent() {},
		generate: async () => { called = true; return ''; } }), /no room/);
	assert.equal(called, false);
});
