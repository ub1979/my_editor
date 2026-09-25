import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mayProposeFile, usesProjectTools } from '../src/chat/projectToolPolicy';
import { MODES } from '../src/pair/prompts';

test('All read-only conversations can inspect the project but cannot propose edits', () => {
	for (const id of ['review', 'explain', 'why', 'qa', 'brainstorm']) {
		assert.equal(usesProjectTools(MODES[id]), true, id);
		assert.equal(mayProposeFile(id, false), false, id);
	}
	assert.equal(mayProposeFile('review', false), false);
	assert.equal(usesProjectTools(MODES.chat), true);
	assert.equal(mayProposeFile('chat', false), true);
	assert.equal(mayProposeFile('chat', true), false);
	assert.equal(usesProjectTools(MODES.architecture), false);
});
