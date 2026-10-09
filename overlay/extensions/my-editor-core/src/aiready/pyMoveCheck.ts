import { createHash } from 'crypto';
import * as path from 'path';
import type { FileInfo, ParsedFile } from './language';
import { declarationProblems } from './moveCheck';
import type { PyLead } from './pyAst';
import { boundName, copiedLead } from './pyImports';
import type { PyFileInfo } from './pyRules';
import { resolveRelative } from './pyScan';

const stem = (file: string) => path.posix.basename(file).replace(/\.py$/, '');
const firstLine = (text: string) => `\`${text.split('\n')[0].trim()}\``;

/**
 * Move rule 2's import part for Python. The original: its leading block byte-identical, then only the facade, which
 * names exactly the plan's new files and, per file, exactly its moved names, each as `name as name`. A new file: only
 * `__future__` copies, filtered copies of leading-block statements, whole copies of compound ones, and imports of
 * names its sibling new files define.
 */
export function pyImportProblems(before: ParsedFile, after: ParsedFile, files: readonly ParsedFile[]): string[] {
	const was = before.info as PyFileInfo;
	const now = after.info as PyFileInfo;
	const text = (file: ParsedFile, item: PyLead) => file.text.subarray(item.start, item.end).toString('utf8');
	const problems: string[] = [];
	const oldLead = was.facts.lead.filter((_, i) => !was.facade.includes(i)).map(item => text(before, item));
	const kept = now.facts.lead.filter((_, i) => !now.facade.includes(i)).map(item => text(after, item));
	if (kept.length !== oldLead.length || kept.some((t, i) => t !== oldLead[i])) { problems.push(`Rule 2: the leading imports of ${was.path} changed.`); }
	const stems = files.map(f => stem(f.info.path));
	const facade = now.facade.map(i => now.facts.lead[i].imports[0]);
	for (const imp of facade) {
		const index = stems.indexOf(imp.module);
		if (index < 0) { problems.push(`Rule 2: the facade imports .${imp.module}, which is not a new file of this split.`); continue; }
		const moved = files[index].info.declarations.flatMap(d => d.names).sort().join(', ');
		const listed = imp.aliases.map(a => a.name).sort().join(', ');
		if (moved !== listed) { problems.push(`Rule 2: the facade line for ${imp.module}.py names ${listed || 'nothing'}, not exactly its moved names (${moved}).`); }
	}
	if (facade.length !== stems.length || stems.some(s => !facade.some(imp => imp.module === s))) {
		problems.push('Rule 2: the facade does not import every new file exactly once.');
	}
	files.forEach((file, index) => {
		const info = file.info as PyFileInfo;
		for (const item of info.facts.lead) {
			const t = text(file, item);
			const imp = item.imports[0];
			if (item.kind === 'doc') { problems.push(`Rule 3: ${info.path} has a docstring.`); continue; }
			if (item.kind === 'import' && imp.kind === 'from' && imp.level === 1 && stems.includes(imp.module) && stems.indexOf(imp.module) !== index) {
				const other = files[stems.indexOf(imp.module)].info.declarations.flatMap(d => d.names);
				if (imp.aliases.some(a => a.asname || !other.includes(a.name))) {
					problems.push(`Rule 3: ${info.path} imports from ${imp.module}.py a name it does not define.`);
				}
				continue;
			}
			const keep = new Set(item.binds);
			if (!was.facts.lead.some(o => o.kind === item.kind && copiedLead(before.text, o, keep) === t)) {
				problems.push(`Rule 3: ${info.path} has ${firstLine(t)}, which is not a filtered copy of an import of the original.`);
			}
		}
	});
	return problems;
}

const hash = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12);

/** What a global name in a file resolves to: a declaration (by its bytes), an import (absolute module and name), or a builtin. */
function target(infos: readonly PyFileInfo[], info: PyFileInfo, name: string, depth = 0): string {
	const decl = info.declarations.find(d => d.names.includes(name));
	if (decl && info.facts.bindings[name] === 1) { return `decl ${hash(info.spans[decl.id])}`; }
	const item = info.facts.lead.find(l => l.binds.includes(name));
	if (!item) { return name in info.facts.bindings ? `statement ${name}` : `builtin ${name}`; }
	const imp = item.imports.find(i => i.aliases.some(a => boundName(i, a) === name));
	const alias = imp?.aliases.find(a => boundName(imp, a) === name);
	if (!imp || !alias || item.kind === 'compound') {
		const parts = item.imports.map(i => `${resolveRelative(info.context.package, i.level, i.module)}:${i.aliases.map(a => `${a.name}>${a.asname}`)}`);
		return `${item.kind} ${parts.join(';')}`;
	}
	if (imp.kind === 'from' && imp.level === 1 && depth < 5) {
		const sibling = infos.find(i => i.path === path.posix.join(path.posix.dirname(info.path), `${imp.module}.py`));
		if (sibling && sibling !== info && sibling.declarations.some(d => d.names.includes(alias.name))) { return target(infos, sibling, alias.name, depth + 1); }
	}
	return imp.kind === 'from' ? `import ${resolveRelative(info.context.package, imp.level, imp.module)}:${alias.name}`
		: `module ${alias.asname ? alias.name : alias.name.split('.')[0]}`;
}

/** Every (declaration bytes, name read, target) of a unit's files, counted. */
function bindingKeys(infos: readonly PyFileInfo[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const info of infos) {
		for (const d of info.declarations) {
			for (const name of d.py.reads) {
				const key = `${hash(info.spans[d.id])}|${name}|${target(infos, info, name)}`;
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}
	}
	return counts;
}

/**
 * Move rule 4 and rule 6 for Python: the same declarations (kind, names, attached comments and docstring) across the
 * unit; the original binds the same names and keeps `__all__` byte for byte; each new file binds only its moved names
 * and its imports; and every global name read anywhere resolves to the same declaration, import or builtin.
 */
export function pySameDeclarations(before: readonly FileInfo[], after: readonly FileInfo[]): string[] {
	const was = before as readonly PyFileInfo[];
	const now = after as readonly PyFileInfo[];
	const problems = declarationProblems(before, after);
	const original = was[0];
	const current = now.find(info => info.path === original.path);
	if (!current) { return [...problems, `Rule 4: ${original.path} is missing after the move.`]; }
	const names = (info: PyFileInfo) => Object.keys(info.facts.bindings).sort();
	const lost = names(original).filter(n => !names(current).includes(n));
	const gained = names(current).filter(n => !names(original).includes(n));
	if (lost.length || gained.length) { problems.push(`Rule 4: ${original.path} binds different names after the move (${[...lost, ...gained].join(', ')}).`); }
	const all = (info: PyFileInfo) => info.declarations.filter(d => d.names.includes('__all__')).map(d => info.spans[d.id]).join('\n');
	if (all(original) !== all(current)) { problems.push(`Rule 4: __all__ in ${original.path} changed.`); }
	for (const info of now.filter(n => !was.some(w => w.path === n.path))) {
		const allowed = new Set([...info.declarations.flatMap(d => d.names), ...info.facts.lead.flatMap(l => l.binds)]);
		const extra = Object.keys(info.facts.bindings).filter(n => !allowed.has(n));
		if (extra.length) { problems.push(`Rule 4: ${info.path} also binds ${extra.join(', ')}.`); }
	}
	const a = bindingKeys(was);
	const b = bindingKeys(now);
	const changed = [...new Set([...a.keys(), ...b.keys()])].filter(key => (a.get(key) ?? 0) !== (b.get(key) ?? 0));
	if (changed.length) {
		problems.push(`Rule 6: ${changed.length} name binding${changed.length === 1 ? '' : 's'} differ after the move (${changed[0].split('|')[1]}).`);
	}
	return problems;
}
