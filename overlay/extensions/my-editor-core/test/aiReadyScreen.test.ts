import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { buildBlocker, type CheckResult } from '../src/aiready/baseline';
import { runQueue } from '../src/aiready/fixQueue';
import { screenFix, screenQueue, type Screener } from '../src/aiready/fixScreen';
import { type FixChoice, loadState, type RunState, RUNAWAY_LIMIT, saveState, type StepRecord } from '../src/aiready/fixState';
import { earlyText } from '../src/aiready/fixText';
import type { CheckCommand, FileInfo } from '../src/aiready/language';

const run = (command: string, code: number, tail = ''): CheckResult => ({ command, code, failures: [], tail, log: '' });
const fix = (file: string, kind: 'split' | 'tests' = 'split'): FixChoice => ({ file, kind, lines: 1200 });

/** `./engine` fails to build at baseline; `./store` builds. */
const BASELINE = {
	'build ./engine': [run('build ./engine', 1, '# vad\nsilero.c:6:10: fatal error: \'onnx.h\' file not found'),
		run('build ./engine', 1, 'same')] as const,
	'build ./store': [run('build ./store', 0), run('build ./store', 0)] as const,
};

function adapter(infos: Record<string, Partial<FileInfo>>): Screener {
	return {
		checks: (file: string): CheckCommand[] => [{ label: 'build', command: `build ./${path.posix.dirname(file)}`, verifies: true }],
		parse: async (file: string) => {
			if (!infos[file]) { throw new Error(`cannot parse ${file}`); }
			return { path: file, declarations: [{ id: 0, movable: true }], ...infos[file] } as unknown as FileInfo;
		},
		testFileName: (file: string) => file.replace(/\.go$/, '_ai_test.go'),
	};
}

test('the short build blocker names the first error line, or says no compile check was recorded', () => {
	const checks: CheckCommand[] = [{ label: 'build', command: 'build ./engine', verifies: true }];
	assert.equal(buildBlocker(checks, BASELINE), 'its build already fails (silero.c:6:10: fatal error: \'onnx.h\' file not found)');
	assert.equal(buildBlocker([{ label: 'build', command: 'build ./store', verifies: true }], BASELINE), undefined);
	assert.equal(buildBlocker([{ label: 'vet', command: 'vet ./x' }], BASELINE), 'no compile check of it was recorded');
});

test('screening settles fixes before any model call: no passing build, never split, nothing movable, test file there', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-screen-'));
	writeFileSync(path.join(root, 'here_ai_test.go'), '');
	const go = adapter({
		'engine/engine.go': {}, 'store/a.go': {}, 'store/gen.go': { skip: 'generated code' },
		'store/consts.go': { declarations: [{ id: 0, movable: false }] as unknown as FileInfo['declarations'] }, 'here.go': {},
	});
	const screen = (f: FixChoice) => screenFix(go, root, BASELINE, f);
	const engine = await screen(fix('engine/engine.go'));
	assert.equal(engine?.step.status, 'skipped');
	assert.equal(engine?.step.early, true);
	assert.equal(engine?.unchecked, true);
	assert.match(engine?.step.reason ?? '', /^Nothing here can compile \.\/engine to check this split: its build already fails/);
	assert.equal(await screen(fix('store/a.go')), undefined);
	assert.equal((await screen(fix('store/gen.go')))?.step.reason, 'Never split: generated code.');
	const stuck = await screen(fix('store/consts.go'));
	assert.deepEqual([stuck?.step.status, stuck?.step.reason, stuck?.unchecked], ['skipped', 'Nothing in it may move.', false]);
	assert.deepEqual((await screen(fix('store/gen.go')))?.step.lasting, { skip: 'generated code' }, 'settled by content: kept for later runs');
	assert.deepEqual(stuck?.step.lasting, {});
	assert.equal(engine?.step.lasting, undefined, 'a failing build may be fixed, so it is not kept');
	assert.equal((await screen(fix('here.go', 'tests')))?.step.reason, 'here_ai_test.go already exists.');
	assert.equal(await screen(fix('store/a.go', 'tests')), undefined);
	assert.match((await screen(fix('gone.go')))?.step.reason ?? '', /cannot parse gone\.go/);
	mkdirSync(path.join(root, 'store'));
	writeFileSync(path.join(root, 'store', 'a.go'), 'x\n'.repeat(263));
	const short = await screen(fix('store/a.go'));
	assert.deepEqual([short?.step.status, short?.step.reason, short?.step.early], ['skipped', 'Already 263 lines on this branch (the limit is 600).', true]);
	writeFileSync(path.join(root, 'store', 'a.go'), 'x\n'.repeat(701));
	assert.equal(await screen(fix('store/a.go')), undefined);
});

test('the up-front pass puts settled fixes first, in order, and keeps the order of the rest', async () => {
	const fixes = ['a', 'b', 'c', 'd'].map(name => fix(`${name}.go`));
	const settled = new Set(['b.go', 'd.go']);
	const result = await screenQueue(fixes, async f => (settled.has(f.file)
		? { step: { file: f.file, kind: 'split', status: 'skipped', reason: 'no', early: true }, brief: 'no', unchecked: true } : undefined),
	() => false);
	assert.ok(result !== 'stopped');
	assert.deepEqual(result.fixes.map(f => f.file), ['b.go', 'd.go', 'a.go', 'c.go']);
	assert.deepEqual(result.early.map(e => e.step.file), ['b.go', 'd.go']);
	assert.equal(await screenQueue(fixes, async () => undefined, () => true), 'stopped');
});

test('the run text says up front which fixes cannot be checked here, grouped by package', () => {
	const early = (file: string, brief: string, unchecked = true) =>
		({ step: { file, kind: 'split' as const, status: 'skipped' as const, early: true }, brief, unchecked });
	const text = earlyText([early('internal/engine/engine.go', 'its build already fails (x.c: fatal error)'),
		early('internal/engine/runner.go', 'its build already fails (x.c: fatal error)'),
		early('cmd/tool/main.go', 'no compile check of it was recorded'), early('store/consts.go', 'nothing in it may move', false)]);
	assert.equal(text, '3 chosen fixes can\'t be checked here and are skipped: `./internal/engine` (2 files): its build already fails '
		+ '(x.c: fatal error); `./cmd/tool` (1 file): no compile check of it was recorded.\n'
		+ '1 more is skipped before any work: `store/consts.go`: nothing in it may move.\n');
	assert.equal(earlyText([]), '');
});

function queueState(files: readonly string[]): RunState {
	return {
		version: 1, root: '/p', language: 'Go', worktree: { branch: 'b', path: '/p.w', base: '0123' }, startedAt: '', approved: [],
		fixes: files.map(file => fix(file)), next: 0, steps: [], baseline: {}, skippedFiles: [],
	};
}

test('the queue runs every fix until it is empty, well past 25', async () => {
	const state = queueState(Array.from({ length: 60 }, (_, i) => `f${i}.go`));
	const attempted = await runQueue(state, {
		run: async f => ({ file: f.file, kind: 'split', status: 'committed' }), cancelled: () => false, progress: () => undefined, record: () => undefined,
	});
	assert.equal(attempted, 60);
	assert.equal(state.next, 60);
});

test('the runaway bound counts only attempted fixes; a fix settled before any work does not use it', async () => {
	const files = Array.from({ length: 40 }, (_, i) => `f${i}.go`);
	const state = queueState(files);
	const shown: StepRecord[] = [];
	const attempted = await runQueue(state, {
		run: async f => (Number(f.file.slice(1, -3)) % 4 === 0
			? { file: f.file, kind: 'split', status: 'skipped', reason: 'build fails', early: true }
			: { file: f.file, kind: 'split', status: Number(f.file.slice(1, -3)) % 4 === 1 ? 'refused' : 'committed' }),
		cancelled: () => false, progress: () => undefined, record: step => shown.push(step),
	}, 15);
	assert.equal(attempted, 15);
	assert.equal(shown.filter(step => !step.early).length, 15);
	assert.equal(state.next, 20, 'f0..f19: 15 attempted plus 5 settled early');
	assert.equal(state.steps.length, 20);
});

test('progress counts the chosen fixes left after screening and prefixes what each step says', async () => {
	const state = { ...queueState(['early.go', 'a.go', 'b.go']), next: 1, screened: 1 };
	const seen: string[] = [];
	await runQueue(state, {
		run: async (f, progress) => { progress(`Planning how to split ${f.file}…`); return { file: f.file, kind: 'split', status: 'committed' }; },
		cancelled: () => false, progress: text => seen.push(text), record: () => undefined,
	});
	assert.deepEqual(seen, ['Fix 1 of 2: a.go…', 'Fix 1 of 2: Planning how to split a.go…', 'Fix 2 of 2: b.go…',
		'Fix 2 of 2: Planning how to split b.go…']);
});

test('the runaway bound is large', () => {
	assert.ok(RUNAWAY_LIMIT >= 500);
});

test('the queue stops on Stop, and a thrown error counts as an attempted skip', async () => {
	const state = queueState(['a.go', 'b.go', 'c.go']);
	let stop = false;
	const attempted = await runQueue(state, {
		run: async f => {
			if (f.file === 'a.go') { throw new Error('boom'); }
			stop = true;
			return 'stopped';
		},
		cancelled: () => stop, progress: () => undefined, record: () => undefined,
	});
	assert.equal(attempted, 1);
	assert.deepEqual(state.steps, [{ file: 'a.go', kind: 'split', status: 'skipped', reason: 'boom' }]);
	assert.equal(state.next, 1);
});

test('a refactor is settled early when nothing needs one now or its build is blocked', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-screen-'));
	const big = { declarations: [{ id: 0, names: ['Big'], kind: 'func', lines: 752, movable: true }] } as unknown as Partial<FileInfo>;
	const go = adapter({ 'engine/big.go': big, 'store/big.go': big, 'store/small.go': {}, 'store/gen.go': { ...big, skip: 'generated code' } });
	const refactor = (file: string): FixChoice => ({ file, kind: 'refactor', lines: 760, target: { name: 'Big', lines: 752 } });
	const screen = (file: string) => screenFix(go, root, BASELINE, refactor(file));
	assert.equal(await screen('store/big.go'), undefined);
	const small = await screen('store/small.go');
	assert.deepEqual([small?.step.kind, small?.step.reason, small?.step.lasting], ['refactor', 'No function in it needs a refactor now.', undefined]);
	assert.equal((await screen('store/gen.go'))?.step.reason, 'Never refactored: generated code.');
	const blocked = await screen('engine/big.go');
	assert.equal(blocked?.unchecked, true);
	assert.match(blocked?.step.reason ?? '', /^Nothing here can compile \.\/engine to check this refactor: its build already fails/);
	mkdirSync(path.join(root, 'store'));
	writeFileSync(path.join(root, 'store', 'big.go'), 'x\n'.repeat(280));
	assert.equal((await screen('store/big.go'))?.step.reason, 'Already 280 lines on this branch (the limit is 600).');
});

test('a step\'s follow-up fix runs next and counts in the progress', async () => {
	const state = { ...queueState(['early.go', 'r.go', 'b.go']), next: 1, screened: 1 };
	state.fixes[1] = { file: 'r.go', kind: 'refactor', lines: 760, target: { name: 'Big', lines: 752 } };
	const seen: string[] = [];
	const ran: string[] = [];
	await runQueue(state, {
		run: async f => {
			ran.push(`${f.file} ${f.kind}`);
			return f.kind === 'refactor'
				? { file: f.file, kind: 'refactor', status: 'committed', followUp: { file: f.file, kind: 'split', lines: 770 } }
				: { file: f.file, kind: f.kind, status: 'committed' };
		},
		cancelled: () => false, progress: text => seen.push(text), record: () => undefined,
	});
	assert.deepEqual(ran, ['r.go refactor', 'r.go split', 'b.go split']);
	assert.deepEqual(seen, ['Fix 1 of 2: r.go…', 'Fix 2 of 3: r.go…', 'Fix 3 of 3: b.go…']);
	assert.equal(state.next, 4);
});

test('Continue after a saved refactor commit runs its split next', async () => {
	const storage = mkdtempSync(path.join(os.tmpdir(), 'my-editor-continue-'));
	const state = { ...queueState(['r.go', 'b.go']), root: storage };
	state.fixes[0] = { file: 'r.go', kind: 'refactor', lines: 760, target: { name: 'Big', lines: 752 } };
	let stop = false;
	await runQueue(state, {
		run: async f => ({ file: f.file, kind: 'refactor', status: 'committed', followUp: { file: f.file, kind: 'split', lines: 770 } }),
		cancelled: () => stop, progress: () => undefined, record: () => { saveState(storage, state); stop = true; },
	});
	const saved = loadState(storage, storage);
	assert.ok(saved);
	assert.equal(saved.next, 1);
	assert.deepEqual(saved.fixes.map(f => `${f.file} ${f.kind}`), ['r.go refactor', 'r.go split', 'b.go split']);
	const ran: string[] = [];
	await runQueue(saved, {
		run: async f => { ran.push(`${f.file} ${f.kind}`); return { file: f.file, kind: f.kind, status: 'committed' }; },
		cancelled: () => false, progress: () => undefined, record: () => saveState(storage, saved),
	});
	assert.deepEqual(ran, ['r.go split', 'b.go split']);
	assert.equal(loadState(storage, storage)?.next, 3);
});
