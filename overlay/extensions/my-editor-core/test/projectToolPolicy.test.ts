import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mayProposeFile, usesProjectTools } from '../src/chat/projectToolPolicy';

test('Review has project tools but cannot propose edits', () => {
	assert.equal(usesProjectTools('review'), true);
	assert.equal(mayProposeFile('review', false), false);
	assert.equal(usesProjectTools('chat'), true);
	assert.equal(mayProposeFile('chat', false), true);
	assert.equal(mayProposeFile('chat', true), false);
	assert.equal(usesProjectTools('architecture'), false);
});
