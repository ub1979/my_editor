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

test('files no run here can split are named by reason, apart from the ones left, and nothing left is not called done', () => {
	const view = fixButton({ ...idle, branchExists: true, left: 0, refactor: 4, unbuildable: 26 });
	assert.deepEqual([view.label, view.primary], ['Fix on a local branch', false]);
	assert.match(view.text, /Nothing left to split here\. 4 files need a real refactor this fixer can't do here; 26 files are in packages that don't build on this computer\./);
	assert.doesNotMatch(view.text, /All files are within/);
	assert.match(fixButton({ ...idle, left: 0, refactor: 1 }).text, /1 file needs a real refactor this fixer can't do here\.$/);
	assert.match(fixButton({ ...idle, left: 0, unbuildable: 1 }).text, /Nothing left to split here\. 1 file is in packages that don't build on this computer\.$/);
	assert.match(fixButton({ ...idle, branchExists: true, left: 2, unbuildable: 3 }).text, /2 files over 400 lines left to split\. 3 files are in packages/);
});

test('refactor offers count with the files left, and refused ones stay stuck', () => {
	const view = fixButton({ running: false, saved: false, branchExists: true, left: 0, offers: 2, refactor: 1 });
	assert.deepEqual([view.label, view.primary, view.disabled], ['Fix remaining files', true, false]);
	assert.ok(view.text.includes('2 long functions to refactor into helpers.'), view.text);
	assert.ok(view.text.includes('1 file needs a real refactor this fixer can\'t do here.'), view.text);
	assert.doesNotMatch(view.text, /Nothing left/);
	const both = fixButton({ ...idle, branchExists: true, left: 3, offers: 1 });
	assert.match(both.text, /3 files over 400 lines left to split\. 1 long function to refactor into helpers\.$/);
	assert.equal(fixButton({ ...idle, branchExists: true, left: 0, offers: 0, refactor: 1 }).label, 'Fix on a local branch');
});
