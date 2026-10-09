import * as path from 'path';
import type { SplitPlan, SplitResult } from './language';
import { keepBindings } from './tsImports';
import { originalImports, rebuildOriginal } from './tsOriginal';
import type { TsDeclaration, TsFileInfo } from './tsRules';

/** What the pure split needs from the outside: whether a relative specifier from the original reaches a file in its folder. */
export interface SplitEnv {
	readonly resolves: (specifier: string, fileName: string) => boolean;
}

const JS_SUFFIX: Record<string, string> = { '.ts': '.js', '.tsx': '.js', '.mts': '.mjs', '.cts': '.cjs', '.js': '.js', '.jsx': '.js', '.mjs': '.mjs' };

/** The exact start of a new file: a comment naming the original, then a blank line so it is not attached to anything. */
export function tsSplitHeader(file: string): string {
	return `// Split from ${path.posix.basename(file)} by my_editor.\n\n`;
}

/** The relative specifier for a file in the original's folder, in the original's style (`.js`, `.ts` or none). */
export function specifierFor(info: TsFileInfo, fileName: string, quote: string): string {
	const ext = path.extname(info.path);
	const stem = fileName.slice(0, fileName.length - path.extname(fileName).length);
	const suffix = info.style === 'none' ? '' : info.style === 'ts' ? ext : JS_SUFFIX[ext] ?? ext;
	return `${quote}./${stem}${suffix}${quote}`;
}

function label(d: TsDeclaration): string {
	return `declaration ${d.id} (${d.names.join(', ') || d.kind})`;
}

interface Needs {
	/** Local names of the original's imports. */
	readonly imports: Set<string>;
	/** Per sibling plan index: names and whether any use is a value use. */
	readonly siblings: Map<number, Map<string, boolean>>;
	/** Exported types of the original used only as types. */
	readonly fromOriginal: Set<string>;
}

/**
 * Applies a TS/JS split plan without AI, or throws the reasons it cannot (the model gets them for its one retry). New
 * files: header, filtered copies of the original's imports plus sibling and type imports, then the moved spans byte
 * for byte. The original: its old bytes minus the moved spans, imports changed only as the load-order rules allow,
 * and a facade that re-exports what moved.
 */
export function buildTsSplit(source: Buffer, info: TsFileInfo, plan: SplitPlan, env: SplitEnv): SplitResult {
	const js = /\.[cm]?jsx?$/.test(info.path);
	const decls = info.declarations;
	const groupOf = new Map<number, number>();
	plan.forEach((group, i) => group.declarations.forEach(id => groupOf.set(id, i)));
	const owner = new Map<string, TsDeclaration>();
	for (const d of decls.filter(d => d.ts.kind !== 'export list' && d.ts.kind !== 'statement')) { d.names.forEach(name => owner.set(name, d)); }
	const locals = new Map(info.facts.imports.filter(imp => imp.kind !== 'export').flatMap(imp => imp.bindings.map(b => [b.local, imp] as const)));
	const listed = new Set(decls.flatMap(d => d.ts.listed));
	const problems: string[] = [];
	const needs: Needs[] = plan.map(() => ({ imports: new Set(), siblings: new Map(), fromOriginal: new Set() }));
	for (const d of decls.filter(d => groupOf.has(d.id))) {
		const i = groupOf.get(d.id)!;
		const uses: [string, boolean][] = [...d.ts.valueUses.map(n => [n, true] as [string, boolean]),
			...(js ? [] : d.ts.typeUses.map(n => [n, false] as [string, boolean]))];
		for (const [name, value] of uses) {
			if (locals.has(name)) { needs[i].imports.add(name); continue; }
			const target = owner.get(name);
			if (!target) { continue; }
			const j = groupOf.get(target.id);
			const reads = d.ts.defReads.includes(name);
			if (j === i) {
				if (reads && target.id > d.id) { problems.push(`${label(d)} reads ${name} (${target.id}) when it is defined, so ${name} must come earlier in the file.`); }
			} else if (j !== undefined) {
				if (reads) { problems.push(`${label(d)} reads ${name} (${target.id}) when it is defined; move both to the same file, ${name} first.`); }
				else if (!target.ts.exported) {
					problems.push(`${label(d)} uses ${name} (${target.id}), which is not exported: a helper moves to the same file as every declaration that uses it.`);
				}
				else {
					const names = needs[i].siblings.get(j) ?? new Map<string, boolean>();
					names.set(name, (names.get(name) ?? false) || (value && target.ts.valueMeaning));
					needs[i].siblings.set(j, names);
				}
			} else if (!value && !js && (target.ts.exported || listed.has(name))) {
				needs[i].fromOriginal.add(name);
			} else {
				problems.push(`${label(d)} uses ${name} (${target.id}), which stays. Move it to the same file or leave both.`);
			}
		}
		if (d.ts.jsx && info.context.jsx === 'classic') {
			for (const root of info.jsxRoots) {
				if (locals.has(root)) { needs[i].imports.add(root); }
				else { problems.push(`${label(d)} has JSX, which needs ${root} in scope, but ${info.path} does not import it.`); }
			}
		}
	}
	const facade = plan.map(() => ({ uses: new Map<string, TsDeclaration>() }));
	const staying = decls.filter(d => !groupOf.has(d.id));
	for (const s of staying) {
		for (const name of [...s.ts.valueUses, ...s.ts.typeUses]) {
			const target = owner.get(name);
			const j = target && groupOf.get(target.id);
			if (!target || j === undefined) { continue; }
			if (!target.ts.exported) { problems.push(`${label(s)} stays and uses ${name} (${target.id}), which is not exported; moving it would add an export.`); }
			else if (s.ts.defReads.includes(name) && target.id > s.id) {
				problems.push(`${label(s)} stays and reads ${name} (${target.id}) when it is defined, before ${name} is defined now; it would see it early.`);
			}
			else if (s.ts.kind === 'export list' && !target.ts.valueMeaning) { problems.push(`The export list (${s.id}) names the type ${name}, which may not move.`); }
			else { facade[j].uses.set(name, target); }
		}
	}
	problems.push(...valueCycles(plan, needs));
	const quote = info.facts.imports[0]?.specifier[0] === '"' ? '"' : '\'';
	const semi = info.facts.imports.length && !info.facts.imports[0].text.trimEnd().endsWith(';') ? '' : ';';
	if (!info.style) { problems.push('There is no relative import in the file or its folder to copy the specifier style from.'); }
	else {
		for (const name of [...plan.map(g => g.file), ...(needs.some(n => n.fromOriginal.size) ? [path.posix.basename(info.path)] : [])]) {
			const spec = specifierFor(info, name, quote);
			if (!env.resolves(spec.slice(1, -1), name)) { problems.push(`${spec} would not resolve to ${name}.`); }
		}
	}
	const rewrites = originalImports(info, decls, groupOf, problems);
	if (problems.length) { throw new Error([...new Set(problems)].slice(0, 8).join(' ')); }
	const byId = new Map(decls.map(d => [d.id, d]));
	const ownSpec = specifierFor(info, path.posix.basename(info.path), quote);
	const files = plan.map((group, i) => {
		const lines = [
			...info.facts.imports.filter(imp => imp.kind !== 'export' && !imp.sideEffect && imp.bindings.length).flatMap(imp => {
				const text = keepBindings(imp, needs[i].imports);
				return text === undefined ? [] : [text];
			}),
			...[...needs[i].siblings].sort(([a], [b]) => a - b).flatMap(([j, names]) => importLines(plan[j].file, names, owner, info, quote, semi, js)),
			...(needs[i].fromOriginal.size ? [`import type { ${[...needs[i].fromOriginal].join(', ')} } from ${ownSpec}${semi}`] : []),
		];
		const spans = group.declarations.map(id => byId.get(id)!).sort((a, b) => a.id - b.id).map(d => source.subarray(d.span.start, d.span.end).toString('utf8'));
		return { name: group.file, text: Buffer.from(`${tsSplitHeader(info.path)}${lines.length ? `${lines.join('\n')}\n\n` : ''}${spans.join('\n\n')}\n`) };
	});
	const facadeLines = plan.flatMap((group, j) => facadeFor(group.file, group.declarations.map(id => byId.get(id)!), facade[j].uses, info, quote, semi));
	return { original: rebuildOriginal(source, info, new Set(groupOf.keys()), rewrites, facadeLines), files };
}

/** Value imports between new files must not form a cycle; type-only ones may. */
function valueCycles(plan: SplitPlan, needs: readonly Needs[]): string[] {
	const edges = needs.map(n => [...n.siblings].filter(([, names]) => [...names.values()].some(Boolean)).map(([j]) => j));
	const state = new Array<number>(plan.length).fill(0);
	const visit = (i: number): boolean => {
		state[i] = 1;
		for (const j of edges[i]) { if (state[j] === 1 || (state[j] === 0 && visit(j))) { return true; } }
		state[i] = 2;
		return false;
	};
	if (!plan.some((_, i) => state[i] === 0 && visit(i))) { return []; }
	return ['Two new files would import values from each other (an import cycle); group those declarations together.'];
}

/** A new file's imports from one sibling: values, then types (`import type`); plain JS has value imports only. */
function importLines(file: string, names: ReadonlyMap<string, boolean>, owner: ReadonlyMap<string, TsDeclaration>,
	info: TsFileInfo, quote: string, semi: string, js: boolean): string[] {
	const spec = specifierFor(info, file, quote);
	const values = [...names].filter(([, value]) => value || js).map(([name]) => name);
	const types = [...names].filter(([, value]) => !value && !js).map(([name]) => name);
	return [...bindingLine('import', values, owner, spec, semi), ...bindingLine('import type', types, owner, spec, semi)];
}

/** `import f, { a, b } from spec;` (or `import type`), with a moved default export imported by its own name. */
function bindingLine(keyword: string, names: readonly string[], owner: ReadonlyMap<string, TsDeclaration>, spec: string, semi: string): string[] {
	if (!names.length) { return []; }
	const def = names.find(name => owner.get(name)?.ts.isDefault);
	const named = names.filter(name => name !== def);
	// `import type D, { A }` is an error (TS1363), so a type-only default gets its own line.
	if (def && named.length && keyword === 'import type') {
		return [`${keyword} ${def} from ${spec}${semi}`, `${keyword} { ${named.join(', ')} } from ${spec}${semi}`];
	}
	return [`${keyword} ${def ?? ''}${def && named.length ? ', ' : ''}${named.length ? `{ ${named.join(', ')} }` : ''} from ${spec}${semi}`];
}

/** The facade lines for one new file: imports for staying code, then value and type re-exports of what was exported. */
function facadeFor(file: string, moved: readonly TsDeclaration[], uses: ReadonlyMap<string, TsDeclaration>, info: TsFileInfo, quote: string,
	semi: string): string[] {
	const spec = specifierFor(info, file, quote);
	const owner = new Map(moved.flatMap(d => d.names.map(name => [name, d] as const)));
	const used = [...uses].sort(([, a], [, b]) => a.id - b.id).map(([name]) => name);
	const exported = [...moved].sort((a, b) => a.id - b.id).filter(d => d.ts.exported);
	const exportName = (d: TsDeclaration) => (d.ts.isDefault ? ['default'] : d.names);
	const values = exported.filter(d => d.ts.valueMeaning).flatMap(exportName);
	const types = exported.filter(d => !d.ts.valueMeaning).flatMap(exportName);
	return [
		...bindingLine('import', used.filter(name => owner.get(name)?.ts.valueMeaning), owner, spec, semi),
		...bindingLine('import type', used.filter(name => !owner.get(name)?.ts.valueMeaning), owner, spec, semi),
		...(values.length ? [`export { ${values.join(', ')} } from ${spec}${semi}`] : []),
		...(types.length ? [`export type { ${types.join(', ')} } from ${spec}${semi}`] : []),
	];
}
