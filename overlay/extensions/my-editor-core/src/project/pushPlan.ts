/** The branch the AI-ready fixer commits on; pushing it needs the user to say so twice. */
export const FIX_BRANCH_NAME = 'ai_fix';

/** One push the user confirms: exactly this commit, to this remote, as this branch there. Never forced. */
export interface PushPlan {
	readonly remote: string;
	/** The remote's address with any login removed, for the confirmation. */
	readonly remoteUrl: string;
	/** The user's current branch, or undefined when HEAD is detached. */
	readonly branch?: string;
	readonly commit: string;
	/** The branch name on the remote. */
	readonly target: string;
}

const BAD_CHARACTERS = /[\s~^:?*[\\\x00-\x1f\x7f]/;

/** Why a name can't be a branch on the remote (git's own rules for ref names, simplified); undefined when it can. */
export function branchNameProblem(name: string): string | undefined {
	if (!name) { return 'Give the branch a name.'; }
	if (name.length > 200) { return 'That name is too long.'; }
	if (BAD_CHARACTERS.test(name)) { return 'A branch name cannot have spaces or any of ~ ^ : ? * [ \\.'; }
	if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) {
		return 'A branch name cannot start with - or /, or end with / or a dot.';
	}
	if (name.includes('..') || name.includes('//') || name.includes('@{') || name === '@') { return 'A branch name cannot contain .., // or @{.'; }
	if (name.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))) {
		return 'No part of a branch name may start with a dot or end with .lock.';
	}
	return undefined;
}

/** The exact git arguments: the confirmed commit (not whatever HEAD is by then) to the named branch, with no force. */
export function pushArgs(plan: PushPlan): string[] {
	return ['push', plan.remote, `${plan.commit}:refs/heads/${plan.target}`];
}

/** A remote address without a login in it (`https://user:token@host/…` → `https://host/…`). */
export function withoutLogin(url: string): string {
	return url.replace(/^(\w+:\/\/)[^@/]+@/, '$1');
}

/** The confirmation's detail, in plain words with the exact command last. */
export function confirmText(plan: PushPlan): string {
	const from = plan.branch ? `your branch ${plan.branch}` : 'your detached HEAD';
	const fix = plan.branch === FIX_BRANCH_NAME
		? `\n\nThis is ${FIX_BRANCH_NAME}, the branch the AI-ready fixer commits on. Push it only if you have reviewed its fixes.` : '';
	return `Commit ${plan.commit.slice(0, 7)} (${from}) goes to ${plan.remoteUrl} (${plan.remote}) as the branch ${plan.target}. `
		+ 'Nothing else changes: not your files, not your branch, not other branches there.'
		+ `${fix}\n\ngit ${pushArgs(plan).join(' ')}\n\n`
		+ `It is never forced: if ${plan.target} there already has commits this one does not include, GitHub refuses the push.`;
}

/** What a failed push means, in plain words, with git's own last lines kept. */
export function pushFailure(message: string): string {
	if (/rejected|non-fast-forward|fetch first|stale info/i.test(message)) {
		return 'The remote refused it: that branch there has commits this one does not include. my_editor never force-pushes; '
			+ `pick another branch name, or bring those commits in first. (${message})`;
	}
	if (/authentication|could not read username|permission denied|403|terminal prompts disabled|credential/i.test(message)) {
		return 'The remote refused the login. Sign in to GitHub once from Terminal (for example with gh auth login), then push again. '
			+ `(${message})`;
	}
	if (/could not resolve host|unable to access|timed out|network/i.test(message)) {
		return `The remote could not be reached. Check the connection and push again. (${message})`;
	}
	return `The push failed: ${message}`;
}

const PUSH = /\bpush(?:ed|es|ing)?\b/i;
const WHERE = /\b(?:git|github|gitlab|bitbucket|remote|origin|upstream|branch|repo|repository)\b/i;
const NOT_NAMES = new Set(['ai_fix', 'push', 'git', 'github', 'gitlab', 'bitbucket', 'origin', 'remote', 'upstream', 'the', 'a', 'an', 'my', 'new', 'branch',
	'repo', 'repository', 'it', 'this', 'that', 'to', 'as', 'from', 'on', 'in', 'for', 'with', 'now', 'please', 'there', 'here']);

/** Whether a chat message asks to push to a remote (so Pair offers the Push button under its reply). */
export function asksToPush(prompt: string): boolean {
	return PUSH.test(prompt) && WHERE.test(prompt);
}

/** `ai_fix` when the message names the fixer's branch (not as part of a longer name like u_m_dialer_ai_fix); else undefined. */
export function suggestedSource(prompt: string): string | undefined {
	return /(?<![\w-])ai[_-]?fix(?![\w-])/i.test(prompt) ? FIX_BRANCH_NAME : undefined;
}

/** A branch name the message gives for the push ("as u_m_dialer", "to branch release-1", "in release-1 branch"); undefined when none. */
export function suggestedTarget(prompt: string): string | undefined {
	for (const match of prompt.matchAll(/\b(?:as|to|in|into|named|called|branch)\s+[`'"]?([A-Za-z0-9._/-]+)[`'"]?/gi)) {
		const name = match[1].replace(/[.,]+$/, '');
		if (!NOT_NAMES.has(name.toLowerCase()) && !branchNameProblem(name)) { return name; }
	}
	return undefined;
}
