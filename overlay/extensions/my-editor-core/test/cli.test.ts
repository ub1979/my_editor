import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseClaudeLine, parseCodexLine, transcript } from '../src/models/cliProtocol';

test('transcript writes earlier turns out and ends with the request', () => {
	assert.equal(transcript([{ role: 'user', text: 'Hi' }]), 'Hi');
	assert.equal(
		transcript([{ role: 'user', text: 'A?' }, { role: 'assistant', text: 'B.' }, { role: 'user', text: 'C?' }]),
		'Conversation so far:\n\nUser: A?\n\nAssistant: B.\n\nUser: C?');
});

test('parseClaudeLine keeps text deltas and skips thinking and system lines', () => {
	assert.deepEqual(parseClaudeLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}}'), { text: 'Hel' });
	assert.deepEqual(parseClaudeLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"x"}}}'), {});
	assert.deepEqual(parseClaudeLine('{"type":"system","subtype":"init"}'), {});
	assert.deepEqual(parseClaudeLine('not json'), {});
});

test('parseClaudeLine reports failed results', () => {
	assert.deepEqual(parseClaudeLine('{"type":"result","subtype":"success","is_error":true,"result":"Not logged in"}'), { error: 'Not logged in' });
	assert.deepEqual(parseClaudeLine('{"type":"result","subtype":"success","is_error":false,"result":"Hello"}'), {});
});

test('parseCodexLine reads agent messages and failures', () => {
	assert.deepEqual(parseCodexLine('{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"hello"}}'), { text: 'hello' });
	assert.deepEqual(parseCodexLine('{"type":"item.completed","item":{"type":"reasoning","text":"x"}}'), {});
	assert.deepEqual(parseCodexLine('{"type":"turn.failed","error":{"message":"quota"}}'), { error: 'quota' });
});
