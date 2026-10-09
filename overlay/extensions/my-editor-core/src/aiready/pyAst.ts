import * as path from 'path';
import { runTool } from './projectCommands';

/** One alias of an import statement, with its UTF-8 byte span. */
export interface PyAlias {
	readonly name: string;
	readonly asname: string | null;
	readonly start: number;
	readonly end: number;
}

export interface PyImport {
	readonly kind: 'import' | 'from';
	/** For `from` imports, the module after the dots; empty for `import` statements. */
	readonly module: string;
	readonly level: number;
	readonly line: number;
	readonly start: number;
	readonly end: number;
	/** The start of its first line (its indentation included). */
	readonly lineStart: number;
	readonly aliases: readonly PyAlias[];
}

/** One statement of the leading block: the docstring, `__future__` imports, imports, and import-only compound statements. */
export interface PyLead {
	readonly kind: 'doc' | 'future' | 'import' | 'typecheck' | 'compound';
	/** Whole lines: from the start of its first line to the end of its last (no newline). */
	readonly start: number;
	readonly end: number;
	readonly line: number;
	readonly endLine: number;
	readonly binds: readonly string[];
	/** Names its condition reads (`sys`, `TYPE_CHECKING`). */
	readonly needs: readonly string[];
	readonly imports: readonly PyImport[];
}

/** One top-level statement after the leading block, as the helper sees it. */
export interface PyDecl {
	readonly id: number;
	readonly kind: string;
	readonly names: readonly string[];
	readonly start: number;
	readonly end: number;
	readonly line: number;
	readonly lines: number;
	readonly own: boolean;
	readonly doc: string;
	readonly docText: string;
	readonly pure: boolean;
	readonly impure: string | null;
	/** Why its annotations are not pure; they only count when annotations are evaluated. */
	readonly annImpure: string | null;
	/** For statements that are not definitions: only quiet stdlib calls, a docstring, `pass`, an `if TYPE_CHECKING:` block. */
	readonly quiet: boolean;
	/** Names defined earlier in the file that its definition-time code reads; they must move to the same file, earlier. */
	readonly sameFile: readonly string[];
	readonly annSameFile: readonly string[];
	/** `m.attr` read when defined, for the import check. */
	readonly attrReads: readonly (readonly [string, string])[];
	/** Stdlib top-level modules its purity relied on (a tracked file shadowing one refuses). */
	readonly relies: readonly string[];
	readonly defReads: readonly string[];
	readonly annReads: readonly string[];
	/** Every global name it reads, at definition time or later, forward-reference strings included. */
	readonly reads: readonly string[];
	readonly globalStmt: boolean;
	readonly dunders: readonly string[];
	readonly fileUse: null | 'folder' | 'other';
	readonly doctest: boolean;
	readonly warns: boolean;
	readonly defines: readonly string[];
	readonly baseNames: readonly string[];
}

/** The helper's JSON for one file; only the byte facts and `error` when it does not parse. */
export interface PyFacts {
	readonly python: readonly number[];
	readonly error: string | null;
	readonly bom: boolean;
	readonly crlf: boolean;
	readonly cookie: string | null;
	readonly shebang: boolean;
	readonly size: number;
	readonly longLine: boolean;
	readonly cells: boolean;
	readonly future: boolean;
	readonly firstComment: string;
	readonly toolComment: string | null;
	readonly namespace: string | null;
	readonly mainGuard: boolean;
	readonly starImport: boolean;
	readonly lateImport: number | null;
	readonly moduleGetattr: boolean;
	readonly lead: readonly PyLead[];
	/** Where the facade goes: the start of the line after the leading block. */
	readonly facadeAt: number;
	readonly decls: readonly PyDecl[];
	readonly bindings: Readonly<Record<string, number>>;
	readonly globalAssigned: readonly string[];
}

const EMPTY = { future: false, firstComment: '', toolComment: null, namespace: null, mainGuard: false, starImport: false, lateImport: null,
	moduleGetattr: false, lead: [], facadeAt: 0, decls: [], bindings: {}, globalAssigned: [] };

/** The folder of the shipped helpers (`resources/pyast`). */
export function pyHelperDir(extensionPath: string): string {
	return path.join(extensionPath, 'resources', 'pyast');
}

/** Parses one file with the project's interpreter, isolated (`-I -S`: no site, no `.pth`, no project code; `-B`: no `__pycache__` in the helper folder). */
export async function pyFileFacts(python: string, helperDir: string, file: string, cwd: string): Promise<PyFacts> {
	const result = await runTool(python, ['-I', '-S', '-B', path.join(helperDir, 'my_editor_pyast.py'), path.resolve(file)], cwd);
	if (result.code !== 0) { throw new Error(`${path.basename(file)} could not be parsed: ${result.stderr.trim().split('\n').pop() ?? 'no output'}`); }
	try { return { ...EMPTY, ...JSON.parse(result.stdout) } as PyFacts; }
	catch { throw new Error(`${path.basename(file)} could not be parsed: the helper printed no JSON.`); }
}
