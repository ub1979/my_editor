import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChatState } from '../src/chat/chatState';
import { replyActions } from '../src/chat/replyActions';
import { render } from '../src/chat/presentation';
import { architecture } from './planningFixture';

test('a retained valid architecture can be reviewed again without regenerating it or choosing a model', () => {
	const state = new ChatState(undefined);
	const reply = state.addReply('failed', 'architecture');
	Object.assign(reply, { done: true, error: 'Proposed architecture: #data-models needs requirement links and an interface.',
		historyText: 'Ready.\n````markdown\n' + architecture + '````', markdown: 'The planning document could not be prepared for Keep.' });
	const restored = new ChatState(state.snapshot()).messages[0];
	const action = replyActions(restored)[0];
	assert.equal(action.label, 'Review saved architecture');
	assert.deepEqual(action.args, ['architecture', reply.historyText]);
	assert.deepEqual(render(restored).actions, ['Review saved architecture']);
	assert.deepEqual(render(restored).choices, [], 'Do not send the user into another generation loop');
	assert.equal(render(restored).errorAction, undefined);
	restored.mode = 'requirements';
	assert.deepEqual(replyActions(restored), [], 'A wrong-document reply cannot target another planning file');
});
