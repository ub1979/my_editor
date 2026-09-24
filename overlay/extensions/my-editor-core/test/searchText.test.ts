import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { matchingRecordLines } from '../src/records/searchText';

test('older saved evidence can be found with source line and redacted content', () => {
	const lines = matchingRecordLines('.my_editor/chats/2026-09-24.md',
		'first line\nA1 finalization_backpressure phone +447700900123\nother line', 'finalization_backpressure');
	assert.equal(lines.length, 1);
	assert.match(lines[0], /2026-09-24\.md:2:/);
	assert.match(lines[0], /finalization_backpressure/);
	assert.doesNotMatch(lines[0], /447700900123/);
});
