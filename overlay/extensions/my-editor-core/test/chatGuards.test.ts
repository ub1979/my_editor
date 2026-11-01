import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { allowedAction, isReasoningEffort, isWebLink } from '../src/chat/chatGuards';

test('reply buttons may run only the allowed my_editor commands', () => {
	for (const command of ['myEditor.saveDecision', 'myEditor.adaptFile', 'myEditor.analyseProject', 'myEditor.aiReadyFix', 'myEditor.pushBranch']) {
		assert.equal(allowedAction(command), true, command);
	}
	for (const command of ['workbench.action.terminal.sendSequence', 'myEditor.chooseModel', '', 'myEditor.aiReadyFix ']) {
		assert.equal(allowedAction(command), false, command);
	}
});

test('every command a reply button carries is allowed, or its click would do nothing', () => {
	const dir = path.join(process.cwd(), 'src', 'chat');
	const commands = readdirSync(dir).filter(name => name.endsWith('.ts'))
		.flatMap(name => [...readFileSync(path.join(dir, name), 'utf8').matchAll(/sink\.action\([^,]+,\s*'([^']+)'/g)].map(match => match[1]));
	assert.ok(commands.includes('myEditor.pushBranch'), 'the scan finds the reply buttons');
	for (const command of commands) { assert.equal(allowedAction(command), true, command); }
});

test('reasoning efforts are the menu values only', () => {
	for (const key of ['default', 'low', 'medium', 'high', 'xhigh', 'max']) { assert.equal(isReasoningEffort(key), true, key); }
	for (const key of [undefined, '', 'ultra', 'HIGH']) { assert.equal(isReasoningEffort(key), false, String(key)); }
});

test('only http and https links open externally', () => {
	assert.equal(isWebLink('https://example.com/a'), true);
	assert.equal(isWebLink('http://localhost:3000'), true);
	for (const href of [undefined, '', 'file:///etc/passwd', 'command:workbench.action.quit', 'javascript:alert(1)', ' https://x.y', 'vscode://x']) {
		assert.equal(isWebLink(href), false, String(href));
	}
});
