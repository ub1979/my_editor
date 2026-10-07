import type { FindingKind, HealthFinding } from './health';

export interface ReviewFile {
	readonly path: string;
	readonly summary?: string;
	/** Redacted source text. */
	readonly text: string;
	/** One-based lines to show first, such as extra class declarations. */
	readonly focusLines: readonly number[];
}

export interface ReviewPart {
	readonly name: string;
	readonly files: readonly ReviewFile[];
	/** Higher parts are reviewed first. */
	readonly priority: number;
}

export interface ReviewLimits {
	readonly maxCalls: number;
	readonly fileChars: number;
	readonly callChars: number;
}

export type LineRange = readonly [number, number];

export interface Excerpt {
	readonly text: string;
	readonly ranges: readonly LineRange[];
}

export interface ReviewResult {
	readonly findings: HealthFinding[];
	readonly reviewed: string[];
	readonly notReviewed: string[];
	readonly partial: boolean;
	/** The last model error, when calls failed. */
	readonly error?: string;
}

export const DEFAULT_LIMITS: ReviewLimits = { maxCalls: 40, fileChars: 6_000, callChars: 40_000 };
const WINDOW = 60;
const MAX_LINE_CHARS = 300;
const MAX_PARSE_ATTEMPTS = 50;
const MAX_ERRORS_IN_A_ROW = 3;
const AI_KINDS = new Set<FindingKind>(['mixed-job', 'design', 'bug', 'poor-code']);

export const REVIEW_SYSTEM = `You review one part of an existing software project so it becomes easier to maintain.
You get file summaries and numbered excerpts. Report only what the excerpts show:
- "mixed-job": a file doing more than one job; put a proposed grouping of its definitions in "grouping".
- "design": tangled responsibilities, duplicated logic, or a design pattern that would clearly simplify the code.
- "bug": a likely bug.
- "poor-code": code that is hard to read or fragile.
Use each file path exactly as given and a line number from its excerpt. Keep "text" to one or two plain sentences.
Reply with only a JSON array of {"file", "line", "kind", "text", "grouping"?} objects, or [] when nothing is worth reporting.`;

/** Lines around the flagged places first, then the file from the top, numbered, within a character budget. */
export function excerpt(text: string, focusLines: readonly number[], maxChars: number): Excerpt {
	const lines = text.split('\n').map(line => line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line);
	const windows: LineRange[] = [...focusLines.map(line => [line, line + WINDOW - 1] as LineRange), [1, lines.length]];
	const chosen = new Set<number>();
	let used = 0;
	fill: for (const [from, to] of windows) {
		for (let line = Math.max(1, from); line <= Math.min(to, lines.length); line++) {
			if (chosen.has(line)) { continue; }
			const cost = lines[line - 1].length + String(line).length + 3;
			if (used + cost > maxChars) { break fill; }
			chosen.add(line);
			used += cost;
		}
	}
	const ranges: [number, number][] = [];
	for (const line of [...chosen].sort((a, b) => a - b)) {
		const last = ranges[ranges.length - 1];
		if (last && last[1] === line - 1) { last[1] = line; } else { ranges.push([line, line]); }
	}
	const body = ranges.map(([from, to]) => lines.slice(from - 1, to).map((line, i) => `${from + i}: ${line}`).join('\n')).join('\n…\n');
	return { text: body, ranges };
}

/** The first span of the reply that parses as a JSON array of objects, trying `[` from the left and `]` from the right. */
function parseArray(reply: string): unknown[] | undefined {
	const text = reply.replace(/```[a-zA-Z]*/g, '');
	const starts: number[] = [];
	const ends: number[] = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '[') { starts.push(i); } else if (text[i] === ']') { ends.unshift(i); }
	}
	let attempts = 0;
	for (const start of starts) {
		for (const end of ends) {
			if (end <= start) { break; }
			if (++attempts > MAX_PARSE_ATTEMPTS) { return undefined; }
			try {
				const value: unknown = JSON.parse(text.slice(start, end + 1));
				if (Array.isArray(value) && value.every(item => item && typeof item === 'object')) { return value; }
			} catch { /* try the next span */ }
		}
	}
	return undefined;
}

/** Findings from a model reply, kept only when they point at a line the model was shown; undefined if unreadable. */
export function parseReview(reply: string, shown: ReadonlyMap<string, readonly LineRange[]>): HealthFinding[] | undefined {
	const raw = parseArray(reply);
	if (!raw) { return undefined; }
	const findings: HealthFinding[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') { continue; }
		const { file, line, kind, text, grouping } = item as Record<string, unknown>;
		const ranges = typeof file === 'string' ? shown.get(file) : undefined;
		if (!ranges || typeof line !== 'number' || !Number.isInteger(line) || !ranges.some(([from, to]) => line >= from && line <= to)) { continue; }
		if (typeof kind !== 'string' || !AI_KINDS.has(kind as FindingKind) || typeof text !== 'string' || !text.trim()) { continue; }
		findings.push({
			kind: kind as FindingKind, file: file as string, line, text: text.trim().slice(0, 400),
			...(typeof grouping === 'string' && grouping.trim() ? { grouping: grouping.trim().slice(0, 400) } : {}),
		});
	}
	return findings;
}

/** One part's request: excerpts of its most flagged files that fit the call budget, and what each excerpt shows. */
function partRequest(part: ReviewPart, limits: ReviewLimits): { text: string; shown: Map<string, readonly LineRange[]> } {
	const shown = new Map<string, readonly LineRange[]>();
	const blocks: string[] = [];
	const skipped: string[] = [];
	let used = 0;
	const files = [...part.files].sort((a, b) => b.focusLines.length - a.focusLines.length || b.text.length - a.text.length);
	for (const file of files) {
		const cut = excerpt(file.text, file.focusLines, Math.min(limits.fileChars, limits.callChars - used));
		if (!cut.ranges.length) { skipped.push(file.path); continue; }
		used += cut.text.length;
		shown.set(file.path, cut.ranges);
		blocks.push(`=== ${file.path} ===${file.summary ? `\nSummary: ${file.summary}` : ''}\n${cut.text}`);
	}
	const text = [`Part: ${part.name}`, ...blocks,
		skipped.length ? `Also in this part (no excerpt; do not report on them): ${skipped.join(', ')}` : '',
		'Reply with only the JSON array.'].filter(Boolean).join('\n\n');
	return { text, shown };
}

/** Reviews parts in priority order within the call limit; an unreadable reply gets one retry. */
export async function reviewParts(parts: readonly ReviewPart[], ask: (system: string, text: string) => Promise<string>,
	limits: ReviewLimits, cancelled: () => boolean): Promise<ReviewResult> {
	const findings: HealthFinding[] = [];
	const reviewed: string[] = [];
	const notReviewed: string[] = [];
	let calls = 0;
	let errorsInARow = 0;
	let error: string | undefined;
	for (const part of [...parts].sort((a, b) => b.priority - a.priority)) {
		const { text, shown } = partRequest(part, limits);
		let found: HealthFinding[] | undefined;
		for (let attempt = 0; attempt < 2 && !found && shown.size && calls < limits.maxCalls && errorsInARow < MAX_ERRORS_IN_A_ROW && !cancelled(); attempt++) {
			calls++;
			let reply = '';
			try {
				reply = await ask(REVIEW_SYSTEM, attempt ? `${text}\n\nYour previous reply was not a valid JSON array. Reply with only the array.` : text);
				errorsInARow = 0;
			} catch (caught) {
				errorsInARow++;
				error = caught instanceof Error ? caught.message : String(caught);
			}
			found = parseReview(reply, shown);
		}
		if (found) { reviewed.push(part.name); findings.push(...found); } else { notReviewed.push(part.name); }
	}
	return { findings, reviewed, notReviewed, partial: cancelled(), ...(error ? { error } : {}) };
}
