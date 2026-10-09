import * as path from 'path';
import { FixChoice, MAX_FIXES_PER_RUN } from './fixState';
import type { FileStats, HealthFinding } from './health';

/**
 * The fixes a run can offer, from the deterministic health findings (re-scanned at fix time, never parsed from the
 * report): a split for each long file and tests for each untested one, in the adapter's languages, minus files that
 * are never split. Biggest first.
 */
export function fixChoices(findings: readonly HealthFinding[], stats: readonly FileStats[], extensions: readonly string[],
	skipped: ReadonlyMap<string, string>): FixChoice[] {
	const lines = new Map(stats.map(s => [s.path, s.lines]));
	const choices: FixChoice[] = [];
	for (const finding of findings) {
		const file = finding.file;
		if (!file || !extensions.includes(path.extname(file)) || skipped.has(file)) { continue; }
		if (finding.kind === 'too-long') { choices.push({ file, kind: 'split', lines: lines.get(file) ?? 0 }); }
		if (finding.kind === 'untested') { choices.push({ file, kind: 'tests', lines: lines.get(file) ?? 0 }); }
	}
	return choices.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind));
}

export interface PickItem {
	readonly label: string;
	readonly description: string;
	readonly picked: boolean;
	readonly choice: FixChoice;
}

/** Shows a multi-select list; `vscode.window.showQuickPick` with `canPickMany` fits. */
export type ShowPicker = (items: PickItem[], options: { title: string; placeHolder: string }) => PromiseLike<readonly PickItem[] | undefined>;

/** The multi-select list of fixes: the biggest splits pre-selected (at most one run's worth), add-tests not. Undefined when the user cancels. */
export async function pickFixes(choices: readonly FixChoice[], show: ShowPicker): Promise<FixChoice[] | undefined> {
	let preselected = 0;
	const items = choices.map(choice => ({
		label: choice.file,
		description: `${choice.lines} lines · ${choice.kind === 'split' ? 'split into focused files' : 'add tests'}`,
		picked: choice.kind === 'split' && preselected++ < MAX_FIXES_PER_RUN,
		choice,
	}));
	const picked = await show(items, {
		title: `Fix on a local branch: ${MAX_FIXES_PER_RUN} fixes per run`,
		placeHolder: 'Each fix is checked and committed alone',
	});
	return picked?.map(item => item.choice);
}
