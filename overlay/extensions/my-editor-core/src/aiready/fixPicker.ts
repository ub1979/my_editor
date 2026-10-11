import * as path from 'path';
import type { FixChoice } from './fixState';
import type { FileStats, HealthFinding } from './health';

/**
 * The fixes a run can offer, from the deterministic health findings (re-scanned at fix time, never parsed from the
 * report): a split for each long file and tests for each untested one, in the adapter's languages, minus files that
 * are never split. Biggest first.
 */
export function fixChoices(findings: readonly HealthFinding[], stats: readonly FileStats[], extensions: readonly string[],
	skipped: ReadonlyMap<string, string>, narrowed: ReadonlyMap<string, string> = new Map()): FixChoice[] {
	const lines = new Map(stats.map(s => [s.path, s.lines]));
	const choices: FixChoice[] = [];
	for (const finding of findings) {
		const file = finding.file;
		if (!file || !extensions.includes(path.extname(file)) || skipped.has(file)) { continue; }
		if (finding.kind === 'too-long') {
			choices.push({ file, kind: 'split', lines: lines.get(file) ?? 0, ...(narrowed.has(file) ? { narrowed: narrowed.get(file) } : {}) });
		}
		if (finding.kind === 'untested') { choices.push({ file, kind: 'tests', lines: lines.get(file) ?? 0 }); }
	}
	return choices.sort(biggestFirst);
}

/** The picker's order: biggest file first, then by path and kind. */
export function biggestFirst(a: FixChoice, b: FixChoice): number {
	return b.lines - a.lines || a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind);
}

/** A row's words after the line count. */
function rowText(choice: FixChoice): string {
	if (choice.kind === 'refactor') { return `refactor \`${choice.target?.name}\` (${choice.target?.lines} lines) into helpers, then split`; }
	return choice.kind === 'split' ? `split${choice.narrowed ? `: ${choice.narrowed}` : ' into focused files'}` : 'add tests';
}

export interface PickItem {
	readonly label: string;
	readonly description: string;
	readonly picked: boolean;
	/** Why the row is left unticked, shown under it. */
	readonly detail?: string;
	readonly choice: FixChoice;
}

/** Shows a multi-select list; `vscode.window.showQuickPick` with `canPickMany` fits. */
export type ShowPicker = (items: PickItem[], options: { title: string; placeHolder: string }) => PromiseLike<readonly PickItem[] | undefined>;

/**
 * The multi-select list of fixes: every split pre-selected but those in `blocked` (files nothing here can check, with
 * the reason shown under the row), every refactor but those in `blocked` or `unticked` (with that reason), add-tests
 * not. Undefined when the user cancels.
 */
export async function pickFixes(choices: readonly FixChoice[], show: ShowPicker, blocked: ReadonlyMap<string, string> = new Map(),
	unticked: ReadonlyMap<string, string> = new Map()): Promise<FixChoice[] | undefined> {
	const items = choices.map((choice): PickItem => {
		const why = blocked.get(choice.file) ?? (choice.kind === 'refactor' ? unticked.get(choice.file) : undefined);
		return {
			label: choice.file,
			description: `${choice.lines} lines · ${rowText(choice)}`,
			picked: (choice.kind === 'split' || choice.kind === 'refactor') && why === undefined,
			...(why !== undefined ? { detail: why } : {}),
			choice,
		};
	});
	const picked = await show(items, {
		title: 'Fix on a local branch',
		placeHolder: 'Each fix is checked and committed alone',
	});
	return picked?.map(item => item.choice);
}

/** The never-split files for the run state, each with its size so the change note can list only the long ones. */
export function skippedWithLines(skipped: ReadonlyMap<string, string>, stats: readonly FileStats[]): { file: string; reason: string; lines?: number }[] {
	return [...skipped].map(([file, reason]) => ({ file, reason, lines: stats.find(s => s.path === file)?.lines }));
}
