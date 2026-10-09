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
			+ 'it needs a real refactor, which this fixer doesn\'t do';
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

/** One bullet per file, for the change note and the commit body. */
export function stillOverLines(over: readonly StillOver[]): string[] {
	return over.map(entry => `- \`${entry.file}\`: ${entry.lines} lines; ${entry.reason}.`);
}

/** The heading both the change note and the commit body use. */
export const STILL_OVER_HEADING = `Still over ${MAX_SOURCE_LINES} lines`;
