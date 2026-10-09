import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { blockingEdits, dirtyMessage } from '../src/aiready/dirtyFiles';
import { prerequisites } from '../src/aiready/worktree';

test('blockingEdits ignores Finder and Windows folder files, keeps real edits', () => {
	const porcelain = [
		' M cmd/.DS_Store',
		' M .DS_Store',
		'M  docs/Thumbs.db',
		' M assets/desktop.ini',
		' M src/._report.go',
		' M internal/store/placements.go',
		'R  old/a.go -> new/a.go',
		'',
	].join('\n');
	assert.deepEqual(blockingEdits(porcelain), ['internal/store/placements.go', 'new/a.go']);
	assert.deepEqual(blockingEdits(' M cmd/.DS_Store\n'), []);
	assert.deepEqual(blockingEdits(''), []);
});

test('blockingEdits reads quoted paths with spaces', () => {
	assert.deepEqual(blockingEdits(' M "my dir/a b.go"\n'), ['my dir/a b.go']);
});

test('dirtyMessage names the files, at most five', () => {
	assert.equal(dirtyMessage([]), undefined);
	assert.match(dirtyMessage(['a.go']) ?? '', /a\.go/);
	const many = dirtyMessage(['a', 'b', 'c', 'd', 'e', 'f', 'g']) ?? '';
	assert.match(many, /a, b, c, d, e and 2 more/);
	assert.match(many, /Commit or stash/);
});

test('a changed tracked .DS_Store does not block a run; a changed source file does, by name', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-dirty-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	git('init', '--quiet');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	mkdirSync(path.join(root, 'cmd'));
	writeFileSync(path.join(root, 'cmd', '.DS_Store'), 'finder 1');
	writeFileSync(path.join(root, 'a.go'), 'package shop\n');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	writeFileSync(path.join(root, 'cmd', '.DS_Store'), 'finder 2');
	assert.deepEqual(await prerequisites(root), {});
	writeFileSync(path.join(root, 'a.go'), 'package changed\n');
	assert.match((await prerequisites(root)).problem ?? '', /uncommitted changes: a\.go\./);
});
