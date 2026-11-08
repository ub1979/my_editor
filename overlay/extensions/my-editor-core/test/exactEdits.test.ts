import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyExactEdits } from '../src/chat/exactEdits';

test('exact repairs preserve untouched content and resolve every edit against the original', () => {
	const source = 'const first = 1;\r\n// untouched\r\nconst second = 2;\r\n';
	assert.equal(applyExactEdits(source, [
		{ oldText: 'const first = 1;', newText: 'const first = 2;' },
		{ oldText: 'const second = 2;', newText: 'const second = 3;' },
	]), 'const first = 2;\r\n// untouched\r\nconst second = 3;\r\n');
	assert.equal(applyExactEdits('one two', [{ oldText: 'one', newText: 'two' }, { oldText: 'two', newText: 'three' }]), 'two three');
});

test('missing, repeated and overlapping targets fail rather than guessing', () => {
	for (const edits of [
		[{ oldText: 'missing', newText: 'x' }],
		[{ oldText: 'a', newText: 'x' }],
		[{ oldText: 'aba', newText: 'x' }, { oldText: 'ba', newText: 'y' }],
	]) { assert.throws(() => applyExactEdits('aba', edits), /exactly once|overlap/); }
	assert.throws(() => applyExactEdits('aaa', [{ oldText: 'aa', newText: 'x' }]), /exactly once/);
});

test('replacement inputs retain size, binary and redaction boundaries', () => {
	for (const edits of [[], null, [{ oldText: '', newText: 'x' }], [{ oldText: 'one', newText: 1 }],
		[{ oldText: '[REDACTED]', newText: 'x' }], [{ oldText: 'one', newText: '\0' }]]) {
		assert.throws(() => applyExactEdits('one', edits));
	}
	assert.throws(() => applyExactEdits('one', Array(21).fill({ oldText: 'one', newText: 'x' })));
	assert.throws(() => applyExactEdits('x'.repeat(80_000), [{ oldText: 'x'.repeat(80_000), newText: 'y'.repeat(80_001) }]));
	assert.equal(applyExactEdits('one two', [{ oldText: 'one ', newText: '' }]), 'two');
});
