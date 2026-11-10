import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { agentTurns, MAX_PROJECT_TOOL_CALLS, runAgentLoop } from '../src/chat/agentLoop';

const initial = [{ role: 'user' as const, text: 'Inspect and fix this project.' }];

test('file progress describes relevant context without presenting a tool budget as file progress', async () => {
	const progress: string[] = [];
	let asked = 0;
	await runAgentLoop({ initial, fileReview: true, cancelled: () => false, progress: message => progress.push(message),
		ask: async () => JSON.stringify(asked++ === 0
			? { action: 'tool', name: 'read_file', arguments: { path: 'tsconfig.base.json' } }
			: { action: 'final', message: 'FILE_REVIEWED\nChecked inherited configuration.' }),
		execute: async () => '{}',
	});
	assert.ok(progress.includes('Reading related context: tsconfig.base.json…'));
	assert.ok(progress.includes('Reviewing the context for this file…'));
	assert.doesNotMatch(progress.join('\n'), /Checking the project|\d+\/60|read_file\(/);
});

test('a valid file-pass conclusion never falls through to ordinary chat Keep guidance', async () => {
	let asks = 0;
	const conclusion = 'FILE_REVIEWED\nI updated the proposed manifest to match its dependencies. Test execution remains separate.';
	const result = await runAgentLoop({ initial, fileReview: true, cancelled: () => false, progress: () => undefined,
		finalRecovery: { correction: message => message.startsWith('FILE_REVIEWED\n') ? undefined : 'Return FILE_REVIEWED.', failure: 'Review incomplete.' },
		ask: async () => JSON.stringify(asks++ === 0 ? { action: 'tool', name: 'propose_file', arguments: { path: 'package.json', content: '{}' } }
			: { action: 'final', message: conclusion }),
		execute: async () => 'Proposed package.json for this file pass.',
	});
	assert.equal(result, conclusion);
	assert.equal(asks, 2);
});

test('larger read-only batches finish with at most four concurrent checks', async () => {
	let asks = 0, active = 0, peak = 0;
	const checked: string[] = [];
	const calls = Array.from({ length: 6 }, (_, i) => ({ name: 'read_file', arguments: { path: `src/${i}.ts` } }));
	const result = await runAgentLoop({ initial, cancelled: () => false, progress: () => undefined,
		ask: async () => JSON.stringify(asks++ ? { action: 'final', message: 'Checked all six files.' } : { action: 'tools', calls }),
		execute: async call => {
			active++; peak = Math.max(peak, active);
			await new Promise(resolve => setTimeout(resolve, 5));
			active--; checked.push(String(call.arguments.path)); return 'source';
		},
	});
	assert.equal(result, 'Checked all six files.');
	assert.equal(checked.length, 6);
	assert.equal(peak, 4);
});

test('Review requests a source check before accepting a conclusion', async () => {
	let requests = 0;
	let checks = 0;
	const reply = await runAgentLoop({
		initial,
		requireCheck: call => call.name === 'read_file' || call.name === 'search',
		cancelled: () => false,
		progress: () => undefined,
		ask: async turns => {
			if (requests++ === 0) { return '{"action":"final","message":"I cannot verify the source."}'; }
			if (requests === 2) {
				assert.ok(turns.some(turn => turn.text.includes('use search or read_file')));
				return '{"action":"tool","name":"read_file","arguments":{"path":"src/engine.ts"}}';
			}
			return '{"action":"final","message":"The source confirms the boundary."}';
		},
		execute: async () => { checks++; return 'src/engine.ts:12: boundary'; },
	});
	assert.equal(checks, 1);
	assert.equal(reply, 'The source confirms the boundary.');
});

test('Review does not claim verification when the model skips source checks twice', async () => {
	let requests = 0;
	const reply = await runAgentLoop({
		initial,
		requireCheck: call => call.name === 'read_file' || call.name === 'search',
		cancelled: () => false,
		progress: () => undefined,
		ask: async () => { requests++; return '{"action":"final","message":"The architecture is verified."}'; },
		execute: async () => { throw new Error('No source check was requested.'); },
	});
	assert.equal(requests, 2);
	assert.match(reply, /could not complete a source-backed review/);
});

test('Pair can make more than ten project checks and still finish the same request', async () => {
	let requests = 0;
	let checks = 0;
	const reply = await runAgentLoop({
		initial,
		cancelled: () => false,
		progress: () => undefined,
		ask: async (turns, finalOnly) => {
			assert.equal(finalOnly, false);
			if (requests === 15) {
				assert.ok(turns.some(turn => turn.text.includes('read_file(src/14.go:1)')));
				return '{"action":"final","message":"Found the cause."}';
			}
			return JSON.stringify({ action: 'tool', name: 'read_file', arguments: { path: `src/${requests++}.go` } });
		},
		execute: async () => { checks++; return 'file contents'; },
	});
	assert.equal(checks, 15);
	assert.equal(reply, 'Found the cause.');
});

test('Pair runs grouped read-only checks and gives every result to the next model call', async () => {
	let round = 0;
	const seen: string[] = [];
	const reply = await runAgentLoop({
		initial,
		cancelled: () => false,
		progress: () => undefined,
		ask: async turns => {
			if (round++ === 0) {
				return '{"action":"tools","calls":[{"name":"read_file","arguments":{"path":"a.go"}},{"name":"read_file","arguments":{"path":"b.go"}},{"name":"search","arguments":{"query":"hopper"}}]}';
			}
			assert.ok(turns.some(turn => turn.text.includes('contents of a.go')));
			assert.ok(turns.some(turn => turn.text.includes('contents of b.go')));
			assert.ok(turns.some(turn => turn.text.includes('contents of hopper')));
			return '{"action":"final","message":"Both files matter."}';
		},
		execute: async call => { seen.push(call.name); return `contents of ${String(call.arguments.path ?? call.arguments.query)}`; },
	});
	assert.deepEqual(seen, ['read_file', 'read_file', 'search']);
	assert.equal(reply, 'Both files matter.');
});

test('Pair records the exact host observation while showing only model prose', async () => {
	const checks: string[] = [];
	let round = 0;
	const reply = await runAgentLoop({
		initial,
		cancelled: () => false,
		progress: () => undefined,
		ask: async () => round++ === 0
			? '{"action":"tool","name":"observe","arguments":{"id":"cell_a_live"}}'
			: '{"action":"final","message":"Both cells were dialing during the sample."}',
		execute: async () => 'Observation cell_a_live: completed. a1=63 a2=35',
		onObservation: (call, result) => checks.push(`${call.name}:${result}`),
	});
	assert.deepEqual(checks, ['observe:Observation cell_a_live: completed. a1=63 a2=35']);
	assert.equal(reply, 'Both cells were dialing during the sample.');
});

test('Pair executes a joined tool reply and shows only the plain English answer', async () => {
	const batch = '{"action":"tools","calls":[{"name":"read_file","arguments":{"path":"runner.go"}},{"name":"search","arguments":{"query":"backpressure"}}]}';
	let checks = 0;
	let requests = 0;
	const reply = await runAgentLoop({
		initial,
		cancelled: () => false,
		progress: () => undefined,
		ask: async turns => {
			if (requests++ === 0) { return batch + batch; }
			assert.ok(turns.some(turn => turn.text.includes('Host tool result for read_file(runner.go:1)')));
			return '{"action":"final","message":"I checked the runner and found a backlog guard."}';
		},
		execute: async () => { checks++; return 'backlog guard'; },
	});
	assert.equal(checks, 2);
	assert.equal(reply, 'I checked the runner and found a backlog guard.');
});

test('Pair repairs malformed internal JSON once and never shows it as an answer', async () => {
	let requests = 0;
	const reply = await runAgentLoop({
		initial,
		cancelled: () => false,
		progress: () => undefined,
		ask: async () => (++requests === 1 ? '{"action":"tools","calls":[' : '{"action":"final","message":"I need one more detail to confirm the cause."}'),
		execute: async () => { throw new Error('No tool should run.'); },
	});
	assert.equal(requests, 2);
	assert.equal(reply, 'I need one more detail to confirm the cause.');
});

test('Pair fails in plain English if malformed tool JSON cannot be repaired', async () => {
	const malformed: string[] = [];
	const reply = await runAgentLoop({
		initial,
		cancelled: () => false,
		progress: () => undefined,
		ask: async () => '{"action":"tools","calls":[',
		onMalformedReply: reply => { malformed.push(reply); },
		execute: async () => { throw new Error('No tool should run.'); },
	});
	assert.match(reply, /could not read the model’s project check/);
	assert.doesNotMatch(reply, /"action"/);
	assert.deepEqual(malformed, ['{"action":"tools","calls":[', '{"action":"tools","calls":[']);
});

test('tool history keeps valid JSON actions and complete proposals within its evidence budget', async () => {
	let requests = 0;
	const content = 'export const value = 1;\n';
	await runAgentLoop({ initial, cancelled: () => false, progress: () => undefined,
		ask: async turns => {
			requests++;
			if (requests === 1) { return JSON.stringify({ action: 'tool', name: 'read_file', arguments: { path: 'a.ts' } }); }
			const history = turns.filter(turn => turn.role === 'assistant').map(turn => JSON.parse(turn.text));
			assert.equal(history[0].name, 'read_file');
			if (requests === 2) { return JSON.stringify({ action: 'tool', name: 'propose_file', arguments: { path: 'a.ts', content } }); }
			assert.equal(history[1].arguments.content, content);
			return JSON.stringify({ action: 'final', message: 'File proposal is ready for review.' });
		}, execute: async call => call.name === 'read_file' ? 'Existing source' : 'Proposed a.ts',
	});
	const huge = { label: 'propose_file(large.ts)', call: JSON.stringify({ action: 'tool', name: 'propose_file',
		arguments: { path: 'large.ts', content: 'x'.repeat(80000) } }), result: 'Proposed large.ts' };
	const turns = agentTurns(initial, [huge], 12000);
	assert.ok(turns.every(turn => turn.text.length < 12000));
	assert.ok(turns.some(turn => turn.text.includes('Proposed large.ts')));
});

test('Pair requests an evidence-based final answer at the safety bound', async () => {
	let checks = 0;
	let finalRequests = 0;
	const reply = await runAgentLoop({
		initial,
		cancelled: () => false,
		progress: () => undefined,
		ask: async (_turns, finalOnly) => {
			if (finalOnly) { finalRequests++; return '{"action":"final","message":"I checked the source and prepared a proposal; it still needs Keep."}'; }
			return JSON.stringify({ action: 'tool', name: 'read_file', arguments: { path: `src/${checks}.go` } });
		},
		execute: async () => { checks++; return 'source'; },
	});
	assert.equal(checks, MAX_PROJECT_TOOL_CALLS);
	assert.equal(finalRequests, 1);
	assert.match(reply, /still needs Keep/);
});

test('Pair reports unfinished work if a model still asks for tools at the safety bound', async () => {
	let checks = 0;
	const reply = await runAgentLoop({
		initial,
		cancelled: () => false,
		progress: () => undefined,
		ask: async () => JSON.stringify({ action: 'tool', name: 'read_file', arguments: { path: `src/${checks}.go` } }),
		execute: async () => { checks++; return 'source'; },
	});
	assert.equal(checks, MAX_PROJECT_TOOL_CALLS);
	assert.match(reply, /checked 60 project items/);
	assert.match(reply, /Continue in this chat/);
});

test('older project checks stay bounded and retain the checked paths', () => {
	const observations = Array.from({ length: 50 }, (_, index) => ({
		label: `read_file(src/${index}.go:1)`, call: `Called read_file(src/${index}.go:1)`, result: `result ${index} ` + 'x'.repeat(1_000),
	}));
	const turns = agentTurns(initial, observations);
	const older = turns.find(turn => turn.text.includes('Earlier project checks'));
	assert.ok(older);
	assert.ok(older.text.length < 11_000);
	assert.ok(older.text.includes('read_file(src/45.go:1)'));
	assert.ok(turns.some(turn => turn.text.includes('result 49')));
});

test('file passes retain dependency bodies beyond four reads without growing on repeated reads', () => {
	const dependencies = Array.from({ length: 10 }, (_, index) => ({
		label: `read_file(contract-${index}.ts:1)`, call: `Read contract ${index}`,
		result: `contract-${index}: ` + 'x'.repeat(900) + `\nexport type Contract${index} = { value: string };`,
	}));
	const observations = [...dependencies, ...dependencies.map(item => ({ ...item }))];
	const turns = agentTurns(initial, observations, 12_000);
	for (let index = 0; index < 10; index++) {
		assert.equal(turns.filter(turn => turn.text.includes(`export type Contract${index} =`)).length, 1);
	}
	const bounded = agentTurns(initial, observations, 2_000);
	assert.ok(bounded.filter(turn => turn.role === 'assistant').length <= 2);
	assert.ok(bounded.some(turn => turn.text.includes('export type Contract9 =')));
});


test('a plain review survives a completed read without another model retry', async () => {
	let requests = 0;
	const reply = await runAgentLoop({ initial, plainFinal: true, cancelled: () => false,
		progress: () => undefined, requireCheck: call => call.name === 'read_file',
		ask: async () => ++requests === 1
			? JSON.stringify({ action: 'tool', name: 'read_file', arguments: { path: '.my_editor/specs/requirements.md' } })
			: 'I reviewed the saved requirements. FR-012 needs a transfer flag.',
		execute: async () => '# Requirements\nFR-012',
	});
	assert.equal(requests, 2);
	assert.equal(reply, 'I reviewed the saved requirements. FR-012 needs a transfer flag.');
});

test('plain conclusions still require source evidence and run completion recovery', async () => {
	let requests = 0;
	const reply = await runAgentLoop({ initial, plainFinal: true, cancelled: () => false,
		progress: () => undefined, requireCheck: () => true,
		ask: async () => { requests++; return 'All reviewed.'; },
		execute: async () => { throw Error('No tools authorized'); },
	});
	assert.equal(requests, 2);
	assert.match(reply, /could not complete a source-backed review/);
	let corrections = 0;
	const completed = await runAgentLoop({ initial, plainFinal: true, deferredProposal: true,
		cancelled: () => false, progress: () => undefined,
		finalRecovery: { correction: message => message === 'Please say continue.' ? 'Produce the document now.' : undefined, failure: 'Incomplete' },
		ask: async () => ++corrections === 1 ? 'Please say continue.' : 'Document ready.\n```markdown\n# Architecture\n```',
		execute: async () => { throw Error('No tools authorized'); },
	});
	assert.equal(corrections, 2);
	assert.match(completed, /# Architecture/);
});
