import { writeFileSync } from 'fs';
import * as path from 'path';
import { GO_READ_ENV, goPackage } from './goAst';
import { runTool } from './projectCommands';

/** A helper parameter as written; a pointer one is passed as `&x`. */
export interface ExtractParam { readonly name: string; readonly type: string; readonly pointer: boolean }

/** A value a helper returns to the call block. */
export interface ExtractOutput { readonly name: string; readonly type: string }

/** One built helper, as `goextract build` prints it. */
export interface ExtractHelper {
	readonly name: string;
	readonly from: number;
	readonly to: number;
	readonly params: readonly ExtractParam[];
	readonly outputs: readonly ExtractOutput[];
	readonly returns: boolean;
	readonly tail: boolean;
	readonly lines: number;
	readonly pointerSites: number;
}

/** One statement of a block in the outline. */
export interface ExtractStatement {
	readonly from: number;
	readonly to: number;
	readonly kind: string;
	readonly declares: readonly string[];
	/** Why no chunk may hold it (defer, recover, goto, label NAME, go). */
	readonly refused?: string;
}

/** One statement list of the function. */
export interface ExtractBlock {
	readonly line: number;
	readonly depth: number;
	readonly statements: readonly ExtractStatement[];
	/** Per boundary 0..statements.length: outer locals read at or after it, sorted. */
	readonly live: readonly (readonly string[])[];
}

/** What the model plans from. */
export interface ExtractOutline {
	readonly function: {
		readonly name: string; readonly receiver: string; readonly startLine: number; readonly endLine: number; readonly lines: number;
		/** The most lines it may keep, so that a split can then give it a file of its own. */
		readonly budget: number;
	};
	/** Why the function can't be refactored; then there are no blocks. */
	readonly refused?: string;
	readonly blocks: readonly ExtractBlock[];
}

/** The plan's problems, or the helpers and the function's new length. */
export interface ExtractBuild {
	readonly problems: readonly string[];
	readonly helpers?: readonly ExtractHelper[];
	readonly functionLines?: number;
}

/** Where a function lives, for every subcommand: the list file, the import path, the absolute file, the function and its receiver. */
export interface ExtractTarget { readonly list: string; readonly pkg: string; readonly file: string; readonly func: string; readonly recv?: string }

/** The last object of a `go list -json` stream: with `-deps`, the package itself. */
function lastImportPath(stream: string): string | undefined {
	const start = stream.lastIndexOf('\n{\n');
	try { return (JSON.parse(stream.slice(start + 1)) as { ImportPath?: string }).ImportPath || undefined; }
	catch { return undefined; }
}

/**
 * `go list -export -deps -json` of the file's package into `out`; the import path, or a plain message. A package that
 * does not compile still lists (go exits 1 with the JSON printed); the helper then refuses it with the type error.
 */
export async function listPackage(go: string, root: string, file: string, out: string): Promise<{ list: string; pkg: string } | string> {
	const pkg = goPackage(file);
	const listed = await runTool(go, ['list', '-export', '-deps', '-json', pkg], root, GO_READ_ENV, { timeoutMs: 600_000 });
	const importPath = lastImportPath(listed.stdout);
	if (!importPath) {
		const first = listed.stderr.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('#')) ?? `exit ${listed.code}`;
		return `\`go list\` could not load ${pkg}: ${first}`;
	}
	writeFileSync(out, listed.stdout);
	return { list: out, pkg: importPath };
}

/** Runs one subcommand on the target; any failure to print JSON throws with the helper's message. */
async function extract<T>(helper: string, command: string, target: ExtractTarget, extra: readonly string[]): Promise<T> {
	const args = [command, '-list', target.list, '-pkg', target.pkg, '-file', target.file, '-func', target.func,
		...(target.recv ? ['-recv', target.recv] : []), ...extra];
	const result = await runTool(helper, args, path.dirname(target.file), GO_READ_ENV);
	if (result.code !== 0) { throw new Error(`goextract ${command} failed: ${result.stderr.trim().slice(0, 500)}`); }
	return JSON.parse(result.stdout) as T;
}

export async function extractOutline(helper: string, target: ExtractTarget): Promise<ExtractOutline> {
	return extract<ExtractOutline>(helper, 'outline', target, []);
}

/** Builds the plan in `planFile`; the new file is written to `outFile` only when there are no problems. */
export async function extractBuild(helper: string, target: ExtractTarget, planFile: string, outFile: string): Promise<ExtractBuild> {
	return extract<ExtractBuild>(helper, 'build', target, ['-plan', planFile, '-out', outFile]);
}

/** The extract check of the target file as written now against `beforeFile` and the build's JSON; empty means it passed. */
export async function extractCheck(helper: string, target: ExtractTarget, beforeFile: string, buildFile: string): Promise<string[]> {
	return (await extract<{ problems: string[] }>(helper, 'check', target, ['-before', beforeFile, '-build', buildFile])).problems;
}

/** The helper's usage line appears when it runs with no arguments: the probe for `buildGoTool`. */
export async function probeExtract(binary: string): Promise<boolean> {
	const result = await runTool(binary, [], path.dirname(binary), GO_READ_ENV, { timeoutMs: 30_000 });
	return result.stderr.startsWith('usage: goextract');
}
