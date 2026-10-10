import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fixButton } from '../src/aiready/fixButton';

const idle = { running: false, saved: false, branchExists: false, left: undefined as number | undefined };

test('while a run is in progress the button reads Running and is disabled', () => {
	const view = fixButton({ ...idle, running: true, saved: true, branchExists: true, left: 3 });
	assert.deepEqual([view.label, view.primary, view.disabled], ['Running…', true, true]);
});

test('a saved unfinished run offers Continue', () => {
	const view = fixButton({ ...idle, saved: true, branchExists: true, left: 3 });
	assert.deepEqual([view.label, view.primary, view.disabled], ['Continue', true, false]);
});

test('otherwise the first run reads Fix on a local branch, and later ones Fix remaining files while files are left', () => {
	assert.equal(fixButton(idle).label, 'Fix on a local branch');
	assert.equal(fixButton({ ...idle, left: 4 }).label, 'Fix on a local branch');
	assert.equal(fixButton({ ...idle, branchExists: true }).label, 'Fix remaining files');
	assert.equal(fixButton({ ...idle, branchExists: true, left: 4 }).label, 'Fix remaining files');
	for (const left of [undefined, 0, 4]) { assert.notEqual(fixButton({ ...idle, branchExists: true, left }).label, 'Next batch'); }
});

test('the text gives the count when known and omits it when not', () => {
	assert.match(fixButton({ ...idle, left: 12 }).text, /12 files over 400 lines left/);
	assert.match(fixButton({ ...idle, left: 1 }).text, /1 file over 400 lines left/);
	assert.doesNotMatch(fixButton(idle).text, /over 400/);
});

test('with nothing left the text says so and the button is secondary', () => {
	const view = fixButton({ ...idle, branchExists: true, left: 0 });
	assert.match(view.text, /All files are within 400 lines/);
	assert.equal(view.label, 'Fix on a local branch');
	assert.equal(view.primary, false);
	assert.equal(view.disabled, false);
});
