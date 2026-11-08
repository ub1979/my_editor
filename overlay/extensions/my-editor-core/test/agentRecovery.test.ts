import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseAgentStep } from '../src/chat/agentProtocol';
import { runAgentLoop } from '../src/chat/agentLoop';

test('a shorthand local-model file action is executed instead of discarded before a false final claim', async () => {
	assert.deepEqual(parseAgentStep('{"action":"propose_file","arguments":{"path":"hello.txt","content":"Hello"}}'),
		{ action: 'tool', name: 'propose_file', arguments: { path: 'hello.txt', content: 'Hello' } });
	assert.equal(parseAgentStep('{"action":"shell","arguments":{}}'), undefined);
	assert.deepEqual(parseAgentStep('Reasoning. {"action":"propose_file","path":"pricing.py","content":"def subtotal(values):\\n    return sum(values)\\n"}'),
		{ action: 'tool', name: 'propose_file', arguments: { path: 'pricing.py', content: 'def subtotal(values):\n    return sum(values)\n' } });
	assert.equal(parseAgentStep('{"action":"shell","command":"echo unsafe"}'), undefined);
	assert.equal(parseAgentStep('{"action":"propose_file","arguments":[]}'), undefined);
	assert.deepEqual(parseAgentStep('<think>{"action":"final","message":"guess"}</think>{"action":"tool","name":"list_files","arguments":{}}'),
		{ action: 'tool', name: 'list_files', arguments: {} });
});

test('a model denying file access is redirected to host tools, then a proposal awaiting Keep', async () => {
	const replies = ['{"action":"final","message":"I cannot access project files."}',
		'{"action":"tool","name":"propose_file","arguments":{"path":"hello.txt","content":"Hello"}}',
		'{"action":"final","message":"The hello.txt proposal is ready. Use Keep to apply it."}'];
	let calls = 0;
	const answer = await runAgentLoop({ initial: [{ role: 'user', text: 'Create hello.txt' }], cancelled: () => false,
		progress: () => undefined, ask: async () => replies.shift()!, execute: async () => { calls++; return 'Proposed hello.txt.'; } });
	assert.equal(calls, 1);
	assert.match(answer, /Use Keep/);
});

test('repeated false success cannot be shown when no host file action ran', async () => {
	let calls = 0;
	const answer = await runAgentLoop({ initial: [], cancelled: () => false, progress: () => undefined,
		ask: async () => '{"action":"final","message":"I created hello.txt."}', execute: async () => { calls++; return ''; } });
	assert.equal(calls, 0);
	assert.match(answer, /No file was changed/);
});

test('ordinary prose is repaired into a tool request before ending the agent session', async () => {
	let round = 0, calls = 0;
	const answers = ['Let me read the project.', '{"action":"tool","name":"list_files","arguments":{}}', '{"action":"final","message":"The folder has one file."}'];
	await runAgentLoop({ initial: [], cancelled: () => false, progress: () => undefined,
		ask: async () => answers[round++], execute: async () => { calls++; return 'hello.txt'; } });
	assert.equal(calls, 1);
});

test('a file review cannot describe an unproposed rewrite as a completed fix', async () => {
	const replies = [
		'FILE_REVIEWED\nThe rewrite moves the pause row first and now throws a typed error.',
		'{"action":"tool","name":"propose_file","arguments":{"path":"automation.ts","content":"corrected source"}}',
		'FILE_REVIEWED\nPrepared the pause error correction; tests remain to run.',
	];
	let calls = 0;
	const answer = await runAgentLoop({ initial: [], fileReview: true, cancelled: () => false,
		progress: () => undefined, ask: async () => replies.shift()!,
		execute: async () => { calls++; return 'Proposed automation.ts'; } });
	assert.equal(calls, 1); assert.match(answer, /Prepared the pause error correction/);
});

test('a claimed review-ready diff must produce a real host proposal', async () => {
	const replies = [
		{ action: 'final', message: 'The minimal-diff bus.ts is waiting for review — press Keep.' },
		{ action: 'tool', name: 'propose_file', arguments: { path: 'bus.ts', content: 'corrected source' } },
		{ action: 'final', message: 'The bus.ts proposal is ready for review.' },
	];
	let calls = 0;
	const answer = await runAgentLoop({ initial: [], cancelled: () => false, progress: () => undefined,
		pendingProposal: () => false, ask: async () => JSON.stringify(replies.shift()),
		execute: async () => { calls++; return 'Proposed bus.ts'; } });
	assert.equal(calls, 1); assert.match(answer, /ready for review/);
});

test('review-ready claims respect actual pending state and repeated false claims stop', async () => {
	for (const pending of [false, true]) {
		let asks = 0;
		const answer = await runAgentLoop({ initial: [], cancelled: () => false, progress: () => undefined,
			pendingProposal: () => pending, ask: async () => { asks++; return JSON.stringify({ action: 'final', message: 'The bus.ts proposal is ready for review.' }); },
			execute: async () => { throw Error('No action should be invented'); } });
		assert.equal(asks, pending ? 1 : 2);
		assert.match(answer, pending ? /ready for review/ : /No file was changed/);
	}
});
