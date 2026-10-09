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

/** Natural order (`describe2` before `describe10`), as ruff's isort compares names. */
function natural(a: string, b: string): number {
	const x = a.match(/\d+|\D+/g) ?? [];
	const y = b.match(/\d+|\D+/g) ?? [];
	for (let i = 0; i < Math.min(x.length, y.length); i++) {
		if (x[i] === y[i]) { continue; }
		if (/^\d/.test(x[i]) && /^\d/.test(y[i]) && Number(x[i]) !== Number(y[i])) { return Number(x[i]) - Number(y[i]); }
		return x[i] < y[i] ? -1 : 1;
	}
	return x.length - y.length;
}

/** Ruff's isort member order (`order-by-type`): CONSTANTS, then Classes, then the rest, each case-insensitively and naturally. */
export function isortOrder(a: string, b: string): number {
	const type = (n: string) => (n.length > 1 && n === n.toUpperCase() && n !== n.toLowerCase() ? 0 : /^[A-Z]/.test(n) ? 1 : 2);
	return type(a) - type(b) || natural(a.toLowerCase(), b.toLowerCase()) || natural(a, b);
}

/** `from .stem import a, b` (no aliases, so isort keeps it one statement), names sorted, wrapped as black does when too long. */
export function siblingImport(stem: string, names: readonly string[], lineLength: number): string {
	const sorted = [...names].sort(isortOrder);
	const line = `from .${stem} import ${sorted.join(', ')}`;
	return line.length <= lineLength ? line : `from .${stem} import (\n${sorted.map(n => `    ${n},\n`).join('')})`;
}

/** `from .rows import a as a`, wrapped the way black does when it is longer than `lineLength`. */
export function facadeLine(stem: string, names: readonly string[], lineLength: number): string {
	const line = `from .${stem} import ${names.map(n => `${n} as ${n}`).join(', ')}`;
	return line.length <= lineLength ? line : `from .${stem} import (\n${names.map(n => `    ${n} as ${n},\n`).join('')})`;
}

/** One facade statement: its module (the new file's stem), the names it re-exports and its text. */
export interface FacadeEntry {
	readonly module: string;
	readonly names: readonly string[];
	readonly text: string;
}

/**
 * The facade the way ruff's isort writes it: aliased imports are never combined (`combine-as-imports` is off), so one
 * statement per name, sorted by module and then by name. Entries already in the file (an earlier split) keep their text.
 */
export function facadeStatements(entries: readonly FacadeEntry[], fresh: readonly { module: string; names: readonly string[] }[], lineLength: number):
	string[] {
	const all = [...entries, ...fresh.flatMap(f => f.names.map(n => ({ module: f.module, names: [n], text: facadeLine(f.module, [n], lineLength) })))];
	return all.sort((a, b) => natural(a.module.toLowerCase(), b.module.toLowerCase()) || natural(a.module, b.module) || isortOrder(a.names[0], b.names[0]))
		.map(e => e.text);
}

/** Where the facade goes in the original: the old facade's whole lines (or an empty span), and whether a blank line goes before it. */
export interface FacadePlace {
	readonly start: number;
	readonly end: number;
	/** False after a relative import, which isort keeps in the same section as the facade. */
	readonly blankBefore: boolean;
}

const DEFINITION = /^(?:async\s+def|def|class)\b|^@/;

/**
 * The original after the move: its old lines minus the moved spans, blank runs around them collapsed to the longer
 * bordering run (at most two), and the facade lines in place of the old facade (or where the leading block ends). The
 * facade gets a blank line before it (black after a docstring, isort between sections) and, before the next code, two
 * blank lines when that is a def or class and one otherwise (isort's lines after imports; black wants two before a def).
 */
export function rebuildOriginal(source: Buffer, removed: readonly { start: number; end: number }[], place: FacadePlace | undefined,
	facade: readonly string[]): Buffer {
	const MARK = '\u0000facade';
	const items: (string | undefined)[] = [];
	let offset = 0;
	const text = source.toString('utf8');
	const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
	for (const line of lines) {
		const start = offset;
		const end = offset + Buffer.byteLength(line);
		offset = end + 1;
		if (place && start === place.start) { items.push(MARK); }
		if (place && place.end > place.start && start >= place.start && end <= place.end) { continue; }
		items.push(removed.some(span => start >= span.start && end <= span.end) ? undefined : line);
	}
	if (place && place.start >= offset) { items.push(MARK); }
	const out = collapse(items, 'longest');
	const at = out.indexOf(MARK);
	if (at >= 0) {
		let next = at + 1;
		while (next < out.length && out[next].trim() === '') { next++; }
		const code = out.slice(next).find(line => !line.trimStart().startsWith('#'));
		const after = next >= out.length ? [] : Array<string>(code !== undefined && DEFINITION.test(code) ? 2 : 1).fill('');
		const before = place!.blankBefore && at > 0 && out[at - 1].trim() !== '' ? [''] : [];
		out.splice(at, next - at, ...before, ...facade.flatMap(f => f.split('\n')), ...after);
	}
	return Buffer.from(out.length ? `${out.join('\n')}\n` : '');
}
