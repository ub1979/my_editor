import { accessSync, constants, existsSync, realpathSync, rmSync } from 'fs';
import * as path from 'path';
import { blockingEdits, dirtyMessage } from './dirtyFiles';
import { findTool, runTool } from './projectCommands';

/** Git subcommands that reach a remote. This module never builds them; `gitArgs` refuses them as a second guard. */
const REMOTE_COMMANDS = new Set(['push', 'fetch', 'pull', 'remote', 'clone', 'ls-remote', 'submodule', 'request-pull', 'send-email', 'archive']);
/** The one branch every run adds its fixes to. It is local only; my_editor never suggests merging it. */
export const FIX_BRANCH = 'ai_fix';
/** The branch earlier versions used; its work moves to `ai_fix` once. */
export const OLD_BRANCH = 'my_editor/ai-ready';

/**
 * The full argument list for one local git command: hooks off (they could run project code, reformat files or talk to
 * a remote) and no credential prompts. Throws for any command that reaches a remote.
 */
export function gitArgs(args: readonly string[]): string[] {
	const command = args.find(arg => !arg.startsWith('-'));
	if (!command || REMOTE_COMMANDS.has(command)) { throw new Error(`my_editor does not run git ${command ?? ''} here.`); }
	return ['-c', 'core.hooksPath=/dev/null', ...args];
}

/** Runs one local git command (see `gitArgs`) and returns its output; throws when it fails. */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
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
	const dirty = dirtyMessage(blockingEdits(await git(root, ['status', '--porcelain', '--untracked-files=no'])));
	if (dirty) {
		return { problem: dirty };
	}
	const busy = await branchInUse(root);
	return busy ? { problem: busy } : {};
}

/** Where `ai_fix` is checked out, as a plain message, or undefined when it is free (or does not exist). */
async function branchInUse(root: string): Promise<string | undefined> {
	const listed = await worktrees(root);
	const on = listed.find(entry => entry.branch === `refs/heads/${FIX_BRANCH}`);
	if (!on) { return undefined; }
	if (on === listed[0]) { return `The branch ${FIX_BRANCH} is checked out in your folder. Switch your folder to another branch, then try again.`; }
	return `The branch ${FIX_BRANCH} is checked out in ${on.path}. Finish with that working copy or remove it `
		+ `(\`git worktree remove ${on.path}\`), then try again.`;
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
	/** The branch's tip when this run started: the code the baseline ran on. */
	readonly base: string;
	/** The user's branch (or short HEAD when detached) when the run started. */
	readonly userRef?: string;
	/** Commits on the user's HEAD that the branch does not contain, and where the two part. */
	readonly behind?: number;
	readonly forkPoint?: string;
	/** Whether this run created the branch (so discarding the run may delete it). */
	readonly created?: boolean;
}

async function hasBranch(root: string, name: string): Promise<boolean> {
	return succeeds(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
}

/** How many commits `branch` has that the user's HEAD does not. */
export async function aheadOf(root: string, branch: string): Promise<number> {
	return Number((await git(root, ['rev-list', '--count', `HEAD..${branch}`])).trim());
}

/** A free folder next to the project, so relative paths that leave the repository still resolve. */
export function freeFolder(root: string): string {
	const parent = path.dirname(path.resolve(root));
	try { accessSync(parent, constants.W_OK); } catch {
		throw new Error(`The folder ${parent} is not writable, so the branch's working copy cannot go next to the project.`);
	}
	for (let n = 1; ; n++) {
		const folder = path.join(parent, `${path.basename(root)}.ai-ready${n === 1 ? '' : `-${n}`}`);
		if (!existsSync(folder)) { return folder; }
	}
}

/**
 * Checks out `ai_fix` in a new worktree next to the project, in `folder` (the one the user approved), so the run adds
 * on top of earlier runs. A missing `ai_fix` starts at the old `my_editor/ai-ready` when that exists, else at HEAD.
 * Nothing is merged or rebased, and the user's folder is not touched.
 */
export async function prepare(root: string, folder = freeFolder(root)): Promise<Worktree> {
	const busy = await branchInUse(root);
	if (busy) { throw new Error(busy); }
	const created = !await hasBranch(root, FIX_BRANCH);
	if (created) { await git(root, ['branch', FIX_BRANCH, await hasBranch(root, OLD_BRANCH) ? OLD_BRANCH : 'HEAD']); }
	await git(root, ['worktree', 'add', '--quiet', folder, FIX_BRANCH]);
	const base = (await git(root, ['rev-parse', FIX_BRANCH])).trim();
	const userRef = (await git(root, ['branch', '--show-current'])).trim() || (await git(root, ['rev-parse', '--short', 'HEAD'])).trim();
	const behind = Number((await git(root, ['rev-list', '--count', `${FIX_BRANCH}..HEAD`])).trim());
	const forkPoint = (await git(root, ['merge-base', 'HEAD', FIX_BRANCH])).trim();
	return { branch: FIX_BRANCH, path: folder, base, userRef, behind, forkPoint, created };
}

function real(file: string): string {
	try { return realpathSync(file); } catch { return path.resolve(file); }
}

/** Worktrees from `git worktree list --porcelain`, the main one (the user's folder) first. */
async function worktrees(root: string): Promise<{ path: string; branch?: string }[]> {
	return (await git(root, ['worktree', 'list', '--porcelain'])).split('\n\n').map(block => {
		const lines = block.split('\n');
		return { path: lines.find(line => line.startsWith('worktree '))?.slice(9) ?? '', branch: lines.find(line => line.startsWith('branch '))?.slice(7) };
	}).filter(entry => entry.path);
}

/** Throws unless `folder` is a linked worktree of `root` with `branch` checked out; never the user's folder. */
async function assertRunWorktree(root: string, folder: string, branch: string): Promise<void> {
	const listed = await worktrees(root);
	if (real(folder) === real(root) || (listed[0] && real(folder) === real(listed[0].path))) {
		throw new Error(`The branch ${branch} is checked out in your folder, so my_editor will not reset it. Switch your folder to another branch first.`);
	}
	if (!listed.some(entry => entry.branch === `refs/heads/${branch}` && real(entry.path) === real(folder))) {
		throw new Error(`${folder} is not the working copy of ${branch}.`);
	}
}

/** Puts the run's worktree back at its last commit (a fix that stopped half way). Runs only inside that worktree. */
async function cleanWorktree(root: string, folder: string, branch: string): Promise<void> {
	await assertRunWorktree(root, folder, branch);
	await git(folder, ['reset', '-q']);
	await git(folder, ['checkout', 'HEAD', '--', '.']);
	await git(folder, ['clean', '-fd']);
}

/**
 * Continue after a stop or crash: the saved worktree when Git still lists it on the run's branch, else the branch
 * checked out again in a free folder. Either way, it is reset to its last commit.
 */
export async function reattach(root: string, worktree: Worktree): Promise<Worktree> {
	// Only the run's own folder: pruning would also drop the user's worktrees on drives that are not mounted.
	if (!existsSync(worktree.path)) { await git(root, ['worktree', 'prune']); }
	const listed = await worktrees(root);
	const on = listed.find(entry => entry.branch === `refs/heads/${worktree.branch}`);
	let folder = worktree.path;
	if (on) {
		if (on !== listed[0] && real(on.path) !== real(worktree.path)) {
			throw new Error(`The branch ${worktree.branch} is checked out in ${on.path}, not in the run's working copy.`);
		}
		// The main worktree is the user's folder; cleanWorktree refuses it.
		folder = on === listed[0] ? on.path : worktree.path;
	} else {
		folder = existsSync(worktree.path) ? freeFolder(root) : worktree.path;
		await git(root, ['worktree', 'add', '--quiet', folder, worktree.branch]);
	}
	await cleanWorktree(root, folder, worktree.branch);
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

/**
 * Undoes a step: everything unstaged, tracked files back to the last commit, and the step's new files (and any new
 * file that was staged, say by a commit that failed) removed.
 */
export async function restore(worktree: string, newFiles: readonly string[]): Promise<void> {
	const fields = (await git(worktree, ['diff', '--name-status', '--no-renames', '-z', 'HEAD'])).split('\0').filter(Boolean);
	const entries: { status: string; file: string }[] = [];
	for (let i = 0; i + 1 < fields.length; i += 2) { entries.push({ status: fields[i], file: fields[i + 1] }); }
	const paths = [...new Set([...entries.map(entry => entry.file), ...newFiles])];
	if (paths.length) { await git(worktree, ['reset', '-q', '--', ...paths]); }
	const tracked = entries.filter(entry => entry.status !== 'A').map(entry => entry.file);
	if (tracked.length) { await git(worktree, ['checkout', 'HEAD', '--', ...tracked]); }
	const added = entries.filter(entry => entry.status === 'A').map(entry => entry.file);
	for (const file of new Set([...added, ...newFiles])) { rmSync(path.join(worktree, file), { force: true }); }
}

/** Removes the worktree (files the tests left behind included); the branch stays. */
export async function remove(root: string, worktree: string): Promise<void> {
	await git(root, ['worktree', 'remove', '--force', worktree]);
}

/**
 * Removes a run's worktree when the run is discarded before anything was committed on it; the branch goes too only
 * when this run created it, so earlier runs' fixes stay.
 */
export async function discard(root: string, worktree: Worktree): Promise<void> {
	if (existsSync(worktree.path)) { await remove(root, worktree.path); }
	if (worktree.created) { await git(root, ['branch', '-D', worktree.branch]); }
}
