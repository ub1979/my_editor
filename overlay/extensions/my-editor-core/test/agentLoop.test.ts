import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { agentTurns, MAX_PROJECT_TOOL_CALLS, runAgentLoop } from '../src/chat/agentLoop';

const initial = [{ role: 'user' as const, text: 'Inspect and fix this project.' }];

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
	const reply = await runAgentLoop({
		initial,
		cancelled: () => false,
		progress: () => undefined,
		ask: async () => '{"action":"tools","calls":[',
		execute: async () => { throw new Error('No tool should run.'); },
	});
	assert.match(reply, /could not read the model’s project check/);
	assert.doesNotMatch(reply, /"action"/);
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
