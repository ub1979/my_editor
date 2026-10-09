import { MAX_SOURCE_LINES } from '../quality/sourcePolicy';

/** A file that is never split, with its reason and size. */
export interface NeverSplit {
	readonly file: string;
	readonly reason: string;
	readonly lines?: number;
}

/** Reasons that cover whole kinds of files (tests, nested modules, generated, vendored, build output, declarations). */
const COMMON = /test files are not split|test or test-support file|nested module|generated code|vendored code|build output|declaration file/;

const EXAMPLES = 3;

/** One line for every file with a common reason: the count, up to three examples, and the reason. */
function groupLine(reason: string, files: readonly string[]): string {
	const noun = /test/.test(reason) ? 'test file' : 'file';
	const shown = files.slice(0, EXAMPLES).map(file => `\`${file}\``).join(', ');
	return `- ${files.length} ${noun}${files.length === 1 ? '' : 's'} (${shown}${files.length > EXAMPLES ? ', …' : ''}): ${reason}.`;
}

/**
 * The change note's "Files never split" list: common reasons grouped (most files first), then each long file with a
 * specific reason (a constraint, a directive, CRLF…), then one count for the short ones, which need no split.
 */
export function neverSplitLines(skipped: readonly NeverSplit[]): string[] {
	const groups = new Map<string, string[]>();
	for (const { file, reason } of skipped.filter(s => COMMON.test(s.reason))) { groups.set(reason, [...(groups.get(reason) ?? []), file]); }
	const specific = skipped.filter(s => !COMMON.test(s.reason));
	const long = specific.filter(s => s.lines === undefined || s.lines > MAX_SOURCE_LINES);
	const rest = specific.length - long.length;
	const others = `- plus ${rest} file${rest === 1 ? '' : 's'} under ${MAX_SOURCE_LINES} lines that need${rest === 1 ? 's' : ''} no split. `
		+ 'They have no tests and cannot be given any, so the picker does not offer them.';
	return [
		...[...groups].sort((a, b) => b[1].length - a[1].length).map(([reason, files]) => groupLine(reason, files)),
		...long.map(s => `- \`${s.file}\`: ${s.reason}.`),
		...(rest ? [others] : []),
	];
}
