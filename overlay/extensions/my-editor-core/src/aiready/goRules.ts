import * as path from 'path';
import type { GoAst, GoDecl, GoImport } from './goAst';
import type { Declaration, FileInfo } from './language';

/** go/build's known GOOS and GOARCH values (syslist.go); `go tool dist list` adds any newer ones. */
const KNOWN_OS = 'aix android darwin dragonfly freebsd hurd illumos ios js linux nacl netbsd openbsd plan9 solaris wasip1 windows zos';
const KNOWN_ARCH = '386 amd64 amd64p32 arm armbe arm64 arm64be loong64 mips mipsle mips64 mips64le mips64p32 mips64p32le ppc ppc64 ppc64le riscv riscv64 s390 s390x sparc sparc64 wasm';

export interface Platforms {
	readonly os: ReadonlySet<string>;
	readonly arch: ReadonlySet<string>;
}

/** GOOS and GOARCH names from `go tool dist list` output (`linux/amd64` lines) plus go/build's own lists. */
export function platforms(distList = ''): Platforms {
	const os = new Set(KNOWN_OS.split(' '));
	const arch = new Set(KNOWN_ARCH.split(' '));
	for (const line of distList.split('\n')) {
		const [goos, goarch] = line.trim().split('/');
		if (goos && goarch) { os.add(goos); arch.add(goarch); }
	}
	return { os, arch };
}

/** The `_GOOS`, `_GOARCH` or `_GOOS_GOARCH` ending that makes Go treat a file name as a build constraint. */
export function platformSuffix(name: string, known: Platforms): string | undefined {
	const stem = name.split('.')[0];
	const underscore = stem.indexOf('_');
	if (underscore < 0) { return undefined; }
	const parts = stem.slice(underscore).split('_');
	if (parts[parts.length - 1] === 'test') { parts.pop(); }
	const n = parts.length;
	if (n >= 2 && known.os.has(parts[n - 2]) && known.arch.has(parts[n - 1])) { return `_${parts[n - 2]}_${parts[n - 1]}`; }
	if (n >= 1 && (known.os.has(parts[n - 1]) || known.arch.has(parts[n - 1]))) { return `_${parts[n - 1]}`; }
	return undefined;
}

/** Why Go would ignore, constrain or misread a new file with this name. */
export function goFileNameProblems(name: string, known: Platforms): string[] {
	const problems: string[] = [];
	if (!/^[a-z0-9][a-z0-9_]*\.go$/.test(name)) {
		problems.push('use lower-case letters, digits and underscores, end in .go, and do not start with _ or . (Go ignores such files)');
	}
	if (name.endsWith('_test.go')) { problems.push('a new file must not be a test file'); }
	const suffix = platformSuffix(name, known);
	if (suffix) { problems.push(`the name ends in ${suffix}, which Go treats as a build constraint`); }
	return problems;
}

/** Module-wide facts a file's skip decision needs. */
export interface GoModuleFacts {
	/** Folders below the root (relative, `/`-separated) that have their own go.mod. */
	readonly nestedModules: readonly string[];
	/** Every `//go:generate` and `//go:embed` line in the module, with the folder of its file. */
	readonly directiveLines: readonly { readonly dir: string; readonly text: string }[];
}

/** `//go:generate` and `//go:embed` lines in one file's text. */
export function directiveLines(file: string, text: string): { dir: string; text: string }[] {
	const dir = path.posix.dirname(file);
	return [...text.matchAll(/^[ \t]*(\/\/go:(?:generate|embed)\s.*)$/gm)].map(match => ({ dir, text: match[1].trim() }));
}

function globToRegExp(glob: string): RegExp {
	const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
	return new RegExp(`^${body}(?:/.*)?$`);
}

/** Whether a `//go:generate` or `//go:embed` line anywhere in the module names this file. */
export function namedByDirective(file: string, lines: GoModuleFacts['directiveLines']): boolean {
	const base = path.posix.basename(file);
	return lines.some(line => {
		const tokens = line.text.split(/\s+/).slice(1).map(token => token.replace(/^["`]|["`]$/g, ''));
		// `all:` only changes which dot and underscore files a pattern includes.
		const patterns = tokens.map(token => token.replace(/^all:/, ''));
		if (line.text.startsWith('//go:generate')) { return tokens.some(token => token.includes(base)); }
		const relative = path.posix.relative(line.dir === '.' ? '' : line.dir, file);
		return patterns.some(token => token.includes(base) || globToRegExp(token).test(relative));
	});
}

/** Why a Go file is never split or given tests, or undefined. */
export function goSkipReason(file: string, ast: GoAst, module: GoModuleFacts, known: Platforms): string | undefined {
	if (file.endsWith('_test.go')) { return 'test files are not split in this version'; }
	if (/(^|\/)vendor\//.test(file)) { return 'vendored code'; }
	const nested = module.nestedModules.find(dir => file.startsWith(`${dir}/`));
	if (nested) { return `inside the nested module ${nested}/`; }
	if (ast.generated) { return 'generated code'; }
	if (ast.buildConstraint) { return 'it has a build constraint'; }
	const suffix = platformSuffix(path.posix.basename(file), known);
	if (suffix) { return `its name ends in ${suffix}, a build constraint`; }
	if (ast.cgo) { return 'it uses cgo'; }
	if (ast.bom) { return 'it starts with a byte-order mark'; }
	if (ast.crlf) { return 'it has CRLF line endings'; }
	const directive = ast.directives.find(d => !d.text.startsWith('//go:embed') && !d.text.startsWith('//go:generate'));
	if (directive) { return `it has the directive \`${directive.text}\` on line ${directive.line}`; }
	if (ast.directives.some(d => d.text.startsWith('//go:generate') && /\$\{?GOFILE\b/.test(d.text))) {
		return 'a //go:generate line in it uses $GOFILE, which would change if its declarations moved';
	}
	if (ast.imports.some(i => i.dot)) { return 'it has a dot import'; }
	if (namedByDirective(file, module.directiveLines)) { return 'a //go:generate or //go:embed line names it'; }
	return undefined;
}

/** The name a file uses for an import: its explicit name, else the package name from `go list`, else a guess. */
export function importName(spec: GoImport, packageNames: ReadonlyMap<string, string>): string {
	if (spec.name) { return spec.name; }
	const last = spec.path.split('/').filter(part => !/^v\d+$/.test(part)).pop() ?? spec.path;
	return packageNames.get(spec.path) ?? last.replace(/\.v\d+$/, '');
}

/** An import's comparable key, `name path` (just `path` when unnamed), as in `FileInfo.imports` and `Declaration.uses`. */
export function importKey(spec: GoImport): string {
	return `${spec.name} ${spec.path}`.trim();
}

function unmovable(decl: GoDecl): string | undefined {
	if (!decl.own) { return 'it shares a line with other code'; }
	if (decl.isInit) { return 'init functions run in file order'; }
	if (decl.embed) { return 'a //go:embed variable needs the embed import kept with it'; }
	if (decl.generate) { return 'a //go:generate line inside it would change $GOFILE and generation order'; }
	if (decl.kind === 'var' && decl.hasInit) { return 'an initialized package variable keeps its place in initialization order'; }
	return undefined;
}

/** A parsed Go file: the language-neutral view plus the helper's output, which the Go split needs. */
export interface GoFileInfo extends FileInfo {
	readonly go: GoAst;
}

/** The language-neutral view of a parsed Go file. */
export function goFileInfoView(file: string, ast: GoAst, packageNames: ReadonlyMap<string, string>, skip?: string): GoFileInfo {
	const usable = ast.imports.filter(i => !i.blank && !i.dot);
	const declarations: Declaration[] = ast.decls.map(decl => {
		const reason = unmovable(decl);
		return {
			id: decl.id, kind: decl.grouped ? `${decl.kind} (…)` : decl.kind, names: decl.names, receiver: decl.receiver || undefined,
			span: { start: decl.start, end: decl.end }, lines: decl.lines, doc: decl.doc, docText: decl.docText,
			uses: usable.filter(i => decl.qualifiers.includes(importName(i, packageNames))).map(importKey),
			movable: !reason, reason,
		};
	});
	const decls = ast.importDecls;
	return {
		path: file, declarations,
		importRegion: decls.length ? { start: decls[0][0], end: decls[decls.length - 1][1] } : undefined,
		frame: [{ start: 0, end: ast.packageSpan[1] }, ...decls.map(([start, end]) => ({ start, end }))],
		prelude: { start: 0, end: ast.packageSpan[0] },
		imports: ast.imports.map(importKey),
		skip, go: ast,
	};
}
