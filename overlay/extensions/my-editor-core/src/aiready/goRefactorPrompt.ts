import { redact } from '../records/redact';
import type { ExtractOutline } from './goExtract';
import type { Prompt } from './language';

/** The most a refactor prompt shows of one function, line numbers included; the dialer's 961-line `main` is about 40 000. */
export const MAX_FUNCTION_CHARS = 120_000;

const SYSTEM = [
	'You plan how to shorten one long Go function by moving runs of its statements into new helper functions.',
	'The host copies the statements byte for byte, passes what they read as parameters, returns what they change, '
		+ 'and refuses what it cannot prove equivalent. You only choose the runs and their names.',
	'Rules:',
	'- A run is whole consecutive statements of one block (the body, a nested block or a case body), given by its first and last line. '
		+ 'Never inside a function literal. Runs do not overlap.',
	'- Each helper takes at most 6 parameters (ctx counts, the receiver does not) and has at most 3 changed variables flowing out. '
		+ 'The outline lists at each statement boundary the variables still needed after it: choose boundaries where few are live.',
	'- Statements marked "refused" stay out of every run.',
	'- The function must end at 400 lines or fewer, and each helper too.',
	'- Names are new, unexported lowerCamelCase verbs (queryPlacementRows, applyLedgerPhase).',
	'Reply with only a JSON array, for example: [{"name":"queryPlacementRows","from":177,"to":295}]',
].join('\n');

/** The prompt for one function: its numbered lines and the outline; a plain message when the function is too long to show. */
export function goRefactorPrompt(file: string, source: string, outline: ExtractOutline): Prompt | string {
	const fn = outline.function;
	// Redacted line by line, so line numbers stay the file's.
	const numbered = source.split('\n').slice(fn.startLine - 1, fn.endLine).map((line, i) => `${fn.startLine + i}\t${redact(line)}`).join('\n');
	if (numbered.length > MAX_FUNCTION_CHARS) {
		return `\`${fn.name}\` is ${numbered.length} characters with line numbers, more than the ${MAX_FUNCTION_CHARS} a refactor prompt shows.`;
	}
	return {
		system: SYSTEM,
		text: `File: ${file}\n`
			+ `Function: ${fn.name}${fn.receiver ? ` (${fn.receiver})` : ''}, lines ${fn.startLine}–${fn.endLine} (${fn.lines} lines); `
			+ 'it must end at 400 lines or fewer.\n'
			+ `Outline:\n${outline.blocks.map(block => JSON.stringify(block)).join('\n')}\n\n`
			+ `Source with line numbers:\n${numbered}`,
	};
}
