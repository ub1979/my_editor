import { MAX_SOURCE_LINES, sourceLines } from '../quality/sourcePolicy';
import type { Declaration, FileInfo, SplitPlan, SplitResult } from './language';

/** A file a split left over the line limit, with its size and why. */
export interface StillOver {
	readonly file: string;
	readonly lines: number;
	readonly reason: string;
}

/** Why a file over the limit could not get under it, from the declarations left in it. */
function why(declarations: readonly Declaration[]): string {
	const big = declarations.find(d => d.lines > MAX_SOURCE_LINES);
	if (big) {
		return `one declaration (\`${big.names.join(', ') || big.kind}\`, ${big.lines} lines) is longer than the limit; `
			+ 'it needs a real refactor, which a split can\'t do';
	}
	const stuck = declarations.find(d => !d.movable && d.reason);
	return stuck ? `the rest may not move (${stuck.reason})` : 'nothing more in it could move out';
}

/** Every file of a split still over the limit; `paths` are the new files' repository paths, in the result's order. */
export function stillOver(result: SplitResult, info: FileInfo, plan: SplitPlan, paths: readonly string[]): StillOver[] {
	const moved = new Set(plan.flatMap(group => group.declarations));
	const byId = new Map(info.declarations.map(d => [d.id, d]));
	const files = [
		{ file: info.path, text: result.original, declarations: info.declarations.filter(d => !moved.has(d.id)) },
		...result.files.map((file, index) => ({ file: paths[index], text: file.text, declarations: plan[index].declarations.map(id => byId.get(id)!) })),
	];
	return files.map(({ file, text, declarations }) => ({ file, lines: sourceLines(text.toString('utf8')), declarations }))
		.filter(entry => entry.lines > MAX_SOURCE_LINES)
		.map(({ file, lines, declarations }) => ({ file, lines, reason: why(declarations) }));
}

/** The file's declaration with the most lines (the first of equals); undefined when it has none. */
export function largestDeclaration(info: FileInfo): Declaration | undefined {
	return info.declarations.reduce<Declaration | undefined>((most, d) => (!most || d.lines > most.lines ? d : most), undefined);
}

/**
 * A file a split can't help, before any model call. Either its largest declaration fits under the limit only without
 * the file's other lines (package, imports, blank lines), so whichever file a split leaves it in stays over; or it is
 * over the limit by itself and at least as much over it as everything else that could move out (the other movable
 * declarations up to the limit), so moving those out leaves one file over the limit as before. A big declaration with
 * plenty around it splits.
 */
export function needsRefactor(info: FileInfo, lines: number): StillOver | undefined {
	const big = largestDeclaration(info);
	if (lines <= MAX_SOURCE_LINES || !big) { return undefined; }
	const name = () => big.names?.join(', ') || big.kind;
	if (!(big.lines > MAX_SOURCE_LINES)) {
		// The file's own lines: package, imports and comments, not the blank line between two declarations, which moves with them.
		const between = Math.max(0, info.declarations.length - 1);
		const around = Math.max(0, lines - info.declarations.reduce((sum, d) => sum + d.lines, 0) - between);
		if (!(big.lines + around > MAX_SOURCE_LINES)) { return undefined; }
		return { file: info.path, lines, reason: `needs a real refactor: \`${name()}\` is ${big.lines} lines, too long for a file with its ${around} other lines` };
	}
	const rest = info.declarations.filter(d => d !== big && d.movable && d.lines <= MAX_SOURCE_LINES).reduce((sum, d) => sum + d.lines, 0);
	if (big.lines - MAX_SOURCE_LINES < rest) { return undefined; }
	return { file: info.path, lines, reason: `needs a real refactor: \`${name()}\` is ${big.lines} lines by itself` };
}

/** One bullet per file, for the change note and the commit body. */
export function stillOverLines(over: readonly StillOver[]): string[] {
	return over.map(entry => `- \`${entry.file}\`: ${entry.lines} lines; ${entry.reason}.`);
}

/** The heading both the change note and the commit body use. */
export const STILL_OVER_HEADING = `Still over ${MAX_SOURCE_LINES} lines`;
