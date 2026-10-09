import type * as TS from 'typescript';
import type { Span } from './language';
import type { Ts } from './tsLoad';

/** One binding of an import or re-export, with its exact source text. */
export interface TsBinding {
	/** The local name (for a re-export: the exported name). */
	readonly local: string;
	/** `default`, `*`, `=` (for `import x = require()`) or the imported name. */
	readonly imported: string;
	/** Written as a type: in `import type …` or with an inline `type`. */
	readonly typeOnly: boolean;
	readonly text: string;
}

/** Pieces to rebuild an import with fewer bindings: prefix, default, between, braces open/separators/close, namespace, suffix. */
export interface TsImportPieces {
	prefix: string;
	between: string;
	open: string;
	seps: string[];
	close: string;
	suffix: string;
	defaultText?: string;
	namespaceText?: string;
}

/** An import, `import x = require()` or `export … from`, as written. Texts are UTF-16 slices of the statement. */
export interface TsImport {
	readonly kind: 'import' | 'equals' | 'export';
	readonly text: string;
	/** Whole lines, UTF-8. */
	readonly span: Span;
	readonly own: boolean;
	/** The module specifier with its quotes. */
	readonly specifier: string;
	readonly module: string;
	readonly typeOnly: boolean;
	/** Loads the module for its side effects only: no clause, or an empty one (`import {} from`; `import type {}` loads nothing). */
	readonly sideEffect: boolean;
	/** `export * from`. */
	readonly star: boolean;
	readonly bindings: readonly TsBinding[];
	readonly pieces: TsImportPieces;
}

const whole = (text: string): TsImportPieces => ({ prefix: text, between: '', open: '', seps: [], close: '', suffix: '' });

/** An import declaration's facts, or undefined for any other statement. */
export function importOf(ts: Ts, node: TS.Statement, source: TS.SourceFile): Omit<TsImport, 'span' | 'own'> | undefined {
	const start = node.getStart(source);
	const text = node.getText(source);
	const slice = (from: number, to: number) => source.text.slice(from, to);
	if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
		const spec = node.moduleReference.expression;
		return {
			kind: 'equals', text, specifier: spec.getText(source), module: ts.isStringLiteralLike(spec) ? spec.text : '', typeOnly: node.isTypeOnly,
			sideEffect: false, star: false, bindings: [{ local: node.name.text, imported: '=', typeOnly: node.isTypeOnly, text }], pieces: whole(text),
		};
	}
	const spec = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier : undefined;
	if (!spec || !ts.isStringLiteralLike(spec)) { return undefined; }
	const base = { specifier: spec.getText(source), module: spec.text, text };
	if (ts.isExportDeclaration(node)) {
		const named = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : [];
		const bindings = named.map(e => ({
			local: e.name.text, imported: (e.propertyName ?? e.name).getText(source), typeOnly: node.isTypeOnly || e.isTypeOnly, text: e.getText(source),
		}));
		return { ...base, kind: 'export', typeOnly: node.isTypeOnly, sideEffect: false, star: !node.exportClause, bindings, pieces: whole(text) };
	}
	const clause = (node as TS.ImportDeclaration).importClause;
	const named = clause?.namedBindings;
	if (!clause || (!clause.name && named && ts.isNamedImports(named) && !named.elements.length)) {
		const typeOnly = !!clause?.isTypeOnly;
		return { ...base, kind: 'import', typeOnly, sideEffect: !typeOnly, star: false, bindings: [], pieces: whole(text) };
	}
	const bindings: TsBinding[] = [];
	const first = clause.name ?? named!;
	const last = named ?? clause.name!;
	const pieces = { ...whole(''), prefix: slice(start, first.getStart(source)), suffix: slice(last.end, node.end) };
	if (clause.name) {
		bindings.push({ local: clause.name.text, imported: 'default', typeOnly: clause.isTypeOnly, text: clause.name.text });
		pieces.defaultText = clause.name.text;
		if (named) { pieces.between = slice(clause.name.end, named.getStart(source)); }
	}
	if (named && ts.isNamespaceImport(named)) {
		bindings.push({ local: named.name.text, imported: '*', typeOnly: clause.isTypeOnly, text: named.getText(source) });
		pieces.namespaceText = named.getText(source);
	} else if (named) {
		const elements = named.elements;
		pieces.open = elements.length ? slice(named.getStart(source), elements[0].getStart(source)) : slice(named.getStart(source), named.end - 1);
		pieces.close = elements.length ? slice(elements[elements.length - 1].end, named.end) : '}';
		elements.forEach((e, i) => {
			const imported = (e.propertyName ?? e.name).getText(source);
			bindings.push({ local: e.name.text, imported, typeOnly: clause.isTypeOnly || e.isTypeOnly, text: e.getText(source) });
			if (i < elements.length - 1) { pieces.seps.push(slice(e.end, elements[i + 1].getStart(source))); }
		});
	}
	return { ...base, kind: 'import', typeOnly: clause.isTypeOnly, sideEffect: false, star: false, bindings, pieces };
}

/** Rebuilds an import keeping only some local names, from its own text pieces; undefined when none is kept. */
export function keepBindings(imp: TsImport, keep: ReadonlySet<string>): string | undefined {
	const p = imp.pieces;
	if (imp.bindings.every(b => keep.has(b.local))) { return imp.text; }
	if (imp.kind !== 'import' || !imp.bindings.some(b => keep.has(b.local))) { return undefined; }
	const hasDefault = p.defaultText !== undefined;
	const def = hasDefault && keep.has(imp.bindings[0].local);
	const rest = imp.bindings.slice(hasDefault ? 1 : 0);
	let tail = '';
	if (p.namespaceText !== undefined) { tail = keep.has(rest[0].local) ? p.namespaceText : ''; }
	else {
		const kept = rest.map((b, i) => ({ b, i })).filter(({ b }) => keep.has(b.local));
		if (kept.length) { tail = `${p.open}${kept.map(({ b, i }, j) => `${b.text}${j < kept.length - 1 ? p.seps[i] : ''}`).join('')}${p.close}`; }
	}
	return `${p.prefix}${def ? p.defaultText : ''}${def && tail ? p.between : ''}${tail}${p.suffix}`;
}

/** The side-effect import an import becomes when the last value use of every binding moved: `import 'm' with { … };`. */
export function sideEffectText(imp: TsImport): string {
	return `import ${imp.pieces.suffix.replace(/^\s*from\s*/, '')}`;
}
