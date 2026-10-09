import { collapse } from './moveCheck';
import type { PyImport, PyLead } from './pyAst';

/** The name an alias binds: `as` name, else the first part for `import a.b`, else the name. */
export function boundName(imp: PyImport, alias: PyImport['aliases'][number]): string {
	return alias.asname ?? (imp.kind === 'import' ? alias.name.split('.')[0] : alias.name);
}

/**
 * An import statement's text with only the aliases that bind `keep`, every piece copied as written. When each alias
 * sits alone on its line (a parenthesized list), dropped aliases lose their lines; otherwise the kept aliases are joined
 * with `, ` between the statement's own text before the first alias and after the last. Undefined when none is kept.
 */
export function filteredImport(source: Buffer, imp: PyImport, keep: ReadonlySet<string>): string | undefined {
	const kept = imp.aliases.filter(a => keep.has(boundName(imp, a)));
	const text = (start: number, end: number) => source.subarray(start, end).toString('utf8');
	if (!kept.length) { return undefined; }
	if (kept.length === imp.aliases.length) { return text(imp.start, imp.end); }
	const first = imp.aliases[0];
	const last = imp.aliases[imp.aliases.length - 1];
	const lineOf = (offset: number) => source.lastIndexOf(10, offset - 1) + 1;
	const own = imp.aliases.every((a, i) => i === 0 || lineOf(a.start) !== lineOf(imp.aliases[i - 1].start)) && lineOf(first.start) !== lineOf(imp.start);
	if (own) {
		const lines = imp.aliases.map(a => {
			const start = lineOf(a.start);
			return { alias: a, start, end: source.indexOf(10, a.end) + 1 };
		});
		return text(imp.start, lines[0].start) + lines.filter(l => kept.includes(l.alias)).map(l => text(l.start, l.end)).join('')
			+ text(lines[lines.length - 1].end, imp.end);
	}
	return text(imp.start, first.start) + kept.map(a => text(a.start, a.end)).join(', ') + text(last.end, imp.end);
}

/** An `if TYPE_CHECKING:` block with its header line and only the import lines that keep a name, each filtered. */
export function filteredTypeCheck(source: Buffer, item: PyLead, keep: ReadonlySet<string>): string | undefined {
	const parts = item.imports.map(imp => {
		const text = filteredImport(source, imp, keep);
		return text === undefined ? undefined : source.subarray(imp.lineStart, imp.start).toString('utf8') + text;
	}).filter((t): t is string => t !== undefined);
	if (!parts.length) { return undefined; }
	return `${source.subarray(item.start, item.imports[0].lineStart).toString('utf8')}${parts.join('\n')}`;
}

/** The text a new file copies from one leading-block item for the names it uses; undefined when it needs none of them. */
export function copiedLead(source: Buffer, item: PyLead, keep: ReadonlySet<string>): string | undefined {
	if (item.kind === 'future' || item.kind === 'compound') { return source.subarray(item.start, item.end).toString('utf8'); }
	if (item.kind === 'typecheck') { return filteredTypeCheck(source, item, keep); }
	if (item.kind === 'import') { return filteredImport(source, item.imports[0], keep); }
	return undefined;
}

/** `from .rows import a as a, b as b`, wrapped one name per line the way black does when it is longer than `lineLength`. */
export function facadeLine(stem: string, names: readonly string[], lineLength: number): string {
	const line = `from .${stem} import ${names.map(n => `${n} as ${n}`).join(', ')}`;
	return line.length <= lineLength ? line : `from .${stem} import (\n${names.map(n => `    ${n} as ${n},\n`).join('')})`;
}

/**
 * The original after the move: its old lines minus the moved spans, blank runs around them collapsed to the longer
 * bordering run (at most two), and the facade lines inserted where the leading block ends (`facadeAt`).
 */
export function rebuildOriginal(source: Buffer, removed: readonly { start: number; end: number }[], facadeAt: number, facade: readonly string[]): Buffer {
	const items: (string | undefined)[] = [];
	let offset = 0;
	const text = source.toString('utf8');
	const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
	for (const line of lines) {
		const start = offset;
		const end = offset + Buffer.byteLength(line);
		offset = end + 1;
		if (start === facadeAt) { items.push(...facade.flatMap(f => f.split('\n'))); }
		items.push(removed.some(span => start >= span.start && end <= span.end) ? undefined : line);
	}
	if (facadeAt >= offset) { items.push(...facade.flatMap(f => f.split('\n'))); }
	const out = collapse(items, 'longest');
	return Buffer.from(out.length ? `${out.join('\n')}\n` : '');
}
