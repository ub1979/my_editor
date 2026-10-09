import { existsSync, readdirSync } from 'fs';
import * as path from 'path';
import { createGoAdapter, GO_LANGUAGE, goTools, goVersionProblem } from './goAdapter';
import type { LanguageAdapter } from './language';
import { createPyAdapter, PY_LANGUAGE } from './pyAdapter';
import { pyHelperDir } from './pyAst';
import { ChoosePython, pythonFor } from './pyInterpreter';
import { createTsAdapter, TS_LANGUAGE } from './tsAdapter';
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
	/** Asks the user for the project's Python when none is remembered (a quick pick in the editor). */
	readonly choosePython?: ChoosePython;
}

/** Every language with an adapter, in the order a folder's language is chosen. */
const LANGUAGES = [GO_LANGUAGE, TS_LANGUAGE, PY_LANGUAGE];
const TS_MARKERS = ['package.json', 'tsconfig.json', 'jsconfig.json'];
const PY_MARKERS = ['pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'manage.py'];

/** Whether the top folder looks like a Python project. */
export function pythonProject(root: string): boolean {
	let names: string[] = [];
	try { names = readdirSync(root); } catch { return false; }
	return names.some(name => PY_MARKERS.includes(name) || /^requirements[^/]*\.txt$/.test(name));
}

/** Whether a health finding has a fix on a branch, from the adapters' extensions and fix kinds. */
export function fixableFinding(file: string, kind: string): boolean {
	const fix = kind === 'too-long' ? 'split' : kind === 'untested' ? 'tests' : undefined;
	return !!fix && LANGUAGES.some(language => language.extensions.includes(path.extname(file)) && language.fixes.includes(fix));
}

/** In a folder with both a `go.mod` and a `package.json`/`tsconfig.json`: which language a run uses. */
export function languageNote(root: string): string | undefined {
	if (!existsSync(path.join(root, 'go.mod')) || !TS_MARKERS.some(name => existsSync(path.join(root, name)))) { return undefined; }
	return `This folder has both Go and ${TS_LANGUAGE.label} in its top folder; Go is chosen first, so only Go files are offered.`;
}

/**
 * The adapter for the project's language, or a plain message. Go, TS/JS and Python so far (a mixed repository keeps that
 * order); C#, Rust and C/C++ follow, each in its own `<language>Adapter.ts` registered here.
 */
export async function adapterFor(root: string, host: AdapterHost): Promise<AdapterFactory | string> {
	if (existsSync(path.join(root, 'go.mod'))) {
		const tools = await goTools(path.join(host.extensionPath, 'resources', 'goast', 'main.go'), host.storageDir, host.version);
		if (typeof tools === 'string') { return tools; }
		const problem = await goVersionProblem(tools.go, root);
		return problem ?? ((dir, tracked) => createGoAdapter(dir, tools, tracked));
	}
	if (TS_MARKERS.some(name => existsSync(path.join(root, name)))) {
		const ts = loadTypeScript(bundledTypeScript(host.appRoot));
		if (typeof ts === 'string') { return ts; }
		return lockfileProblem(root) ?? ((dir, tracked) => createTsAdapter(dir, ts, tracked));
	}
	if (pythonProject(root)) {
		const python = await pythonFor(root, host.storageDir, host.choosePython ?? (async () => undefined));
		if (typeof python === 'string') { return python; }
		const dirs = { helperDir: pyHelperDir(host.extensionPath), storageDir: host.storageDir };
		return (dir, tracked) => createPyAdapter(dir, python, dirs, tracked);
	}
	return 'Fixing on a branch works for Go, TypeScript, JavaScript and Python projects (a `go.mod`, `package.json`, `tsconfig.json`, '
		+ '`pyproject.toml`, `setup.py`, `setup.cfg`, `requirements.txt`, `Pipfile` or `manage.py` in the top folder). C#, Rust and C/C++ come next.';
}
