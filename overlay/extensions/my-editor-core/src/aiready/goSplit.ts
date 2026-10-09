import * as path from 'path';
import type { GoImport } from './goAst';
import { GoFileInfo, importKey } from './goRules';
import type { Declaration, SplitPlan, SplitResult } from './language';

interface Line {
	readonly text: Buffer;
	readonly start: number;
	readonly end: number;
	/** A gap is a removed line; blank lines around gaps collapse. */
	gap: boolean;
}

/**
 * Applies a Go split plan, without AI. Each new file is a header comment naming the original, a blank line, the
 * package clause, an import block with exactly the imports its declarations use, then the moved spans byte for byte
 * in their original order, one blank line apart. The original keeps everything else byte for byte, minus the moved
 * spans and the import specs nothing left in it uses; blank lines around a removed span collapse to one.
 */
export function buildGoSplit(source: Buffer, info: GoFileInfo, plan: SplitPlan): SplitResult {
	if (info.go.imports.some(spec => spec.dot)) { throw new Error(`${info.path} has a dot import and is not split.`); }
	// The original compiled, so every non-blank import has a user; none found means a guessed package name was wrong.
	const unused = info.go.imports.find(spec => !spec.blank && !info.declarations.some(d => d.uses.includes(importKey(spec))));
	if (unused) { throw new Error(`No declaration uses the import ${importKey(unused)}, so its package name is unknown and the file is not split.`); }
	const byId = new Map(info.declarations.map(d => [d.id, d]));
	const moved = new Set(plan.flatMap(group => group.declarations));
	const files = plan.map(group => ({
		name: group.file,
		text: newFile(source, info, group.declarations.map(id => byId.get(id)!).sort((a, b) => a.id - b.id)),
	}));
	const used = new Set(info.declarations.filter(d => !moved.has(d.id)).flatMap(d => d.uses));
	return { original: rebuildOriginal(source, info, moved, used), files };
}

/** The exact start of a new file: a comment naming the original, then a blank line so it is not package documentation. */
export function goSplitHeader(file: string): string {
	return `// Split from ${path.posix.basename(file)} by my_editor.\n\n`;
}

function newFile(source: Buffer, info: GoFileInfo, declarations: readonly Declaration[]): Buffer {
	const used = new Set(declarations.flatMap(d => d.uses));
	const specs = info.go.imports.filter(spec => !spec.blank && used.has(importKey(spec)));
	const lines: string[] = [];
	specs.forEach((spec, index) => {
		if (index > 0 && spec.run !== specs[index - 1].run) { lines.push(''); }
		lines.push(`\t${spec.name ? `${spec.name} ` : ''}${JSON.stringify(spec.path)}`);
	});
	const head = `${goSplitHeader(info.path)}package ${info.go.package}\n\n`
		+ (lines.length ? `import (\n${lines.join('\n')}\n)\n\n` : '');
	const spans = declarations.flatMap((d, index) => [...(index ? [Buffer.from('\n\n')] : []), source.subarray(d.span.start, d.span.end)]);
	return Buffer.concat([Buffer.from(head), ...spans, Buffer.from('\n')]);
}

function rebuildOriginal(source: Buffer, info: GoFileInfo, moved: ReadonlySet<number>, used: ReadonlySet<string>): Buffer {
	let lines = splitLines(source);
	const inside = (line: Line, start: number, end: number) => line.start >= start && line.end <= end;
	for (const d of info.declarations.filter(d => moved.has(d.id))) {
		for (const line of lines) { if (inside(line, d.span.start, d.span.end)) { line.gap = true; } }
	}
	const keep = (spec: GoImport) => spec.blank || used.has(importKey(spec));
	info.go.importDecls.forEach(([start, end], index) => {
		const specs = info.go.imports.filter(spec => spec.decl === index);
		if (!specs.some(keep)) {
			for (const line of lines) { if (inside(line, start, end)) { line.gap = true; } }
			return;
		}
		const dropped = specs.filter(spec => !keep(spec));
		if (!dropped.length) { return; }
		const shared = dropped.find(spec => !spec.own);
		if (shared) { throw new Error(`The import ${shared.path} in ${info.path} shares a line with other code.`); }
		const block = lines.filter(line => inside(line, start, end) && !dropped.some(spec => inside(line, spec.start, spec.end)));
		lines = [...lines.filter(line => line.end < start), ...tidyImportBlock(block), ...lines.filter(line => line.start > end)];
	});
	return joinLines(collapse(lines), source.length > 0 && source[source.length - 1] === 10);
}

/** Inside a parenthesized import block: no blank line after `(` or before `)`, and no two blank lines in a row. */
function tidyImportBlock(block: Line[]): Line[] {
	const blank = (line: Line) => line.text.toString('utf8').trim() === '';
	const out: Line[] = [];
	for (const line of block) {
		const previous = out[out.length - 1];
		if (blank(line) && (!previous || blank(previous) || previous.text.toString('utf8').trimEnd().endsWith('('))) { continue; }
		if (line.text.toString('utf8').trim().startsWith(')') && previous && blank(previous)) { out.pop(); }
		out.push(line);
	}
	return out;
}

/**
 * Each run of blank lines and gaps holding a gap becomes one blank line if it held a blank line, else nothing; at the
 * end of the file it becomes nothing.
 */
function collapse(lines: readonly Line[]): Buffer[] {
	const blank = (line: Line) => !line.gap && line.text.toString('utf8').trim() === '';
	const out: Buffer[] = [];
	for (let i = 0; i < lines.length;) {
		if (!lines[i].gap && !blank(lines[i])) { out.push(lines[i].text); i++; continue; }
		let j = i;
		while (j < lines.length && (lines[j].gap || blank(lines[j]))) { j++; }
		const run = lines.slice(i, j);
		if (!run.some(line => line.gap)) { out.push(...run.map(line => line.text)); }
		else if (run.some(blank) && j < lines.length) { out.push(Buffer.alloc(0)); }
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

function joinLines(lines: readonly Buffer[], finalNewline: boolean): Buffer {
	const parts = lines.flatMap((line, index) => index ? [Buffer.from('\n'), line] : [line]);
	return Buffer.concat([...parts, ...(finalNewline && lines.length ? [Buffer.from('\n')] : [])]);
}
