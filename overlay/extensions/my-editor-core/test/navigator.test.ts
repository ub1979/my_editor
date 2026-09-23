import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { changedHunks, parseFindings } from '../src/navigator/hunks';

test('changedHunks finds inserted and edited lines in the new text', () => {
	const before = 'a\nb\nc\nd\ne';
	const after = 'a\nB\nc\nx\ny\nd\ne';
	assert.deepEqual(changedHunks(before, after), [{ start: 2, end: 2 }, { start: 4, end: 5 }]);
});

test('changedHunks returns nothing for pure deletions or no change', () => {
	assert.deepEqual(changedHunks('a\nb\nc', 'a\nc'), []);
	assert.deepEqual(changedHunks('a\nb', 'a\nb'), []);
});

test('changedHunks falls back to one hunk for huge edits', () => {
	assert.deepEqual(changedHunks('x\nq\nz', 'x\n1\n2\nz', 1), [{ start: 2, end: 3 }]);
});

test('parseFindings reads a JSON array inside prose and clamps lines', () => {
	const reply = 'Here you go:\n```json\n[{"line": 3, "severity": "warning", "message": "Possible null."}, {"line": 99, "message": "Style."}]\n```';
	assert.deepEqual(parseFindings(reply, 10), [
		{ line: 3, severity: 'warning', message: 'Possible null.' },
		{ line: 10, severity: 'info', message: 'Style.' },
	]);
});

test('parseFindings tolerates junk and empty arrays', () => {
	assert.deepEqual(parseFindings('nothing to report', 5), []);
	assert.deepEqual(parseFindings('[]', 5), []);
	assert.deepEqual(parseFindings('[{"line": 1, "message": ""}]', 5), []);
});
