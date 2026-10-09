import * as path from 'path';
import type { NewFile, SplitPlan, SplitResult } from './language';
import type { PyLead } from './pyAst';
import { copiedLead, facadeStatements, moduleOrder, rebuildOriginal, siblingImport } from './pyImports';
import { hookOf, PyDeclaration, PyFileInfo } from './pyRules';

/** The exact first lines of a module split from `file`. */
export function pySplitHeader(file: string): string {
	return `# Split from ${path.posix.basename(file)} by my_editor.\n\n`;
}

const stem = (file: string) => file.replace(/\.py$/, '');

/** `declaration 7 (parse_row)`. */
function named(d: PyDeclaration): string {
	return `declaration ${d.id} (${d.names.join(', ')})`;
}

/** Plan problems from the name rules, the class rules and the patches tracked code makes; empty when the plan may be built. */
export function pyPlanProblems(info: PyFileInfo, plan: SplitPlan, deferred: boolean): { problems: string[]; edges: Map<number, Set<number>> } {
	const byId = new Map(info.declarations.map(d => [d.id, d]));
	const groupOf = new Map(plan.flatMap((group, g) => group.declarations.map(id => [id, g] as const)));
	const owner = new Map<string, PyDeclaration>();
	for (const d of info.declarations) { for (const n of d.names) { if (!owner.has(n)) { owner.set(n, d); } } }
	const problems: string[] = [];
	const edges = new Map(plan.map((_, g) => [g, new Set<number>()]));
	const own = new Set<string>();
	for (const [id, g] of groupOf) {
		const d = byId.get(id)!;
		const early = new Set([...d.py.sameFile, ...(deferred ? [] : d.py.annSameFile), ...d.py.baseNames]);
		for (const name of d.py.reads) {
			const e = owner.get(name);
			if (info.facts.lead.some(item => item.binds.includes(name))) { own.add(name); continue; }
			if (e) { own.add(name); }
			if (!e || e.id === d.id) { continue; }
			const eg = groupOf.get(e.id);
			if (eg === undefined) { problems.push(`${named(d)} uses ${name} (${e.id}), which stays. Move it to the same file or leave both.`); }
			else if (eg !== g && early.has(name)) { problems.push(`${named(d)} reads ${name} (${e.id}) when it is defined, so both must move to the same file.`); }
			else if (eg !== g) { edges.get(g)!.add(eg); }
		}
		for (const base of d.py.baseNames) {
			const hook = owner.get(base) && hookOf(owner.get(base)!.py);
			if (hook) { problems.push(`${named(d)} subclasses ${base}, which defines ${hook}, so defining it runs project code.`); }
		}
	}
	// isort sorts the facade with the relative imports of the same import block (blank lines do not end one; a compound
	// statement does), and the leading block stays byte for byte, so a new module must sort after every one of them.
	const kinds = info.facts.lead.map(item => item.kind);
	const start = Math.max(kinds.lastIndexOf('compound'), kinds.lastIndexOf('typecheck')) + 1;
	const last = info.facts.lead.slice(start).filter((item, i) => !info.facade.includes(start + i) && item.kind === 'import')
		.map(item => item.imports[0]).filter(imp => imp?.kind === 'from' && imp.level === 1 && imp.module).map(imp => imp.module).sort(moduleOrder).pop();
	for (const group of last ? plan : []) {
		if (moduleOrder(stem(group.file), last!) < 0) {
			problems.push(`${group.file}: the facade import .${stem(group.file)} would sort before .${last} in the same isort section; `
				+ `name it to sort after .${last}, e.g. ${last}_${group.file}.`);
		}
	}
	if (cyclic(edges)) { problems.push('Two new files would import each other; group the declarations that use each other in one file.'); }
	const patches = info.context.patches;
	const module = info.context.module;
	for (const name of [...own].sort()) {
		const where = patches.strings.get(name) ?? patches.named.get(name) ?? patches.assigned.get(name);
		if (where) { problems.push(`${where} patches ${module}.${name}, which moved code reads; the patch would no longer reach it.`); }
	}
	if (groupOf.size && (patches.prefix || patches.objectUse)) {
		problems.push(`${patches.prefix ?? patches.objectUse} patches ${module} by a computed name or object, which may stop reaching moved code.`);
	}
	return { problems, edges };
}

function cyclic(edges: ReadonlyMap<number, ReadonlySet<number>>): boolean {
	const state = new Map<number, number>();
	const visit = (n: number): boolean => {
		if (state.get(n) === 1) { return true; }
		if (state.get(n) === 2) { return false; }
		state.set(n, 1);
		const found = [...(edges.get(n) ?? [])].some(visit);
		state.set(n, 2);
		return found;
	};
	return [...edges.keys()].some(visit);
}

export interface PySplitOptions {
	readonly lineLength: number;
	readonly deferred: boolean;
}

/**
 * New modules and the new original. Each new module: the split header, the original's `__future__` imports, filtered
 * copies of the leading-block statements its spans use (compound ones whole, with the imports their conditions read),
 * imports of sibling new modules, then the moved spans byte for byte, two blank lines apart. Blank lines follow ruff's
 * isort: after `__future__`, between statements the original kept apart (its sections), before the sibling imports, and
 * two before a def or class (else one). The original keeps every byte except the moved spans and gains the facade after
 * its leading block, sorted in with an earlier split's facade. Throws with every problem when the plan breaks a rule. A
 * file that is never split (a test file whose failing tests are dropped) only loses the spans.
 */
export function buildPySplit(source: Buffer, info: PyFileInfo, plan: SplitPlan, options: PySplitOptions): SplitResult {
	const byId = new Map(info.declarations.map(d => [d.id, d]));
	const removed = plan.flatMap(group => group.declarations.map(id => byId.get(id)!.span));
	if (info.skip) { return { original: rebuildOriginal(source, removed, undefined, []), files: [] }; }
	const { problems, edges } = pyPlanProblems(info, plan, options.deferred || info.facts.future);
	if (problems.length) { throw new Error(problems.join(' ')); }
	const lead = info.facts.lead;
	const names = (g: number) => [...plan[g].declarations].sort((a, b) => a - b).flatMap(id => byId.get(id)!.names);
	const files: NewFile[] = plan.map((group, g) => {
		const decls = [...group.declarations].sort((a, b) => a - b).map(id => byId.get(id)!);
		const used = new Set(decls.flatMap(d => d.py.reads));
		for (const item of lead) {
			if (item.kind !== 'import' && item.binds.some(n => used.has(n))) { item.needs.forEach(n => used.add(n)); }
		}
		const kept = lead.map(item => ({ item, text: item.kind === 'future' || item.binds.some(n => used.has(n)) ? copiedLead(source, item, used) : undefined }))
			.filter((k): k is { item: PyLead; text: string } => k.text !== undefined);
		const head = kept.map((k, i) => {
			const prev = kept[i - 1]?.item;
			const apart = prev && (prev.kind === 'future' && k.item.kind !== 'future' || /\n[ \t]*\n/.test(source.subarray(prev.end, k.item.start).toString('utf8')));
			return `${apart ? '\n' : ''}${k.text}`;
		});
		const siblings = [...edges.get(g)!].sort((a, b) => stem(plan[a].file).localeCompare(stem(plan[b].file)))
			.map(eg => siblingImport(stem(plan[eg].file), names(eg).filter(n => used.has(n)), options.lineLength));
		const imports = [...head, ...siblings.map((t, i) => (i === 0 && head.length ? `\n${t}` : t))];
		const body = decls.map(d => source.subarray(d.span.start, d.span.end).toString('utf8')).join('\n\n\n');
		const gap = imports.length ? (/def$|^class$/.test(decls[0].kind) ? '\n\n\n' : '\n\n') : '\n';
		return { name: group.file, text: Buffer.from(`${pySplitHeader(info.path)}${imports.join('\n')}${gap}${body}\n`) };
	});
	const old = info.facade.map(i => lead[i]);
	const entries = old.map(item => ({ module: item.imports[0].module, names: item.imports[0].aliases.map(a => a.name),
		text: source.subarray(item.start, item.end).toString('utf8') }));
	const facade = facadeStatements(entries, plan.map((group, g) => ({ module: stem(group.file), names: names(g) })), options.lineLength);
	const last = lead.filter((_, i) => !info.facade.includes(i)).pop();
	const relative = last?.kind === 'import' && last.imports[0]?.kind === 'from' && last.imports[0].level > 0;
	const place = old.length ? { start: old[0].start, end: old[old.length - 1].end, blankBefore: !relative }
		: { start: info.facts.facadeAt, end: info.facts.facadeAt, blankBefore: !relative };
	return { original: rebuildOriginal(source, removed, place, facade), files };
}
