import type { CommitRecord } from './commitParse';
import type { TreeFile } from './stubs';

const HISTORY_WORDS = /^(commit|commits|history|changed|change|when|what|which|where|why|that|this|file|project|about|introduced)$/;

/** The first word of a history question worth searching commit subjects for, skipping question and Git words. */
export function historySubjectTerm(question: string): string | undefined {
	return (question.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? []).find(word => !HISTORY_WORDS.test(word));
}

/** One commit as a list line; detailed adds its files and the files importing them (`downstream`). */
export function commitLine(commit: CommitRecord, detailed: boolean, downstream: ReadonlySet<string>): string {
	const more = commit.paths.length > 8 ? ` (+${commit.paths.length - 8} more)` : '';
	const files = detailed && commit.paths.length ? `\n  Files: ${commit.paths.slice(0, 8).join(', ')}${more}` : '';
	const affected = detailed && downstream.size ? `\n  Possible downstream: ${[...downstream].slice(0, 8).join(', ')}` : '';
	return `- ${commit.hash} ${commit.date} ${commit.subject}${files}${affected}`;
}

/** The changed paths (10, or 30 when detailed), or `clean`. */
export function workingTreeLine(changed: readonly string[], clean: boolean, detailed: boolean): string {
	const shown = detailed ? 30 : 10;
	const more = changed.length > shown ? ` (+${changed.length - shown} more)` : '';
	return `Working tree: ${clean ? 'clean' : changed.slice(0, shown).join(', ') + more}`;
}

/** What a change to `focus` may reach: its importers and the requirements and section its file plan links. */
export function impactHint(focus: string, importers: readonly string[], plan: TreeFile | undefined): string {
	return `If ${focus} changes: direct importers: ${importers.slice(0, 15).join(', ') || '(none recorded)'}; `
		+ `linked requirements: ${plan?.requirements?.join(', ') || '(none recorded)'}; `
		+ `architecture section: ${plan?.section ? `#${plan.section}` : '(none recorded)'}. `
		+ 'This is a dependency hint, not a prediction of runtime behavior.';
}
