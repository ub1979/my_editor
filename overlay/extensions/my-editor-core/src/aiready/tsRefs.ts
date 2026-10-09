import type * as TS from 'typescript';
import type { Ts } from './tsLoad';

/** Resolves identifiers to this file's module-scope names (top-level declarations and imports) with the file's checker. */
export interface Scope {
	readonly ts: Ts;
	readonly checker: TS.TypeChecker;
	readonly source: TS.SourceFile;
}

const IMPORT_KINDS = new Set(['ImportSpecifier', 'ImportClause', 'NamespaceImport', 'ImportEqualsDeclaration']);

/** The top-level statement a node is in. */
export function topStatement(ts: Ts, node: TS.Node): TS.Node {
	let at = node;
	while (at.parent && !ts.isSourceFile(at.parent)) { at = at.parent; }
	return at;
}

/** Whether a declaration node is module scope: an import binding or a top-level declaration (variables included). */
function moduleScope(ts: Ts, decl: TS.Declaration): boolean {
	if (IMPORT_KINDS.has(ts.SyntaxKind[decl.kind])) { return true; }
	if (ts.isVariableDeclaration(decl)) { return !!decl.parent?.parent && ts.isVariableStatement(decl.parent.parent) && ts.isSourceFile(decl.parent.parent.parent); }
	if (ts.isBindingElement(decl)) {
		let at: TS.Node = decl;
		while (at && !ts.isVariableDeclaration(at)) { at = at.parent; }
		return !!at && moduleScope(ts, at as TS.VariableDeclaration);
	}
	return !!decl.parent && ts.isSourceFile(decl.parent);
}

/** The module-scope name an identifier refers to, or undefined (a local, a member, a global or nothing). */
export function moduleName(scope: Scope, id: TS.Identifier): string | undefined {
	const { ts, checker } = scope;
	const parent = id.parent;
	const symbol = parent && ts.isShorthandPropertyAssignment(parent) && parent.name === id
		? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(id);
	const decls = symbol?.declarations ?? [];
	return decls.length && decls.every(decl => decl.getSourceFile() === scope.source) && decls.some(decl => moduleScope(ts, decl)) ? id.text : undefined;
}

/** Whether an identifier is the name a declaration declares (not a use). */
export function isDeclarationName(ts: Ts, id: TS.Identifier): boolean {
	const parent = id.parent as TS.Node & { name?: TS.Node };
	if (!parent || parent.name !== id) { return false; }
	return ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)
		|| ts.isEnumDeclaration(parent) || ts.isModuleDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isBindingElement(parent)
		|| ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent)
		|| ts.isParameter(parent) || ts.isEnumMember(parent) || ts.isTypeParameterDeclaration(parent) || ts.isClassExpression(parent) || ts.isFunctionExpression(parent);
}

/** Whether an identifier is used only as a type here: in a type, `implements`, an interface's `extends`, `typeof` in a type, or JSDoc. */
export function isTypeUse(ts: Ts, id: TS.Node): boolean {
	for (let node = id; node.parent && !ts.isSourceFile(node.parent); node = node.parent) {
		const parent = node.parent;
		if (ts.isExpressionWithTypeArguments(parent) && parent.expression === node) { continue; }
		if (ts.isHeritageClause(parent)) { return parent.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(parent.parent); }
		if (ts.isTypeNode(parent) || (parent.kind >= ts.SyntaxKind.FirstJSDocNode && parent.kind <= ts.SyntaxKind.LastJSDocNode)) { return true; }
		if (ts.isExportSpecifier(parent)) { return parent.isTypeOnly || parent.parent.parent.isTypeOnly; }
	}
	return false;
}

/** Every identifier in a node, JSDoc included (for `@type {T}` in JS). */
export function identifiers(ts: Ts, node: TS.Node, into: TS.Identifier[] = []): TS.Identifier[] {
	if (ts.isIdentifier(node)) { into.push(node); }
	for (const doc of (node as { jsDoc?: TS.Node[] }).jsDoc ?? []) { identifiers(ts, doc, into); }
	ts.forEachChild(node, child => { identifiers(ts, child, into); });
	return into;
}

const FUNCTION_LIKE = new Set(['FunctionExpression', 'ArrowFunction', 'MethodDeclaration', 'GetAccessor', 'SetAccessor', 'Constructor', 'FunctionDeclaration']);

/** The expressions that run when a declaration is evaluated: initializers, `extends`, computed names, static fields and blocks, enum values. */
export function definitionTime(ts: Ts, node: TS.Node): TS.Node[] {
	if (ts.isVariableStatement(node)) { return node.declarationList.declarations.flatMap(d => (d.initializer ? [d.initializer] : [])); }
	if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
		const parts: TS.Node[] = [];
		for (const clause of node.heritageClauses ?? []) {
			if (clause.token === ts.SyntaxKind.ExtendsKeyword) { parts.push(...clause.types.map(type => type.expression)); }
		}
		for (const member of node.members) {
			if (member.name && ts.isComputedPropertyName(member.name)) { parts.push(member.name.expression); }
			const isStatic = ts.canHaveModifiers(member) && ts.getModifiers(member)?.some(m => m.kind === ts.SyntaxKind.StaticKeyword);
			if (ts.isPropertyDeclaration(member) && isStatic && member.initializer) { parts.push(member.initializer); }
			if (ts.isClassStaticBlockDeclaration(member)) { parts.push(member.body); }
		}
		return parts;
	}
	if (ts.isEnumDeclaration(node)) { return node.members.flatMap(m => (m.initializer ? [m.initializer] : [])); }
	if (ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) { return []; }
	return [node];
}

/** Module-scope names read while a declaration is evaluated (not inside functions it defines). */
export function definitionReads(scope: Scope, node: TS.Node): string[] {
	const { ts } = scope;
	const names = new Set<string>();
	const visit = (at: TS.Node): void => {
		if (FUNCTION_LIKE.has(ts.SyntaxKind[at.kind])) { return; }
		if (ts.isClassExpression(at)) { definitionTime(ts, at).forEach(visit); return; }
		if (ts.isIdentifier(at) && !isDeclarationName(ts, at) && !isTypeUse(ts, at)) {
			const name = moduleName(scope, at);
			if (name) { names.add(name); }
		}
		ts.forEachChild(at, visit);
	};
	definitionTime(ts, node).forEach(visit);
	return [...names];
}

const GLOBAL_CONSTANTS = new Set(['undefined', 'NaN', 'Infinity']);
const EMPTY_COLLECTIONS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);

/**
 * Whether evaluating an expression runs no code: literals, functions, pure classes, module-scope reads, `undefined`,
 * plain arrays and objects of those, and argument-less `new Map()`/`Set`/`WeakMap`/`WeakSet`. Wrappers like `as` are transparent.
 */
export function isPure(scope: Scope, node: TS.Node): boolean {
	const { ts } = scope;
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)
		|| (ts.isSatisfiesExpression?.(node) ?? false)) {
		return isPure(scope, (node as TS.ParenthesizedExpression).expression);
	}
	switch (node.kind) {
		case ts.SyntaxKind.StringLiteral: case ts.SyntaxKind.NumericLiteral: case ts.SyntaxKind.BigIntLiteral:
		case ts.SyntaxKind.RegularExpressionLiteral: case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
		case ts.SyntaxKind.TrueKeyword: case ts.SyntaxKind.FalseKeyword: case ts.SyntaxKind.NullKeyword:
		case ts.SyntaxKind.FunctionExpression: case ts.SyntaxKind.ArrowFunction:
			return true;
	}
	if (ts.isPrefixUnaryExpression(node)) { return node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand); }
	if (ts.isIdentifier(node)) { return !!moduleName(scope, node) || (GLOBAL_CONSTANTS.has(node.text) && !scope.checker.getSymbolAtLocation(node)?.declarations?.length); }
	if (ts.isClassExpression(node)) { return classPure(scope, node); }
	if (ts.isArrayLiteralExpression(node)) { return node.elements.every(e => ts.isOmittedExpression(e) || (!ts.isSpreadElement(e) && isPure(scope, e))); }
	if (ts.isObjectLiteralExpression(node)) {
		return node.properties.every(p => {
			const plain = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name));
			if (ts.isPropertyAssignment(p)) { return !!plain && isPure(scope, p.initializer); }
			if (ts.isShorthandPropertyAssignment(p)) { return !p.objectAssignmentInitializer && !!moduleName(scope, p.name); }
			return ts.isMethodDeclaration(p) && !!plain;
		});
	}
	if (ts.isNewExpression(node)) {
		return ts.isIdentifier(node.expression) && EMPTY_COLLECTIONS.has(node.expression.text) && !moduleName(scope, node.expression)
			&& !scope.checker.getSymbolAtLocation(node.expression)?.declarations?.some(d => d.getSourceFile() === scope.source) && !node.arguments?.length;
	}
	return false;
}

/** A class whose definition runs no code: no decorators, and a pure `extends`, computed names and static initializers, no static block with code. */
export function classPure(scope: Scope, node: TS.ClassLikeDeclaration): boolean {
	const { ts } = scope;
	if (hasDecorators(ts, node)) { return false; }
	return definitionTime(ts, node).every(part => (ts.isBlock(part) ? part.statements.length === 0 : isPure(scope, part)));
}

/** Whether a class (or anything in it) has a decorator. */
export function hasDecorators(ts: Ts, node: TS.Node): boolean {
	let found = false;
	const visit = (at: TS.Node): void => { if (ts.isDecorator(at)) { found = true; } else if (!found) { ts.forEachChild(at, visit); } };
	visit(node);
	return found;
}

/** Whether an enum's members are all literals or references to earlier members of the same enum. */
export function enumLiteral(ts: Ts, node: TS.EnumDeclaration): boolean {
	const earlier = new Set<string>();
	for (const member of node.members) {
		const init = member.initializer;
		const literal = !init || ts.isStringLiteral(init) || ts.isNumericLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)
			|| (ts.isPrefixUnaryExpression(init) && init.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(init.operand))
			|| (ts.isIdentifier(init) && earlier.has(init.text))
			|| (ts.isPropertyAccessExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === node.name.text && earlier.has(init.name.text));
		if (!literal) { return false; }
		earlier.add(member.name.getText());
	}
	return true;
}

/** Whether an identifier is written to: assigned, incremented, a for-in/of target, or inside a destructuring assignment target. */
export function isWrite(ts: Ts, id: TS.Identifier): boolean {
	let node: TS.Node = id;
	let parent = node.parent;
	if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
		&& (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) { return true; }
	if ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === node) { return true; }
	while (parent && (ts.isArrayLiteralExpression(parent) || ts.isObjectLiteralExpression(parent) || ts.isShorthandPropertyAssignment(parent)
		|| (ts.isPropertyAssignment(parent) && parent.initializer === node) || ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent) || ts.isParenthesizedExpression(parent))) {
		node = parent;
		parent = node.parent;
	}
	if (node !== id && parent && (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === node) { return true; }
	return !!parent && ts.isBinaryExpression(parent) && parent.left === node
		&& parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

/**
 * Why a declaration's span may never move, whatever the scope: it names its module or file (`import.meta` except
 * `.dirname`/`.env`, `__filename`, a free `module`/`exports`, `require` other than `require('literal')`, `eval`), uses
 * module-level `this`/`arguments`/`new.target`, or lists its own folder.
 */
export function spanProblems(scope: Scope, node: TS.Node): string[] {
	const { ts, checker } = scope;
	const problems = new Set<string>();
	const unresolved = (id: TS.Identifier) => !(ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id
		? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id))?.declarations?.length;
	const moduleLevel = (at: TS.Node) => {
		for (let up = at.parent; up; up = up.parent) {
			if (ts.isSourceFile(up)) { return true; }
			if (ts.isFunctionLike(up) && !ts.isArrowFunction(up)) { return false; }
			if (ts.isPropertyDeclaration(up) || ts.isClassStaticBlockDeclaration(up)) { return false; }
		}
		return true;
	};
	const visit = (at: TS.Node): void => {
		if (ts.isMetaProperty(at) && at.keywordToken === ts.SyntaxKind.ImportKeyword) {
			const parent = at.parent;
			if (!(ts.isPropertyAccessExpression(parent) && /^(dirname|env)$/.test(parent.name.text))) { problems.add('it uses `import.meta`, which names its module'); }
		} else if (ts.isMetaProperty(at) && moduleLevel(at)) { problems.add('it uses `new.target` at module level'); }
		if (at.kind === ts.SyntaxKind.ThisKeyword && moduleLevel(at)) { problems.add('it uses `this` at module level, which differs per module'); }
		if (ts.isIdentifier(at)) {
			const text = at.text;
			if (text === 'arguments' && moduleLevel(at) && unresolved(at)) { problems.add('it uses `arguments` at module level'); }
			if ((text === '__filename' || text === 'module' || text === 'exports' || text === 'eval') && unresolved(at) && !isDeclarationName(ts, at)
				&& !(ts.isPropertyAccessExpression(at.parent) && at.parent.name === at)) {
				problems.add(`it uses \`${text}\`, which names its module or file`);
			}
			if (text === 'require' && unresolved(at)) {
				const call = at.parent;
				const literal = ts.isCallExpression(call) && call.expression === at && call.arguments.length === 1 && ts.isStringLiteralLike(call.arguments[0]);
				if (!literal) { problems.add('it uses `require` other than `require(\'literal\')`'); }
			}
			if (/^(readdir|readdirSync|opendir|opendirSync)$/.test(text)) { problems.add('it lists a folder, which would now hold the new files'); }
		}
		ts.forEachChild(at, visit);
	};
	visit(node);
	return [...problems];
}
