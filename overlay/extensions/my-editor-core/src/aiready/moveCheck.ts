import type { Declaration, FileInfo, ParsedFile, Span, SplitPlan } from './language';

export interface MoveCheckInput {
	/** The original file before and after the split. */
	readonly before: ParsedFile;
	readonly after: ParsedFile;
	/** The new files, re-parsed from disk, in plan order. */
	readonly files: readonly ParsedFile[];
	readonly plan: SplitPlan;
	/** The exact text each new file has before its package clause (the adapter's `splitHeader`). */
	readonly header: string;
	/** The adapter's own import check (`LanguageAdapter.importProblems`); replaces the generic import-key checks. */
	readonly importProblems?: (before: ParsedFile, after: ParsedFile, files: readonly ParsedFile[]) => string[];
	/** How blank lines around a removed span collapse (`LanguageAdapter.blankLines`); one by default. */
	readonly blankLines?: 'one' | 'longest';
}

const IMPORTS = '\u0000imports';

/**
 * Move rules 1–3, on byte spans and without AI. 1: each moved span is byte-identical to a declaration in exactly the
 * new file the plan names. 2: the original equals its old bytes minus the moved spans, with only import specs removed
 * and blank lines around removed spans collapsed to one (or, with `longest`, to the longer bordering run, at most two).
 * 3: a new file holds only its frame (header comment, package clause, imports) and its moved spans; the bytes before
 * its package clause are exactly the header (no build or `//go:debug` line), and its imports are some of the
 * original's, none blank. Empty means pass.
 */
export function checkMove(input: MoveCheckInput): string[] {
	const problems: string[] = [];
	const { before, after, files, plan } = input;
	const byId = new Map(before.info.declarations.map(d => [d.id, d]));
	if (files.length !== plan.length) { return [`Expected ${plan.length} new files, found ${files.length}.`]; }
	plan.forEach((group, index) => {
		const file = files[index];
		const wanted = group.declarations.map(id => slice(before.text, byId.get(id)!.span)).sort();
		const found = file.info.declarations.map(d => slice(file.text, d.span)).sort();
		if (wanted.length !== found.length || wanted.some((text, i) => text !== found[i])) {
			problems.push(`Rule 1: ${group.file} does not hold exactly its moved declarations, byte for byte.`);
		}
		const rest = remove(file.text, [...file.info.declarations.map(d => d.span), ...file.info.frame]);
		if (rest.trim()) { problems.push(`Rule 3: ${group.file} has extra content: ${JSON.stringify(rest.trim().slice(0, 80))}.`); }
		const prelude = file.info.prelude;
		if (prelude && slice(file.text, prelude) !== input.header) {
			problems.push(`Rule 3: ${group.file} must start with exactly ${JSON.stringify(input.header)} before its package clause.`);
		}
		for (const key of input.importProblems ? [] : file.info.imports) {
			if (key.startsWith('_ ')) { problems.push(`Rule 3: ${group.file} has the blank import ${key}.`); }
			else if (!before.info.imports.includes(key)) { problems.push(`Rule 3: ${group.file} imports ${key}, which the original did not.`); }
		}
	});
	const moved = plan.flatMap(group => group.declarations.map(id => byId.get(id)!.span));
	const expected = afterImports(collapse(marked(before, moved, !!after.info.importRegion), input.blankLines));
	const actual = afterImports(marked(after, [], true).map(item => item ?? ''));
	if (expected.length !== actual.length || expected.some((line, i) => line !== actual[i])) {
		const at = expected.findIndex((line, i) => line !== actual[i]);
		problems.push(`Rule 2: ${before.info.path} changed beyond the moved spans near line ${at + 1}: `
			+ `expected ${JSON.stringify(expected[at] ?? '(end)')}, found ${JSON.stringify(actual[at] ?? '(end)')}.`);
	}
	if (input.importProblems) { problems.push(...input.importProblems(before, after, files)); return [...new Set(problems)]; }
	const count = (keys: readonly string[], key: string) => keys.filter(k => k === key).length;
	for (const key of new Set(after.info.imports)) {
		if (count(after.info.imports, key) > count(before.info.imports, key)) { problems.push(`Rule 2: ${before.info.path} gained the import ${key}.`); }
	}
	return [...new Set(problems)];
}

/** Move rule 4 for adapters whose declarations carry kind, receiver, names and doc: the same multiset before and after. */
export function declarationProblems(before: readonly FileInfo[], after: readonly FileInfo[]): string[] {
	const key = (d: Declaration) => `${d.kind}${d.receiver ? ` (${d.receiver})` : ''} ${d.names.join(', ')}\n${d.docText}`;
	const count = (infos: readonly FileInfo[]) => {
		const counts = new Map<string, number>();
		for (const d of infos.flatMap(info => info.declarations)) { counts.set(key(d), (counts.get(key(d)) ?? 0) + 1); }
		return counts;
	};
	const was = count(before);
	const now = count(after);
	const problems: string[] = [];
	for (const name of new Set([...was.keys(), ...now.keys()])) {
		const a = was.get(name) ?? 0;
		const b = now.get(name) ?? 0;
		if (a !== b) {
			const [title, doc] = name.split('\n');
			problems.push(`Rule 4: ${title}${doc ? ' (with its doc comment)' : ''} appears ${b} time${b === 1 ? '' : 's'} after the move, ${a} before.`);
		}
	}
	return problems;
}

/**
 * The file's lines, with the import region as one marker line and removed spans as gaps (undefined). An empty region
 * marks where imports would go (TS: the facade of a file without imports), before the line it starts.
 */
function marked(file: ParsedFile, removed: readonly Span[], keepImports: boolean): (string | undefined)[] {
	const out: (string | undefined)[] = [];
	const region = file.info.importRegion;
	let offset = 0;
	for (const line of lines(file.text)) {
		const start = offset;
		const end = offset + line.length;
		offset = end + 1;
		if (region && region.start === region.end && start === region.start) { out.push(keepImports ? IMPORTS : undefined); }
		else if (region && start >= region.start && end <= region.end) {
			if (start === region.start) { out.push(keepImports ? IMPORTS : undefined); }
			continue;
		}
		out.push(removed.some(span => start >= span.start && end <= span.end) ? undefined : line.toString('utf8'));
	}
	return out;
}

/** Blank lines right after the import marker are not compared: an added facade may bring or take one. */
function afterImports(items: readonly string[]): string[] {
	const out: string[] = [];
	for (const line of items) {
		if (line.trim() === '' && out[out.length - 1] === IMPORTS) { continue; }
		out.push(line);
	}
	return out;
}

/**
 * Each run of blank lines and gaps that holds a gap becomes one blank line if it held a blank line, else nothing; with
 * `longest`, as many blank lines as its longest unbroken stretch of them, at most two. At the end, nothing.
 */
export function collapse(items: readonly (string | undefined)[], mode: 'one' | 'longest' = 'one'): string[] {
	const out: string[] = [];
	for (let i = 0; i < items.length;) {
		if (items[i] !== undefined && items[i]!.trim() !== '') { out.push(items[i]!); i++; continue; }
		let j = i;
		let gap = false;
		let longest = 0;
		for (let stretch = 0; j < items.length && (items[j] === undefined || items[j]!.trim() === ''); j++) {
			stretch = items[j] === undefined ? 0 : stretch + 1;
			gap ||= items[j] === undefined;
			longest = Math.max(longest, stretch);
		}
		if (!gap) { out.push(...(items.slice(i, j) as string[])); }
		else if (longest && j < items.length) { out.push(...Array<string>(mode === 'longest' ? Math.min(longest, 2) : 1).fill('')); }
		i = j;
	}
	return out;
}

function lines(text: Buffer): Buffer[] {
	const out: Buffer[] = [];
	let start = 0;
	for (let i = text.indexOf(10); i >= 0; i = text.indexOf(10, start)) {
		out.push(text.subarray(start, i));
		start = i + 1;
	}
	if (start < text.length) { out.push(text.subarray(start)); }
	return out;
}

function slice(text: Buffer, span: Span): string {
	return text.subarray(span.start, span.end).toString('utf8');
}

/** The text left after removing the spans. */
function remove(text: Buffer, spans: readonly Span[]): string {
	const sorted = [...spans].sort((a, b) => a.start - b.start);
	const parts: Buffer[] = [];
	let at = 0;
	for (const span of sorted) {
		if (span.start > at) { parts.push(text.subarray(at, span.start)); }
		at = Math.max(at, span.end);
	}
	parts.push(text.subarray(at));
	return Buffer.concat(parts).toString('utf8');
}
