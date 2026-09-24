import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { compactInvestigation, evidenceEntry } from '../src/chat/investigationRecord';

test('investigation records separate host evidence from answer and redact sensitive output', () => {
	const observed = evidenceEntry('observe', { id: 'cell_a_live' }, 'spool_depth=2 admin_key=supersecret123 phone=+447700900123');
	assert.equal(observed.subject, 'cell_a_live');
	assert.match(observed.excerpt, /spool_depth=2/);
	assert.doesNotMatch(observed.excerpt, /supersecret|447700900123/);
	assert.equal(observed.resultHash.length, 64);
	const record = compactInvestigation({
		id: 'abc123abc123', at: '2026-09-24T14:00:00Z', model: 'Codex',
		question: 'q'.repeat(3_000), answer: 'a'.repeat(5_000), evidence: [observed],
	});
	assert.equal(record.question.length, 2_000);
	assert.equal(record.answer.length, 4_000);
	assert.equal(record.evidence[0].resultHash, observed.resultHash);
});
