import * as path from 'path';
import type { FileInfo, ParsedFile } from './language';
import { declarationProblems } from './moveCheck';
import type { TsImport } from './tsAst';
import type { TsFileInfo } from './tsRules';

const stem = (name: string) => path.posix.basename(name).replace(/\.[^.]+$/, '');

/** The new file (or the original) a relative specifier names, by stem, among files in the original's folder. */
function target(imp: TsImport, files: readonly string[]): string | undefined {
	if (!/^\.\/[^/]+$/.test(imp.module)) { return undefined; }
	const name = imp.module.slice(2).replace(/\.[cm]?[jt]sx?$/, '');
	return files.find(file => stem(file) === name);
}

/** Names a file exports by its own `export` keyword (`default` for a default export). */
function ownExports(info: TsFileInfo): string[] {
	return info.declarations.filter(d => d.ts.exported).flatMap(d => (d.ts.isDefault ? ['default'] : d.names));
}

function usedNames(info: TsFileInfo, values: boolean): Set<string> {
	return new Set(info.declarations.flatMap(d => (values ? d.ts.valueUses : [...d.ts.valueUses, ...d.ts.typeUses])));
}

/**
 * Move rule 2's import part for TS/JS. The original: every old import declaration is unchanged, lost only specifiers
 * written as types that nothing left uses (never all of them unless it is `import type`) or specifiers whose last value
 * use moved, or became a side-effect import of the same module; after them only the facade, which names only the
 * plan's new files and only what they export. A new file: only filtered copies of the original's imports, imports of
 * sibling new files, and `import type` from the original.
 */
export function tsImportProblems(before: ParsedFile, after: ParsedFile, files: readonly ParsedFile[]): string[] {
	const was = before.info as TsFileInfo;
	const now = after.info as TsFileInfo;
	const news = files.map(f => f.info as TsFileInfo);
	const newNames = news.map(info => info.path);
	const problems: string[] = [];
	const everValue = usedNames(was, true);
	const stayingValue = usedNames(now, true);
	const stayingAny = usedNames(now, false);
	const old = was.facts.imports;
	const current = now.facts.imports;
	let at = 0;
	for (const imp of old) {
		const found = current[at];
		if (found && found.text === imp.text) { at++; continue; }
		if (found && found.specifier === imp.specifier && found.kind === imp.kind && imp.kind === 'import') {
			if (found.sideEffect && !imp.typeOnly && imp.bindings.every(b => !stayingAny.has(b.local) && (b.typeOnly || everValue.has(b.local)))
				&& imp.bindings.some(b => !b.typeOnly)) { at++; continue; }
			const kept = found.bindings.map(b => b.text);
			const dropped = imp.bindings.filter(b => !kept.includes(b.text));
			const allowed = found.typeOnly === imp.typeOnly && kept.every(text => imp.bindings.some(b => b.text === text)) && dropped.every(b =>
				!stayingAny.has(b.local) && (b.typeOnly || (everValue.has(b.local) && found.bindings.some(k => stayingValue.has(k.local)))));
			if (allowed && kept.length) { at++; continue; }
		}
		if (imp.typeOnly && imp.bindings.every(b => !stayingAny.has(b.local))) { continue; }
		problems.push(`Rule 2: the import ${imp.text.trim().split('\n')[0]} changed beyond what the move allows.`);
		if (found && found.specifier === imp.specifier) { at++; }
	}
	for (const imp of current.slice(at)) {
		const file = target(imp, newNames);
		const info = news.find(n => n.path === file);
		if (!info || imp.sideEffect || imp.star || imp.bindings.some(b => b.imported === '*')) {
			problems.push(`Rule 2: ${now.path} gained ${imp.text.trim()}, which is not part of the facade.`);
			continue;
		}
		const exported = ownExports(info);
		const missing = imp.bindings.filter(b => !exported.includes(b.imported));
		if (missing.length) { problems.push(`Rule 2: the facade names ${missing.map(b => b.imported).join(', ')}, which ${info.path} does not export.`); }
	}
	for (const [index, info] of news.entries()) {
		for (const imp of info.facts.imports) {
			const where = `Rule 3: ${info.path}`;
			if (imp.sideEffect) { problems.push(`${where} has the side-effect import ${imp.text.trim()}.`); continue; }
			if (imp.kind === 'export') { problems.push(`${where} re-exports with ${imp.text.trim()}.`); continue; }
			const sibling = target(imp, newNames.filter((_, i) => i !== index));
			if (sibling) {
				const exported = ownExports(news.find(n => n.path === sibling)!);
				if (imp.bindings.some(b => !exported.includes(b.imported))) { problems.push(`${where} imports from ${sibling} a name it does not export.`); }
				continue;
			}
			if (target(imp, [now.path])) {
				const exported = [...ownExports(now), ...now.declarations.flatMap(d => d.ts.listed)];
				if (!imp.bindings.every(b => imp.typeOnly || b.typeOnly) || imp.bindings.some(b => !exported.includes(b.imported))) {
					problems.push(`${where} imports ${imp.text.trim()} from the original, which must be \`import type\` of names it exports.`);
				}
				continue;
			}
			const copy = old.find(o => o.specifier === imp.specifier && o.kind === imp.kind && o.typeOnly === imp.typeOnly && !o.sideEffect
				&& imp.bindings.every(b => o.bindings.some(ob => ob.text === b.text)));
			if (!copy) { problems.push(`${where} imports ${imp.text.trim()}, which is not a filtered copy of an import of the original.`); }
		}
	}
	return problems;
}

/**
 * Move rule 4 and rule 6 for TS/JS: the same declarations (kind with its `export` keyword, names, doc) across the
 * unit; the original's export surface the same (names, meanings, and the declaration each resolves to); each new file
 * exporting only what its spans export by their own keyword; and every identifier binding the same way.
 */
export function tsSameDeclarations(before: readonly FileInfo[], after: readonly FileInfo[]): string[] {
	const was = before as readonly TsFileInfo[];
	const now = after as readonly TsFileInfo[];
	const problems = declarationProblems(before, after);
	const surface = (info: TsFileInfo | undefined) => new Set(info?.surface ?? []);
	const old = surface(was[0]);
	const current = surface(now[0]);
	for (const entry of old) { if (!current.has(entry)) { problems.push(`Rule 4: ${was[0].path} no longer exports ${entry.split('|')[0]} the same way (${entry}).`); } }
	for (const entry of current) { if (!old.has(entry)) { problems.push(`Rule 4: ${was[0].path} now exports ${entry.split('|')[0]} differently (${entry}).`); } }
	for (const info of now.filter(n => !was.some(w => w.path === n.path))) {
		const own = ownExports(info).sort().join(', ');
		const actual = [...surface(info)].map(entry => entry.split('|')[0]).sort().join(', ');
		if (own !== actual) { problems.push(`Rule 4: ${info.path} exports ${actual || 'nothing'}, but its declarations export ${own || 'nothing'}.`); }
	}
	const count = (infos: readonly TsFileInfo[]) => {
		const counts = new Map<string, number>();
		for (const entry of infos.flatMap(info => info.bindings ?? [])) { counts.set(entry, (counts.get(entry) ?? 0) + 1); }
		return counts;
	};
	const a = count(was);
	const b = count(now);
	const changed = [...new Set([...a.keys(), ...b.keys()])].filter(key => (a.get(key) ?? 0) !== (b.get(key) ?? 0));
	if (changed.length) { problems.push(`Rule 6: ${changed.length} identifier binding${changed.length === 1 ? '' : 's'} differ after the move (${changed[0].split('|')[2]}).`); }
	return problems;
}
