import { accessSync, constants, existsSync, realpathSync, rmSync } from 'fs';
import * as path from 'path';
import { findTool, runTool } from './projectCommands';

/** Git subcommands that reach a remote. This module never builds them; `gitArgs` refuses them as a second guard. */
const REMOTE_COMMANDS = new Set(['push', 'fetch', 'pull', 'remote', 'clone', 'ls-remote', 'submodule', 'request-pull', 'send-email', 'archive']);
const BRANCH = 'my_editor/ai-ready';

/**
 * The full argument list for one local git command: hooks off (they could run project code, reformat files or talk to
 * a remote) and no credential prompts. Throws for any command that reaches a remote.
 */
export function gitArgs(args: readonly string[]): string[] {
	const command = args.find(arg => !arg.startsWith('-'));
	if (!command || REMOTE_COMMANDS.has(command)) { throw new Error(`my_editor does not run git ${command ?? ''} here.`); }
	return ['-c', 'core.hooksPath=/dev/null', ...args];
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
	const bin = findTool('git');
	if (!bin) { throw new Error('Git was not found.'); }
	const result = await runTool(bin, gitArgs(args), cwd, { GIT_TERMINAL_PROMPT: '0' });
	if (result.code !== 0) { throw new Error(`git ${args[0]} failed: ${result.stderr.trim().split('\n').slice(-2).join(' ')}`); }
	return result.stdout;
}

async function succeeds(cwd: string, args: readonly string[]): Promise<boolean> {
	try { await git(cwd, args); return true; } catch { return false; }
}

/** Why the folder cannot be fixed on a branch yet, as a plain message; `noRepository` when `git init` could help. */
export async function prerequisites(root: string): Promise<{ problem?: string; noRepository?: boolean }> {
	if (!await succeeds(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])) {
		return { problem: 'This folder is not a Git repository with a commit yet.', noRepository: true };
	}
	if (realpathSync((await git(root, ['rev-parse', '--show-toplevel'])).trim()) !== realpathSync(root)) {
		return { problem: 'Open the repository’s top folder to fix it on a branch.' };
	}
	if ((await git(root, ['status', '--porcelain', '--untracked-files=no'])).trim()) {
		return { problem: 'Some tracked files have uncommitted changes. Commit or stash them first, so the branch starts from a known state.' };
	}
	return {};
}

/** Creates a repository with one commit of the current files (everything but `.my_editor/`), after the user agreed. */
export async function initRepository(root: string): Promise<void> {
	if (!existsSync(path.join(root, '.git'))) { await git(root, ['init', '--quiet']); }
	await git(root, ['add', '--all', '--', '.', ':(exclude).my_editor']);
	await git(root, ['commit', '--quiet', '-m', 'Initial commit']);
}

/** Tracked files, relative and `/`-separated. */
export async function trackedFiles(root: string): Promise<string[]> {
	return (await git(root, ['ls-files', '-z'])).split('\0').filter(Boolean);
}

export interface Worktree {
	readonly branch: string;
	readonly path: string;
	/** The commit the branch started from. */
	readonly base: string;
}

/** The first free branch name: `my_editor/ai-ready`, then `-2`, `-3`… */
async function freeBranch(root: string): Promise<string> {
	for (let n = 1; ; n++) {
		const name = n === 1 ? BRANCH : `${BRANCH}-${n}`;
		if (!await succeeds(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) { return name; }
	}
}

/** A free folder next to the project, so relative paths that leave the repository still resolve. */
export function freeFolder(root: string): string {
	const parent = path.dirname(path.resolve(root));
	try { accessSync(parent, constants.W_OK); } catch { throw new Error(`The folder ${parent} is not writable, so the branch's working copy cannot go next to the project.`); }
	for (let n = 1; ; n++) {
		const folder = path.join(parent, `${path.basename(root)}.ai-ready${n === 1 ? '' : `-${n}`}`);
		if (!existsSync(folder)) { return folder; }
	}
}

/** Creates the branch at HEAD and checks it out in a new worktree next to the project. The user's folder is not touched. */
export async function prepare(root: string): Promise<Worktree> {
	const branch = await freeBranch(root);
	const folder = freeFolder(root);
	const base = (await git(root, ['rev-parse', 'HEAD'])).trim();
	await git(root, ['worktree', 'add', '--quiet', folder, '-b', branch, base]);
	return { branch, path: folder, base };
}

/** After a crash: the worktree from saved state, or prune and check the branch out again. */
export async function reattach(root: string, worktree: Worktree): Promise<Worktree> {
	if (existsSync(path.join(worktree.path, '.git'))) { return worktree; }
	await git(root, ['worktree', 'prune']);
	const folder = existsSync(worktree.path) ? freeFolder(root) : worktree.path;
	await git(root, ['worktree', 'add', '--quiet', folder, worktree.branch]);
	return { ...worktree, path: folder };
}

/** Tracked files with changes in the worktree. */
export async function changedFiles(worktree: string): Promise<string[]> {
	return (await git(worktree, ['diff', '--name-only', 'HEAD'])).split('\n').map(line => line.trim()).filter(Boolean);
}

/** Commits exactly these paths under the user's Git identity; returns the commit hash. */
export async function commit(worktree: string, paths: readonly string[], subject: string, body: string): Promise<string> {
	await git(worktree, ['add', '--force', '--', ...paths]);
	await git(worktree, ['commit', '--quiet', '-m', subject, '-m', body, '--', ...paths]);
	return (await git(worktree, ['rev-parse', 'HEAD'])).trim();
}

/** Undoes a step: tracked files back to the last commit, the step's new files removed. */
export async function restore(worktree: string, newFiles: readonly string[]): Promise<void> {
	const changed = await changedFiles(worktree);
	if (changed.length) { await git(worktree, ['checkout', 'HEAD', '--', ...changed]); }
	for (const file of newFiles) { rmSync(path.join(worktree, file), { force: true }); }
}

/** Removes the worktree (files the tests left behind included); the branch stays. */
export async function remove(root: string, worktree: string): Promise<void> {
	await git(root, ['worktree', 'remove', '--force', worktree]);
}

/** Deletes a branch this run created, when the run is discarded before anything was committed on it. */
export async function deleteBranch(root: string, branch: string): Promise<void> {
	await git(root, ['branch', '-D', branch]);
}
