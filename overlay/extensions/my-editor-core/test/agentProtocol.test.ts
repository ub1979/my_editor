import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseAgentStep, safeRelativePath, testSpec } from '../src/chat/agentProtocol';

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
