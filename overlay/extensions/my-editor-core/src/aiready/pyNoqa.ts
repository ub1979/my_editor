import type { ParsedFile } from './language';
import { boundName } from './pyImports';
import type { PyFileInfo } from './pyRules';

/**
 * What a split appends to an import it leaves unused in the original. The import stays (a module attribute others may
 * read), but ruff and flake8 report it (F401) on the statement's first line, where they also read `# noqa`.
 */
export const NOQA = '  # noqa: F401';

/** Global names the file's own code reads: its top-level statements but `skip` (moved ones), its leading conditions, and the strings in `__all__`. */
export function readNames(info: PyFileInfo, skip: ReadonlySet<number> = new Set()): Set<string> {
	const names = new Set(info.facts.lead.flatMap(item => item.needs));
	for (const d of info.declarations.filter(decl => !skip.has(decl.id))) {
		d.py.reads.forEach(name => names.add(name));
		if (d.names.includes('__all__')) { for (const m of info.spans[d.id].matchAll(/(["'])([A-Za-z_]\w*)\1/g)) { names.add(m[2]); } }
	}
	return names;
}

/**
 * The lines of the original (by where they start in `source`, its text before the split) that gain NOQA when the project
 * lints with ruff or flake8: the first line of each leading-block import (in a `TYPE_CHECKING` block or a fallback too)
 * that binds a name `before` read and `after` no longer reads, even when it binds others still read. Never a facade
 * import, a `__future__` one, a redundant alias (`x as x`, a re-export), a line that already names noqa, one ending in a
 * backslash, or one the suffix would make longer than the line length (black and isort would wrap it).
 */
export function noqaLines(source: Buffer, info: PyFileInfo, before: ReadonlySet<string>, after: ReadonlySet<string>): Map<number, string> {
	const lines = new Map<number, string>();
	const limit = info.context.lintsImports?.lineLength;
	if (limit === undefined) { return lines; }
	info.facts.lead.forEach((item, index) => {
		if (item.kind === 'doc' || item.kind === 'future' || info.facade.includes(index)) { return; }
		for (const imp of item.imports) {
			const names = imp.aliases.filter(a => a.asname !== a.name).map(a => boundName(imp, a));
			if (imp.module === '__future__' || !names.some(name => before.has(name) && !after.has(name))) { continue; }
			const end = source.indexOf(10, imp.lineStart);
			const line = source.subarray(imp.lineStart, end < 0 ? source.length : end).toString('utf8');
			if (!/\\\s*$|#.*\bnoqa\b/i.test(line) && [...line].length + NOQA.length <= limit) { lines.set(imp.lineStart, NOQA); }
		}
	});
	return lines;
}

/** Move rule 2's suffixes for Python: NOQA where the split leaves an import unused, from the original as parsed before and after. */
export function pyLineSuffixes(before: ParsedFile, after: ParsedFile): Map<number, string> {
	const was = before.info as PyFileInfo;
	return noqaLines(before.text, was, readNames(was), readNames(after.info as PyFileInfo));
}

/** `source` from `start` to `end`, each line that starts at a key of `suffixes` with that suffix appended. */
export function suffixed(source: Buffer, start: number, end: number, suffixes: ReadonlyMap<number, string>): string {
	let out = '';
	let at = start;
	for (const key of [...suffixes.keys()].filter(k => k >= start && k < end).sort((a, b) => a - b)) {
		const eol = source.indexOf(10, key);
		const stop = eol < 0 || eol > end ? end : eol;
		out += source.subarray(at, stop).toString('utf8') + suffixes.get(key)!;
		at = stop;
	}
	return out + source.subarray(at, end).toString('utf8');
}
