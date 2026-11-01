import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mayProposeFile, mayUsePlanningTool, usesProjectTools } from '../src/chat/projectToolPolicy';
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
	assert.equal(usesProjectTools(MODES.architecture), true);
});

test('planning retrieves saved decisions while proposals stay in the document Keep/Undo path', () => {
	for (const id of ['requirements', 'architecture', 'tree']) {
		assert.equal(usesProjectTools(MODES[id]), true);
		assert.equal(mayProposeFile(id, false), false);
	}
	for (const name of ['read_file', 'read_chat', 'search_chat', 'search_records']) { assert.equal(mayUsePlanningTool(name), true); }
	for (const name of ['propose_file', 'propose_delete', 'run_tests', 'observe']) { assert.equal(mayUsePlanningTool(name), false); }
});
