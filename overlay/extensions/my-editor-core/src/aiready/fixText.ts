import { MAX_SOURCE_LINES } from '../quality/sourcePolicy';
import { type EarlyOutcome, unitOf } from './fixScreen';
import type { StepRecord } from './fixState';
import { FIX_BRANCH, type Worktree } from './worktree';

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
export function approvalDetail(folder: string, approved: readonly string[], language: string, installs = false, note = ''): string {
	return `In a new working copy at ${folder}, on the local branch ${FIX_BRANCH} (made from your branch the first time; later runs add `
		+ `on top):\n\n${approved.join('\n')}\n\n`
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
	const refactor = outcomes.filter(outcome => outcome.step.over?.length);
	const unchecked = outcomes.filter(outcome => outcome.unchecked && !refactor.includes(outcome));
	const other = outcomes.filter(outcome => !outcome.unchecked && !refactor.includes(outcome));
	const lines = [
		...(unchecked.length ? [`${unchecked.length} chosen fix${unchecked.length === 1 ? '' : 'es'} can't be checked here and `
			+ `${unchecked.length === 1 ? 'is' : 'are'} skipped: ${grouped(unchecked)}.`] : []),
		...(other.length ? [`${other.length} ${unchecked.length ? 'more' : `chosen fix${other.length === 1 ? '' : 'es'}`} `
			+ `${other.length === 1 ? 'is' : 'are'} skipped before any work: `
			+ `${other.map(({ step, brief }) => `\`${step.file}\`: ${brief}`).join('; ')}.`] : []),
		...(refactor.length ? [`${refactor.length} file${refactor.length === 1 ? ' needs' : 's need'} a real refactor, so `
			+ `${refactor.length === 1 ? 'it is' : 'they are'} not split (listed in the change note): `
			+ `${refactor.map(({ step, brief }) => `\`${step.file}\`: ${brief}`).join('; ')}.`] : []),
	];
	return lines.map(line => `${line}\n`).join('');
}

/** Where a paused run stands: fixes left, the branch, the file Continue starts from, and the runaway bound when it was hit. */
export interface Paused {
	readonly left: number;
	readonly branch: string;
	readonly next: string;
	readonly bound?: number;
}

/** Said when a run pauses with fixes left: on Stop, or (only when it was hit) at the runaway bound. */
export function pausedText({ left, branch, next, bound }: Paused): string {
	const why = bound === undefined ? 'Stopped.' : `This run stopped after ${bound} fixes, a safety limit for runaway runs.`;
	return `\n${why} ${left} fix${left === 1 ? ' is' : 'es are'} left on \`${branch}\`; Continue picks up from \`${next}\`.`;
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
	/** Files still over the line limit: left so by committed splits, or needing a real refactor. */
	readonly stillOver?: number;
	/** Commits the branch has that the user's branch lacks, and that branch's name (or short HEAD). */
	readonly ahead?: number;
	readonly userRef?: string;
}

/** Said before the run and in the change note when the user's branch has commits the fix branch lacks; else empty. */
export function behindText(worktree: Worktree): string {
	const behind = worktree.behind ?? 0;
	if (!behind || !worktree.forkPoint) { return ''; }
	return `\`${worktree.branch}\` is based on \`${worktree.forkPoint.slice(0, 7)}\`; your branch has ${behind} newer `
		+ `commit${behind === 1 ? '' : 's'} that these fixes don't include.`;
}

/** The review commands: what the branch adds over the user's branch, how to work on it, how to delete it. */
export function reviewText(branch: string, userRef: string): string {
	return `Review with \`git diff ${userRef}...${branch}\` or \`git log ${userRef}..${branch}\`, work on them with `
		+ `\`git switch ${branch}\`, or delete them with \`git branch -D ${branch}\`.`;
}

/** The closing message: what was committed, the one thing changed in the user's folder, and how to review. */
export function closingText(close: Closing): string {
	const { committed, branch, base, note } = close;
	const userRef = close.userRef ?? base.slice(0, 12);
	const ahead = close.ahead === undefined ? '' : ` (now ${close.ahead} commit${close.ahead === 1 ? '' : 's'} ahead of \`${userRef}\`)`;
	return `\n**Done.** ${committed} fix${committed === 1 ? '' : 'es'} committed on \`${branch}\`${ahead}, with the change note \`${note}\`. `
		+ `${close.discarded ? `${close.discarded} fix${close.discarded === 1 ? '' : 'es'} discarded. ` : ''}`
		+ `${close.stillOver ? `${close.stillOver} file${close.stillOver === 1 ? ' is' : 's are'} still over ${MAX_SOURCE_LINES} lines; `
			+ 'the change note says why. ' : ''}`
		+ `${close.reportUpdated ? 'In your folder, only the health report in `.my_editor/ai-ready/` was updated. ' : ''}`
		+ `Nothing was pushed; \`${branch}\` exists only in this repository on your machine.`
		+ `${close.removed ? '' : ` Remove the working copy \`${close.worktree}\` when you are done with it.`}\n\n`
		+ reviewText(branch, userRef);
}

/** A run that committed nothing, as it closes. */
export interface Empty {
	readonly steps: readonly StepRecord[];
	readonly branch: string;
	/** Whether the branch existed before this run (and so stays); a branch this run made is deleted. */
	readonly kept: boolean;
	/** Whether the worktree was removed. */
	readonly removed: boolean;
	readonly worktree: string;
}

const LISTED = 8;

/** The closing message when no fix was committed: nothing changed on the branch, and why, one line per fix. */
export function nothingText({ steps, branch, kept, removed, worktree }: Empty): string {
	const lines = steps.slice(0, LISTED).map(step => `- \`${step.file}\`: ${step.reason ?? step.status}`);
	const more = steps.length > LISTED ? [`- and ${steps.length - LISTED} more.`] : [];
	const where = kept ? `\`${branch}\` is unchanged and no change note was added` : 'no branch was kept';
	return `\n**Done.** No fix was committed this time, so ${where}. Nothing was pushed.`
		+ `${removed ? '' : ` Remove the working copy \`${worktree}\` when you are done with it.`}\n\n`
		+ `${[...lines, ...more].join('\n')}${lines.length ? '\n\n' : ''}`
		+ 'The next run leaves out files settled by their own content, and leaves unticked the ones nothing here can check.\n';
}
