import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { MAX_SOURCE_LINES } from '../quality/sourcePolicy';
import { flakyTests } from './baseline';
import type { RunState, StepRecord } from './fixState';
import { STILL_OVER_HEADING, stillOverLines } from './stillOver';

const RUN_SECTION = '## Fixes on a local branch';

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** `.my_editor/changes/ai-ready-<date>-<time>.md`, in local time: a new path each run, so merges never collide. */
export function noteFileName(at: Date): string {
	return `.my_editor/changes/ai-ready-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.md`;
}

/** Flaky tests across all baseline commands. */
export function runFlaky(state: RunState): string[] {
	return Object.values(state.baseline).flatMap(([first, second]) => flakyTests(first.tests, second.tests));
}

/** "Plan: 2 attempts; rejected: …" when the model's plan was asked for more than once or rejected. */
function planText(step: StepRecord): string {
	const plan = step.plan;
	if (!plan || (plan.attempts < 2 && !plan.rejected.length)) { return ''; }
	return `Plan: ${plan.attempts} attempt${plan.attempts === 1 ? '' : 's'}${plan.rejected.length ? `; rejected: ${plan.rejected.join(' / ')}` : ''}`;
}

function stepLine(step: StepRecord): string {
	const short = step.commit?.slice(0, 7);
	if (step.kind === 'split') {
		const moved = (step.moved ?? []).map(m => `\`${m.file}\` (${m.names.join(', ')})`).join('; ');
		return `- \`${short}\` Split \`${step.file}\` into ${moved}.`;
	}
	const dropped = step.dropped?.length ? `; dropped failing tests ${step.dropped.join(', ')}` : '';
	return `- \`${short}\` Added tests for \`${step.file}\` in \`${step.testFile}\`${dropped}.`;
}

/** Skipped files over the limit with their reasons, then one count for the rest (a file with no recorded size is listed). */
function neverSplit(state: RunState): string[] {
	const long = state.skippedFiles.filter(s => s.lines === undefined || s.lines > MAX_SOURCE_LINES);
	const rest = state.skippedFiles.length - long.length;
	const others = `- plus ${rest} file${rest === 1 ? '' : 's'} under ${MAX_SOURCE_LINES} lines that need no split. `
		+ 'They have no tests and cannot be given any, so the picker does not offer them';
	return [...long.map(s => `- \`${s.file}\`: ${s.reason}.`), ...(rest ? [others] : [])];
}

/** What may still differ for moved code when the adapter does not say. */
const MAY_DIFFER = 'File names and line numbers in error traces may differ for moved code.';

/** Said only when a split ran in a types-only file. */
const TYPES_ONLY = 'Interfaces and type aliases moved in a types-only project change no emitted JavaScript.';

function commitLines(step: StepRecord): string[] {
	return [stepLine(step), ...(step.checks ? [`  Checks: ${step.checks}`] : []), ...(planText(step) ? [`  ${planText(step)}`] : [])];
}

function notDoneLine(step: StepRecord): string {
	return `- \`${step.file}\` (${step.kind === 'split' ? 'split' : 'tests'}): ${step.status}. ${step.reason ?? ''} ${planText(step)}`.trimEnd();
}

/** The change note committed on the branch at close (pure); `mayDiffer` comes from the language adapter. */
export function renderChangeNote(state: RunState, at: Date, mayDiffer = MAY_DIFFER, hasReport = false): string {
	const committed = state.steps.filter(step => step.status === 'committed');
	const notDone = state.steps.filter(step => step.status === 'skipped' || step.status === 'refused');
	const discarded = state.steps.filter(step => step.status === 'discarded');
	const pending = state.fixes.slice(state.next);
	const flaky = runFlaky(state);
	const failing = Object.entries(state.baseline).filter(([, [first]]) => first.code !== 0).map(([command]) => command);
	const notes = state.steps.flatMap(step => step.notes ?? []);
	const over = committed.flatMap(step => step.over ?? []);
	const { branch, base } = state.worktree;
	const narrowed = state.steps.some(step => step.status === 'committed' && step.kind === 'split' && state.fixes.some(fix => fix.file === step.file && fix.narrowed));
	const lines = [
		`# AI-ready changes: ${path.basename(state.root)}`, '',
		`${at.toISOString().slice(0, 16).replace('T', ' ')} UTC · branch \`${branch}\` from \`${base.slice(0, 7)}\` · ${state.language}`, '',
		'Each commit moves code into new files or adds tests; none is meant to change what the program does. Every split passed the move check '
		+ '(each moved declaration copied byte for byte, nothing else changed, the same declarations and doc comments in the package), '
		+ 'then the checks of its package, with the same results as before the run. A check that already failed before the run is marked '
		+ '"not a check" on its commit: it proves nothing about that commit.', '',
		'## Commits', '',
		...(committed.length ? committed.flatMap(commitLines) : ['No fix was committed.']), '',
		...(over.length ? [`## ${STILL_OVER_HEADING}`, '', ...stillOverLines(over), ''] : []),
		...(notDone.length ? ['## Skipped or refused', '', ...notDone.map(notDoneLine), ''] : []),
		...(pending.length ? ['## Not run yet', '', ...pending.map(fix => `- \`${fix.file}\` (${fix.kind === 'split' ? 'split' : 'tests'})`), ''] : []),
		...(discarded.length ? ['## Discarded by you', '', ...discarded.map(step => `- \`${step.file}\` (${step.kind === 'split' ? 'split' : 'tests'})`), ''] : []),
		...(state.skippedFiles.length ? ['## Files never split', '', ...neverSplit(state), ''] : []),
		...(flaky.length ? ['## Flaky tests excluded from comparison', '', ...flaky.map(name => `- ${name}`), ''] : []),
		...(failing.length ? ['## Checks that already failed before the run', '',
			'They had to fail the same way after every fix, so they prove less for the files they cover:', '',
			...failing.map(command => `- \`${command}\``), ''] : []),
		'## Left for you', '',
		...notes.map(note => `- ${note}`),
		`- ${mayDiffer}${narrowed ? ` ${TYPES_ONLY}` : ''}`,
		'- Git hooks did not run for these commits. Run your usual checks when you review.',
		...(hasReport ? ['- Bugs and design problems from the health report are suggestions; ask Pair about them.'] : []), '',
		'## How to review', '',
		'```sh',
		`git diff ${base.slice(0, 12)}..${branch}`,
		`git log --stat ${base.slice(0, 12)}..${branch}`,
		`git merge ${branch}        # keep the changes`,
		`git branch -D ${branch}    # or throw them away`,
		'```', '',
		'Nothing was pushed. After merging, run **Analyse** again to refresh the project brain for the changed files.', '',
	];
	return lines.join('\n');
}

/** The health report with this run's summary as its last section, replacing an earlier run's. */
export function reportWithRun(report: string, state: RunState, notePath: string): string {
	const committed = state.steps.filter(step => step.status === 'committed').length;
	const discarded = state.steps.filter(step => step.status === 'discarded').length;
	const others = state.steps.length - committed - discarded;
	const kept = report.split(`\n${RUN_SECTION}`)[0].trimEnd();
	return `${kept}\n\n${RUN_SECTION}\n\n${committed} fix${committed === 1 ? '' : 'es'} committed on \`${state.worktree.branch}\``
		+ `${others ? `, ${others} skipped or refused` : ''}${discarded ? `, ${discarded} discarded by you` : ''}. Details: \`${notePath}\` on that branch.\n`;
}

/** The health report's path in the user's folder. */
export function reportPath(root: string): string {
	return path.join(root, '.my_editor', 'ai-ready', 'report.md');
}

/** Adds this run's summary to the health report, creating the report and its folder when there is none. False when it cannot be written. */
export function writeRunReport(root: string, state: RunState, notePath: string): boolean {
	const file = reportPath(root);
	try {
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, reportWithRun(existsSync(file) ? readFileSync(file, 'utf8') : '# AI-ready health report', state, notePath));
		return true;
	} catch { return false; /* The note on the branch is the record. */ }
}
