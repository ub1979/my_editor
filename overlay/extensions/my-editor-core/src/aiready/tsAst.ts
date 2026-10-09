import * as path from 'path';
import type * as TS from 'typescript';
import { importOf, TsImport } from './tsImports';
import type { Ts } from './tsLoad';
import {
	classPure, definitionReads, enumLiteral, hasDecorators, identifiers, isDeclarationName, isPure, isTypeUse, isWrite, moduleName, Scope, spanProblems,
} from './tsRefs';

export { keepBindings } from './tsImports';
export type { TsBinding, TsImport } from './tsImports';

/** One top-level statement other than an import (overloads grouped), with what the rules need. */
export interface TsDecl {
	readonly kind: string;
	readonly names: string[];
	readonly exported: boolean;
	readonly isDefault: boolean;
	readonly declare: boolean;
	readonly valueMeaning: boolean;
	/** UTF-16 offsets of the span: attached comments to the end of its last line. */
	readonly start: number;
	readonly end: number;
	readonly own: boolean;
	readonly docText: string;
	/** Module-scope names it uses (not its own), as values and only as types. */
	readonly valueUses: string[];
	readonly typeUses: string[];
	/** Module-scope names its definition-time code reads. */
	readonly defReads: string[];
	readonly quiet: boolean;
	/** Its definition-time code runs nothing (for classes, variables and enums). */
	readonly pure: boolean;
	readonly problems: string[];
	readonly decorators: boolean;
	readonly jsx: boolean;
	/** JSDoc `@typedef`, `@callback` or `@import` in it. */
	readonly jsdocTypes: boolean;
	/** Variables: every name is a plain identifier. */
	readonly plainNames: boolean;
	/** Enums: literal members only. */
	readonly literalEnum: boolean;
	/** Names in it that are written to outside their own declaration span. */
	readonly assigned: string[];
	/** For an `export { … }` list: the local names it exports. */
	readonly listed: string[];
}

export interface TsFacts {
	readonly text: string;
	readonly imports: readonly TsImport[];
	readonly decls: readonly TsDecl[];
	/** UTF-16 offset of the line where the facade goes when there are no imports (after the directives). */
	readonly facadeAt: number;
	readonly directives: readonly string[];
	readonly parseErrors: number;
	/** Every import, `import x = require()` and `export … from` comes before the first other statement. */
	readonly importsAtTop: boolean;
	readonly module: boolean;
	readonly exportEquals: boolean;
	/** Top-level `require`, `module.exports` or `exports.x` in a JS file. */
	readonly commonJs: boolean;
	readonly decorators: boolean;
	/** Comments outside declarations' spans that apply to the file, and the first comment. */
	readonly comments: readonly string[];
	readonly firstComment: string;
	/** UTF-16 offset to UTF-8 byte offset. */
	readonly bytes: (offset: number) => number;
}

/** UTF-16 offsets to UTF-8 byte offsets, through one prefix table (a surrogate pair counts 4 bytes at its first unit). */
export function utf8Table(text: string): (offset: number) => number {
	const table = new Uint32Array(text.length + 1);
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		table[i + 1] = table[i] + (c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? 4 : c >= 0xdc00 && c <= 0xdfff ? 0 : 3);
	}
	return offset => table[offset];
}

function scriptKind(ts: Ts, file: string): TS.ScriptKind {
	const ext = path.extname(file);
	return ext === '.tsx' ? ts.ScriptKind.TSX : ext === '.jsx' ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(ext) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/** A program over one file's text only (no resolution, no libraries), for the binder and checker. */
export function fileProgram(ts: Ts, file: string, text: string, options: TS.CompilerOptions):
	{ source: TS.SourceFile; checker: TS.TypeChecker; program: TS.Program } {
	const name = path.resolve('/', file);
	const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
	const host = ts.createCompilerHost(options);
	host.getSourceFile = requested => (path.resolve(requested) === name ? source : undefined);
	host.fileExists = requested => path.resolve(requested) === name;
	host.readFile = requested => (path.resolve(requested) === name ? text : undefined);
	const program = ts.createProgram({ rootNames: [name], options: { ...options, noResolve: true }, host });
	return { source, checker: program.getTypeChecker(), program };
}

function lineStart(text: string, at: number): number {
	return text.lastIndexOf('\n', at - 1) + 1;
}

function lineEnd(text: string, at: number): number {
	const end = text.indexOf('\n', at);
	return end < 0 ? text.length : end;
}

/** A statement's span (attached comments to the end of its last line) and whether it is on lines of its own. */
function statementSpan(ts: Ts, text: string, node: TS.Node, previousEnd: number, source: TS.SourceFile): { start: number; end: number; own: boolean } {
	const token = node.getStart(source);
	const comments = (ts.getLeadingCommentRanges(text, node.pos) ?? []).filter(c => c.pos >= previousEnd
		&& !(previousEnd > 0 && !text.slice(previousEnd, c.pos).includes('\n')));
	let start = token;
	for (let i = comments.length - 1; i >= 0; i--) {
		const comment = comments[i];
		const gap = text.slice(comment.end, start);
		if ((gap.match(/\n/g)?.length ?? 0) > 1 || text.slice(lineStart(text, comment.pos), comment.pos).trim()) { break; }
		start = comment.pos;
	}
	const trailing = ts.getTrailingCommentRanges(text, node.end) ?? [];
	const end = lineEnd(text, node.end);
	const after = trailing.reduce((rest, c) => rest.replace(text.slice(c.pos, c.end), ''), text.slice(node.end, end));
	const own = !text.slice(lineStart(text, start), start).trim() && !after.trim() && trailing.every(c => c.end <= end)
		&& (previousEnd === 0 || text.slice(previousEnd, start).includes('\n') || !text.slice(0, start).trim());
	return { start: lineStart(text, start), end, own };
}

/** Each top-level statement's span (UTF-16): attached comments to the end of its last line. */
export function statementSpans(ts: Ts, source: TS.SourceFile): Map<TS.Node, { start: number; end: number }> {
	const spans = new Map<TS.Node, { start: number; end: number }>();
	let previousEnd = 0;
	for (const node of source.statements) {
		const span = statementSpan(ts, source.text, node, previousEnd, source);
		spans.set(node, { start: span.start, end: span.end });
		previousEnd = node.end;
	}
	return spans;
}

function hasModifier(ts: Ts, node: TS.Node, kind: TS.SyntaxKind): boolean {
	return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(m => m.kind === kind);
}

function bindingNames(ts: Ts, name: TS.BindingName): string[] {
	if (ts.isIdentifier(name)) { return [name.text]; }
	return name.elements.flatMap(e => (ts.isOmittedExpression(e) ? [] : bindingNames(ts, e.name)));
}

function describe(ts: Ts, node: TS.Statement): { kind: string; names: string[]; valueMeaning: boolean; plainNames: boolean } {
	const name = (n: { name?: TS.Node }) => (n.name && ts.isIdentifier(n.name) ? n.name.text : 'default');
	if (ts.isFunctionDeclaration(node)) { return { kind: 'function', names: [name(node)], valueMeaning: true, plainNames: true }; }
	if (ts.isClassDeclaration(node)) { return { kind: 'class', names: [name(node)], valueMeaning: true, plainNames: true }; }
	if (ts.isInterfaceDeclaration(node)) { return { kind: 'interface', names: [node.name.text], valueMeaning: false, plainNames: true }; }
	if (ts.isTypeAliasDeclaration(node)) { return { kind: 'type', names: [node.name.text], valueMeaning: false, plainNames: true }; }
	if (ts.isEnumDeclaration(node)) {
		const kind = hasModifier(ts, node, ts.SyntaxKind.ConstKeyword) ? 'const enum' : 'enum';
		return { kind, names: [node.name.text], valueMeaning: true, plainNames: true };
	}
	if (ts.isVariableStatement(node)) {
		const flags = node.declarationList.flags;
		const kind = flags & ts.NodeFlags.Using ? 'using' : flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : 'var';
		const decls = node.declarationList.declarations;
		return { kind, names: decls.flatMap(d => bindingNames(ts, d.name)), valueMeaning: true, plainNames: decls.every(d => ts.isIdentifier(d.name)) };
	}
	if (ts.isModuleDeclaration(node)) { return { kind: 'namespace', names: [node.name.text], valueMeaning: true, plainNames: true }; }
	if (ts.isExportAssignment(node)) { return { kind: node.isExportEquals ? 'export =' : 'export default', names: [], valueMeaning: true, plainNames: true }; }
	if (ts.isExportDeclaration(node)) { return { kind: 'export list', names: [], valueMeaning: false, plainNames: true }; }
	if (ts.isImportEqualsDeclaration(node)) { return { kind: 'import alias', names: [node.name.text], valueMeaning: true, plainNames: true }; }
	return { kind: 'statement', names: [], valueMeaning: false, plainNames: true };
}

function quiet(scope: Scope, node: TS.Statement, pure: boolean): boolean {
	const { ts } = scope;
	if (hasModifier(ts, node, ts.SyntaxKind.DeclareKeyword) || ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node)
		|| ts.isTypeAliasDeclaration(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isEmptyStatement(node)) { return true; }
	if (ts.isImportEqualsDeclaration(node)) { return ts.isExternalModuleReference(node.moduleReference); }
	// `using` and `await using` call the value's dispose method when the module body ends, so they always run code.
	if (ts.isVariableStatement(node) && node.declarationList.flags & ts.NodeFlags.Using) { return false; }
	if (ts.isClassDeclaration(node) || ts.isVariableStatement(node) || ts.isEnumDeclaration(node)) { return pure; }
	return ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression);
}

/** Everything the TS rules need from one file's text, from a single-file program. */
export function tsFileFacts(ts: Ts, file: string, text: string, options: TS.CompilerOptions): TsFacts {
	const { source, checker, program } = fileProgram(ts, file, text, options);
	const scope: Scope = { ts, checker, source };
	const bytes = utf8Table(text);
	const imports: TsImport[] = [];
	const decls: TsDecl[] = [];
	const directives: string[] = [];
	let previousEnd = 0;
	let firstOther = -1;
	let importsAtTop = true;
	let facadeAt = -1;
	const statements = source.statements;
	for (let i = 0; i < statements.length; i++) {
		const node = statements[i];
		const span = statementSpan(ts, text, node, previousEnd, source);
		const imp = importOf(ts, node, source);
		const directive = ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && firstOther < 0 && !imports.length;
		if (directive) { directives.push((node.expression as TS.StringLiteral).text); previousEnd = node.end; continue; }
		if (facadeAt < 0) { facadeAt = span.start; }
		if (imp) {
			if (firstOther >= 0) { importsAtTop = false; }
			imports.push({ ...imp, span: { start: bytes(lineStart(text, node.getStart(source))), end: bytes(span.end) }, own: span.own });
			previousEnd = node.end;
			continue;
		}
		if (firstOther < 0) { firstOther = i; }
		const group = [node];
		while (ts.isFunctionDeclaration(node) && !(group[group.length - 1] as TS.FunctionDeclaration).body && i + 1 < statements.length
			&& ts.isFunctionDeclaration(statements[i + 1]) && (statements[i + 1] as TS.FunctionDeclaration).name?.text === node.name?.text) {
			group.push(statements[++i]);
		}
		const spans = group.map((member, k) => (k === 0 ? span : statementSpan(ts, text, member, group[k - 1].end, source)));
		const last = group[group.length - 1];
		const info = describe(ts, node);
		const uses = new Map<string, 'value' | 'type'>();
		for (const member of group) {
			for (const id of identifiers(ts, member)) {
				if (isDeclarationName(ts, id) && topLevelName(ts, id)) { continue; }
				const name = moduleName(scope, id);
				if (!name || info.names.includes(name)) { continue; }
				const kind = isTypeUse(ts, id) ? 'type' : 'value';
				if (uses.get(name) !== 'value') { uses.set(name, kind); }
			}
		}
		const pure = ts.isClassDeclaration(node) ? classPure(scope, node)
			: ts.isEnumDeclaration(node) ? enumLiteral(ts, node)
				: ts.isVariableStatement(node) ? info.plainNames && node.declarationList.declarations.every(d => !d.initializer || isPure(scope, d.initializer))
					: false;
		const jsx = group.some(member => containsJsx(ts, member));
		const docText = text.slice(span.start, node.getStart(source)).trim();
		const whole = text.slice(span.start, spans[spans.length - 1].end);
		const exports = ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : [];
		decls.push({
			...info, exported: hasModifier(ts, node, ts.SyntaxKind.ExportKeyword), isDefault: hasModifier(ts, node, ts.SyntaxKind.DefaultKeyword),
			declare: hasModifier(ts, node, ts.SyntaxKind.DeclareKeyword), start: span.start, end: spans[spans.length - 1].end, own: spans.every(s => s.own),
			docText, valueUses: [...uses].filter(([, k]) => k === 'value').map(([n]) => n), typeUses: [...uses].filter(([, k]) => k === 'type').map(([n]) => n),
			defReads: definitionReads(scope, node), quiet: quiet(scope, node, pure), pure, problems: group.flatMap(member => spanProblems(scope, member)),
			decorators: hasDecorators(ts, node), jsx, jsdocTypes: /\.[cm]?jsx?$/.test(file) && /@(typedef|callback|import)\b/.test(whole),
			literalEnum: ts.isEnumDeclaration(node) && enumLiteral(ts, node), assigned: [],
			listed: exports.map(e => (e.propertyName ?? e.name).getText(source)),
		});
		previousEnd = last.end;
	}
	if (facadeAt < 0) { facadeAt = text.length; }
	markAssigned(scope, decls);
	const types = new Set(decls.filter(d => !d.valueMeaning && d.kind !== 'export list' && d.kind !== 'statement').flatMap(d => d.names));
	for (const decl of decls.filter(d => d.kind === 'export list')) {
		(decl.typeUses as string[]).push(...decl.valueUses.filter(name => types.has(name)));
		decl.valueUses.splice(0, decl.valueUses.length, ...decl.valueUses.filter(name => !types.has(name)));
	}
	return {
		text, imports, decls, facadeAt, directives, importsAtTop,
		parseErrors: program.getSyntacticDiagnostics(source).length,
		module: ts.isExternalModule(source), exportEquals: statements.some(s => (ts.isExportAssignment(s) && s.isExportEquals) || ts.isNamespaceExportDeclaration(s)),
		commonJs: /\.[cm]?jsx?$/.test(file) && statements.some(s => commonJsStatement(ts, s)),
		decorators: decls.some(d => d.decorators), comments: fileComments(ts, text, source), firstComment: firstComment(ts, text), bytes,
	};
}

function topLevelName(ts: Ts, id: TS.Identifier): boolean {
	let node: TS.Node = id.parent;
	while (node && (ts.isBindingElement(node) || ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node))) { node = node.parent; }
	if (ts.isVariableDeclaration(node)) { node = node.parent.parent; }
	return !!node?.parent && ts.isSourceFile(node.parent);
}

function containsJsx(ts: Ts, node: TS.Node): boolean {
	if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) { return true; }
	return !!ts.forEachChild(node, child => containsJsx(ts, child) || undefined);
}

function commonJsStatement(ts: Ts, node: TS.Node): boolean {
	let found = false;
	const visit = (at: TS.Node): void => {
		if (found || ts.isFunctionLike(at) || ts.isClassLike(at)) { return; }
		if (ts.isIdentifier(at) && (at.text === 'module' || at.text === 'exports' || at.text === 'require')
			&& !(ts.isPropertyAccessExpression(at.parent) && at.parent.name === at)) { found = true; return; }
		ts.forEachChild(at, visit);
	};
	visit(node);
	return found;
}

/** Records, per declaration, which of its names are written to outside its own span. */
function markAssigned(scope: Scope, decls: TsDecl[]): void {
	const { ts } = scope;
	const writes: { name: string; at: number }[] = [];
	const visit = (node: TS.Node): void => {
		if (ts.isIdentifier(node) && isWrite(ts, node)) {
			const name = moduleName(scope, node);
			if (name) { writes.push({ name, at: node.getStart(scope.source) }); }
		}
		ts.forEachChild(node, visit);
	};
	visit(scope.source);
	for (const decl of decls) {
		(decl.assigned as string[]).push(...new Set(writes.filter(w => decl.names.includes(w.name) && (w.at < decl.start || w.at >= decl.end)).map(w => w.name)));
	}
}

function fileComments(ts: Ts, text: string, source: TS.SourceFile): string[] {
	const out: string[] = [];
	for (const node of [...source.statements, source.endOfFileToken]) {
		for (const c of ts.getLeadingCommentRanges(text, node.pos) ?? []) { out.push(text.slice(c.pos, c.end)); }
	}
	return [...new Set(out)];
}

function firstComment(ts: Ts, text: string): string {
	const c = (ts.getLeadingCommentRanges(text, text.startsWith('#!') ? text.indexOf('\n') + 1 : 0) ?? [])[0];
	return c ? text.slice(c.pos, c.end) : '';
}
