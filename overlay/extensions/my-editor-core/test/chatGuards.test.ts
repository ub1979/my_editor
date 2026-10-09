import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { allowedAction, isReasoningEffort, isWebLink } from '../src/chat/chatGuards';

test('reply buttons may run only the allowed my_editor commands', () => {
	for (const command of ['myEditor.saveDecision', 'myEditor.adaptFile', 'myEditor.analyseProject', 'myEditor.aiReadyFix']) {
		assert.equal(allowedAction(command), true, command);
	}
	for (const command of ['workbench.action.terminal.sendSequence', 'myEditor.chooseModel', '', 'myEditor.aiReadyFix ']) {
		assert.equal(allowedAction(command), false, command);
	}
});

test('reasoning efforts are the menu values only', () => {
	for (const key of ['default', 'low', 'medium', 'high', 'xhigh']) { assert.equal(isReasoningEffort(key), true, key); }
	for (const key of [undefined, '', 'max', 'HIGH']) { assert.equal(isReasoningEffort(key), false, String(key)); }
});

test('only http and https links open externally', () => {
	assert.equal(isWebLink('https://example.com/a'), true);
	assert.equal(isWebLink('http://localhost:3000'), true);
	for (const href of [undefined, '', 'file:///etc/passwd', 'command:workbench.action.quit', 'javascript:alert(1)', ' https://x.y', 'vscode://x']) {
		assert.equal(isWebLink(href), false, String(href));
	}
});
