import { keepBindings, sideEffectText, TsImport } from './tsImports';
import type { TsDeclaration, TsFileInfo } from './tsRules';

/**
 * The original's import declarations after the move: unchanged, dropped (`import type` with no use left), filtered
 * (specifiers written as types with no use left, or whose last value use moved while another kept one still loads the
 * module), or turned into a side-effect import (the last value use of every specifier moved). Undefined means unchanged.
 * In a types-only file only specifiers written as types may go: dropping any other changes the emitted JavaScript
 * under one of the two readings of imports (elision or `verbatimModuleSyntax`), so that is refused.
 */
export function originalImports(info: TsFileInfo, decls: readonly TsDeclaration[], groupOf: ReadonlyMap<number, number>,
	problems: string[]): Map<TsImport, string | null> {
	const typesOnly = info.context.scope === 'types';
	const staying = decls.filter(d => !groupOf.has(d.id));
	const stayingValue = new Set(staying.flatMap(d => d.ts.valueUses));
	const stayingAny = new Set(staying.flatMap(d => [...d.ts.valueUses, ...d.ts.typeUses]));
	const everValue = new Set(decls.flatMap(d => d.ts.valueUses));
	const out = new Map<TsImport, string | null>();
	for (const imp of info.facts.imports) {
		if (imp.kind === 'export' || imp.sideEffect) { continue; }
		const drop = new Set<string>();
		let valueMoved = false;
		for (const b of imp.bindings) {
			const lostValue = everValue.has(b.local) && !stayingValue.has(b.local);
			if (stayingAny.has(b.local)) {
				if (lostValue && !b.typeOnly) {
					problems.push(`The last value use of ${b.local} (from ${imp.specifier}) moves, but staying code still uses it as a type, `
						+ `so ${imp.specifier} could stop loading in its place.`);
				}
				continue;
			}
			if (b.typeOnly) { drop.add(b.local); continue; }
			if (!lostValue) { continue; }
			if (typesOnly) {
				problems.push(`${b.local} (from ${imp.specifier}) is not written as a type, and a types-only move may drop only imports `
					+ 'written as types, so the emitted JavaScript cannot change; leave the declarations that use it in place.');
				continue;
			}
			drop.add(b.local);
			valueMoved = true;
		}
		if (!drop.size) { continue; }
		const keep = new Set(imp.bindings.filter(b => !drop.has(b.local)).map(b => b.local));
		if (imp.kind === 'equals') { problems.push(`${imp.text.trim()} would lose its last use; it is never rewritten.`); continue; }
		if (!keep.size) {
			if (imp.typeOnly) { out.set(imp, null); }
			else if (valueMoved) { out.set(imp, sideEffectText(imp)); }
			continue;
		}
		if (valueMoved && ![...keep].some(name => stayingValue.has(name))) {
			problems.push(`The last value use of ${[...drop].join(', ')} (from ${imp.specifier}) moves, and the names left in that import `
				+ 'might no longer load it; move their users too, or none.');
			continue;
		}
		out.set(imp, keepBindings(imp, keep)!);
	}
	return out;
}

interface Line {
	text: Buffer;
	readonly start: number;
	readonly end: number;
	gap: boolean;
	facade?: boolean;
}

/** The original's old bytes minus the moved spans, with its imports rewritten and the facade after them. */
export function rebuildOriginal(source: Buffer, info: TsFileInfo, moved: ReadonlySet<number>, rewrites: ReadonlyMap<TsImport, string | null>,
	facade: readonly string[]): Buffer {
	let lines = splitLines(source);
	const inside = (line: Line, start: number, end: number) => line.start >= start && line.end <= end;
	for (const d of info.declarations.filter(d => moved.has(d.id))) {
		for (const line of lines) { if (inside(line, d.span.start, d.span.end)) { line.gap = true; } }
	}
	for (const [imp, text] of rewrites) {
		const old = source.subarray(imp.span.start, imp.span.end).toString('utf8');
		const own = lines.filter(line => inside(line, imp.span.start, imp.span.end));
		lines = lines.filter(line => !own.includes(line) || line === own[0]);
		if (text === null) { lines = lines.filter(line => line !== own[0]); continue; }
		// Sliced, never `String.replace`: a replacement string would expand `$$`, `$&` and `$1` in the import's text.
		const at = old.indexOf(imp.text);
		own[0].text = Buffer.from(`${old.slice(0, at)}${text}${old.slice(at + imp.text.length)}`);
	}
	if (facade.length) {
		const imports = info.facts.imports;
		const at = imports.length
			? lines.findIndex(line => line.start > imports[imports.length - 1].span.end)
			: lines.findIndex(line => line.start >= info.facts.bytes(info.facts.facadeAt));
		const added = facade.map(text => ({ text: Buffer.from(text), start: -1, end: -1, gap: false, facade: true }));
		lines.splice(at < 0 ? lines.length : at, 0, ...added);
	}
	const out = collapse(lines);
	const last = out.map(line => line.facade).lastIndexOf(true);
	if (last >= 0 && last + 1 < out.length && out[last + 1].text.toString('utf8').trim() !== '') {
		out.splice(last + 1, 0, { text: Buffer.alloc(0), start: -1, end: -1, gap: false });
	}
	const finalNewline = source.length > 0 && source[source.length - 1] === 10;
	const parts = out.flatMap((line, index) => (index ? [Buffer.from('\n'), line.text] : [line.text]));
	return Buffer.concat([...parts, ...(finalNewline && out.length ? [Buffer.from('\n')] : [])]);
}

/** Each run of blank lines and gaps holding a gap becomes one blank line if it held a blank line, else nothing; at the end, nothing. */
function collapse(lines: readonly Line[]): Line[] {
	const blank = (line: Line) => !line.gap && !line.facade && line.text.toString('utf8').trim() === '';
	const out: Line[] = [];
	for (let i = 0; i < lines.length;) {
		if (!lines[i].gap && !blank(lines[i])) { out.push(lines[i]); i++; continue; }
		let j = i;
		while (j < lines.length && (lines[j].gap || blank(lines[j]))) { j++; }
		const run = lines.slice(i, j);
		if (!run.some(line => line.gap)) { out.push(...run); }
		else if (run.some(blank) && j < lines.length) { out.push({ text: Buffer.alloc(0), start: -1, end: -1, gap: false }); }
		i = j;
	}
	return out;
}

function splitLines(source: Buffer): Line[] {
	const lines: Line[] = [];
	let start = 0;
	for (let i = source.indexOf(10); i >= 0; i = source.indexOf(10, start)) {
		lines.push({ text: source.subarray(start, i), start, end: i, gap: false });
		start = i + 1;
	}
	if (start < source.length) { lines.push({ text: source.subarray(start), start, end: source.length, gap: false }); }
	return lines;
}
