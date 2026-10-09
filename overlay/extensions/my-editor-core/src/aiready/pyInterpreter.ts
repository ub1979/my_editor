import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findTool } from './projectCommands';

/** The project's Python, as probed with `-I` (site on, no project code). */
export interface PyInterpreter {
	/** As found: a venv's `bin/python` is a symlink, and resolving it would lose the venv. */
	readonly path: string;
	readonly version: readonly [number, number, number];
	readonly implementation: string;
	readonly prefix: string;
	readonly venv: boolean;
	readonly stdlib: readonly string[];
	/** Top-level modules installed in its site-packages. */
	readonly installed: readonly string[];
	readonly tools: { readonly pytest: boolean; readonly randomly: boolean; readonly mypy: boolean; readonly black: boolean; readonly pytestDjango: boolean };
}

const PROBE = [
	'import importlib.util, json, pkgutil, sys',
	'site = [p for p in sys.path if p.endswith(("site-packages", "dist-packages"))]',
	'mods = list(pkgutil.iter_modules())',
	'own = sorted({m.name for m in mods if getattr(m.module_finder, "path", "") in site})',
	'std = sorted(getattr(sys, "stdlib_module_names", None) or set(sys.builtin_module_names)',
	'  | {m.name for m in mods if getattr(m.module_finder, "path", "") not in site})',
	'has = lambda n: importlib.util.find_spec(n) is not None',
	'print(json.dumps({"version": list(sys.version_info[:3]), "implementation": sys.implementation.name, "prefix": sys.prefix,',
	'  "venv": sys.prefix != getattr(sys, "base_prefix", sys.prefix), "stdlib": std, "installed": own, "tools": {"pytest": has("pytest"),',
	'  "randomly": has("pytest_randomly"), "mypy": has("mypy"), "black": has("black"), "pytestDjango": has("pytest_django")}}))',
].join('\n');

const SHIM = /(^|\/)(\.pyenv\/shims|\.asdf\/shims|mise\/shims|\.local\/share\/mise\/shims)\//;

/** Runs the probe; a plain message when the file does not run as Python. */
export function probePython(file: string): PyInterpreter | string {
	const result = spawnSync(file, ['-I', '-c', PROBE], { encoding: 'utf8', timeout: 30_000, cwd: os.tmpdir() });
	try {
		const probed = JSON.parse(result.stdout) as Omit<PyInterpreter, 'path'>;
		return { ...probed, path: file };
	} catch {
		return `${file} did not run as Python: ${(result.stderr || result.error?.message || 'no output').trim().split('\n').pop()}`;
	}
}

/** Why this interpreter cannot be used for splits, or undefined. */
export function interpreterProblem(python: PyInterpreter): string | undefined {
	const [major, minor] = python.version;
	if (SHIM.test(python.path)) {
		return `${python.path} is a version-manager shim, which picks a Python per folder at each run. Choose the interpreter it points to.`;
	}
	if (python.implementation !== 'cpython') { return `Python splitting needs CPython; ${python.path} is ${python.implementation}.`; }
	if (major === 3 && minor >= 15) { return 'Python splitting needs Python 3.9 to 3.14 for now.'; }
	if (major !== 3 || minor < 9) { return `Python splitting needs Python 3.9 to 3.14; ${python.path} is ${python.version.join('.')}.`; }
	return undefined;
}

/** The first line a read-only tool prints, or undefined (never through a shell). */
function ask(tool: string, args: readonly string[], cwd: string): string | undefined {
	const bin = findTool(tool, [path.join(os.homedir(), '.local', 'bin')]);
	if (!bin) { return undefined; }
	const result = spawnSync(bin, [...args], { cwd, encoding: 'utf8', timeout: 30_000 });
	return result.status === 0 ? result.stdout.trim().split('\n').pop() : undefined;
}

const EXE = process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');

/** Interpreters for a project: a venv in its folder, Poetry, Pipenv or Hatch when configured, and pyenv versions it names. */
export function pythonCandidates(folder: string): string[] {
	const root = path.resolve(folder);
	const found: string[] = [];
	for (const dir of ['.venv', 'venv', 'env']) {
		if (existsSync(path.join(root, dir, 'pyvenv.cfg')) && existsSync(path.join(root, dir, EXE))) { found.push(path.join(root, dir, EXE)); }
	}
	const has = (file: string) => existsSync(path.join(root, file));
	const pyproject = has('pyproject.toml') ? readFileSync(path.join(root, 'pyproject.toml'), 'utf8') : '';
	if (has('poetry.lock') || /^\[tool\.poetry\]/m.test(pyproject)) { found.push(ask('poetry', ['env', 'info', '--executable'], root) ?? ''); }
	if (has('Pipfile')) { found.push(ask('pipenv', ['--py'], root) ?? ''); }
	if (has('hatch.toml') || /^\[tool\.hatch[.\]]/m.test(pyproject)) {
		const env = ask('hatch', ['env', 'find'], root);
		found.push(env ? path.join(env, EXE) : '');
	}
	if (has('.python-version')) {
		for (const version of readFileSync(path.join(root, '.python-version'), 'utf8').split(/\s+/).filter(Boolean)) {
			found.push(path.join(os.homedir(), '.pyenv', 'versions', version, 'bin', 'python'));
		}
	}
	return [...new Set(found.filter(file => file && existsSync(file)))];
}

/** The user's pick per project folder, in global storage. */
function picks(storageDir: string): Record<string, string> {
	try { return JSON.parse(readFileSync(path.join(storageDir, 'python-interpreters.json'), 'utf8')) as Record<string, string>; } catch { return {}; }
}

export function rememberPython(storageDir: string, root: string, file: string | undefined): void {
	const all = picks(storageDir);
	if (file) { all[root] = file; } else { delete all[root]; }
	mkdirSync(storageDir, { recursive: true });
	writeFileSync(path.join(storageDir, 'python-interpreters.json'), `${JSON.stringify(all, null, '\t')}\n`);
}

/** Asks the user: confirm one candidate, pick among several, or pick a file; undefined when they decline. */
export type ChoosePython = (candidates: readonly string[]) => Promise<string | undefined>;

/**
 * The project's interpreter: the remembered pick, else the user's choice among the candidates, probed and checked
 * against the version gate. A plain message when there is none to use.
 */
export async function pythonFor(root: string, storageDir: string, choose: ChoosePython): Promise<PyInterpreter | string> {
	let file = picks(storageDir)[root];
	if (!file || !existsSync(file)) {
		file = await choose(pythonCandidates(root)) ?? '';
		if (!file) { return 'No Python interpreter was chosen, so nothing was changed. Run **AI-Ready: Choose Python Interpreter** to pick one.'; }
	}
	const python = probePython(file);
	if (typeof python === 'string') { return python; }
	const problem = interpreterProblem(python);
	if (problem) { return problem; }
	rememberPython(storageDir, root, file);
	return python;
}

/**
 * The env for every approved command: the interpreter's folder first on PATH, the venv, the import roots on
 * PYTHONPATH (so tests import the branch, not an editable install of the user's folder), and no caches in the worktree.
 */
export function pythonEnv(python: PyInterpreter, roots: readonly string[], storageDir: string, worktree: string): Record<string, string> {
	const cache = path.join(storageDir, 'mypy-cache', createHash('sha1').update(worktree).digest('hex').slice(0, 12));
	return {
		PATH: `${path.dirname(python.path)}${path.delimiter}${process.env.PATH ?? ''}`,
		...(python.venv ? { VIRTUAL_ENV: python.prefix } : {}),
		PYTHONPATH: roots.join(path.delimiter), PYTHONDONTWRITEBYTECODE: '1', PYTHONHASHSEED: '0', NO_COLOR: '1', PY_COLORS: '0', MYPY_CACHE_DIR: cache,
	};
}

/** What the approval modal says about the interpreter, so a wrong pick is visible before anything runs. */
export function pythonApprovalNote(python: PyInterpreter, requiresPython: string | undefined, env: Readonly<Record<string, string>>): string {
	const shown = ['PYTHONPATH', 'VIRTUAL_ENV', 'PYTHONDONTWRITEBYTECODE', 'PYTHONHASHSEED'].filter(key => env[key]).map(key => `${key}=${env[key]}`);
	return `Python: ${python.path} (${python.version.join('.')}, sys.prefix ${python.prefix}); the project asks for `
		+ `${requiresPython ? `Python ${requiresPython}` : 'no Python version'}. Commands run with ${shown.join(', ')}, the interpreter's folder first on PATH. `;
}
