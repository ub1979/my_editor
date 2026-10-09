import * as path from 'path';
import type { Declaration, FileInfo } from './language';
import type { TsDecl, TsFacts } from './tsAst';
import type { Scope } from './tsProject';
import { globRegExp } from './tsScan';

/** Project facts about one file that its skip reason and movability need (pure inputs). */
export interface TsFileContext {
	/** What may move, or why nothing in the file may. */
	readonly scope: Scope | { skip: string };
	/** Why the scope is types only, for the reason text. */
	readonly scopeReason?: string;
	readonly jsx: 'classic' | 'automatic' | 'other';
	readonly emitDecoratorMetadata: boolean;
	readonly cyclic: boolean;
	/** Why a tool or framework finds this file's folder by path, if one does. */
	readonly foundByPath?: string;
	/** The nearest package.json marks the file side-effect-free. */
	readonly sideEffectFree: boolean;
	readonly exportsWildcard: boolean;
	/** The nearest package.json `files` names this file exactly. */
	readonly listedInFiles: boolean;
	/** `.gitattributes` marks it `linguist-generated`. */
	readonly generatedAttribute: boolean;
}

/** A TS declaration as the core sees it, plus what the TS split needs. */
export interface TsDeclaration extends Declaration {
	readonly ts: TsDecl;
}

/** A parsed TS/JS file: the language-neutral view plus the raw facts. */
export interface TsFileInfo extends FileInfo {
	readonly declarations: readonly TsDeclaration[];
	readonly facts: TsFacts;
	readonly context: TsFileContext;
	/** The original's own specifier style for relative imports, from its imports or its siblings'. */
	readonly style?: 'js' | 'ts' | 'none';
	/** Classic JSX: the root names the factory needs in scope. */
	readonly jsxRoots: readonly string[];
	/** From the unit program, filled by the adapter: the export surface and every identifier's binding. */
	readonly surface?: readonly string[];
	readonly bindings?: readonly string[];
}

const TEST = /\.(test|spec|stories)\.[^/]+$|(^|\/)(__tests__|__mocks__|__fixtures__|test|tests|spec|e2e|cypress)\//;
const CONFIG = /(^|\/)([^/]+\.(config|setup)\.[^/]+|setupTests\.[^/]+|gulpfile\.[^/]+|Gruntfile\.[^/]+|\.eslintrc\.[^/]+)$/;
const BUILD = /(^|\/)(node_modules|dist|build|out|coverage|vendor)\/|\.min\.js$/;
const GENERATED_NAME = /\.gen\.[cm]?[jt]sx?$|_pb\.[cm]?[jt]s$|(^|\/)__generated__\//;
const GENERATED_TEXT = /@generated|DO NOT EDIT|auto-generated|Code generated/i;
/** Comments a tool reads: type-check, lint and coverage switches, then JSX and Flow pragmas and AMD module names. */
const TOOL_COMMENTS = [
	/@ts-nocheck|@ts-check|^\/\*\s*eslint-disable(?![\w-])|istanbul ignore file|c8 ignore file/,
	/@jsx\b|@jsxFrag\b|@jsxImportSource\b|@jsxRuntime\b|@flow\b|^\/\/\/\s*<amd-module/,
];

/** Why a TS/JS file is never split, or undefined. */
export function tsSkipReason(file: string, text: string, facts: TsFacts, context: TsFileContext): string | undefined {
	if (/\.d\.[cm]?ts$/.test(file)) { return 'a declaration file'; }
	if (TEST.test(file)) { return 'a test or test-support file'; }
	if (CONFIG.test(file)) { return 'a config or entry script'; }
	if (BUILD.test(file)) { return 'build output or vendored code'; }
	if (GENERATED_NAME.test(file) || context.generatedAttribute || GENERATED_TEXT.test(facts.firstComment)) { return 'generated code'; }
	if (text.length > 512 * 1024 || text.split('\n').some(line => line.length > 1000)) {
		return 'it looks minified (a line over 1,000 characters or over 512 KB)';
	}
	if (text.charCodeAt(0) === 0xfeff) { return 'it starts with a byte-order mark'; }
	if (text.includes('\r\n')) { return 'it has CRLF line endings'; }
	if (facts.parseErrors) { return 'the parser reports errors in it (Flow or broken code)'; }
	if (typeof context.scope === 'object') { return context.scope.skip; }
	if (facts.commonJs) { return 'CommonJS module'; }
	if (facts.exportEquals) { return 'it has `export =` or `export as namespace`'; }
	if (!facts.module) { return 'a script file: its top-level names are globals and a new file would never load'; }
	const directive = facts.directives.find(d => d !== 'use strict');
	if (directive) { return `it has the directive '${directive}', which a new file would lack`; }
	const tool = facts.comments.find(comment => TOOL_COMMENTS.some(pattern => pattern.test(comment)));
	if (tool) { return `it has the file-level comment \`${tool.split('\n')[0].slice(0, 60)}\`, which new files would need`; }
	if (facts.decorators && context.emitDecoratorMetadata) { return 'it has decorators and emitDecoratorMetadata is on'; }
	if (!facts.importsAtTop) { return 'its imports are not one block at the top'; }
	if (facts.imports.some(imp => !imp.own)) { return 'an import shares a line with other code'; }
	if (context.cyclic) { return 'it is in an import cycle'; }
	if (context.sideEffectFree && (facts.decls.some(d => !d.quiet) || facts.imports.some(imp => imp.sideEffect))) {
		return 'its package.json marks it side-effect-free and it runs code when loaded, so a bundler may drop or reorder that code';
	}
	if (context.foundByPath) { return context.foundByPath; }
	if (context.exportsWildcard) { return 'its package.json "exports" has a wildcard subpath, which would make new files public'; }
	if (context.listedInFiles) { return 'its package.json "files" names it, and new files would be left out of the published package'; }
	return undefined;
}

const RUNTIME_KINDS = new Set(['function', 'interface', 'type', 'class', 'enum', 'const', 'let', 'var']);

/** Why one declaration may not move, given the file's scope and the declarations before it; undefined when it may. */
function unmovable(decl: TsDecl, index: number, facts: TsFacts, context: TsFileContext, merged: ReadonlySet<string>): string | undefined {
	const scope = context.scope as Scope;
	if (!RUNTIME_KINDS.has(decl.kind) || decl.declare) {
		if (decl.kind === 'const enum') { return 'a const enum is inlined across files differently by each tool'; }
		if (decl.kind === 'namespace') { return 'a namespace body runs code and merges'; }
		return decl.declare ? 'it is ambient (declare)' : 'it is not a declaration, or it runs code';
	}
	if (!decl.own) { return 'it shares a line with other code'; }
	if (decl.names.some(name => merged.has(name))) { return 'its name has more than one declaration (declaration merging)'; }
	if (decl.problems.length) { return decl.problems[0]; }
	if (decl.jsx && context.jsx === 'other') { return 'its JSX is compiled by another tool (jsx: preserve, or no tsconfig)'; }
	if (decl.jsdocTypes) { return 'its doc comment declares file-level types (@typedef, @callback or @import)'; }
	if (scope === 'types' && decl.kind !== 'interface' && decl.kind !== 'type') {
		return `only interfaces and type aliases may move here: ${context.scopeReason || 'the project is not ES modules checked by tsc alone'}`;
	}
	if (scope === 'functions' && decl.kind !== 'function') { return 'only function declarations may move in plain JavaScript'; }
	if (decl.assigned.length) { return `${decl.assigned[0]} is assigned elsewhere, and an imported name cannot be`; }
	if (decl.kind === 'class' && decl.decorators) { return 'it has decorators, which run when the class is defined'; }
	if (decl.kind === 'enum' && !decl.literalEnum) { return 'a member is computed, which runs code'; }
	if (['const', 'let', 'var'].includes(decl.kind) && !decl.plainNames) { return 'it destructures, which runs code'; }
	if (['class', 'const', 'let', 'var'].includes(decl.kind) && !decl.pure) {
		return 'its definition runs code (a call, a property read, an operator or a global read)';
	}
	if (['class', 'enum', 'const', 'let', 'var'].includes(decl.kind) && facts.decls.slice(0, index).some(d => !d.quiet)) {
		return 'code runs before it in the file, so it would be defined earlier than now';
	}
	return undefined;
}

function firstDocLine(doc: string): string {
	return doc.split('\n').map(line => line.replace(/^\s*(\/\*\*?|\*\/|\*|\/\/)\s?/, '').replace(/\*\/\s*$/, '').trim()).find(Boolean) ?? '';
}

/** The language-neutral view of a parsed TS/JS file. */
export function tsFileInfoView(file: string, facts: TsFacts, context: TsFileContext, skip: string | undefined,
	style: TsFileInfo['style'], jsxRoots: readonly string[]): TsFileInfo {
	const counts = new Map<string, number>();
	for (const name of facts.decls.filter(d => d.kind !== 'export list' && d.kind !== 'statement').flatMap(d => d.names)) {
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	const merged = new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
	const locals = new Map(facts.imports.flatMap(imp => imp.bindings.map(b => [b.local, `${b.local} ${imp.specifier}`] as const)));
	const { bytes, text } = facts;
	const declarations: TsDeclaration[] = facts.decls.map((decl, id) => {
		const reason = skip ? skip : unmovable(decl, id, facts, context, merged);
		return {
			id, kind: `${decl.exported ? 'export ' : ''}${decl.isDefault ? 'default ' : ''}${decl.kind}`, names: decl.names,
			span: { start: bytes(decl.start), end: bytes(decl.end) },
			lines: text.slice(decl.start, decl.end).split('\n').length, doc: firstDocLine(decl.docText), docText: decl.docText,
			uses: [...new Set([...decl.valueUses, ...decl.typeUses].flatMap(name => (locals.has(name) ? [locals.get(name)!] : [])))],
			movable: !reason, reason, ts: decl,
		};
	});
	const imports = facts.imports;
	const first = Math.min(imports[0]?.span.start ?? Infinity, declarations[0]?.span.start ?? Infinity, bytes(text.length));
	return {
		path: file, declarations, facts, context, style, jsxRoots, skip,
		narrowed: !skip && context.scope === 'types' ? `only types may move${context.scopeReason ? ` (${context.scopeReason})` : ''}` : undefined,
		importRegion: imports.length
			? { start: imports[0].span.start, end: imports[imports.length - 1].span.end }
			: { start: bytes(facts.facadeAt), end: bytes(facts.facadeAt) },
		frame: [{ start: 0, end: first }, ...imports.map(imp => imp.span)],
		prelude: { start: 0, end: first },
		imports: imports.flatMap(imp => (imp.sideEffect ? [`_ ${imp.specifier}`]
			: imp.kind === 'export' ? [`export ${imp.specifier}`]
				: imp.bindings.map(b => `${b.local} ${imp.specifier}`))),
	};
}

/** The style of a file's relative specifiers: `.js`-like suffix, `.ts`-like suffix or none; `mixed` when they disagree. */
export function specifierStyle(facts: TsFacts): 'js' | 'ts' | 'none' | 'mixed' | undefined {
	const styles = new Set(facts.imports.filter(imp => /^\.\.?\//.test(imp.module)).flatMap(imp => {
		const ext = path.extname(imp.module);
		return /^\.[cm]?jsx?$/.test(ext) ? ['js'] : /^\.[cm]?tsx?$/.test(ext) ? ['ts'] : ext === '' ? ['none'] : [];
	}));
	return styles.size > 1 ? 'mixed' : ([...styles][0] as 'js' | 'ts' | 'none' | undefined);
}

const FRAMEWORK_FILES = new Set([
	'page', 'layout', 'route', 'template', 'loading', 'error', 'not-found', 'default', 'head', 'middleware', 'instrumentation',
	'_app', '_document', '_layout',
]);

/** Why a new file split from `original` may not have this name; `entries` are the names already in its folder. */
export function tsFileNameProblems(name: string, original: string, entries: readonly string[], testGlobs: readonly string[]): string[] {
	const problems: string[] = [];
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) { problems.push('use letters, digits, dots, dashes and underscores, starting with a letter or digit'); }
	const ext = /\.d\.[cm]?ts$/.test(name) ? '.d.ts' : path.extname(name);
	if (ext !== path.extname(original)) { problems.push(`use the original's extension ${path.extname(original)} (code can parse differently in another)`); }
	const stem = path.parse(name).name;
	if (/^index$/i.test(stem)) { problems.push('index files are found by folder imports'); }
	if (/\.d$|\.(test|spec|stories|config)(\.|$)/i.test(stem)) { problems.push('a new file must not be a declaration, test, story or config file'); }
	if (FRAMEWORK_FILES.has(stem.toLowerCase())) { problems.push(`${stem} is a file name frameworks give a meaning`); }
	const taken = entries.find(entry => entry !== name && path.parse(entry).name.toLowerCase() === stem.toLowerCase());
	if (taken) { problems.push(`${taken} already uses the name ${stem}, so an import of ./${stem} could resolve differently`); }
	const relative = path.posix.join(path.posix.dirname(original), name);
	const glob = testGlobs.find(g => globRegExp(g).test(relative) || globRegExp(g).test(name));
	if (glob) { problems.push(`the project's test pattern ${glob} matches it`); }
	return problems;
}
