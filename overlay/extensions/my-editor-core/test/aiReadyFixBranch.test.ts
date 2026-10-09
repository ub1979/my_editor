import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { renderChangeNote } from '../src/aiready/changeNote';
import type { RunState } from '../src/aiready/fixState';
import { approvalDetail, behindText, closingText } from '../src/aiready/fixText';
import { aheadOf, commit, discard, prepare, prerequisites, remove } from '../src/aiready/worktree';
import { MODES, systemPrompt } from '../src/pair/prompts';

/** A fresh repository on `main` with one commit, and a git helper for it. */
function repository(): { parent: string; root: string; git: (...args: string[]) => string } {
	const parent = mkdtempSync(path.join(os.tmpdir(), 'my-editor-fixbranch-'));
	const root = path.join(parent, 'shop');
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	execFileSync('git', ['init', '--quiet', '-b', 'main', root]);
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(path.join(root, 'a.go'), 'package shop\n');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	return { parent, root, git };
}

/** One run: prepare, one commit of `file`, remove the worktree. */
async function oneRun(root: string, file: string): Promise<string> {
	const wt = await prepare(root);
	writeFileSync(path.join(wt.path, file), 'package shop\n');
	const sha = await commit(wt.path, [file], `add ${file}`, 'Body.');
	await remove(root, wt.path);
	return sha;
}

test('the fixes always go on ai_fix: a second run stacks on the first, and no ai_fix-2 is ever made', async () => {
	const { root, git } = repository();
	const head = git('rev-parse', 'HEAD');
	const first = await oneRun(root, 'b.go');
	const wt = await prepare(root);
	assert.equal(wt.branch, 'ai_fix');
	assert.equal(wt.base, first, 'the second run starts at the first run\'s tip');
	assert.equal(wt.userRef, 'main');
	assert.equal(wt.behind, 0);
	assert.equal(wt.created, false);
	writeFileSync(path.join(wt.path, 'c.go'), 'package shop\n');
	await commit(wt.path, ['c.go'], 'add c.go', 'Body.');
	assert.equal(await aheadOf(root, 'ai_fix'), 2);
	await discard(root, wt);
	assert.equal(git('rev-parse', '--verify', 'ai_fix').length, 40, 'discard keeps a branch the run did not create');
	assert.equal(git('branch', '--list', 'ai_fix-*'), '');
	assert.equal(git('rev-parse', 'HEAD'), head);
	assert.equal(git('branch', '--show-current'), 'main');
});

test('the first run moves earlier work from my_editor/ai-ready to ai_fix and leaves the old branch alone', async () => {
	const { root, git } = repository();
	git('branch', 'my_editor/ai-ready');
	git('switch', '--quiet', 'my_editor/ai-ready');
	writeFileSync(path.join(root, 'old.go'), 'package shop\n');
	git('add', 'old.go');
	git('commit', '--quiet', '-m', 'old run');
	const old = git('rev-parse', 'HEAD');
	git('switch', '--quiet', 'main');
	const wt = await prepare(root);
	assert.deepEqual([wt.branch, wt.base, wt.created], ['ai_fix', old, true]);
	assert.equal(git('rev-parse', 'my_editor/ai-ready'), old);
	await remove(root, wt.path);
});

test('when your branch has moved on, the run still stacks on ai_fix and says so in Pair and the change note', async () => {
	const { root, git } = repository();
	await oneRun(root, 'b.go');
	const fork = git('rev-parse', 'HEAD');
	for (const name of ['x.go', 'y.go']) {
		writeFileSync(path.join(root, name), 'package shop\n');
		git('add', name);
		git('commit', '--quiet', '-m', name);
	}
	const wt = await prepare(root);
	assert.deepEqual([wt.behind, wt.forkPoint], [2, fork]);
	const text = `\`ai_fix\` is based on \`${fork.slice(0, 7)}\`; your branch has 2 newer commits that these fixes don't include.`;
	assert.equal(behindText(wt), text);
	assert.equal(behindText({ ...wt, behind: 0 }), '');
	const state = { version: 1, root, language: 'Go', worktree: wt, startedAt: '', approved: [], fixes: [], next: 0, steps: [], baseline: {},
		skippedFiles: [] } as RunState;
	assert.ok(renderChangeNote(state, new Date()).includes(text));
	await remove(root, wt.path);
});

test('ai_fix checked out in another folder stops the run with that folder named', async () => {
	const { parent, root, git } = repository();
	git('branch', 'ai_fix');
	const other = path.join(parent, 'elsewhere');
	git('worktree', 'add', '--quiet', other, 'ai_fix');
	const problem = (await prerequisites(root)).problem ?? '';
	assert.ok(problem.includes(`checked out in ${realpathSync(other)}`), problem);
	await assert.rejects(prepare(root), /checked out in/);
	git('worktree', 'remove', other);
	git('switch', '--quiet', 'ai_fix');
	assert.match((await prerequisites(root)).problem ?? '', /checked out in your folder/);
});

test('no closing, change-note, approval or Pair text suggests merging ai_fix', () => {
	const close = closingText({ committed: 2, branch: 'ai_fix', base: 'abcdef1234567890', note: 'n.md', removed: true, worktree: '/w',
		reportUpdated: false, ahead: 5, userRef: 'main' });
	assert.match(close, /2 fixes committed on `ai_fix` \(now 5 commits ahead of `main`\)/);
	assert.match(close, /`git diff main\.\.\.ai_fix` or `git log main\.\.ai_fix`/);
	assert.match(close, /`git switch ai_fix`/);
	assert.match(close, /`git branch -D ai_fix`/);
	assert.match(close, /Nothing was pushed; `ai_fix` exists only in this repository on your machine\./);
	const state = { version: 1, root: '/p/shop', language: 'Go', startedAt: '', approved: [], fixes: [], next: 0, steps: [], baseline: {},
		skippedFiles: [], worktree: { branch: 'ai_fix', path: '/w', base: 'abcdef1234567890', userRef: 'main' } } as RunState;
	const note = renderChangeNote(state, new Date());
	assert.match(note, /git diff main\.\.\.ai_fix/);
	assert.match(note, /git switch ai_fix/);
	const prompt = systemPrompt(MODES.chat, '', '', '/tmp/shop');
	assert.match(prompt, /ai_fix/);
	assert.match(prompt, /never tell the user to merge/i);
	assert.match(approvalDetail('/p/shop.ai-ready', ['go build ./...'], 'Go'), /ai_fix/);
	for (const text of [close, note, approvalDetail('/p/w', ['go vet ./a'], 'Go')]) { assert.doesNotMatch(text, /git merge|merg/i); }
});

test('only worktree.ts runs git in the fixer', () => {
	const dir = path.join(__dirname, '../../src/aiready');
	const running = readdirSync(dir).filter(name => /findTool\('git'|runTool\([^)]*'git'/.test(readFileSync(path.join(dir, name), 'utf8')));
	assert.deepEqual(running, ['worktree.ts']);
});
