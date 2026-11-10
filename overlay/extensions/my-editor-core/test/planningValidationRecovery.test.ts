import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { planningRecovery } from '../src/chat/planningRecovery';
import { runAgentLoop } from '../src/chat/agentLoop';
import { planningError } from '../src/project/planning';
import { architecture, requirements } from './planningFixture';

const target = '.my_editor/specs/architecture.md';
const bad = architecture + '\n## Repositories {#repositories}\nOnly SQL access.\n';
const good = bad.replace('Only SQL access.', 'Serves FR-001. Interface: saveDraft(text: string): void.');
const reply = (doc: string) => JSON.stringify({ action: 'final', message: '```markdown\n' + doc + '\n```' });

test('one host validation correction repairs a generated document without changing prerequisites', async () => {
	let calls = 0;
	const result = await runAgentLoop({ initial: [{ role: 'user', text: 'Finalize architecture' }], deferredProposal: true,
		cancelled: () => false, progress: () => {}, finalRecovery: {
			correction: message => planningRecovery(message, target, { requirements }), failure: 'Invalid document',
		}, ask: async turns => {
			if (++calls === 1) { return reply(bad); }
			assert.match(turns.at(-1)!.text, /#repositories needs requirement links and an interface/);
			assert.ok(turns.some(turn => turn.text === reply(bad)));
			return reply(good);
		}, execute: async () => { throw Error('No writes or tests are authorized here'); },
	});
	assert.equal(calls, 2);
	assert.match(result, /Interface: saveDraft/);
	assert.equal(planningError('architecture', { requirements }, good), undefined);
});

test('validation repair is bounded and does not turn an interview question into authorization', async () => {
	let calls = 0;
	const result = await runAgentLoop({ initial: [], deferredProposal: true, cancelled: () => false, progress: () => {},
		finalRecovery: { correction: message => planningRecovery(message, target, { requirements }), failure: 'Invalid document' },
		ask: async () => { calls++; return reply(bad); }, execute: async () => '',
	});
	assert.equal(calls, 2); assert.equal(result, 'Invalid document');
	assert.equal(planningRecovery('Can I write the architecture now?', target, { requirements }, false), undefined);
	assert.equal(planningRecovery('Which database is required?', target, { requirements }), undefined);
});

test('correction sees all component failures and handles an unfinished outer fence', () => {
	const many = architecture + Array.from({ length: 8 }, (_, i) => `\n## Adapter ${i} {#adapter-${i}}\nOnly SQL.\n`).join('');
	const reason = planningRecovery('```markdown\n' + many + '\n```', target, { requirements })!;
	assert.match(reason, /#adapter-7 needs requirement links and an interface/);
	assert.match(planningError('architecture', { requirements }, many)!, /and 4 more issue/);
	assert.match(planningRecovery('```markdown\n' + architecture, target, { requirements })!, /properly closed outer fence/);
});

test('a validation correction retains its complete draft after retrieving missing evidence', async () => {
	let calls = 0;
	const result = await runAgentLoop({ initial: [], deferredProposal: true,
		cancelled: () => false, progress: () => {}, finalRecovery: {
			correction: message => planningRecovery(message, target, { requirements }), failure: 'Invalid document',
		}, ask: async turns => {
			if (++calls === 1) { return reply(bad); }
			assert.ok(turns.some(turn => turn.text === reply(bad)), 'The draft being repaired must survive retrieval');
			if (calls === 2) { return JSON.stringify({ action: 'tool', name: 'read_file', arguments: { path: 'src/contracts.ts' } }); }
			return reply(good);
		}, execute: async () => 'Current repository interface',
	});
	assert.equal(calls, 3); assert.match(result, /Interface: saveDraft/);
});

test('changed prerequisites are detected even when all requirement IDs stay the same', async () => {
	const { changedPlanningPrerequisites } = await import('../src/project/planning');
	const before = { requirements, architecture };
	const after = { requirements: requirements.replace('without losing its text', 'with an encrypted backup'), architecture };
	assert.deepEqual(changedPlanningPrerequisites('architecture', before, after), ['requirements']);
	assert.deepEqual(changedPlanningPrerequisites('tree', before, { ...before, architecture: architecture + '\nNew design decision.' }), ['architecture']);
	assert.deepEqual(changedPlanningPrerequisites('requirements', before, after), []);
});
