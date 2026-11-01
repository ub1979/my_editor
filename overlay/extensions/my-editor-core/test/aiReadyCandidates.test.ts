import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { fixTip, treeSource } from '../src/aiready/branchTip';
import { findCandidates } from '../src/aiready/fixCandidates';
import { screenParsed } from '../src/aiready/fixScreen';
import { remembered, type Remembered, settledCache } from '../src/aiready/fixSettled';
import type { Declaration, FileInfo, LanguageAdapter, RefactorHooks } from '../src/aiready/language';

const lines = (n: number) => 'x\n'.repeat(n);

function decl(id: number, size: number): Declaration {
	return { id, kind: 'function', names: [`f${id}`], span: { start: 0, end: 0 }, lines: size, doc: '', docText: '', uses: [], movable: true };
}

/** A repository whose HEAD has five long Go files; `solo.go` is one 425-line function. */
function repository(): { root: string; git: (...args: string[]) => string } {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-tip-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	git('init', '--quiet', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	for (const [name, size] of [['a.go', 600], ['b.go', 500], ['c.go', 450], ['d.go', 420], ['solo.go', 430], ['small.go', 20]] as const) {
		writeFileSync(path.join(root, name), lines(size));
	}
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	return { root, git };
}

/** A first run's commits on `branch`: `a.go` split under the limit, `b.go` split leaving a new file over it. */
function firstRun(root: string, git: (...args: string[]) => string, branch: string): void {
	git('checkout', '--quiet', '-b', branch);
	writeFileSync(path.join(root, 'a.go'), lines(250));
	writeFileSync(path.join(root, 'a_part.go'), lines(250));
	writeFileSync(path.join(root, 'b.go'), lines(90));
	writeFileSync(path.join(root, 'b_big.go'), lines(410));
	git('add', '.');
	git('commit', '--quiet', '-m', 'my_editor: split');
	git('checkout', '--quiet', 'main');
}

/** A Go-like adapter on `root` that records what it parsed; it reads the file there, as the real ones do. */
function factory(parsed: string[]) {
	return (root: string): LanguageAdapter => ({
		label: 'Go', extensions: ['.go'], fixes: ['split'],
		parse: async (file: string): Promise<FileInfo> => {
			readFileSync(path.join(root, file));
			parsed.push(file);
			const declarations = file === 'solo.go' ? [decl(0, 425)] : [decl(0, 200), decl(1, 200), decl(2, 150)];
			return { path: file, declarations, frame: [], imports: [] };
		},
	}) as unknown as LanguageAdapter;
}

test('the tip is ai_fix, else the old branch a run would start from, else none; its files are read without a checkout', async () => {
	const { root, git } = repository();
	assert.equal(await fixTip(root), undefined);
	firstRun(root, git, 'my_editor/ai-ready');
	assert.equal(await fixTip(root), git('rev-parse', 'my_editor/ai-ready'));
	git('branch', 'ai_fix', 'main');
	assert.equal(await fixTip(root), git('rev-parse', 'ai_fix'));
	git('branch', '-D', 'ai_fix');
	const source = await treeSource(root);
	assert.deepEqual([...source.changed].sort(), ['a.go', 'a_part.go', 'b.go', 'b_big.go']);
	assert.ok(source.tracked.includes('b_big.go'));
	assert.equal(await source.text('b_big.go'), lines(410));
	assert.equal(await source.text('c.go'), lines(450));
	assert.equal(git('branch', '--show-current'), 'main');
	assert.equal(git('status', '--porcelain'), '');
	rmSync(root, { recursive: true, force: true });
});

test('a second run offers the files still over the limit on ai_fix, not the ones the first run split', async () => {
	const { root, git } = repository();
	firstRun(root, git, 'ai_fix');
	const parsed: string[] = [];
	const found = await findCandidates(root, factory(parsed), () => false);
	assert.ok(found);
	assert.deepEqual(found.choices.map(c => `${c.file} ${c.lines}`), ['c.go 450', 'd.go 420', 'b_big.go 410']);
	assert.deepEqual(found.unsplittable.map(c => c.file), ['solo.go']);
	assert.deepEqual(found.unparsed.map(c => c.file), ['b_big.go']);
	assert.deepEqual(parsed.sort(), ['c.go', 'd.go', 'solo.go'], 'files that differ on ai_fix are screened later, in its working copy');
	assert.equal(found.tip, git('rev-parse', 'ai_fix'));
	rmSync(root, { recursive: true, force: true });
});

test('without an earlier run, candidates come from the folder as before', async () => {
	const { root } = repository();
	const found = await findCandidates(root, factory([]), () => false);
	assert.deepEqual(found?.choices.map(c => c.file), ['a.go', 'b.go', 'c.go', 'd.go']);
	assert.equal(found?.tip, undefined);
	rmSync(root, { recursive: true, force: true });
});

/** The same adapter with a refactor whose target is the file's largest declaration, named as `target` says. */
function refactoring(parsed: string[], target: RefactorHooks['target'] = info => ({ name: info.declarations[0].names[0], lines: 425 })) {
	return (root: string): LanguageAdapter =>
		({ ...factory(parsed)(root), fixes: ['split', 'refactor'], refactor: { target } as RefactorHooks }) as LanguageAdapter;
}

test('a file only a refactor can help is offered as a refactor when the adapter has one, and stays unsplittable without it', async () => {
	const { root, git } = repository();
	const found = await findCandidates(root, refactoring([]), () => false);
	assert.deepEqual(found?.choices.map(c => `${c.file} ${c.kind} ${c.lines}`),
		['a.go split 600', 'b.go split 500', 'c.go split 450', 'solo.go refactor 430', 'd.go split 420']);
	assert.deepEqual(found?.choices.find(c => c.kind === 'refactor')?.target, { name: 'f0', lines: 425 });
	assert.deepEqual(found?.unsplittable.map(c => c.file), ['solo.go']);
	assert.deepEqual([...found?.blobs ?? []], [['solo.go', git('rev-parse', 'HEAD:solo.go')]]);
	const plain = await findCandidates(root, factory([]), () => false);
	assert.equal(plain?.choices.some(c => c.kind === 'refactor'), false);
	assert.deepEqual(plain?.unsplittable.map(c => c.file), ['solo.go']);
	const notFunction = await findCandidates(root, refactoring([], () => '`f0` is a var, not a function'), () => false);
	assert.equal(notFunction?.choices.some(c => c.kind === 'refactor'), false);
	assert.deepEqual(notFunction?.unsplittable.map(c => c.file), ['solo.go']);
	rmSync(root, { recursive: true, force: true });
});

test('a settled file with its big function is offered without parsing; a record without it holds, parsed again only when unchanged', async () => {
	const { root, git } = repository();
	firstRun(root, git, 'ai_fix');
	const big = { name: 'Big', receiver: 'Store', lines: 405 };
	const known: Remembered = (file, blob) => (file === 'b_big.go' ? { blob: blob!, big } : file === 'solo.go' ? { blob: blob! } : undefined);
	const parsed: string[] = [];
	const found = await findCandidates(root, refactoring(parsed), () => false, known);
	assert.deepEqual(found?.choices.map(c => `${c.file} ${c.kind}`), ['c.go split', 'solo.go refactor', 'd.go split', 'b_big.go refactor']);
	assert.deepEqual(found?.choices.find(c => c.file === 'b_big.go')?.target, big);
	assert.deepEqual(found?.unsplittable.map(c => c.file).sort(), ['b_big.go', 'solo.go']);
	assert.deepEqual(parsed.sort(), ['c.go', 'd.go', 'solo.go'], 'the record without its big function is parsed again');
	assert.equal(found?.blobs.get('b_big.go'), git('rev-parse', 'ai_fix:b_big.go'));
	const older: Remembered = (file, blob) => (file === 'b_big.go' ? { blob: blob! } : undefined);
	const again = await findCandidates(root, refactoring([]), () => false, older);
	assert.deepEqual(again?.unparsed, [], 'a changed file a record settled is not screened again');
	assert.equal(again?.choices.some(c => c.file === 'b_big.go'), false);
	assert.deepEqual(again?.unsplittable.map(c => c.file).sort(), ['b_big.go', 'solo.go']);
	const plain = await findCandidates(root, factory([]), () => false, older);
	assert.deepEqual(plain?.unsplittable.map(c => c.file).sort(), ['b_big.go', 'solo.go'], 'without a refactor the old record still holds');
	rmSync(root, { recursive: true, force: true });
});

test('a changed file where nothing may move is ticked once, then never again, run after run', async () => {
	const { root, git } = repository();
	firstRun(root, git, 'ai_fix');
	const first = await findCandidates(root, refactoring([]), () => false);
	assert.deepEqual(first?.unparsed.map(c => c.file), ['b_big.go'], 'unknown yet: the run\'s working copy screens it');
	const fix = first!.unparsed[0];
	const stuck: FileInfo = { path: 'b_big.go', frame: [], imports: [], declarations: [{ ...decl(0, 200), movable: false }] };
	const screener = { checks: () => [], parse: async () => stuck, testFileName: (file: string) => file };
	const outcome = screenParsed(screener, root, {}, fix, stuck);
	assert.equal(outcome?.step.reason, 'Nothing in it may move.');
	let cache = settledCache([outcome!.step], new Map([['b_big.go', git('rev-parse', 'ai_fix:b_big.go')]]));
	for (const pass of [1, 2]) {
		const found = await findCandidates(root, refactoring([]), () => false, remembered(cache));
		assert.equal(found?.choices.some(c => c.file === 'b_big.go'), false, `pass ${pass}: not offered`);
		assert.deepEqual(found?.unparsed, [], `pass ${pass}: not ticked`);
		assert.ok(found?.unsplittable.some(c => c.file === 'b_big.go'), `pass ${pass}: listed as one a split can't help`);
		cache = settledCache([], new Map(), cache);
	}
	rmSync(root, { recursive: true, force: true });
});

test('a language that parses text checks changed files from the branch: no blind ticks, and their refactors are offered at once', async () => {
	const { root, git } = repository();
	git('checkout', '--quiet', '-b', 'ai_fix');
	writeFileSync(path.join(root, 'big_test.go'), lines(900));
	writeFileSync(path.join(root, 'solo.go'), lines(431));
	git('add', '.');
	git('commit', '--quiet', '-m', 'the branch');
	git('checkout', '--quiet', 'main');
	const fromText: string[] = [];
	const adapter = (dir: string): LanguageAdapter => ({
		...refactoring([])(dir),
		parseText: async (file: string, text: string): Promise<FileInfo> => {
			fromText.push(`${file} ${text.split('\n').length - 1}`);
			const declarations = file === 'solo.go' ? [decl(0, 425)] : [decl(0, 200), decl(1, 200), decl(2, 150)];
			return { path: file, declarations, frame: [], imports: [], ...(file.endsWith('_test.go') ? { skip: 'test files are not split' } : {}) };
		},
	}) as LanguageAdapter;
	const older: Remembered = (file, blob) => (file === 'solo.go' ? { blob: blob! } : undefined);
	const found = await findCandidates(root, adapter, () => false, older);
	assert.deepEqual(fromText.sort(), ['big_test.go 900', 'solo.go 431'], 'read from ai_fix, not the folder');
	assert.equal(found?.skipped.get('big_test.go'), 'test files are not split');
	assert.equal(found?.choices.some(c => c.file === 'big_test.go'), false);
	assert.deepEqual(found?.choices.find(c => c.file === 'solo.go'), { file: 'solo.go', kind: 'refactor', lines: 431, target: { name: 'f0', lines: 425 } });
	assert.deepEqual(found?.unparsed, []);
	rmSync(root, { recursive: true, force: true });
});
