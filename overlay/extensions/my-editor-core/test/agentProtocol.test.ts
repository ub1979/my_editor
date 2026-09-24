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

test('agent protocol groups independent reads but never writes or test runs', () => {
	assert.deepEqual(parseAgentStep('{"action":"tools","calls":[{"name":"read_file","arguments":{"path":"a.go"}},{"name":"search","arguments":{"query":"Dial"}}]}'), {
		action: 'tools', calls: [
			{ name: 'read_file', arguments: { path: 'a.go' } },
			{ name: 'search', arguments: { query: 'Dial' } },
		],
	});
	assert.equal(parseAgentStep('{"action":"tools","calls":[{"name":"read_file","arguments":{"path":"a.go"}},{"name":"propose_file","arguments":{"path":"a.go","content":"new"}}]}'), undefined);
	assert.equal(parseAgentStep('{"action":"tools","calls":[{"name":"read_file","arguments":{"path":"a.go"}},{"name":"run_tests","arguments":{"command":"npm test"}}]}'), undefined);
	assert.equal(parseAgentStep('{"action":"tools","calls":[{"name":"read_file","arguments":{"path":"a.go"}},{"name":"observe","arguments":{"id":"cell_a_live"}}]}'), undefined);
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
