import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectGitSync, updateGitProject } from '../src/project/gitSync';

function git(cwd: string, ...args: string[]): void {
	execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
}

test('Git update notices a remote commit, fast-forwards safely, and preserves local work', async () => {
	const base = mkdtempSync(join(tmpdir(), 'my-editor-git-sync-'));
	try {
		const remote = join(base, 'remote.git');
		const source = join(base, 'source');
		const project = join(base, 'project');
		const branch = 'codex/production-predictdial-delivery-v1';
		mkdirSync(source);
		git(base, 'init', '--bare', '-q', '-b', branch, remote);
		git(source, 'init', '-q', '-b', branch);
		git(source, 'config', 'user.name', 'Tester');
		git(source, 'config', 'user.email', 'tester@example.invalid');
		writeFileSync(join(source, 'README.md'), 'first\n');
		git(source, 'add', 'README.md');
		git(source, 'commit', '-qm', 'first');
		git(source, 'remote', 'add', 'origin', remote);
		git(source, 'push', '-q', '-u', 'origin', branch);
		git(base, 'clone', '-q', '--branch', branch, '--single-branch', remote, project);

		writeFileSync(join(source, 'README.md'), 'second\n');
		git(source, 'commit', '-qam', 'second');
		git(source, 'push', '-q');
		mkdirSync(join(project, '.my_editor'));
		writeFileSync(join(project, '.my_editor', 'brain.md'), 'local note\n');
		const behind = await inspectGitSync(project, true);
		assert.equal(behind.kind, 'tracked');
		assert.equal(behind.branch, branch);
		assert.equal(behind.behind, 1);
		assert.equal(behind.untracked, true);
		assert.equal(behind.localEdits, false);
		const updated = await updateGitProject(project);
		assert.equal(updated.updated, true);
		assert.equal(updated.state.behind, 0);
		assert.equal(readFileSync(join(project, 'README.md'), 'utf8'), 'second\n');
		assert.equal(readFileSync(join(project, '.my_editor', 'brain.md'), 'utf8'), 'local note\n');

		writeFileSync(join(source, 'README.md'), 'third\n');
		git(source, 'commit', '-qam', 'third');
		git(source, 'push', '-q');
		writeFileSync(join(project, 'README.md'), 'my local edit\n');
		const blocked = await updateGitProject(project);
		assert.equal(blocked.updated, false);
		assert.match(blocked.reason ?? '', /Commit or stash local file edits/);
		assert.equal(readFileSync(join(project, 'README.md'), 'utf8'), 'my local edit\n');
		git(project, 'config', 'user.name', 'Tester');
		git(project, 'config', 'user.email', 'tester@example.invalid');
		git(project, 'add', 'README.md');
		git(project, 'commit', '-qm', 'local edit');
		const diverged = await updateGitProject(project);
		assert.equal(diverged.updated, false);
		assert.match(diverged.reason ?? '', /local commits as well as remote commits/);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});
