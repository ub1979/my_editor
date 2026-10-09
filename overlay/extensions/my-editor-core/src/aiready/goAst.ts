import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'fs';
import * as path from 'path';
import { runTool } from './projectCommands';

/** One import spec, as `resources/goast` prints it. */
export interface GoImport {
	readonly name: string;
	readonly path: string;
	readonly start: number;
	readonly end: number;
	/** In a parenthesized group and alone on its lines, so it can be removed line by line. */
	readonly own: boolean;
	/** Index into `importDecls`. */
	readonly decl: number;
	/** Specs in one run are adjacent; runs are separated by a blank line or another import declaration. */
	readonly run: number;
	readonly blank: boolean;
	readonly dot: boolean;
}

/** One top-level declaration other than an import. */
export interface GoDecl {
	readonly id: number;
	readonly kind: 'func' | 'method' | 'type' | 'const' | 'var';
	readonly grouped: boolean;
	readonly names: readonly string[];
	readonly receiver: string;
	readonly start: number;
	readonly end: number;
	readonly lines: number;
	readonly doc: string;
	readonly docText: string;
	readonly isInit: boolean;
	readonly hasInit: boolean;
	readonly embed: boolean;
	readonly generate: boolean;
	readonly own: boolean;
	/** X of each selector X.Sel that the parser left unresolved: import names, or names from other files. */
	readonly qualifiers: readonly string[];
}

export interface GoDirective {
	readonly line: number;
	readonly offset: number;
	readonly text: string;
}

/** The helper's JSON for one file. */
export interface GoAst {
	readonly package: string;
	readonly packageSpan: readonly [number, number];
	readonly buildConstraint: boolean;
	readonly cgo: boolean;
	readonly generated: boolean;
	readonly bom: boolean;
	readonly crlf: boolean;
	readonly imports: readonly GoImport[];
	readonly importDecls: readonly (readonly [number, number])[];
	readonly decls: readonly GoDecl[];
	readonly directives: readonly GoDirective[];
}

/**
 * Builds the parser helper once per extension version and helper source, with the user's own Go and
 * `GOTOOLCHAIN=local`, in an empty folder outside any module. Returns the binary's path.
 */
export async function buildGoHelper(mainGo: string, storageDir: string, version: string, go: string): Promise<string> {
	const hash = createHash('sha1').update(readFileSync(mainGo)).digest('hex').slice(0, 8);
	const dir = path.join(storageDir, 'goast', `${version}-${hash}`);
	const binary = path.join(dir, 'goast');
	if (existsSync(binary)) { return binary; }
	mkdirSync(dir, { recursive: true });
	const work = mkdtempSync(path.join(dir, 'build-'));
	try {
		copyFileSync(mainGo, path.join(work, 'main.go'));
		const built = await runTool(go, ['build', '-o', path.join(work, 'goast'), 'main.go'], work,
			{ GOTOOLCHAIN: 'local', GOFLAGS: '', GOWORK: 'off', CGO_ENABLED: '0' });
		if (built.code !== 0) { throw new Error(`Could not build the Go parser helper: ${built.stderr.trim().slice(0, 500)}`); }
		renameSync(path.join(work, 'goast'), binary);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
	return binary;
}

/** Parses one Go file with the helper. */
export async function goFileInfo(helper: string, file: string): Promise<GoAst> {
	const result = await runTool(helper, [file], path.dirname(file));
	if (result.code !== 0) { throw new Error(`${path.basename(file)} could not be parsed: ${result.stderr.trim().slice(0, 300)}`); }
	return JSON.parse(result.stdout) as GoAst;
}
