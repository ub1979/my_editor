import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chunkShapeProblems, parseChunks } from '../src/aiready/refactorPlan';
import { retryText } from '../src/aiready/splitPlan';

test('a reply\'s JSON array of name, from and to is read, with prose around it ignored', () => {
	assert.deepEqual(parseChunks('Here is the plan:\n[{"name":"queryRows","from":177,"to":295}]\nThat is all.'),
		[{ name: 'queryRows', from: 177, to: 295 }]);
	assert.deepEqual(parseChunks('```json\n[{"name":"a","from":3,"to":4,"why":"x"}, {"name":"b","from":5,"to":5}]\n```'),
		[{ name: 'a', from: 3, to: 4 }, { name: 'b', from: 5, to: 5 }]);
	assert.deepEqual(parseChunks('[]'), []);
	for (const reply of ['no plan', '[{"name":"a","from":"3","to":4}]', '[{"name":3,"from":3,"to":4}]', '[{"name":"a","from":3.5,"to":4}]',
		'{"name":"a","from":3,"to":4}', '[{"name":"a","from":3,"to":4}']) {
		assert.equal(parseChunks(reply), undefined, reply);
	}
});

test('shape problems: none, too many, bad names, reversed and overlapping ranges, a name twice', () => {
	assert.deepEqual(chunkShapeProblems([]), ['The plan names no helper.']);
	const many = Array.from({ length: 13 }, (_, i) => ({ name: `h${i}`, from: i * 10 + 1, to: i * 10 + 5 }));
	assert.deepEqual(chunkShapeProblems(many), ['At most 12 helpers per plan.']);
	assert.deepEqual(chunkShapeProblems(many.slice(0, 12)), []);
	assert.deepEqual(chunkShapeProblems([{ name: 'Query', from: 1, to: 2 }, { name: `x-${'y'.repeat(80)}`, from: 3, to: 4 }]), [
		'"Query" must start with a lower-case letter and use only letters, digits and underscores.',
		`${JSON.stringify(`x-${'y'.repeat(80)}`).slice(0, 60)} must start with a lower-case letter and use only letters, digits and underscores.`,
	]);
	assert.deepEqual(chunkShapeProblems([{ name: 'name', from: 30, to: 20 }]), ['name: from 30 is after to 20.']);
	assert.deepEqual(chunkShapeProblems([{ name: 'b', from: 13, to: 15 }, { name: 'a', from: 11, to: 14 }]), ['a (11–14) overlaps b (13–15).']);
	assert.deepEqual(chunkShapeProblems([{ name: 'name', from: 1, to: 2 }, { name: 'name', from: 3, to: 4 }]), ['name is named twice.']);
});

test('the retry repeats the prompt with the rejected plan and its problems', () => {
	const reply = '[{"name":"a","from":11,"to":14},{"name":"b","from":13,"to":15}]';
	const text = retryText({ system: 's', text: 'Function: big' }, reply, chunkShapeProblems(parseChunks(reply)!));
	assert.match(text, /^Function: big\n\nYour previous plan:\n\[\{"name":"a"/);
	assert.match(text, /It was rejected:\n- a \(11–14\) overlaps b \(13–15\)\.\n\nReply with a corrected JSON array only\.$/);
});
