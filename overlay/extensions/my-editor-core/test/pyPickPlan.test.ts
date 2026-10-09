import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BROWSE, pythonChoice, pythonChosenMessage, pythonQuestion, USE_IT } from '../src/aiready/pyPickPlan';

test('one candidate: a modal confirm showing its path, with Use it and Choose a file', () => {
	assert.deepEqual(pythonQuestion(['/p/.venv/bin/python']), {
		kind: 'confirm', message: 'Use this Python for fixes on a local branch?', detail: '/p/.venv/bin/python', buttons: [USE_IT, BROWSE],
	});
});

test('several candidates: a pick list with every candidate in order, then Choose a file last', () => {
	const question = pythonQuestion(['/a/python', '/b/python3']);
	assert.deepEqual(question, { kind: 'pick', title: 'Python for fixes on a local branch', items: ['/a/python', '/b/python3', BROWSE] });
});

test('no candidates: straight to the file dialog', () => {
	assert.deepEqual(pythonQuestion([]), { kind: 'browse' });
	assert.deepEqual(pythonChoice(pythonQuestion([]), undefined), { kind: 'browse' });
});

test('a confirm takes its candidate only on Use it; dismissing it cancels', () => {
	const question = pythonQuestion(['/p/python']);
	assert.deepEqual(pythonChoice(question, USE_IT), { kind: 'done', file: '/p/python' });
	assert.deepEqual(pythonChoice(question, undefined), { kind: 'done', file: undefined });
	assert.deepEqual(pythonChoice(question, 'Cancel'), { kind: 'done', file: undefined });
	assert.deepEqual(pythonChoice(question, BROWSE), { kind: 'browse' });
});

test('a pick is the picked item; Choose a file opens the dialog; no pick cancels', () => {
	const question = pythonQuestion(['/a/python', '/b/python']);
	assert.deepEqual(pythonChoice(question, '/b/python'), { kind: 'done', file: '/b/python' });
	assert.deepEqual(pythonChoice(question, BROWSE), { kind: 'browse' });
	assert.deepEqual(pythonChoice(question, undefined), { kind: 'done', file: undefined });
});

test('a candidate whose path equals the browse label still opens the dialog, never a file named like the button', () => {
	assert.deepEqual(pythonChoice(pythonQuestion([BROWSE, '/b/python']), BROWSE), { kind: 'browse' });
});

test('the chosen message names the file and its dotted version', () => {
	assert.equal(pythonChosenMessage('/p/python', [3, 12, 1]), 'Fixes in this folder use /p/python (Python 3.12.1).');
});
