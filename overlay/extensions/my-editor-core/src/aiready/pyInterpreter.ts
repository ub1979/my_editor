import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from 'fs';
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
	/** `sys.executable` as the probe saw it: a launcher or shim runs another file than the one chosen. */
	readonly executable?: string;
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
	'  "executable": sys.executable,',
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

/** A script (`#!`), as version-manager shims and wrappers are: it picks the real interpreter at each run. */
function script(file: string): boolean {
	try {
		const fd = openSync(file, 'r');
		try { const head = Buffer.alloc(2); return readSync(fd, head, 0, 2, 0) === 2 && head.toString('latin1') === '#!'; } finally { closeSync(fd); }
	} catch { return false; }
}

const real = (file: string) => { try { return realpathSync(file); } catch { return path.resolve(file); } };

/** A pyenv version named by `.python-version`: a plain name whose folder (followed through links) stays under ~/.pyenv/versions. */
function pyenvPython(name: string): string | undefined {
	const versions = path.join(os.homedir(), '.pyenv', 'versions');
	if (!/^[A-Za-z0-9][\w.+-]*$/.test(name) || name.includes('..')) { return undefined; }
	const folder = path.join(versions, name);
	return real(folder).startsWith(`${real(versions)}${path.sep}`) ? path.join(folder, 'bin', 'python') : undefined;
}

/** Why an interpreter in the project folder cannot be trusted: its environment folder came with the repository (tracked by git). */
export function trackedInterpreter(root: string, file: string): string | undefined {
	for (const at of new Set([path.resolve(file), real(file)])) {
		const rel = [path.relative(path.resolve(root), at), path.relative(real(root), at)].find(r => r && !r.startsWith('..') && !path.isAbsolute(r));
		if (!rel) { continue; }
		const parts = rel.split(path.sep);
		const folder = parts.length > 2 ? parts.slice(0, -2).join(path.sep) : parts.length === 2 ? parts[0] : rel;
		const listed = spawnSync('git', ['ls-files', '-z', '--', folder], { cwd: root, encoding: 'utf8', timeout: 30_000 });
		if (listed.status === 0 && listed.stdout) {
			return `${folder} is tracked by git, so ${file} came with the repository; choose an interpreter you installed.`;
		}
	}
	return undefined;
}

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
		for (const version of readFileSync(path.join(root, '.python-version'), 'utf8').split(/\s+/).filter(Boolean)) { found.push(pyenvPython(version) ?? ''); }
	}
	return [...new Set(found.filter(file => file && existsSync(file) && !script(file) && !trackedInterpreter(root, file)))];
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
	const remembered = !!file && existsSync(file);
	if (!remembered) {
		file = await choose(pythonCandidates(root)) ?? '';
		if (!file) { return 'No Python interpreter was chosen, so nothing was changed. Run **AI-Ready: Choose Python Interpreter** to pick one.'; }
	}
	const python = checkedPython(root, file);
	if (typeof python === 'string') { return remembered ? `${python} Run **AI-Ready: Choose Python Interpreter** to pick another.` : python; }
	rememberPython(storageDir, root, file);
	return python;
}

/** Probes a chosen file and checks it: the version gate, a launcher that runs another file, a pick tracked by git. */
export function checkedPython(root: string, file: string): PyInterpreter | string {
	const tracked = trackedInterpreter(root, file);
	if (tracked) { return tracked; }  // Before the probe: a file that came with the repository never runs.
	const python = probePython(file);
	if (typeof python === 'string') { return python; }
	const problem = interpreterProblem(python);
	if (problem) { return problem; }
	if (python.executable && real(python.executable) !== real(file)) {
		return `${file} runs ${python.executable}; choose that interpreter instead (a launcher or shim can pick another one at each run).`;
	}
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

/** Whether a version meets a PEP 440 specifier set (`>=3.10,<3.13`, `~=3.12`, `==3.11.*`); undefined for a clause it cannot read. */
export function meetsSpec(version: readonly number[], spec: string): boolean | undefined {
	const cmp = (a: readonly number[], b: readonly number[]) => {
		for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) { return (a[i] ?? 0) - (b[i] ?? 0); } }
		return 0;
	};
	const prefix = (want: readonly number[]) => want.every((n, i) => version[i] === n);
	let ok = true;
	for (const clause of spec.split(',').map(c => c.trim()).filter(Boolean)) {
		const m = /^(~=|===?|!=|<=|>=|<|>)\s*(\d+(?:\.\d+)*)(\.\*)?$/.exec(clause);
		if (!m) { return undefined; }
		const want = m[2].split('.').map(Number);
		const c = cmp(version, want);
		const met = m[3] ? (m[1] === '!=' ? !prefix(want) : prefix(want))
			: { '~=': c >= 0 && prefix(want.slice(0, -1)), '==': c === 0, '===': c === 0, '!=': c !== 0, '<=': c <= 0, '>=': c >= 0, '<': c < 0, '>': c > 0 }[m[1]];
		ok &&= !!met;
	}
	return ok;
}

/** What the approval modal says about the interpreter, so a wrong pick is visible before anything runs. */
export function pythonApprovalNote(python: PyInterpreter, requiresPython: string | undefined, env: Readonly<Record<string, string>>): string {
	const shown = ['PYTHONPATH', 'VIRTUAL_ENV', 'PYTHONDONTWRITEBYTECODE', 'PYTHONHASHSEED'].filter(key => env[key]).map(key => `${key}=${env[key]}`);
	const version = python.version.join('.');
	const unmet = requiresPython && meetsSpec(python.version, requiresPython) === false
		? `**${version} does not satisfy requires-python ${requiresPython}**, so the checks may not show how the project runs. ` : '';
	return `Python: ${python.path} (${version}, sys.prefix ${python.prefix}); the project asks for `
		+ `${requiresPython ? `Python ${requiresPython}` : 'no Python version'}. ${unmet}`
		+ `Commands run with ${shown.join(', ')}, the interpreter's folder first on PATH. `;
}
