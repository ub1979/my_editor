import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { fixTip, treeSource } from '../src/aiready/branchTip';
import { findCandidates } from '../src/aiready/fixCandidates';
import type { Declaration, FileInfo, LanguageAdapter } from '../src/aiready/language';

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
	writeFileSync(path.join(root, 'a_part.go'), lines(350));
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
			const declarations = file === 'solo.go' ? [decl(0, 425)] : [decl(0, 200), decl(1, 200), decl(2, 50)];
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
