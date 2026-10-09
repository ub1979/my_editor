/** The default and limits of `myEditor.aiReady.commandTimeoutMinutes`. */
const DEFAULT_TIMEOUT_MINUTES = 10;
const MAX_TIMEOUT_MINUTES = 240;

/** The per-command timeout in minutes from the raw setting: a number clamped to 1–240, else the default. */
export function timeoutMinutes(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) { return DEFAULT_TIMEOUT_MINUTES; }
	return Math.min(MAX_TIMEOUT_MINUTES, Math.max(1, value));
}

/** The approval modal's detail: where the commands run, the exact commands, and what they run. */
export function approvalDetail(folder: string, approved: readonly string[], language: string): string {
	return `In a new working copy at ${folder}, on a new branch:\n\n${approved.join('\n')}\n\n`
		+ 'They build the project and run its tests, which runs project code and tests written by the AI model. '
		+ `my_editor also runs read-only ${language} tools (to list packages and check formatting) and local git commands there. `
		+ 'Your files and your branch stay as they are until the end, when the health report in .my_editor/ai-ready/ is updated. Nothing is pushed.';
}

export interface Closing {
	readonly committed: number;
	/** Fixes the user discarded instead of running. */
	readonly discarded?: number;
	readonly branch: string;
	readonly base: string;
	readonly note: string;
	/** Whether the worktree was removed. */
	readonly removed: boolean;
	readonly worktree: string;
	/** Whether the health report in the user's folder was updated. */
	readonly reportUpdated: boolean;
}

/** The closing message: what was committed, the one thing changed in the user's folder, and how to review. */
export function closingText(close: Closing): string {
	const { committed, branch, base, note } = close;
	return `\n**Done.** ${committed} fix${committed === 1 ? '' : 'es'} committed on \`${branch}\`, with the change note \`${note}\`. `
		+ `${close.discarded ? `${close.discarded} fix${close.discarded === 1 ? '' : 'es'} discarded. ` : ''}`
		+ `${close.reportUpdated ? 'In your folder, only the health report in `.my_editor/ai-ready/` was updated. ' : ''}Nothing was pushed.`
		+ `${close.removed ? '' : ` Remove the working copy \`${close.worktree}\` when you are done with it.`}\n\n`
		+ `Review with \`git diff ${base.slice(0, 12)}..${branch}\`, keep the changes with \`git merge ${branch}\`, or delete them with \`git branch -D ${branch}\`.`;
}
