import { type EarlyOutcome, unitOf } from './fixScreen';
import { MAX_FIXES_PER_RUN } from './fixState';

/** The default and limits of `myEditor.aiReady.commandTimeoutMinutes`. */
const DEFAULT_TIMEOUT_MINUTES = 10;
const MAX_TIMEOUT_MINUTES = 240;

/** The per-command timeout in minutes from the raw setting: a number clamped to 1–240, else the default. */
export function timeoutMinutes(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) { return DEFAULT_TIMEOUT_MINUTES; }
	return Math.min(MAX_TIMEOUT_MINUTES, Math.max(1, value));
}

/** One short line and a bullet list of the commands that already fail before any change. */
export function alreadyFailingText(commands: readonly string[]): string {
	return commands.length ? `Some checks already fail before any change:\n\n${commands.map(command => `- \`${command}\``).join('\n')}\n` : '';
}

/** What the install (the first approved command) does, in a few true sentences. */
function installText(command: string): string {
	return `my_editor chose \`${command}\` from the lockfile. It downloads packages from the registry this repository configures (or your `
		+ 'default one) and runs the install scripts of the project and of its dependencies; the repository\'s .npmrc, .yarnrc.yml or '
		+ '.pnpmfile.cjs can also run code during the install. ';
}

/** The approval modal's detail: where the commands run, the exact commands, what they run, and the adapter's note. */
export function approvalDetail(folder: string, approved: readonly string[], language: string, fixCount = 0, installs = false, note = ''): string {
	const over = fixCount > MAX_FIXES_PER_RUN ? `${fixCount} fixes chosen: ${MAX_FIXES_PER_RUN} now; Continue does the rest.\n\n` : '';
	return `${over}In a new working copy at ${folder}, on a new branch:\n\n${approved.join('\n')}\n\n`
		+ (installs ? installText(approved[0]) : '')
		+ `${installs ? 'The others' : 'They'} build the project and run its tests, which runs project code and tests written by the AI model. `
		+ `my_editor also runs read-only ${language} tools (to list packages and check formatting) and local git commands there. ${note}`
		+ 'Your files and your branch stay as they are until the end, when the health report in .my_editor/ai-ready/ is updated. Nothing is pushed.';
}

/** `./a` (2 files): reason; … — fixes grouped by their unit and short reason, in first-seen order. */
function grouped(outcomes: readonly EarlyOutcome[]): string {
	const groups = new Map<string, { unit: string; brief: string; count: number }>();
	for (const { step, brief } of outcomes) {
		const unit = unitOf(step.file);
		const group = groups.get(`${unit}\n${brief}`) ?? { unit, brief, count: 0 };
		group.count++;
		groups.set(`${unit}\n${brief}`, group);
	}
	return [...groups.values()].map(g => `\`${g.unit}\` (${g.count} file${g.count === 1 ? '' : 's'}): ${g.brief}`).join('; ');
}

/** The run text said once, right after the baseline: which chosen fixes are skipped before any work, and why. */
export function earlyText(outcomes: readonly EarlyOutcome[]): string {
	const unchecked = outcomes.filter(outcome => outcome.unchecked);
	const other = outcomes.filter(outcome => !outcome.unchecked);
	const lines = [
		...(unchecked.length ? [`${unchecked.length} chosen fix${unchecked.length === 1 ? '' : 'es'} can't be checked here and `
			+ `${unchecked.length === 1 ? 'is' : 'are'} skipped: ${grouped(unchecked)}.`] : []),
		...(other.length ? [`${other.length} ${unchecked.length ? 'more' : `chosen fix${other.length === 1 ? '' : 'es'}`} `
			+ `${other.length === 1 ? 'is' : 'are'} skipped before any work: `
			+ `${other.map(({ step, brief }) => `\`${step.file}\`: ${brief}`).join('; ')}.`] : []),
	];
	return lines.map(line => `${line}\n`).join('');
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
