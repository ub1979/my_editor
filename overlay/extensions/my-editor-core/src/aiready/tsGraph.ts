import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import type * as TS from 'typescript';
import { analysisOptions, holder } from './tsConfig';
import type { Ts } from './tsLoad';
import type { TsProject } from './tsProject';

const CODE = /\.(?:[cm]?[jt]sx?)$/;

/** Source files the module graph covers: tracked TS/JS, not declarations and not in `node_modules`. */
export function graphFiles(tracked: readonly string[]): string[] {
	return tracked.filter(file => CODE.test(file) && !/\.d\.[cm]?ts$/.test(file) && !/(^|\/)node_modules\//.test(file));
}

/** A workspace package's source entry: `src/index.*`, `index.*`, or its `main`/`module` with a source extension. */
function workspaceEntry(project: TsProject, dir: string, files: ReadonlySet<string>): string | undefined {
	const pkg = project.packages.get(dir) as { main?: string; module?: string; source?: string; exports?: unknown } | undefined;
	const dot = (value: unknown): string | undefined => typeof value === 'string' ? value
		: value && typeof value === 'object' ? dot((value as Record<string, unknown>)['.'] ?? (value as Record<string, unknown>).import ?? (value as Record<string, unknown>).default) : undefined;
	const stems = ['src/index', 'index', ...[dot(pkg?.exports), pkg?.source, pkg?.module, pkg?.main].filter((v): v is string => !!v).map(v => v.replace(/^\.\//, '').replace(/\.[cm]?[jt]sx?$/, ''))];
	for (const stem of stems) {
		for (const ext of ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs']) {
			const file = `${dir}/${stem}${ext}`;
			if (files.has(file)) { return file; }
		}
	}
	return undefined;
}

/** Every module a file loads at run time, as written: static imports and re-exports, `require`, `import()` and `jest.requireActual` with a literal. */
export function runtimeSpecifiers(ts: Ts, file: string, text: string): { specifiers: string[]; dynamic: boolean } {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const specifiers: string[] = [];
	let dynamic = false;
	const literal = (node: TS.Node | undefined) => (node && ts.isStringLiteralLike(node) ? node.text : undefined);
	const visit = (node: TS.Node): void => {
		if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) { specifiers.push(literal(node.moduleSpecifier)!); }
		else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) { specifiers.push(literal(node.moduleSpecifier)!); }
		else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && !node.isTypeOnly) {
			specifiers.push(literal(node.moduleReference.expression) ?? '');
		} else if (ts.isCallExpression(node)) {
			const callee = node.expression;
			const named = (ts.isIdentifier(callee) && callee.text === 'require') || callee.kind === ts.SyntaxKind.ImportKeyword
				|| (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && /^(jest|vi)$/.test(callee.expression.text)
					&& /^(requireActual|requireMock|importActual|importMock)$/.test(callee.name.text));
			if (named) {
				const spec = literal(node.arguments[0]);
				if (spec === undefined) { dynamic = true; } else { specifiers.push(spec); }
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return { specifiers: specifiers.filter(Boolean), dynamic };
}

/**
 * Files in an import cycle (static, dynamic or `require`, any depth), plus files that import themselves or load a
 * module by a computed name. Type-only imports are not edges. Workspace package names resolve to their source entry.
 */
export function cyclicFiles(ts: Ts, project: TsProject): Set<string> {
	const files = graphFiles(project.tracked);
	const known = new Set(files);
	const edges = new Map<string, string[]>();
	const cyclic = new Set<string>();
	const entries = new Map([...project.workspaces].map(([name, dir]) => [name, workspaceEntry(project, dir, known)]));
	const cache = new Map<string, TS.ModuleResolutionCache>();
	for (const file of files) {
		const abs = path.join(project.root, file);
		let text = '';
		try { text = readFileSync(abs, 'utf8'); } catch { continue; }
		const { specifiers, dynamic } = runtimeSpecifiers(ts, file, text);
		if (dynamic) { cyclic.add(file); }
		const config = holder(project.configs, file);
		const options = analysisOptions(ts, config?.options);
		const key = config?.path ?? '';
		if (!cache.has(key)) { cache.set(key, ts.createModuleResolutionCache(project.root, name => name, options)); }
		edges.set(file, specifiers.flatMap(spec => {
			const bare = /^[^./]/.test(spec) ? [...entries].find(([name]) => spec === name || spec.startsWith(`${name}/`)) : undefined;
			if (bare && spec === bare[0] && bare[1]) { return [bare[1]]; }
			const resolved = ts.resolveModuleName(spec, abs, options, ts.sys, cache.get(key)).resolvedModule?.resolvedFileName;
			const relative = resolved && existsSync(resolved) ? source(path.relative(project.root, resolved).split(path.sep).join('/'), known) : undefined;
			if (relative && known.has(relative)) { return [relative]; }
			// A workspace import the graph cannot follow could hide a cycle.
			if (bare) { cyclic.add(file); }
			return [];
		}));
	}
	for (const component of components(files, edges)) {
		if (component.length > 1 || edges.get(component[0])?.includes(component[0])) { component.forEach(file => cyclic.add(file)); }
	}
	return cyclic;
}

/** The source a resolved declaration file stands for: `b.d.ts` next to a tracked `b.js` is `b.js`. */
function source(file: string, known: ReadonlySet<string>): string {
	const match = /^(.*)\.d\.([cm]?)ts$/.exec(file);
	if (!match) { return file; }
	return [`.${match[2]}js`, '.jsx', `.${match[2]}ts`, '.tsx'].map(ext => `${match[1]}${ext}`).find(candidate => known.has(candidate)) ?? file;
}

/** Strongly connected components (Tarjan), iterative so deep graphs do not overflow the stack. */
function components(nodes: readonly string[], edges: ReadonlyMap<string, readonly string[]>): string[][] {
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const out: string[][] = [];
	let next = 0;
	for (const start of nodes) {
		if (index.has(start)) { continue; }
		const work: { node: string; i: number }[] = [{ node: start, i: 0 }];
		index.set(start, next); low.set(start, next); next++; stack.push(start); onStack.add(start);
		while (work.length) {
			const frame = work[work.length - 1];
			const targets = edges.get(frame.node) ?? [];
			if (frame.i < targets.length) {
				const to = targets[frame.i++];
				if (!index.has(to)) {
					index.set(to, next); low.set(to, next); next++; stack.push(to); onStack.add(to);
					work.push({ node: to, i: 0 });
				} else if (onStack.has(to)) { low.set(frame.node, Math.min(low.get(frame.node)!, index.get(to)!)); }
				continue;
			}
			work.pop();
			if (work.length) { const parent = work[work.length - 1].node; low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!)); }
			if (low.get(frame.node) === index.get(frame.node)) {
				const component: string[] = [];
				let member: string;
				do { member = stack.pop()!; onStack.delete(member); component.push(member); } while (member !== frame.node);
				out.push(component);
			}
		}
	}
	return out;
}
