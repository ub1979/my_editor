import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { findCandidates } from '../src/aiready/fixCandidates';
import { closeEmpty } from '../src/aiready/fixEmpty';
import { loadSettled, rememberSettled, remembered, saveSettled, SETTLED_RULES, settledCache } from '../src/aiready/fixSettled';
import type { RunState, StepRecord } from '../src/aiready/fixState';
import type { Declaration, FileInfo, LanguageAdapter } from '../src/aiready/language';
import { prepare } from '../src/aiready/worktree';

const lines = (n: number) => 'x\n'.repeat(n);
const never: StepRecord = { file: 'big_test.go', kind: 'split', status: 'skipped', reason: 'Never split: test files are not split.', early: true,
	lasting: { skip: 'test files are not split' } };
const refactor: StepRecord = { file: 'solo.go', kind: 'split', status: 'skipped', reason: 'Needs a real refactor.', early: true,
	over: [{ file: 'solo.go', lines: 430, reason: 'needs a real refactor' }], lasting: {} };
const unchecked: StepRecord = { file: 'engine.go', kind: 'split', status: 'skipped', reason: 'Nothing here can compile ./ to check this split.', early: true };

function decl(id: number, size: number): Declaration {
	return { id, kind: 'function', names: [`f${id}`], span: { start: 0, end: 0 }, lines: size, doc: '', docText: '', uses: [], movable: true };
}

/** A repository on `main` with long files; `ai_fix` parts from it, then the user's branch edits two of them. */
function diverged(): { root: string; git: (...args: string[]) => string } {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-settled-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	git('init', '--quiet', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	for (const [name, size] of [['big_test.go', 900], ['solo.go', 430], ['c.go', 450]] as const) { writeFileSync(path.join(root, name), lines(size)); }
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	git('branch', 'ai_fix');
	writeFileSync(path.join(root, 'big_test.go'), lines(901));
	writeFileSync(path.join(root, 'solo.go'), lines(431));
	git('commit', '--quiet', '-am', 'the user goes on');
	return { root, git };
}

/** A Go-like adapter that reads files in `root`: test files are never split, `solo.go` is one long function. */
function factory(parsed: string[]) {
	return (root: string): LanguageAdapter => ({
		label: 'Go', extensions: ['.go'], fixes: ['split'],
		parse: async (file: string): Promise<FileInfo> => {
			readFileSync(path.join(root, file));
			parsed.push(file);
			const declarations = file === 'solo.go' ? [decl(0, 425)] : [decl(0, 200), decl(1, 200), decl(2, 50)];
			return { path: file, declarations, frame: [], imports: [], ...(file.endsWith('_test.go') ? { skip: 'test files are not split' } : {}) };
		},
	}) as unknown as LanguageAdapter;
}

test('a run keeps its lasting split outcomes by blob id, never the ones a build blocked', () => {
	const cache = settledCache([never, refactor, unchecked], new Map([['big_test.go', 'b1'], ['solo.go', 's1'], ['engine.go', 'e1']]));
	assert.deepEqual(cache, { rules: SETTLED_RULES, files: { 'big_test.go': { blob: 'b1', skip: 'test files are not split' }, 'solo.go': { blob: 's1' } } });
	const known = remembered(cache);
	assert.deepEqual(known('solo.go', 's1'), { blob: 's1' });
	assert.equal(known('solo.go', 's2'), undefined, 'the file changed since');
	assert.equal(known('solo.go', undefined), undefined);
	assert.equal(remembered(cache, SETTLED_RULES + 1)('solo.go', 's1'), undefined, 'new rules may split it');
	assert.deepEqual(Object.keys(settledCache([], new Map(), cache).files).sort(), ['big_test.go', 'solo.go'], 'earlier entries stay');
	assert.deepEqual(settledCache([], new Map(), cache, SETTLED_RULES + 1).files, {}, 'new rules start afresh');
});

test('the record is saved per project and read back', () => {
	const storage = mkdtempSync(path.join(os.tmpdir(), 'settled-'));
	assert.equal(loadSettled(storage, '/p/shop'), undefined);
	const cache = settledCache([refactor], new Map([['solo.go', 's1']]));
	saveSettled(storage, '/p/shop', cache);
	assert.deepEqual(loadSettled(storage, '/p/shop'), cache);
	assert.equal(loadSettled(storage, '/p/other'), undefined);
});

test('files the user changed after ai_fix parted are ticked once, then left out once a run settled them', async () => {
	const { root, git } = diverged();
	const first = await findCandidates(root, factory([]), () => false);
	assert.deepEqual(first?.choices.map(c => c.file), ['big_test.go', 'c.go', 'solo.go'], 'the picker cannot parse them in the folder');
	const storage = mkdtempSync(path.join(os.tmpdir(), 'settled-'));
	const folder = `${root}.ai-ready`;
	await prepare(root, folder);
	await rememberSettled(storage, root, folder, [never, refactor]);
	assert.equal(loadSettled(storage, root)?.files['solo.go']?.blob, git('rev-parse', 'ai_fix:solo.go'));
	const parsed: string[] = [];
	const found = await findCandidates(root, factory(parsed), () => false, remembered(loadSettled(storage, root)));
	assert.deepEqual(found?.choices.map(c => c.file), ['c.go']);
	assert.deepEqual(found?.unsplittable.map(c => c.file), ['solo.go']);
	assert.equal(found?.skipped.get('big_test.go'), 'test files are not split');
	assert.deepEqual(parsed, ['c.go'], 'remembered files are not parsed again');
	rmSync(folder, { recursive: true, force: true });
	rmSync(root, { recursive: true, force: true });
});

test('a file in the folder where nothing may move is never offered for a split', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-stuck-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	git('init', '--quiet', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(path.join(root, 'stuck.go'), lines(500));
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	const pinned = (dir: string) => ({
		...factory([])(dir),
		parse: async (file: string): Promise<FileInfo> => ({ path: file, declarations: [{ ...decl(0, 200), movable: false }], frame: [], imports: [] }),
	}) as unknown as LanguageAdapter;
	const found = await findCandidates(root, pinned, () => false);
	assert.deepEqual(found?.choices, []);
	assert.deepEqual(found?.unsplittable.map(c => c.file), ['stuck.go']);
	rmSync(root, { recursive: true, force: true });
});

function emptyRun(root: string, worktree: Awaited<ReturnType<typeof prepare>>): RunState {
	return {
		version: 1, root, language: 'Go', worktree, startedAt: new Date().toISOString(), approved: [], fixes: [], next: 0,
		steps: [never, refactor], baseline: {}, skippedFiles: [],
	};
}

test('a run that committed nothing adds no commit to an existing ai_fix and says why', async () => {
	const { root, git } = diverged();
	const tip = git('rev-parse', 'ai_fix');
	const storage = mkdtempSync(path.join(os.tmpdir(), 'settled-'));
	const worktree = await prepare(root, `${root}.ai-ready`);
	const said: string[] = [];
	await closeEmpty(storage, emptyRun(root, worktree), { text: text => said.push(text) });
	assert.equal(git('rev-parse', 'ai_fix'), tip);
	assert.equal(existsSync(worktree.path), false);
	assert.match(said.join(''), /No fix was committed this time, so `ai_fix` is unchanged and no change note was added/);
	assert.match(said.join(''), /`solo\.go`: Needs a real refactor\./);
	rmSync(root, { recursive: true, force: true });
});

test('a first run that committed nothing leaves no ai_fix branch behind', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-first-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	git('init', '--quiet', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(path.join(root, 'solo.go'), lines(430));
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	const worktree = await prepare(root, `${root}.ai-ready`);
	assert.equal(worktree.created, true);
	const said: string[] = [];
	await closeEmpty(mkdtempSync(path.join(os.tmpdir(), 'settled-')), emptyRun(root, worktree), { text: text => said.push(text) });
	assert.equal(git('branch', '--list', 'ai_fix'), '');
	assert.match(said.join(''), /no branch was kept/);
	rmSync(root, { recursive: true, force: true });
});

test('without ai_fix the picker reads blob ids from HEAD, so a remembered file in the folder is left out too', async () => {
	const { root, git } = diverged();
	git('branch', '-D', 'ai_fix');
	const known = remembered(settledCache([refactor], new Map([['solo.go', git('rev-parse', 'HEAD:solo.go')]])));
	const found = await findCandidates(root, factory([]), () => false, known);
	assert.deepEqual(found?.unsplittable.map(c => c.file), ['solo.go']);
	assert.equal(found?.choices.some(c => c.file === 'solo.go'), false);
	rmSync(root, { recursive: true, force: true });
});

test('a split settled as needing a refactor keeps its big function by blob', () => {
	const big = { name: 'Step', receiver: 'Store', lines: 425 };
	const cache = settledCache([{ ...refactor, lasting: { big } }, never], new Map([['solo.go', 's1'], ['big_test.go', 'b1']]));
	assert.deepEqual(cache.files['solo.go'], { blob: 's1', big });
	assert.deepEqual(cache.files['big_test.go'], { blob: 'b1', skip: 'test files are not split' });
	assert.deepEqual(remembered(cache)('solo.go', 's1')?.big, big);
	assert.equal(remembered(cache)('solo.go', 's2'), undefined);
});
