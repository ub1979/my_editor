import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { clearState, loadState, RunState, saveState } from '../src/aiready/fixState';
import { runCommand, splitCommand } from '../src/aiready/projectCommands';
import { changedFiles, commit, discard, gitArgs, prepare, prerequisites, reattach, remove, restore } from '../src/aiready/worktree';

test('commands run only when approved, without a shell, with a full log', async () => {
	assert.equal(splitCommand('go test ./... ; rm -rf /'), undefined);
	assert.equal(splitCommand('go test $(x)'), undefined);
	assert.deepEqual(splitCommand('go vet ./internal/store'), { bin: 'go', args: ['vet', './internal/store'] });
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-run-'));
	const options = { cwd: dir, approved: ['node --version'], timeoutMs: 20_000, logFile: path.join(dir, 'logs', 'a.log') };
	assert.match((await runCommand('node --help', options)).error ?? '', /not approved/);
	const result = await runCommand('node --version', options);
	assert.equal(result.code, 0);
	assert.match(result.stdout, /^v\d+/);
	assert.match(readFileSync(options.logFile, 'utf8'), /\$ node --version[\s\S]*# exit 0/);
});

test('worktree.ts never builds a push, fetch or remote command', () => {
	for (const command of ['push', 'fetch', 'pull', 'remote', 'clone', 'ls-remote', 'submodule']) {
		assert.throws(() => gitArgs([command, 'origin']), /does not run git/);
	}
	assert.deepEqual(gitArgs(['status']), ['-c', 'core.hooksPath=/dev/null', 'status']);
	const source = readFileSync(path.join(__dirname, '../../src/aiready/worktree.ts'), 'utf8');
	const built = [...source.matchAll(/(?:git|succeeds)\(\w+, \['([\w-]+)'/g)].map(match => match[1]);
	assert.ok(built.length >= 10);
	assert.deepEqual(built.filter(command => ['push', 'fetch', 'pull', 'remote', 'clone', 'ls-remote', 'submodule'].includes(command)), []);
});

test('a worktree next to the project gets a branch, a commit and a restore; the user folder stays put', async () => {
	const parent = mkdtempSync(path.join(os.tmpdir(), 'my-editor-wt-'));
	const root = path.join(parent, 'shop');
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	execFileSync('git', ['init', '--quiet', root]);
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(path.join(root, 'a.go'), 'package shop\n');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	assert.deepEqual(await prerequisites(root), {});
	const branch = git('branch', '--show-current');
	const wt = await prepare(root);
	assert.equal(wt.path, path.join(parent, 'shop.ai-ready'));
	assert.equal(wt.branch, 'ai_fix');
	await assert.rejects(prepare(root), /ai_fix is checked out in/);
	writeFileSync(path.join(wt.path, 'a.go'), 'package shop\n\nfunc A() {}\n');
	writeFileSync(path.join(wt.path, 'b.go'), 'package shop\n');
	assert.deepEqual(await changedFiles(wt.path), ['a.go']);
	await restore(wt.path, ['b.go']);
	assert.deepEqual(await changedFiles(wt.path), []);
	assert.ok(!existsSync(path.join(wt.path, 'b.go')));
	writeFileSync(path.join(wt.path, 'b.go'), 'package shop\n');
	await commit(wt.path, ['b.go'], 'my_editor: add b (b.go)', 'Body.');
	await remove(root, wt.path);
	assert.ok(!existsSync(wt.path));
	assert.equal(git('log', '-1', '--format=%s', wt.branch), 'my_editor: add b (b.go)');
	assert.equal(git('branch', '--show-current'), branch);
	assert.equal(git('status', '--porcelain'), '');
	writeFileSync(path.join(root, 'a.go'), 'package changed\n');
	assert.match((await prerequisites(root)).problem ?? '', /uncommitted changes/);
});

test('run state is saved per project in storage and survives a reload', () => {
	const storage = mkdtempSync(path.join(os.tmpdir(), 'my-editor-state-'));
	const saved: RunState = {
		version: 1, root: '/p/shop', language: 'Go', worktree: { branch: 'ai_fix', path: '/p/shop.ai-ready', base: 'abc' },
		startedAt: '2026-10-09T10:00:00Z', approved: ['go build ./...'], fixes: [{ file: 'a.go', kind: 'split', lines: 900 }], next: 0, steps: [],
		baseline: {}, skippedFiles: [],
	};
	saveState(storage, saved);
	assert.deepEqual(loadState(storage, '/p/shop'), saved);
	assert.equal(loadState(storage, '/p/other'), undefined);
	clearState(storage, '/p/shop');
	assert.equal(loadState(storage, '/p/shop'), undefined);
});

/** A fresh repository with one commit of a.go, and a git helper for it. */
function repository(): { parent: string; root: string; git: (...args: string[]) => string } {
	const parent = mkdtempSync(path.join(os.tmpdir(), 'my-editor-wt-'));
	const root = path.join(parent, 'shop');
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	execFileSync('git', ['init', '--quiet', root]);
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(path.join(root, 'a.go'), 'package shop\n');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	return { parent, root, git };
}

test('prepare uses the folder it is given, and discard removes the worktree and its branch', async () => {
	const { parent, root, git } = repository();
	const wt = await prepare(root, path.join(parent, 'chosen'));
	assert.equal(wt.path, path.join(parent, 'chosen'));
	await discard(root, wt);
	assert.ok(!existsSync(wt.path));
	assert.equal(git('branch', '--list', wt.branch), '');
});

test('restore unstages and deletes a staged new file and puts a staged change back', async () => {
	const { root } = repository();
	const wt = await prepare(root);
	const wgit = (...args: string[]) => execFileSync('git', args, { cwd: wt.path, encoding: 'utf8' });
	writeFileSync(path.join(wt.path, 'a.go'), 'package changed\n');
	writeFileSync(path.join(wt.path, 'new_test.go'), 'package shop\n');
	wgit('add', '--force', '--', 'a.go', 'new_test.go');
	await restore(wt.path, []);
	assert.equal(wgit('status', '--porcelain'), '');
	assert.ok(!existsSync(path.join(wt.path, 'new_test.go')));
	assert.equal(readFileSync(path.join(wt.path, 'a.go'), 'utf8'), 'package shop\n');
});

test('reattach cleans only a registered worktree on the run branch, never the user folder', async () => {
	const { root, git } = repository();
	writeFileSync(path.join(root, 'keep.txt'), 'mine\n');
	writeFileSync(path.join(root, 'a.go'), 'package mine\n');
	const wt = await prepare(root);
	writeFileSync(path.join(wt.path, 'a.go'), 'package half\n');
	writeFileSync(path.join(wt.path, 'stray.go'), 'package shop\n');
	assert.deepEqual(await reattach(root, wt), wt);
	assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: wt.path, encoding: 'utf8' }), '');
	const userBranch = git('branch', '--show-current');
	await assert.rejects(reattach(root, { ...wt, branch: userBranch, path: root }), /your folder/);
	await assert.rejects(reattach(root, { ...wt, path: root }), /checked out in/);
	assert.equal(readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'mine\n');
	assert.equal(readFileSync(path.join(root, 'a.go'), 'utf8'), 'package mine\n');
	assert.equal(git('status', '--porcelain'), 'M a.go\n?? keep.txt');
});

test('reattach adds the worktree again after a crash, and leaves a plain folder at the old path alone', async () => {
	const { root } = repository();
	const wt = await prepare(root);
	rmSync(wt.path, { recursive: true, force: true });
	const again = await reattach(root, wt);
	assert.equal(again.path, wt.path);
	assert.ok(existsSync(path.join(again.path, 'a.go')));
	await remove(root, again.path);
	mkdirSync(wt.path);
	writeFileSync(path.join(wt.path, 'notes.txt'), 'not a worktree\n');
	const moved = await reattach(root, wt);
	assert.notEqual(moved.path, wt.path);
	assert.equal(readFileSync(path.join(wt.path, 'notes.txt'), 'utf8'), 'not a worktree\n');
	assert.ok(existsSync(path.join(moved.path, 'a.go')));
});

test('worktree.ts runs checkout and clean only after checking the folder is the run worktree', () => {
	const source = readFileSync(path.join(__dirname, '../../src/aiready/worktree.ts'), 'utf8');
	const cleans = [...source.matchAll(/git\((\w+), \['clean'/g)];
	assert.equal(cleans.length, 1);
	const body = source.slice(source.indexOf('async function cleanWorktree'));
	assert.match(body.slice(0, body.indexOf('\n}\n')),
		/await assertRunWorktree\(root, folder, branch\);[\s\S]*git\(folder, \['checkout', 'HEAD', '--', '\.'\]\)[\s\S]*git\(folder, \['clean', '-fd'\]\)/);
});

test('reattach prunes only when the saved worktree is gone, never the user\'s own missing worktrees', async () => {
	const { parent, root, git } = repository();
	const wt = await prepare(root);
	const other = path.join(parent, 'elsewhere');
	git('worktree', 'add', '--quiet', other, '-b', 'user-branch');
	rmSync(other, { recursive: true });
	await reattach(root, wt);
	assert.match(git('worktree', 'list', '--porcelain'), /elsewhere/);
	rmSync(wt.path, { recursive: true });
	const again = await reattach(root, wt);
	assert.equal(again.path, wt.path);
	assert.ok(existsSync(wt.path));
});
