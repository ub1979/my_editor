import { elidesCode } from '../pair/codeBlock';
import { dedent } from './pythonCode';

export interface AiMarker { readonly line: number; readonly instruction: string; readonly indent: string }

/** A directive occupies its own comment line, so text inside strings never triggers generation. */
export function aiMarker(line: string, index: number): AiMarker | undefined {
	const match = /^(\s*)(?:#|\/\/|--)\s*@?ai\s+(.+?)\s*$/i.exec(line);
	if (!match) { return undefined; }
	if (match[2].startsWith('<') && !match[2].endsWith('>')) { return undefined; }
	const instruction = match[2].replace(/^<([\s\S]*)>$/, '$1').trim();
	return instruction ? { line: index, instruction, indent: match[1] } : undefined;
}

/** A bounded single snippet is inserted below the directive; every other byte of the document is retained. */
export function insertAiSnippet(text: string, marker: AiMarker, reply: string): string {
	const blocks = [...reply.matchAll(/```[^\n]*\n([\s\S]*?)\n?```/g)];
	if (blocks.length !== 1) { throw new Error('The model must return exactly one complete code block. Please retry.'); }
	const code = dedent(blocks[0][1]).trimEnd();
	if (!code.trim() || code.split('\n').length > 100 || elidesCode(code)) {
		throw new Error('The model returned an empty, incomplete, or oversized snippet. Ask for one small function.');
	}
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(eol);
	const current = aiMarker(lines[marker.line] ?? '', marker.line);
	if (!current || current.instruction !== marker.instruction) { throw new Error('The AI directive changed. Please run it again.'); }
	const offset = lines.slice(0, marker.line + 1).join(eol).length;
	const snippet = code.split('\n').map(line => line ? marker.indent + line : '').join(eol);
	return text.slice(0, offset) + eol + snippet + text.slice(offset);
}
