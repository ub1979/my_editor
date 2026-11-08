import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decisionReference, decisionReferences } from '../src/project/decisionReferences';
import { materializeRepairDecision, repairDecisionProblem, requestedRepairs } from '../src/project/filePassRepairs';

test('saved section references survive formatting but not changed meaning or provenance', () => {
	const docs = { requirements: '## FR-011\n- **Preserve the full reason.**\n- Do not truncate it.\n' };
	const [entry] = decisionReferences(docs);
	const parsed = requestedRepairs('BLOCKED\nREPAIRS_REQUIRED ' + JSON.stringify({ files: [{ path: 'src/reason.ts', reason: 'Preserve long reasons' }],
		decision: { source: 'requirements', reference: entry.reference } }))!;
	assert.equal(materializeRepairDecision(parsed.decision, [], docs).quote, entry.quote);
	assert.equal(decisionReference('requirements', 'Preserve the full reason.\nDo not truncate it.'), entry.reference);
	assert.match(repairDecisionProblem(parsed.decision, [], { requirements: docs.requirements.replace('Do not', 'Do') })!, /unknown/);
	assert.match(repairDecisionProblem({ ...parsed.decision, source: 'architecture' }, [], docs)!, /unknown/);
	assert.match(repairDecisionProblem({ ...parsed.decision, quote: 'Invented permission' }, [], docs)!, /different quote/);
});

test('developer references retain exact approved answers and cannot be minted from arbitrary model text', () => {
	const answer = 'Keep empty reasons unchanged.';
	const decision = { source: 'developer' as const, reference: decisionReference('developer', answer), quote: '' };
	assert.equal(materializeRepairDecision(decision, [answer], {}).quote, answer);
	assert.match(repairDecisionProblem(decision, ['Do not keep empty reasons unchanged.'], {})!, /unknown/);
	assert.match(repairDecisionProblem(decision, [], {})!, /unknown/);
	assert.match(repairDecisionProblem({ ...decision, quote: 'empty reasons unchanged.' }, [answer], {})!, /different quote/);
});

test('a referenced plan section permits a contiguous excerpt but retains the whole section in repair context', () => {
	const docs = { architecture: '## Automation\n- **Read the current paused state.**\n- Never resume without a user click.\n\n## Other\nAllow a different unrelated behavior.\n' };
	const [entry] = decisionReferences(docs);
	const decision = { source: 'architecture' as const, reference: entry.reference, quote: 'Read the current paused state.' };
	assert.equal(repairDecisionProblem(decision, [], docs), undefined);
	assert.equal(materializeRepairDecision(decision, [], docs).quote, entry.quote);
	for (const quote of ['Allow a different unrelated behavior.', 'Read the paused state.', 'Always resume without a user click.', 'Read', 'Read the current paused state. Never resume without user click.']) {
		assert.match(repairDecisionProblem({ ...decision, quote }, [], docs)!, /different quote/);
	}
	assert.match(repairDecisionProblem(decision, [], { architecture: docs.architecture.replace('Never resume', 'Always resume') })!, /unknown/);
});
