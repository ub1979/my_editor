import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import type * as TS from 'typescript';
import { statementSpans } from './tsAst';
import type { Ts } from './tsLoad';
import { identifiers, topStatement } from './tsRefs';

/** Same-folder modules a file imports (any import or re-export, type-only too), transitively; the file first. */
export function unitOf(ts: Ts, root: string, file: string, options: TS.CompilerOptions): string[] {
	const dir = path.posix.dirname(file);
	const unit = [file];
	for (let i = 0; i < unit.length; i++) {
		const abs = path.join(root, unit[i]);
		let text = '';
		try { text = readFileSync(abs, 'utf8'); } catch { continue; }
		const source = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, false);
		for (const node of source.statements) {
			const spec = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
				: ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) ? node.moduleReference.expression : undefined;
			if (!spec || !ts.isStringLiteralLike(spec) || !/^\.\.?\//.test(spec.text)) { continue; }
			const resolved = ts.resolveModuleName(spec.text, abs, options, ts.sys).resolvedModule?.resolvedFileName;
			const relative = resolved && existsSync(resolved) ? path.relative(root, resolved).split(path.sep).join('/') : undefined;
			if (relative && path.posix.dirname(relative) === dir && !unit.includes(relative) && !/\.d\.[cm]?ts$/.test(relative)) { unit.push(relative); }
		}
	}
	return unit;
}

/** What rules 4 and 6 compare for one file of a unit: its export surface and where every identifier binds. */
export interface UnitFacts {
	/** `name|meanings|target`, one per export of the module. */
	readonly surface: string[];
	/** `statement|offset|target`, one per identifier outside its import declarations. */
	readonly bindings: string[];
}

function hash(text: string): string {
	return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

/** The alias declaration's module specifier, if it imports or re-exports from a module. */
function specifierOf(ts: Ts, decl: TS.Declaration): TS.Expression | undefined {
	if (ts.isImportSpecifier(decl)) { return decl.parent.parent.parent.moduleSpecifier; }
	if (ts.isImportClause(decl)) { return decl.parent.moduleSpecifier; }
	if (ts.isNamespaceImport(decl)) { return decl.parent.parent.moduleSpecifier; }
	if (ts.isExportSpecifier(decl)) { return decl.parent.parent.moduleSpecifier; }
	if (ts.isNamespaceExport(decl)) { return decl.parent.moduleSpecifier; }
	if (ts.isImportEqualsDeclaration(decl) && ts.isExternalModuleReference(decl.moduleReference)) { return decl.moduleReference.expression; }
	return undefined;
}

function importedName(ts: Ts, decl: TS.Declaration): string {
	if (ts.isImportSpecifier(decl) || ts.isExportSpecifier(decl)) { return (decl.propertyName ?? decl.name).getText(); }
	if (ts.isImportClause(decl)) { return 'default'; }
	return '*';
}

function typeOnlyAlias(ts: Ts, decl: TS.Declaration): boolean {
	if (ts.isImportSpecifier(decl)) { return decl.isTypeOnly || decl.parent.parent.isTypeOnly; }
	if (ts.isExportSpecifier(decl)) { return decl.isTypeOnly || decl.parent.parent.isTypeOnly; }
	if (ts.isImportClause(decl)) { return decl.isTypeOnly; }
	if (ts.isNamespaceImport(decl)) { return decl.parent.isTypeOnly; }
	if (ts.isImportEqualsDeclaration(decl)) { return decl.isTypeOnly; }
	return false;
}

/**
 * Rule 4 and rule 6 facts for one file, from a program over its unit (the file plus the same-folder modules it
 * imports). A binding target is a declaration in the unit (by its statement's bytes and its offset there), an import
 * of a module outside the unit (by specifier and name), or a global. Aliases into the unit are followed, so a name
 * imported from a new file re-traces to the declaration it was before.
 */
export function unitFacts(ts: Ts, root: string, file: string, unit: readonly string[], options: TS.CompilerOptions): UnitFacts {
	const names = new Set(unit.map(f => path.resolve(root, f)));
	const host = ts.createCompilerHost(options);
	const read = host.getSourceFile.bind(host);
	host.getSourceFile = (name, version, onError, create) => (names.has(path.resolve(name)) ? read(name, version, onError, create) : undefined);
	const program = ts.createProgram({ rootNames: [...names], options, host });
	const checker = program.getTypeChecker();
	const spans = new Map<TS.SourceFile, Map<TS.Node, { start: number; end: number }>>();
	const where = (node: TS.Node) => {
		const source = node.getSourceFile();
		if (!spans.has(source)) { spans.set(source, statementSpans(ts, source)); }
		const statement = topStatement(ts, node);
		const span = spans.get(source)!.get(statement)!;
		return { key: hash(source.text.slice(span.start, span.end)), offset: node.getStart(source) - span.start };
	};
	const follow = (start: TS.Symbol): { target: string; typeOnly: boolean; symbol?: TS.Symbol } => {
		let symbol = start;
		let typeOnly = false;
		for (let i = 0; i < 32 && symbol.flags & ts.SymbolFlags.Alias; i++) {
			const decl = symbol.declarations?.[0];
			if (!decl) { break; }
			typeOnly ||= typeOnlyAlias(ts, decl);
			const spec = specifierOf(ts, decl);
			const module = spec && checker.getSymbolAtLocation(spec);
			const into = module?.declarations?.[0]?.getSourceFile();
			if (spec && (!into || !names.has(path.resolve(into.fileName)))) { return { target: `import:${spec.getText()}:${importedName(ts, decl)}`, typeOnly }; }
			const next = checker.getImmediateAliasedSymbol(symbol);
			if (!next || next === symbol) { return { target: `alias:${symbol.name}`, typeOnly }; }
			symbol = next;
		}
		const decl = symbol.declarations?.[0];
		if (!decl) { return { target: `symbol:${symbol.name}`, typeOnly, symbol }; }
		if (ts.isSourceFile(decl)) { return { target: `module:${path.relative(root, decl.fileName)}`, typeOnly, symbol }; }
		if (!names.has(path.resolve(decl.getSourceFile().fileName))) { return { target: `outside:${symbol.name}`, typeOnly, symbol }; }
		const at = where(decl);
		return { target: `at:${at.key}:${at.offset}`, typeOnly, symbol };
	};
	const source = program.getSourceFile(path.resolve(root, file));
	if (!source) { return { surface: [], bindings: [] }; }
	const moduleSymbol = checker.getSymbolAtLocation(source);
	const surface = (moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []).map(symbol => {
		const { target, typeOnly, symbol: final } = follow(symbol);
		const flags = final?.flags ?? 0;
		const meanings = `${flags & ts.SymbolFlags.Value && !typeOnly ? 'v' : ''}${flags & ts.SymbolFlags.Type ? 't' : ''}${flags & ts.SymbolFlags.Namespace ? 'n' : ''}`;
		return `${symbol.name}|${meanings}|${target}`;
	}).sort();
	const bindings: string[] = [];
	for (const statement of source.statements) {
		if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement) || (ts.isExportDeclaration(statement) && statement.moduleSpecifier)) { continue; }
		for (const id of identifiers(ts, statement)) {
			const parent = id.parent;
			const symbol = parent && ts.isShorthandPropertyAssignment(parent) && parent.name === id
				? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(id);
			const at = where(id);
			bindings.push(`${at.key}|${at.offset}|${symbol ? follow(symbol).target : `none:${id.text}`}`);
		}
	}
	return { surface, bindings };
}
