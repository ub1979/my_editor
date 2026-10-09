import { spawnSync } from 'child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'fs';
import * as path from 'path';
import type { CheckCommand } from './language';
import { configNaming, PICKLING_LIBRARIES, pyToolConfig, PyToolConfig } from './pyConfig';
import type { PyInterpreter } from './pyInterpreter';
import { pythonEnv } from './pyInterpreter';
import { splitCommand } from './projectCommands';
import { folderScanned, patchFacts, PyPatches, pyScan, PyScan, replacedModule, resolveRelative } from './pyScan';
import { globRegExp } from './tsScan';

/** Everything the Python adapter knows about a project, read once from its tracked files. */
export interface PyProject {
	readonly root: string;
	readonly python: PyInterpreter;
	readonly helperDir: string;
	readonly storageDir: string;
	readonly tracked: readonly string[];
	/** Tracked text files under 1 MB, by path. */
	readonly texts: ReadonlyMap<string, string>;
	readonly config: PyToolConfig;
	readonly scan: PyScan;
	/** Import roots, `.` for the top folder: it, `src` when packages live there, and pytest's `pythonpath`. */
	readonly roots: readonly string[];
	/** Top-level packages at the roots (folders with `__init__.py`), not tests, builds or environments. */
	readonly packages: readonly string[];
	readonly django: boolean;
	readonly hasTests: boolean;
	/** Stdlib module names a tracked file shadows at an import root. */
	readonly shadowed: ReadonlySet<string>;
	readonly generated: readonly RegExp[];
	/** Why functions and classes may not move (the project pickles by reference or reads `__module__`), if so. */
	readonly constantsOnly?: string;
}

const BINARY = /\.(png|jpe?g|gif|ico|pdf|zip|gz|tgz|whl|so|dylib|dll|exe|pyc|woff2?|ttf|sqlite3?|db|pkl|npy|npz|parquet|bin)$/i;
const NOT_PACKAGE = /^(tests?|testing|docs?|build|dist|venv|\.venv|env|site-packages|node_modules|vendor|_vendor|third_party)$/;

function readTexts(root: string, tracked: readonly string[]): Map<string, string> {
	const texts = new Map<string, string>();
	for (const file of tracked.filter(f => !BINARY.test(f))) {
		try {
			const buffer = readFileSync(path.join(root, file));
			if (buffer.length <= 1024 * 1024 && !buffer.includes(0)) { texts.set(file, buffer.toString('utf8')); }
		} catch { /* A tracked file deleted in the folder is not read. */ }
	}
	return texts;
}

/** Files a `.gitattributes` marks `linguist-generated`. */
function generatedPatterns(texts: ReadonlyMap<string, string>): RegExp[] {
	return [...texts].filter(([file]) => file.endsWith('.gitattributes')).flatMap(([file, text]) => {
		const dir = path.posix.dirname(file);
		return text.split('\n').filter(line => /\blinguist-generated(?!=false)\b/.test(line) && !/-linguist-generated/.test(line)).map(line => {
			const pattern = line.trim().split(/\s+/)[0].replace(/^\//, '');
			return globRegExp(`${dir === '.' ? '' : `${dir}/`}${pattern.includes('/') ? pattern : `**/${pattern}`}`);
		});
	});
}

/** Reads the project: tool config, scans of tracked files, import roots and packages. */
export function pyProject(root: string, python: PyInterpreter, helperDir: string, storageDir: string, tracked: readonly string[]): PyProject {
	const texts = readTexts(root, tracked);
	const config = pyToolConfig(texts);
	const scan = pyScan(texts);
	const set = new Set(tracked);
	const roots = ['.', ...(tracked.some(f => /^src\/[^/]+\/__init__\.py$/.test(f)) ? ['src'] : []), ...config.pythonPath.filter(p => p !== '.' && p !== 'src')];
	const packages = [...new Set(roots.flatMap(r => tracked.filter(f => path.posix.dirname(path.posix.dirname(f)) === r && f.endsWith('/__init__.py'))
		.map(f => path.posix.basename(path.posix.dirname(f)))))].filter(name => !NOT_PACKAGE.test(name)).sort();
	const shadows = (name: string) => roots.some(r => set.has(path.posix.join(r, `${name}.py`)) || set.has(path.posix.join(r, name, '__init__.py')));
	const shadowed = new Set(python.stdlib.filter(shadows));
	const dependency = config.dependencies.find(name => PICKLING_LIBRARIES.includes(name));
	const pickles = scan.pickles ?? (dependency ? `the project depends on ${dependency}` : undefined);
	return {
		root, python, helperDir, storageDir, tracked, texts, config, scan, roots, packages, shadowed, generated: generatedPatterns(texts),
		django: set.has('manage.py'), hasTests: tracked.some(f => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f)),
		constantsOnly: pickles ? `the project may pickle by reference: ${pickles}`
			: scan.moduleReaders ? `the project looks at where things are defined: ${scan.moduleReaders}` : undefined,
	};
}

const IDENTIFIER = /^[A-Za-z_]\w*$/;

/** A file's dotted module name and package, or why it is not a module in a regular package. */
export function moduleOf(project: PyProject, file: string): { module: string; package: string } | { skip: string } {
	const set = new Set(project.tracked);
	let found = false;
	for (const root of [...project.roots].sort((a, b) => b.length - a.length)) {
		const rel = root === '.' ? file : file.startsWith(`${root}/`) ? file.slice(root.length + 1) : undefined;
		if (rel === undefined) { continue; }
		const parts = rel.replace(/\.py$/, '').split('/');
		const dirs = parts.slice(0, -1);
		if (!dirs.length) { continue; }
		found = true;
		const regular = dirs.every((_, i) => set.has(path.posix.join(root, ...dirs.slice(0, i + 1), '__init__.py')));
		if (!regular || !parts.every(p => IDENTIFIER.test(p))) { continue; }
		const isInit = parts[parts.length - 1] === '__init__';
		const module = (isInit ? dirs : parts).join('.');
		return { module, package: isInit ? module : dirs.join('.') };
	}
	return { skip: found ? 'it is in a namespace package or a folder that is not a package (no __init__.py)' : 'a top-level module, not in a package' };
}

/** The package of any tracked file, for resolving its relative imports. */
export function packageOf(project: PyProject, file: string): string {
	const found = moduleOf(project, file);
	return 'skip' in found ? '' : found.package;
}

/** Project-level reasons a module is never split, beyond its own text. */
export function projectSkip(project: PyProject, file: string, module: string, pkg: string): string | undefined {
	const { config, scan, texts, root } = project;
	const dir = path.posix.dirname(file);
	const stem = file.replace(/\.py$/, '');
	const init = texts.get(path.posix.join(dir, '__init__.py')) ?? '';
	if (config.compiled) { return config.compiled; }
	if (project.tracked.includes(`${stem}.pyi`) || project.tracked.includes(`${stem}.pxd`)) {
		return 'a sibling .pyi or .pxd file goes with it, and new modules would need their own';
	}
	try { if (lstatSync(path.join(root, file)).isSymbolicLink()) { return 'it is a symlink'; } } catch { /* Missing files are caught when parsed. */ }
	if (/^(?:async\s+)?def\s+__(?:getattr|dir)__\s*\(|^__(?:getattr|dir)__\s*=/m.test(init)) {
		return 'its package __init__.py defines __getattr__ or __dir__ (a lazy package), which can run code when a sibling is looked up';
	}
	if (config.plugins.includes(module) || scan.pytestPlugins.has(module)) { return 'pytest loads it as a plugin'; }
	const scriptPath = [...scan.scriptPaths].find(p => p === file || file.endsWith(`/${p}`));
	if (scriptPath || scan.scriptModules.has(module)) { return `a tracked file runs it as a script (python ${scriptPath ?? `-m ${module}`})`; }
	const named = configNaming(config, texts, file, module);
	if (named) { return `${named}, and new files would not get the same treatment`; }
	const listed = scanned(project, dir);
	if (listed) { return listed; }
	const replaced = replacedModule(texts, module, f => packageOf(project, f));
	if (replaced) { return `${replaced}, which would not re-create moved definitions`; }
	const star = scan.starImports.find(s => (s.module.startsWith('.') ? resolveRelative(packageOf(project, s.file), s.module.match(/^\.*/)![0].length,
		s.module.replace(/^\.*/, '')) : s.module) === pkg);
	if (star && !/^__all__\s*[:=]/m.test(init)) {
		return `${star.file} does \`from ${star.module} import *\` and ${pkg}/__init__.py has no __all__, so new modules would be exported`;
	}
	if (project.generated.some(re => re.test(file))) { return 'generated code (linguist-generated)'; }
	if (path.posix.basename(file) === '_version.py' && /setuptools[_-]scm|versioneer/i.test(texts.get(file) ?? '')) { return 'generated code (a version file)'; }
	return undefined;
}

function scanned(project: PyProject, dir: string): string | undefined {
	return folderScanned(project.scan, dir, project.roots);
}

/** Tracked code patching or assigning the module's attributes. */
export function modulePatches(project: PyProject, module: string): PyPatches {
	return patchFacts(project.texts, module, f => packageOf(project, f));
}

/** Where tracked code or config filters warnings by this module, if anywhere. */
export function warningFilter(project: PyProject, module: string): string | undefined {
	const line = project.scan.warningLines.find(l => l.text.replace(/\\/g, '').includes(module));
	return line ? `${line.file} filters warnings by ${module}` : undefined;
}

/** The env of every approved command. */
export function pyCommandEnv(project: PyProject): Record<string, string> {
	return pythonEnv(project.python, project.roots.map(r => path.join(project.root, r)), project.storageDir, project.root);
}

function pycheckPath(project: PyProject): string {
	return path.join(project.helperDir, 'my_editor_pycheck.py');
}

/** Build (the import check), type checker and test commands for a module, in order. */
export function checkCommands(project: PyProject, module: string): CheckCommand[] {
	const { python, config } = project;
	const exe = path.basename(python.path);
	// By its path: `-m` would put the project folder first on sys.path, where a file of the same name could answer instead.
	const checks: CheckCommand[] = [{ label: 'build', command: `${exe} ${pycheckPath(project)} ${module}`, verifies: true }];
	if (config.mypy && python.tools.mypy) {
		checks.push({ label: 'vet', command: `${exe} -m mypy --no-error-summary --no-color-output ${config.mypy.length ? '' : project.packages.join(' ')}`.trim() });
	}
	if (config.pyright && existsSync(path.join(path.dirname(python.path), config.pyright))) { checks.push({ label: 'vet', command: config.pyright }); }
	if (!project.hasTests) { return checks; }
	if (project.django && !python.tools.pytestDjango) { checks.push({ label: 'test', command: `${exe} manage.py test --verbosity 2` }); }
	else if (python.tools.pytest) {
		checks.push({ label: 'test', command: `${exe} -m pytest -q -rA -p no:cacheprovider${python.tools.randomly ? ' -p no:randomly' : ''}` });
	}
	else { checks.push({ label: 'test', command: `${exe} -m unittest discover -v` }); }
	return checks;
}

/** Why tests would not run the worktree's code: a top-level package that still resolves outside it (an editable install). */
export function importRootProblem(project: PyProject): string | undefined {
	if (splitCommand(`python ${pycheckPath(project)} pkg.mod`)?.args[0] !== pycheckPath(project)) {
		return `The import check's folder ${project.helperDir} has a space or a character the command runner does not pass, so Python splits `
			+ 'cannot be verified from this install. Install my_editor in a folder without spaces.';
	}
	if (!project.packages.length) { return undefined; }
	// `-c` puts the current folder first on sys.path; drop it so a project file cannot shadow json or importlib here.
	const code = 'import sys\ndel sys.path[0]\nimport importlib.util, json\n'
		+ 'print(json.dumps({n: getattr(importlib.util.find_spec(n), "origin", None) for n in sys.argv[1:]}))';
	const result = spawnSync(project.python.path, ['-c', code, ...project.packages], {
		cwd: project.root, encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...pyCommandEnv(project) },
	});
	let origins: Record<string, string | null>;
	try { origins = JSON.parse(result.stdout) as Record<string, string | null>; }
	catch { return `Could not check where the project's packages import from: ${(result.stderr || 'no output').trim().split('\n').pop()}`; }
	const root = realpathSync(project.root);
	for (const [name, origin] of Object.entries(origins)) {
		const at = origin && existsSync(origin) ? realpathSync(origin) : origin;
		if (!at || !at.startsWith(`${root}${path.sep}`)) {
			return `The package ${name} imports from ${at ?? 'nowhere'}, not from the working copy, so tests would check other code. `
				+ 'An editable install or a .pth file may point at your folder; Python splits stop for this run.';
		}
	}
	return undefined;
}
