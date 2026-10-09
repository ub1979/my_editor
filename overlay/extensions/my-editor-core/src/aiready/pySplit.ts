import * as path from 'path';
import type { NewFile, SplitPlan, SplitResult } from './language';
import { copiedLead, facadeLine, rebuildOriginal } from './pyImports';
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

/** Plan groups in an order where a file comes after the files it imports. */
function ordered(count: number, edges: ReadonlyMap<number, ReadonlySet<number>>): number[] {
	const out: number[] = [];
	const add = (g: number) => {
		if (out.includes(g)) { return; }
		[...(edges.get(g) ?? [])].sort((a, b) => a - b).forEach(add);
		out.push(g);
	};
	for (let g = 0; g < count; g++) { add(g); }
	return out;
}

export interface PySplitOptions {
	readonly lineLength: number;
	readonly deferred: boolean;
}

/**
 * New modules and the new original. Each new module: the split header, the original's `__future__` imports, filtered
 * copies of the leading-block statements its spans use (compound ones whole, with the imports their conditions read),
 * imports of sibling new modules, then the moved spans byte for byte, two blank lines apart. The original keeps every
 * byte except the moved spans and gains the facade after its leading block. Throws with every problem when the plan
 * breaks a rule. A file that is never split (a test file whose failing tests are dropped) only loses the spans.
 */
export function buildPySplit(source: Buffer, info: PyFileInfo, plan: SplitPlan, options: PySplitOptions): SplitResult {
	const byId = new Map(info.declarations.map(d => [d.id, d]));
	const removed = plan.flatMap(group => group.declarations.map(id => byId.get(id)!.span));
	if (info.skip) { return { original: rebuildOriginal(source, removed, -1, []), files: [] }; }
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
		const imports = lead.map(item => (item.kind === 'future' || item.binds.some(n => used.has(n)) ? copiedLead(source, item, used) : undefined))
			.filter((t): t is string => t !== undefined);
		const siblings = [...edges.get(g)!].sort((a, b) => a - b).map(eg => {
			const wanted = names(eg).filter(n => used.has(n));
			return `from .${stem(plan[eg].file)} import ${wanted.join(', ')}`;
		});
		const head = [...imports, ...siblings];
		const body = decls.map(d => source.subarray(d.span.start, d.span.end).toString('utf8')).join('\n\n\n');
		const header = pySplitHeader(info.path);
		return { name: group.file, text: Buffer.from(`${header}${head.length ? `${head.join('\n')}\n\n\n` : '\n'}${body}\n`) };
	});
	const facade = ordered(plan.length, edges).map(g => facadeLine(stem(plan[g].file), names(g), options.lineLength));
	return { original: rebuildOriginal(source, removed, info.facts.facadeAt, facade), files };
}
