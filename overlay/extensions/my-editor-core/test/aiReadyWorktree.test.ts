import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { clearState, loadState, RunState, saveState } from '../src/aiready/fixState';
import { runCommand, splitCommand } from '../src/aiready/projectCommands';
import { changedFiles, commit, gitArgs, prepare, prerequisites, remove, restore } from '../src/aiready/worktree';

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
	assert.equal(wt.branch, 'my_editor/ai-ready');
	assert.equal((await prepare(root)).branch, 'my_editor/ai-ready-2');
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
		version: 1, root: '/p/shop', language: 'Go', worktree: { branch: 'my_editor/ai-ready', path: '/p/shop.ai-ready', base: 'abc' },
		startedAt: '2026-10-09T10:00:00Z', approved: ['go build ./...'], fixes: [{ file: 'a.go', kind: 'split', lines: 900 }], next: 0, steps: [],
		baseline: {}, skippedFiles: [],
	};
	saveState(storage, saved);
	assert.deepEqual(loadState(storage, '/p/shop'), saved);
	assert.equal(loadState(storage, '/p/other'), undefined);
	clearState(storage, '/p/shop');
	assert.equal(loadState(storage, '/p/shop'), undefined);
});
