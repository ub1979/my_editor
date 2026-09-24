import { execFile } from 'child_process';
import { redact } from '../records/redact';

export interface GitSyncState {
	readonly kind: 'not-git' | 'no-upstream' | 'tracked';
	readonly branch?: string;
	readonly upstream?: string;
	readonly ahead?: number;
	readonly behind?: number;
	readonly localEdits?: boolean;
	readonly untracked?: boolean;
	readonly remoteHead?: string;
	readonly checkedAt?: number;
	readonly fetchError?: string;
}

export interface GitUpdateResult {
	readonly state: GitSyncState;
	readonly updated: boolean;
	readonly reason?: string;
}

function git(cwd: string, args: readonly string[], timeout = 20_000): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', [...args], {
			cwd, timeout, maxBuffer: 2_000_000,
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
		}, (error, stdout, stderr) => {
			if (error) {
				const detail = stderr.trim().split(/[\r\n]+/).slice(-2).join(' ') || error.message;
				reject(new Error(redact(detail.replace(/https?:\/\/[^\s]+/g, '[remote URL]')).slice(0, 500)));
			}
			else { resolve(stdout.trim()); }
		});
	});
}

/** Fetch only the current branch's remote, then compare local HEAD with its upstream. */
export async function inspectGitSync(cwd: string, fetchRemote = false): Promise<GitSyncState> {
	try {
		if (await git(cwd, ['rev-parse', '--is-inside-work-tree']) !== 'true') { return { kind: 'not-git' }; }
	} catch { return { kind: 'not-git' }; }
	let branch: string;
	try { branch = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']); }
	catch { return { kind: 'no-upstream', branch: 'detached HEAD' }; }
	let upstream: string;
	try { upstream = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']); }
	catch { return { kind: 'no-upstream', branch }; }
	let fetchError: string | undefined;
	if (fetchRemote) {
		try {
			const remote = await git(cwd, ['config', '--get', `branch.${branch}.remote`]);
			if (remote && remote !== '.') { await git(cwd, ['fetch', '--quiet', '--no-tags', remote], 30_000); }
		} catch (error) {
			fetchError = error instanceof Error ? error.message.slice(0, 300) : String(error);
		}
	}
	const [counts, porcelain, remoteHead] = await Promise.all([
		git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']),
		git(cwd, ['status', '--porcelain', '--untracked-files=normal']),
		git(cwd, ['rev-parse', '@{upstream}']),
	]);
	const [ahead, behind] = counts.split(/\s+/).map(Number);
	const lines = porcelain.split('\n').filter(Boolean);
	return {
		kind: 'tracked', branch, upstream, ahead, behind,
		localEdits: lines.some(line => !line.startsWith('??')),
		untracked: lines.some(line => line.startsWith('??')),
		remoteHead, checkedAt: Date.now(), fetchError,
	};
}

/** Apply only a clean fast-forward. Git itself prevents overwriting conflicting untracked files. */
export async function updateGitProject(cwd: string): Promise<GitUpdateResult> {
	const state = await inspectGitSync(cwd, true);
	if (state.kind !== 'tracked') { return { state, updated: false, reason: 'This branch has no upstream to update from.' }; }
	if (state.fetchError) { return { state, updated: false, reason: `Could not check the remote: ${state.fetchError}` }; }
	if (!state.behind) { return { state, updated: false, reason: 'This branch is already up to date.' }; }
	if (state.ahead) { return { state, updated: false, reason: 'This branch has local commits as well as remote commits. Review them in Source Control before updating.' }; }
	if (state.localEdits) { return { state, updated: false, reason: 'Commit or stash local file edits in Source Control before updating.' }; }
	try {
		await git(cwd, ['merge', '--ff-only', '@{upstream}'], 30_000);
		return { state: await inspectGitSync(cwd), updated: true };
	} catch (error) {
		return { state: await inspectGitSync(cwd), updated: false, reason: error instanceof Error ? error.message : String(error) };
	}
}
