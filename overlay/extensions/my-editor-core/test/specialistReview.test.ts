import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MODES } from '../src/pair/prompts';
import { specialistReview } from '../src/chat/specialistReview';

test('standalone specialist inspection does not demand the document-generation pipeline', () => {
	for (const id of ['requirements', 'architecture', 'tree']) {
		const review = specialistReview(MODES[id], true, false);
		assert.equal(review.id, id); assert.equal(review.writes, 'none'); assert.equal(review.doc, undefined);
		assert.match(review.instruction, /Missing planning documents are an evidence limit/);
		assert.match(review.instruction, /checks not executed/);
		assert.equal(specialistReview(MODES[id], false, false), MODES[id], 'Document generation retains its gates');
		assert.equal(specialistReview(MODES[id], true, true), MODES[id], 'Opening a stage does not silently start an audit');
	}
	for (const id of ['file', 'feature', 'explain']) { assert.equal(specialistReview(MODES[id], true, false), MODES[id]); }
});
