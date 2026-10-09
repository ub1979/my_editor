import { existsSync } from 'fs';
import * as path from 'path';
import { createGoAdapter, goTools, goVersionProblem } from './goAdapter';
import type { LanguageAdapter } from './language';
import { createTsAdapter } from './tsAdapter';
import { bundledTypeScript, loadTypeScript } from './tsLoad';
import { lockfileProblem } from './tsProject';

/** Creates a language adapter for a root (the user's folder or the worktree) and its tracked files. */
export type AdapterFactory = (root: string, tracked: readonly string[]) => LanguageAdapter;

/** Where the extension keeps its files, for adapters that ship or build helpers. */
export interface AdapterHost {
	readonly extensionPath: string;
	readonly storageDir: string;
	readonly version: string;
	/** The editor's install folder (`vscode.env.appRoot`); its bundled TypeScript is used for TS/JS. */
	readonly appRoot: string;
}

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs'];

/** Whether a health finding has a fix on a branch: Go splits and tests; TS/JS splits. */
export function fixableFinding(file: string, kind: string): boolean {
	const ext = path.extname(file);
	return (ext === '.go' && (kind === 'too-long' || kind === 'untested')) || (TS_EXTENSIONS.includes(ext) && kind === 'too-long');
}

/**
 * The adapter for the project's language, or a plain message. Go and TS/JS so far (a mixed repository stays Go-first);
 * Python, C#, Rust and C/C++ follow, each in its own `<language>Adapter.ts` registered here.
 */
export async function adapterFor(root: string, host: AdapterHost): Promise<AdapterFactory | string> {
	if (existsSync(path.join(root, 'go.mod'))) {
		const tools = await goTools(path.join(host.extensionPath, 'resources', 'goast', 'main.go'), host.storageDir, host.version);
		if (typeof tools === 'string') { return tools; }
		const problem = await goVersionProblem(tools.go, root);
		return problem ?? ((dir, tracked) => createGoAdapter(dir, tools, tracked));
	}
	if (['package.json', 'tsconfig.json', 'jsconfig.json'].some(name => existsSync(path.join(root, name)))) {
		const ts = loadTypeScript(bundledTypeScript(host.appRoot));
		if (typeof ts === 'string') { return ts; }
		return lockfileProblem(root) ?? ((dir, tracked) => createTsAdapter(dir, ts, tracked));
	}
	return 'Fixing on a branch works for Go, TypeScript and JavaScript projects (a `go.mod`, `package.json` or `tsconfig.json` in the top folder). Python, C#, Rust and C/C++ come next.';
}
