import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChatState } from '../src/chat/chatState';
import type { RunInput, Sink, Turn } from '../src/chat/engine';
import type { MemoryMessage } from '../src/chat/memory';
import { ChatTurn, endsMode, isDeterministic, runChatTurn, TurnContext } from '../src/chat/replyRun';

const CONVERSATIONAL = new Set(['requirements', 'architecture']);

function sink(progress: string[]): Sink {
	return { text: () => undefined, progress: message => progress.push(message), proposal: () => undefined, action: () => undefined, error: () => undefined };
}

function token(cancelled = () => false) {
	return { get isCancellationRequested() { return cancelled(); }, onCancellationRequested: () => ({ dispose: () => undefined }) };
}

function history(count: number): MemoryMessage[] {
	return Array.from({ length: count }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' as const : 'user' as const, text: `turn ${i}` }));
}

function setup(mode: string | undefined, resultMode: string, compact: (previous: string, turns: readonly Turn[]) => Promise<string>) {
	const state = new ChatState(undefined);
	state.mode = mode;
	const runs: { input: RunInput; live: readonly Turn[] }[] = [];
	let saves = 0;
	const context: TurnContext = {
		state, conversational: CONVERSATIONAL, activeFile: () => undefined, save: () => { saves++; },
		engine: {
			compactHistory: (previous, turns) => compact(previous, turns),
			run: async (input, live) => { runs.push({ input, live }); return { mode: resultMode, reply: 'ok' }; },
		},
	};
	const reply = state.addReply('r1', mode);
	const turn = (text: string, turns: MemoryMessage[]): ChatTurn => ({ text, mode, kickoff: false, reply, locateOnly: false, history: turns });
	return { state, context, runs, turn, saves: () => saves };
}

test('Git-backed requests skip the working brief', () => {
	assert.equal(isDeterministic('anything', 'changes'), true);
	assert.equal(isDeterministic('anything', 'impact'), true);
	assert.equal(isDeterministic('  /changes src/a.ts', undefined), true);
	assert.equal(isDeterministic('/impact', 'chat'), true);
	assert.equal(isDeterministic('/changesets', undefined), false);
	assert.equal(isDeterministic('show /changes', undefined), false);
});

test('one-shot modes end after the reply; conversations, skills and changed modes stay', () => {
	assert.equal(endsMode('feature', 'feature', 'feature', CONVERSATIONAL), true);
	assert.equal(endsMode('requirements', 'requirements', 'requirements', CONVERSATIONAL), false);
	assert.equal(endsMode('skill:debug', 'skill:debug', 'skill:debug', CONVERSATIONAL), false);
	assert.equal(endsMode('review', 'qa', 'review', CONVERSATIONAL), false, 'the user picked another mode meanwhile');
	assert.equal(endsMode('chat', undefined, undefined, CONVERSATIONAL), false);
});

test('older turns are folded into the brief in batches before the model runs', async () => {
	const briefs: string[] = [];
	const run = setup('feature', 'feature', async (previous, turns) => {
		briefs.push(previous);
		return `${previous}+${turns.length}`;
	});
	const progress: string[] = [];
	const turns = history(30);
	await runChatTurn(run.turn('add it', turns), run.context, sink(progress), token());
	assert.deepEqual(briefs, ['', '+8']);
	assert.deepEqual(run.state.memory, { brief: '+8+8', throughId: 'm15' });
	assert.equal(run.saves(), 2);
	assert.deepEqual(progress, ['Keeping track of earlier conversation…', 'Keeping track of earlier conversation…', '']);
	const [{ input, live }] = run.runs;
	assert.equal(input.memory, '+8+8');
	assert.equal(input.requestId, 'r1');
	assert.equal(input.chatArchive?.length, 30);
	assert.equal(live[0].text, 'turn 16');
	assert.equal(run.state.mode, undefined, 'a feature request runs once');
});

test('a failing summarizer falls back to a local brief', async () => {
	const run = setup('requirements', 'requirements', async () => { throw new Error('offline'); });
	await runChatTurn(run.turn('more', history(17)), run.context, sink([]), token());
	assert.match(run.state.memory.brief, /User requested: turn 0/);
	assert.equal(run.state.memory.throughId, 'm7');
	assert.equal(run.state.mode, 'requirements', 'a conversation keeps its mode');
});

test('stopping during compaction skips the model and keeps the old brief', async () => {
	let stopped = false;
	const run = setup(undefined, 'chat', async () => { stopped = true; return 'new brief'; });
	await runChatTurn(run.turn('hi', history(20)), run.context, sink([]), token(() => stopped));
	assert.equal(run.runs.length, 0);
	assert.deepEqual(run.state.memory, { brief: '' });
	assert.equal(run.saves(), 0);
});

test('a change-history request never asks the summarizer', async () => {
	const run = setup('changes', 'changes', async () => { throw new Error('should not compact'); });
	await runChatTurn(run.turn('src/a.ts', history(30)), run.context, sink([]), token());
	assert.equal(run.runs.length, 1);
	assert.deepEqual(run.state.memory, { brief: '' });
	assert.equal(run.state.mode, undefined);
});
