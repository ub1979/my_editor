import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { looksLikeAgentProtocol, parseAgentStep, safeRelativePath, testSpec } from '../src/chat/agentProtocol';

test('agent protocol accepts one structured tool call or final reply', () => {
	assert.deepEqual(parseAgentStep('{"action":"tool","name":"read_file","arguments":{"path":"src/app.ts","start":20}}'), {
		action: 'tool', name: 'read_file', arguments: { path: 'src/app.ts', start: 20 },
	});
	assert.deepEqual(parseAgentStep('```json\n{"action":"final","message":"Done."}\n```'), {
		action: 'final', message: 'Done.',
	});
	assert.equal(parseAgentStep('{"action":"tool","name":"read_file","arguments":[]}'), undefined);
	assert.equal(parseAgentStep('I read the file'), undefined);
});

test('literal source whitespace in model JSON preserves code and existing escapes exactly', () => {
	const content = '/**\n * Client boundary\r\n */\n\tconst text = "quoted";\nconst pattern = /\\n/;\n';
	const step = { action: 'tool', name: 'propose_file', arguments: { path: 'src/client.ts', content } };
	const encoded = JSON.stringify(step);
	// Reproduce the failed provider reply: the opening comment has raw newlines, with
	// the rest escaped normally. The corrected reply also had literal tabs/newlines.
	assert.deepEqual(parseAgentStep(encoded.replace('\\n', '\n')), step);
	const literal = encoded.replace(/\\r\\n/g, '\r\n').replace(/\\t/g, '\t');
	assert.deepEqual(parseAgentStep(literal), step);
	assert.deepEqual(parseAgentStep('```json\n' + literal + '\n```'), step);
	assert.equal(parseAgentStep(literal.slice(0, -2)), undefined);
	assert.equal(parseAgentStep('{"action":"final","message":"bad "quote"\n"}'), undefined);
	assert.equal(parseAgentStep('{"action":"final","message":"bad\\\ncontinuation"}'), undefined);
	assert.equal(parseAgentStep('{"action":"final","message":"nul\u0000"}'), undefined);
	assert.equal(parseAgentStep('{"action":"tools","calls":[{"name":"propose_file","arguments":{"path":"a.ts","content":"a\nb"}}]}'), undefined);
});

test('agent protocol groups independent reads but never writes or test runs', () => {
	const reads = Array.from({ length: 6 }, (_, i) => ({ name: 'read_file', arguments: { path: `src/${i}.ts` } }));
	assert.deepEqual(parseAgentStep(JSON.stringify({ action: 'tools', calls: reads })), { action: 'tools', calls: reads });
	assert.equal(parseAgentStep(JSON.stringify({ action: 'tools', calls: Array(61).fill(reads[0]) })), undefined);
	assert.equal(parseAgentStep(JSON.stringify({ action: 'tools', calls: [...reads, { name: 'propose_file', arguments: { path: 'x.ts', content: 'x' } }] })), undefined);
	const patch = { name: 'propose_edit', arguments: { path: 'a.ts', edits: [{ oldText: 'one', newText: 'two' }] } };
	assert.deepEqual(parseAgentStep(JSON.stringify({ action: 'tool', ...patch })), { action: 'tool', ...patch });
	assert.equal(parseAgentStep(JSON.stringify({ action: 'tools', calls: [patch, { name: 'read_file', arguments: { path: 'a.ts' } }] })), undefined);
	assert.deepEqual(parseAgentStep('{"action":"tools","calls":[{"name":"read_file","arguments":{"path":"a.go"}},{"name":"search","arguments":{"query":"Dial"}}]}'), {
		action: 'tools', calls: [
			{ name: 'read_file', arguments: { path: 'a.go' } },
			{ name: 'search', arguments: { query: 'Dial' } },
		],
	});
	assert.equal(parseAgentStep('{"action":"tools","calls":[{"name":"read_file","arguments":{"path":"a.go"}},{"name":"propose_file","arguments":{"path":"a.go","content":"new"}}]}'), undefined);
	assert.equal(parseAgentStep('{"action":"tools","calls":[{"name":"read_file","arguments":{"path":"a.go"}},{"name":"run_tests","arguments":{"command":"npm test"}}]}'), undefined);
	assert.equal(parseAgentStep('{"action":"tools","calls":[{"name":"read_file","arguments":{"path":"a.go"}},{"name":"observe","arguments":{"id":"cell_a_live"}}]}'), undefined);
	assert.equal(parseAgentStep('{"action":"tools","calls":[{"name":"search","arguments":{"query":"header"}},{"name":"open_files","arguments":{"locations":[{"path":"src/a.ts","line":5}]}}]}'), undefined);
	assert.deepEqual(parseAgentStep('{"action":"tool","name":"open_files","arguments":{"locations":[{"path":"src/a.ts","line":5}]}}'), {
		action: 'tool', name: 'open_files', arguments: { locations: [{ path: 'src/a.ts', line: 5 }] },
	});
	assert.deepEqual(parseAgentStep('{"action":"tool","name":"observe","arguments":{"id":"cell_a_live"}}'), {
		action: 'tool', name: 'observe', arguments: { id: 'cell_a_live' },
	});
	assert.deepEqual(parseAgentStep('{"action":"tools","calls":[{"name":"read_chat","arguments":{"turnsAgo":2,"start":0}},{"name":"search","arguments":{"query":"gap"}}]}'), {
		action: 'tools', calls: [
			{ name: 'read_chat', arguments: { turnsAgo: 2, start: 0 } },
			{ name: 'search', arguments: { query: 'gap' } },
		],
	});
	assert.deepEqual(parseAgentStep('{"action":"tool","name":"search_chat","arguments":{"query":"backpressure"}}'), {
		action: 'tool', name: 'search_chat', arguments: { query: 'backpressure' },
	});
});

test('agent protocol consumes joined model replies without exposing tool JSON', () => {
	const reply = '{"action":"tools","calls":[{"name":"read_file","arguments":{"path":"internal/engine/runner.go","start":590,"lines":45}},{"name":"search","arguments":{"query":"finalization_backpressure"}}]}';
	assert.deepEqual(parseAgentStep(reply + reply), parseAgentStep(reply));
	assert.deepEqual(parseAgentStep(reply + '\n' + reply), parseAgentStep(reply));
	assert.deepEqual(parseAgentStep('Checking these files: ' + reply), parseAgentStep(reply));
	assert.equal(looksLikeAgentProtocol(reply.slice(0, -2)), true);
	assert.equal(looksLikeAgentProtocol('Checking these files: ' + reply), true);
	assert.equal(looksLikeAgentProtocol('The file contains JSON examples.'), false);
});

test('DeepSeek XML read requests normalize without permitting writes or command execution', () => {
	const reply = '<tool_result name="read_file">\n{"path":"packages/contracts/test/events.test.ts","start":160,"lines":300}\n</tool_result>';
	assert.deepEqual(parseAgentStep(reply), { action: 'tool', name: 'read_file',
		arguments: { path: 'packages/contracts/test/events.test.ts', start: 160, lines: 300 } });
	assert.equal(looksLikeAgentProtocol(reply), true);
	assert.deepEqual(parseAgentStep('<tool_call name="search">{"query":"saveDraft"}</tool_call>'),
		{ action: 'tool', name: 'search', arguments: { query: 'saveDraft' } });
	for (const name of ['propose_file', 'propose_delete', 'run_tests', 'observe', 'open_files', 'exec']) {
		assert.equal(parseAgentStep(`<tool_result name="${name}">{"path":"src/app.ts","command":"npm test"}</tool_result>`), undefined);
	}
	for (const body of ['null', '[]', '"text"', '{bad}']) {
		assert.equal(parseAgentStep(`<tool_result name="read_file">${body}</tool_result>`), undefined);
	}
	assert.equal(parseAgentStep('<tool_result name="read_file">{"path":"a.ts"}</tool_call>'), undefined);
});

test('file conclusions are scoped and alternate grouped reads retain the read-only checks', () => {
	for (const message of ['FILE_REVIEWED\nCompared the file with its callers.', 'BLOCKED\nWhich interface should this implement?']) {
		assert.equal(parseAgentStep(message), undefined);
		assert.deepEqual(parseAgentStep(message, true), { action: 'final', message });
	}
	assert.equal(parseAgentStep('FILE_REVIEWED', true), undefined);
	const batch = { action: 'tool', name: 'tools', calls: [{ name: 'read_file', arguments: { path: 'a.ts' } }] };
	assert.deepEqual(parseAgentStep(JSON.stringify(batch)), { action: 'tools', calls: batch.calls });
	assert.deepEqual(parseAgentStep(JSON.stringify({ action: 'tool', name: 'tools', arguments: { calls: batch.calls } })),
		{ action: 'tools', calls: batch.calls });
	for (const name of ['propose_file', 'propose_delete', 'run_tests', 'observe']) {
		assert.equal(parseAgentStep(JSON.stringify({ ...batch, calls: [{ name, arguments: { path: 'a.ts' } }] })), undefined);
		assert.equal(parseAgentStep(JSON.stringify({ action: 'tool', name: 'tools',
			arguments: { calls: [{ name, arguments: { path: 'a.ts' } }] } })), undefined);
	}
});

test('agent paths stay relative and avoid internal or dependency trees', () => {
	for (const path of ['/tmp/file', '../other', 'src/../secret', '.git/config', 'node_modules/pkg/index.js', 'src\\file', 'src//file']) {
		assert.equal(safeRelativePath(path), undefined, path);
	}
	assert.equal(safeRelativePath('src/nested/file.ts'), 'src/nested/file.ts');
});

test('test commands are allowlisted and cannot invoke a shell', () => {
	assert.deepEqual(testSpec('go test ./...'), { bin: 'go', args: ['test', './...'] });
	assert.deepEqual(testSpec('go test ./internal/store/...'), { bin: 'go', args: ['test', './internal/store/...'] });
	assert.equal(testSpec('npm test; rm -rf .'), undefined);
	assert.equal(testSpec('go test ../other'), undefined);
});
