import type { GitSyncState } from './gitSync';

export interface ProjectContextStatus {
	readonly name: string;
	readonly path: string;
	readonly head?: string;
	readonly git: GitSyncState;
	readonly brainCommit?: string;
	readonly brainFiles: number;
	readonly summarizedFiles: number;
}

export function describeProjectStatus(status: ProjectContextStatus | undefined): string {
	if (!status) { return 'No local project folder is open in my_editor.'; }
	const lines = [`Open project: ${status.name} (${status.path}).`];
	if (status.head) { lines.push(`Local Git HEAD: ${status.head}.`); }
	if (status.git.kind === 'tracked') {
		lines.push(`Branch ${status.git.branch}, tracking ${status.git.upstream}; last fetched upstream snapshot: ${status.git.behind ?? 0} behind, ${status.git.ahead ?? 0} ahead. This does not check the live remote.`);
		if (status.git.localEdits || status.git.untracked) { lines.push('Working tree has local changes; inspect them before describing the committed state.'); }
	} else if (status.git.kind === 'no-upstream') { lines.push(`Branch ${status.git.branch}; no upstream branch is configured.`); }
	lines.push(status.brainCommit
		? `Project brain: ${status.summarizedFiles}/${status.brainFiles} files summarized at commit ${status.brainCommit}.`
		: 'Project brain: no saved file map.');
	if (status.head && status.brainCommit && !status.head.startsWith(status.brainCommit) && !status.brainCommit.startsWith(status.head)) {
		lines.push('The brain was built from a different commit. Recheck current source before relying on its summaries.');
	}
	lines.push('This is local project state, not proof of the source running in production.');
	return lines.join('\n');
}
