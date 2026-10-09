import * as path from 'path';
import { MAX_SOURCE_LINES } from '../quality/sourcePolicy';
import { flakyTests } from './baseline';
import type { RunState, StepRecord } from './fixState';

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
	return `- \`${short}\` Added tests for \`${step.file}\` in \`${step.testFile}\`${step.dropped?.length ? `; dropped failing tests ${step.dropped.join(', ')}` : ''}.`;
}

/** Skipped files over the limit with their reasons, then one count for the rest (a file with no recorded size is listed). */
function neverSplit(state: RunState): string[] {
	const long = state.skippedFiles.filter(s => s.lines === undefined || s.lines > MAX_SOURCE_LINES);
	const rest = state.skippedFiles.length - long.length;
	return [...long.map(s => `- \`${s.file}\`: ${s.reason}.`), ...(rest ? [`- plus ${rest} file${rest === 1 ? '' : 's'} that need no split`] : [])];
}

/** The change note committed on the branch at close (pure). */
export function renderChangeNote(state: RunState, at: Date): string {
	const committed = state.steps.filter(step => step.status === 'committed');
	const notDone = state.steps.filter(step => step.status === 'skipped' || step.status === 'refused');
	const discarded = state.steps.filter(step => step.status === 'discarded');
	const pending = state.fixes.slice(state.next);
	const flaky = runFlaky(state);
	const failing = Object.entries(state.baseline).filter(([, [first]]) => first.code !== 0).map(([command]) => command);
	const notes = state.steps.flatMap(step => step.notes ?? []);
	const { branch, base } = state.worktree;
	const lines = [
		`# AI-ready changes: ${path.basename(state.root)}`, '',
		`${at.toISOString().slice(0, 16).replace('T', ' ')} UTC · branch \`${branch}\` from \`${base.slice(0, 7)}\` · ${state.language}`, '',
		'Each commit moves code into new files or adds tests; none is meant to change what the program does. Every split passed the move check '
		+ '(each moved declaration copied byte for byte, nothing else changed, the same declarations and doc comments in the package), '
		+ 'then the checks of its package, with the same results as before the run. A check that already failed before the run is marked '
		+ '"not a check" on its commit: it proves nothing about that commit.', '',
		'## Commits', '',
		...(committed.length ? committed.flatMap(step => [stepLine(step), ...(step.checks ? [`  Checks: ${step.checks}`] : []), ...(planText(step) ? [`  ${planText(step)}`] : [])]) : ['No fix was committed.']), '',
		...(notDone.length ? ['## Skipped or refused', '', ...notDone.map(step => `- \`${step.file}\` (${step.kind === 'split' ? 'split' : 'tests'}): ${step.status}. ${step.reason ?? ''} ${planText(step)}`.trimEnd()), ''] : []),
		...(pending.length ? ['## Not run yet', '', ...pending.map(fix => `- \`${fix.file}\` (${fix.kind === 'split' ? 'split' : 'tests'})`), ''] : []),
		...(discarded.length ? ['## Discarded by you', '', ...discarded.map(step => `- \`${step.file}\` (${step.kind === 'split' ? 'split' : 'tests'})`), ''] : []),
		...(state.skippedFiles.length ? ['## Files never split', '', ...neverSplit(state), ''] : []),
		...(flaky.length ? ['## Flaky tests excluded from comparison', '', ...flaky.map(name => `- ${name}`), ''] : []),
		...(failing.length ? ['## Checks that already failed before the run', '',
			'They had to fail the same way after every fix, so they prove less for the files they cover:', '',
			...failing.map(command => `- \`${command}\``), ''] : []),
		'## Left for you', '',
		...notes.map(note => `- ${note}`),
		'- File names and line numbers in panics, `runtime.Caller`, `log.Lshortfile`, `slog` source attributes and package-level closure names '
		+ '(`glob..funcN`) may differ for moved code. The program’s behavior does not.',
		'- Git hooks did not run for these commits. Run your usual checks when you review.',
		'- Bugs and design problems from the health report are suggestions; ask Pair about them.', '',
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
