import { elidesCode } from '../pair/codeBlock';
import { fencedBlocks } from '../pair/fencedBlocks';
import { MAX_SOURCE_LINES, sourceLines, sourcePolicyError } from '../quality/sourcePolicy';
import { dedent } from './pythonCode';

export interface AiMarker { readonly line: number; readonly instruction: string; readonly indent: string }

/** Invalid model output can be corrected once; source edits and provider failures must not be retried. */
export class SnippetValidationError extends Error {}

export function snippetLineBudget(text: string): number {
	return Math.max(0, MAX_SOURCE_LINES - sourceLines(text));
}

/** A directive occupies its own comment line, so text inside strings never triggers generation. */
export function aiMarker(line: string, index: number): AiMarker | undefined {
	const match = /^(\s*)(?:#|\/\/|--)\s*@?ai\s+(.+?)\s*$/i.exec(line);
	if (!match) { return undefined; }
	if (match[2].startsWith('<') && !match[2].endsWith('>')) { return undefined; }
	const instruction = match[2].replace(/^<([\s\S]*)>$/, '$1').trim();
	return instruction ? { line: index, instruction, indent: match[1] } : undefined;
}

/** A bounded single snippet is inserted below the directive; every other byte of the document is retained. */
export function insertAiSnippet(text: string, marker: AiMarker, reply: string, filePath?: string): string {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(eol);
	const current = aiMarker(lines[marker.line] ?? '', marker.line);
	if (!current || current.instruction !== marker.instruction) { throw new Error('The AI directive changed. Please run it again.'); }
	const blocks = fencedBlocks(reply);
	if (blocks.length !== 1) { throw new SnippetValidationError(`The model returned ${blocks.length} code blocks; expected exactly one complete code block.`); }
	if (!blocks[0].closed) { throw new SnippetValidationError('The model stopped before closing its code block. Return the complete implementation.'); }
	const code = dedent(blocks[0].text).trimEnd();
	if (!code.trim()) { throw new SnippetValidationError('The model returned an empty code block.'); }
	const count = sourceLines(code), budget = snippetLineBudget(text);
	if (count > budget) {
		throw new SnippetValidationError(`The model returned ${count} lines; this file has room for ${budget} more (${MAX_SOURCE_LINES} lines per source file). Return a compact complete implementation without omitting behavior.`);
	}
	if (elidesCode(code)) { throw new SnippetValidationError('The model used an omitted-code placeholder. Return every requested method in full.'); }
	const offset = lines.slice(0, marker.line + 1).join(eol).length;
	const snippet = code.split('\n').map(line => line ? marker.indent + line : '').join(eol);
	const proposed = text.slice(0, offset) + eol + snippet + text.slice(offset);
	const policyError = filePath && sourcePolicyError(filePath, proposed);
	if (policyError) { throw new SnippetValidationError(policyError); }
	return proposed;
}
