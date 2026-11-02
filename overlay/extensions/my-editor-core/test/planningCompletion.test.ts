import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { planningEvidence } from '../src/chat/planningEvidence';
import { planningRecovery, PLANNING_INCOMPLETE } from '../src/chat/planningRecovery';
import { agentTurns, MAX_PROJECT_TOOL_CALLS, runAgentLoop } from '../src/chat/agentLoop';

const target = '.my_editor/specs/tree.json';
const files = Array.from({ length: 210 }, (_, i) => ({ path: `src/part-${i}.ts`,
	role: `Complete responsibility ${i}, including validation and typed errors.`, requirements: ['FR-001'],
	section: 'store', status: i === 209 ? 'in-progress' : 'stub', extra: { preserve: true } }));
const saved = JSON.stringify(files, null, '\t');
const deferred = 'Say **continue** and I’ll read those two ranges, then write the complete document for Keep.';
const finalRecovery = { correction: (text: string) => planningRecovery(text, target), failure: PLANNING_INCOMPLETE };

test('Long planning evidence preserves every field and survives later tool compaction', () => {
	assert.ok(saved.length > 30_000);
	const context = planningEvidence([target], { tree: saved }, 200_000)[0];
	assert.deepEqual(JSON.parse(context.slice(context.indexOf('\n') + 1)), files);
	const initial = [{ role: 'user' as const, text: context }];
	const observations = Array.from({ length: 25 }, (_, i) => ({ label: `read ${i}`, call: `read ${i}`, result: 'x'.repeat(1000) }));
	assert.equal(agentTurns(initial, observations)[0].text, context);
	assert.ok(context.includes('part-209.ts'));
});

test('Oversized planning evidence is explicitly absent, never a partial replacement baseline', () => {
	const context = planningEvidence([target], { tree: saved }, 1000)[0];
	assert.match(context, /contents are not included/);
	assert.doesNotMatch(context, /part-0/);
	assert.match(context, /instead of asking for continue/);
});

test('Markdown planning evidence keeps the ending and redacts credentials', () => {
	const source = '# Architecture\n' + 'component\n'.repeat(4000) + '\n## Final component\nFR-001\nsk-ant-12345678901234567890';
	const result = planningEvidence(['.my_editor/specs/architecture.md'], { architecture: source }, 200_000)[0];
	assert.match(result, /Final component/); assert.match(result, /\[REDACTED\]/); assert.doesNotMatch(result, /sk-ant-/);
});

test('Only redundant permission requests are corrected, not real blockers or completed documents', () => {
	assert.ok(planningRecovery(deferred, target));
	assert.ok(planningRecovery('Would you like me to generate it now?', target));
	assert.equal(planningRecovery('Which storage engine must this integrate with?', target), undefined);
	assert.equal(planningRecovery('The architecture prerequisite is missing; Keep it first.', target), undefined);
	assert.equal(planningRecovery('The file is too large for this model context.', target), undefined);
	assert.equal(planningRecovery('```json\n[]\n```\nSay continue to start coding.', target), undefined);
});

test('Authorized planning continues through retrieval and proposes in the same run', async () => {
	let requests = 0, checks = 0;
	const reply = await runAgentLoop({
		initial: [{ role: 'user', text: 'Write the complete file tree JSON now.' }], deferredProposal: true, finalRecovery,
		cancelled: () => false, progress: () => undefined,
		ask: async turns => {
			requests++;
			if (requests === 1) { return JSON.stringify({ action: 'final', message: deferred }); }
			assert.ok(turns.some(turn => turn.text.includes('already authorized')));
			if (requests === 2) { return JSON.stringify({ action: 'tool', name: 'read_file', arguments: { path: 'src/part.ts' } }); }
			assert.ok(turns.some(turn => turn.text.includes('complete source')));
			return JSON.stringify({ action: 'final', message: '```json\n[]\n```' });
		},
		execute: async () => { checks++; return 'complete source'; },
	});
	assert.equal(requests, 3); assert.equal(checks, 1); assert.match(reply, /```json/);
});

test('Repeated deferral stops after one correction with an honest failure', async () => {
	let requests = 0;
	const reply = await runAgentLoop({ initial: [], deferredProposal: true, finalRecovery,
		cancelled: () => false, progress: () => undefined,
		ask: async () => { requests++; return JSON.stringify({ action: 'final', message: deferred }); },
		execute: async () => { throw Error('No tool expected'); },
	});
	assert.equal(requests, 2); assert.equal(reply, PLANNING_INCOMPLETE);
});

test('Final-only correction cannot exceed the tool budget', async () => {
	let checks = 0, finals = 0;
	const reply = await runAgentLoop({ initial: [], deferredProposal: true, finalRecovery,
		cancelled: () => false, progress: () => undefined,
		ask: async (_turns, finalOnly, remaining) => {
			if (!finalOnly || finals++ > 0) { return JSON.stringify({ action: 'tool', name: 'read_file', arguments: { path: 'tree.json' } }); }
			assert.equal(remaining, 0);
			return JSON.stringify({ action: 'final', message: deferred });
		},
		execute: async () => { checks++; return 'source'; },
	});
	assert.equal(checks, MAX_PROJECT_TOOL_CALLS); assert.equal(finals, 2); assert.equal(reply, PLANNING_INCOMPLETE);
});

test('Read-only conversations without a completion policy are not continued automatically', async () => {
	let requests = 0;
	const reply = await runAgentLoop({ initial: [], deferredProposal: true,
		cancelled: () => false, progress: () => undefined,
		ask: async () => { requests++; return JSON.stringify({ action: 'final', message: deferred }); },
		execute: async () => { throw Error('No tool expected'); },
	});
	assert.equal(requests, 1); assert.equal(reply, deferred);
});

test('Cancellation during correction produces no proposal', async () => {
	let cancelled = false, requests = 0;
	const reply = await runAgentLoop({ initial: [], deferredProposal: true, finalRecovery,
		cancelled: () => cancelled, progress: () => undefined,
		ask: async () => {
			if (++requests === 1) { return JSON.stringify({ action: 'final', message: deferred }); }
			cancelled = true; return JSON.stringify({ action: 'final', message: '```json\n[]\n```' });
		}, execute: async () => '',
	});
	assert.equal(reply, ''); assert.equal(requests, 2);
});
