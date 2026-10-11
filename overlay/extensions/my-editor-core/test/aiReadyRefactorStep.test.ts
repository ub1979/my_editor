import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import type { CheckResult } from '../src/aiready/baseline';
import type { FileInfo, LanguageAdapter, RefactorBuild, RefactorHooks } from '../src/aiready/language';
import { runRefactor } from '../src/aiready/refactorStep';
import type { StepContext } from '../src/aiready/steps';

const BEFORE = 'x\n'.repeat(460);
const AFTER = 'y\n'.repeat(470);
const HELPER = { name: 'addMany', params: ['n', '*total'], outputs: ['n'], returns: false };
const FIX = { file: 'big.txt', kind: 'refactor' as const, lines: 460, target: { name: 'Big', lines: 450 } };
const ok = (command: string, code = 0): CheckResult => ({ command, code, failures: code ? ['broken'] : [], tail: code ? 'broken' : '', log: '' });

/** What the fake refactor hooks saw. */
interface Seen { built: string[]; checked: number; abandoned: number }

/** A Git repository with a 460-line `big.txt` holding one 450-line function, and a step context on it. */
function setup(options: { check?: string[]; build?: (name: string) => RefactorBuild; code?: number; cancelled?: () => boolean } = {}) {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-refactor-step-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	git('init', '--quiet', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(path.join(root, 'big.txt'), BEFORE);
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	const seen: Seen = { built: [], checked: 0, abandoned: 0 };
	const build = options.build ?? ((name: string) => (name === 'bad'
		? { problems: ['bad: not a run of statements.'] }
		: { problems: [], text: Buffer.from(AFTER), helpers: [HELPER], functionLines: 300, facts: '{}' }));
	const hooks: RefactorHooks = {
		target: () => ({ name: 'Big', lines: 450 }),
		coverage: () => { throw new Error('not here'); },
		ran: async () => false,
		prompt: async () => ({ system: 'plan', text: 'Big' }),
		build: async (_file, _target, chunks) => { seen.built.push(chunks[0].name); return build(chunks[0].name); },
		check: async () => { seen.checked++; return options.check ?? []; },
		abandon: () => { seen.abandoned++; },
		mayDiffer: '', approvalNote: '',
	};
	const info: FileInfo = { path: 'big.txt', frame: [], imports: [], declarations: [
		{ id: 0, kind: 'func', names: ['Big'], span: { start: 0, end: 0 }, lines: 450, doc: '', docText: '', uses: [], movable: true }] };
	const adapter = {
		label: 'Fake', extensions: ['.txt'], refactor: hooks, parse: async () => info, testFileName: (file: string) => file,
		checks: () => [{ label: 'build', command: 'build .', verifies: true }], unformatted: async () => [],
	} as unknown as LanguageAdapter;
	const ctx = (replies: string[]): StepContext => ({
		adapter, worktree: root, baseline: { 'build .': [ok('build .'), ok('build .')] }, flaky: [], coverage: { 'big.txt': true },
		ask: async () => replies.shift() ?? '[]', check: async command => ok(command, options.code ?? 0),
		cancelled: options.cancelled ?? (() => false), progress: () => undefined,
	});
	return { root, git, seen, ctx };
}

const plan = (name: string) => `Here: [{"name":"${name}","from":3,"to":300}]`;

test('a refactor is planned, built, extract-checked, compared with the baseline and committed, and the split follows', async () => {
	const { root, git, seen, ctx } = setup();
	const step = await runRefactor(ctx([plan('bad'), plan('addMany')]), FIX);
	assert.ok(typeof step === 'object' && step.status === 'committed', JSON.stringify(step));
	assert.deepEqual(seen.built, ['bad', 'addMany']);
	assert.equal(seen.checked, 1);
	assert.deepEqual(step.plan, { attempts: 2, rejected: ['bad: not a run of statements.'] });
	assert.deepEqual(step.refactor, { target: 'Big', helpers: [HELPER], lines: 300, ran: true });
	assert.deepEqual(step.followUp, { file: 'big.txt', kind: 'split', lines: 470 });
	assert.equal(step.commit, git('rev-parse', 'HEAD'));
	assert.equal(git('log', '-1', '--format=%s'), 'my_editor: extract 1 helper from Big (big.txt)');
	assert.match(git('log', '-1', '--format=%b'), /- addMany\(n, \*total\) → n\n\nExtract check: passed\. Coverage: the package's tests ran Big/);
	assert.equal(readFileSync(path.join(root, 'big.txt'), 'utf8'), AFTER);
	assert.equal(git('status', '--porcelain'), '');
});

test('a plan rejected twice is refused and nothing is written', async () => {
	const { root, git, seen, ctx } = setup();
	const step = await runRefactor(ctx([plan('bad'), 'no plan here']), FIX);
	assert.ok(typeof step === 'object');
	assert.equal(step.status, 'refused');
	assert.equal(step.reason, 'The refactor plan was rejected twice: The reply was not a JSON array of {"name", "from", "to"}.');
	assert.deepEqual(step.plan?.attempts, 2);
	assert.equal(seen.checked, 0);
	assert.equal(seen.abandoned, 1, 'the language frees what it kept for the plan');
	assert.equal(readFileSync(path.join(root, 'big.txt'), 'utf8'), BEFORE);
	assert.equal(git('status', '--porcelain'), '');
});

test('an extract-check failure restores the file and refuses with the reason', async () => {
	const { root, git, ctx } = setup({ check: ['helper addMany: body differs at line 4.'] });
	const step = await runRefactor(ctx([plan('addMany')]), FIX);
	assert.ok(typeof step === 'object');
	assert.deepEqual([step.status, step.reason], ['refused', 'The extract check failed: helper addMany: body differs at line 4.']);
	assert.equal(readFileSync(path.join(root, 'big.txt'), 'utf8'), BEFORE);
	assert.equal(git('status', '--porcelain'), '');
	assert.equal(git('log', '--format=%s'), 'first');
});

test('checks that differ from the baseline restore the file and refuse the refactor', async () => {
	const { root, git, ctx } = setup({ code: 1 });
	const step = await runRefactor(ctx([plan('addMany')]), FIX);
	assert.ok(typeof step === 'object');
	assert.equal(step.status, 'refused');
	assert.match(step.reason ?? '', /^Checks differ from before: /);
	assert.equal(readFileSync(path.join(root, 'big.txt'), 'utf8'), BEFORE);
	assert.equal(git('status', '--porcelain'), '');
});

test('Stop while planning leaves nothing behind', async () => {
	let stop = false;
	const { root, git, seen, ctx } = setup({ cancelled: () => stop });
	const context = ctx([]);
	const step = await runRefactor({ ...context, ask: async () => { stop = true; return plan('addMany'); } }, FIX);
	assert.equal(step, 'stopped');
	assert.equal(seen.abandoned, 1);
	assert.equal(readFileSync(path.join(root, 'big.txt'), 'utf8'), BEFORE);
	assert.equal(git('status', '--porcelain'), '');
});
