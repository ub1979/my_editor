import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { moveOutputAnchor, outputHeight, pythonOutputHtml } from '../src/coding/pythonOutputHtml';

test('inline output follows edits above a block and is invalidated by edits inside it', () => {
	const block = { start: 20, end: 40 };
	assert.deepEqual(moveOutputAnchor(block, [{ rangeOffset: 0, rangeLength: 0, text: '# note\n' }]), { start: 27, end: 47 });
	assert.deepEqual(moveOutputAnchor(block, [{ rangeOffset: 45, rangeLength: 5, text: '' }]), block);
	assert.equal(moveOutputAnchor(block, [{ rangeOffset: 30, rangeLength: 0, text: 'new' }]), undefined);
	assert.equal(moveOutputAnchor(block, [{ rangeOffset: 10, rangeLength: 15, text: '' }]), undefined);
	assert.equal(moveOutputAnchor(block, [{ rangeOffset: 40, rangeLength: 0, text: 'appended' }]), undefined);
	assert.deepEqual(moveOutputAnchor(block, [{ rangeOffset: 1, rangeLength: 2, text: '' }, { rangeOffset: 10, rangeLength: 0, text: 'abc' }]), { start: 21, end: 41 });
});

test('Python output is escaped, height bounded, and dismissal cannot execute printed markup', () => {
	const html = pythonOutputHtml(7, 'Finished', '<script>alert("bad")</script>\n42 & more');
	assert.ok(!html.includes('<script>alert'));
	assert.ok(html.includes('&lt;script&gt;'));
	assert.ok(html.includes('42 &amp; more'));
	assert.ok(html.includes("default-src 'none'"));
	assert.ok(html.includes('Dismiss this block output'));
	assert.equal(outputHeight('x\n'.repeat(1000)), 16);
	assert.equal(outputHeight(''), 4);
	assert.ok(pythonOutputHtml(1, 'Finished', '').includes('No output'));
});
