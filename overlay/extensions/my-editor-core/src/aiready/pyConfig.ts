import * as path from 'path';

/** One `key = value` of a TOML or INI file, under its section (`tool.pytest.ini_options`, `mypy-pkg.mod`). */
export interface ConfigEntry {
	readonly file: string;
	readonly section: string;
	readonly key: string;
	readonly value: string;
}

/** Python tool config files whose text the adapter reads. */
export const CONFIG_FILES = new RegExp(`(^|/)(${['pyproject.toml', 'setup.cfg', 'tox.ini', 'pytest.ini', 'mypy.ini', '.mypy.ini', '.flake8', '.coveragerc',
	'ruff.toml', '.ruff.toml', 'pyrightconfig.json'].map(name => name.replace(/\./g, '\\.')).join('|')})$`);

/**
 * Sections and keys of TOML and INI files, line by line: a value goes on while brackets or triple quotes are open, or
 * (INI) while lines are indented. Enough for the settings below; not a full TOML parser.
 */
export function configEntries(file: string, text: string): ConfigEntry[] {
	const out: ConfigEntry[] = [];
	let section = '';
	let current: { key: string; value: string } | undefined;
	let open = 0;
	const flush = () => { if (current) { out.push({ file, section, ...current }); } current = undefined; };
	for (const raw of text.split('\n')) {
		const line = raw.replace(/\r$/, '');
		if (current && (open > 0 || (/^[ \t]+\S/.test(line) && !file.endsWith('.toml')))) {
			current.value += `\n${line}`;
			open += depth(line);
			continue;
		}
		const header = /^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/.exec(line);
		if (header) { flush(); section = header[1].trim().replace(/^"|"$/g, ''); open = 0; continue; }
		const pair = /^\s*("[^"]*"|'[^']*'|[\w.\- ]+?)\s*[=:]\s*(.*)$/.exec(line);
		if (pair && !line.trim().startsWith('#')) {
			flush();
			current = { key: pair[1].replace(/["']/g, '').trim(), value: pair[2] };
			open = depth(pair[2]);
		}
	}
	flush();
	return out;
}

function depth(text: string): number {
	const code = text.replace(/"(?:[^"\\]|\\.)*"|'[^']*'|#.*$/g, '');
	return (code.match(/[[{]/g)?.length ?? 0) - (code.match(/[\]}]/g)?.length ?? 0) + ((text.match(/"""|'''/g)?.length ?? 0) % 2);
}

/** Every quoted string in a value; for an unquoted INI value, its comma, space or newline separated words. */
export function words(value: string): string[] {
	const quoted = [...value.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(m => m[1] ?? m[2]);
	return quoted.length ? quoted : value.split(/[\s,]+/).filter(Boolean);
}

export function entry(entries: readonly ConfigEntry[], section: RegExp, key: string): ConfigEntry | undefined {
	return entries.find(e => section.test(e.section) && e.key === key);
}

/** The lowest Python minor version a `requires-python` spec allows, when it names one (`>=3.10` → 10). */
export function lowestMinor(spec: string | undefined): number | undefined {
	const found = [...(spec ?? '').matchAll(/(>=|~=|==|>)\s*3\.(\d+)/g)].map(m => Number(m[2]) + (m[1] === '>' ? 1 : 0));
	return found.length ? Math.max(...found) : undefined;
}

/** PEP 503 normalized names of the project's declared dependencies. */
export function dependencyNames(entries: readonly ConfigEntry[], requirements: readonly string[]): string[] {
	const name = (spec: string) => /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1]?.toLowerCase().replace(/[-_.]+/g, '-');
	const listed = entries.flatMap(e => {
		if (/^project$/.test(e.section) && e.key === 'dependencies') { return words(e.value); }
		if (/^project\.optional-dependencies$/.test(e.section)) { return words(e.value); }
		if (/^tool\.poetry(\.group\.[^.]+)?\.(dev-)?dependencies$/.test(e.section)) { return [e.key]; }
		if (/^options$/.test(e.section) && ['install_requires', 'tests_require'].includes(e.key)) { return e.value.split('\n'); }
		return [];
	});
	const lines = requirements.flatMap(text => text.split('\n').filter(line => !/^\s*(#|-)/.test(line)));
	return [...new Set([...listed, ...lines].map(name).filter((n): n is string => !!n && n !== 'python'))];
}

/** Libraries that pickle functions and classes by module and qualified name (reviewer point 4): a dependency on one narrows to constants. */
export const PICKLING_LIBRARIES = ['dill', 'cloudpickle', 'joblib', 'jsonpickle', 'celery', 'rq', 'dramatiq', 'ray', 'dask', 'distributed', 'torch',
	'multiprocess', 'pathos', 'loky', 'huey', 'arq'];

/** The project's settings for Python tools, from its tracked config files. */
export interface PyToolConfig {
	readonly requiresPython?: string;
	/** Annotations count as deferred when the lowest allowed Python is 3.14 or later. */
	readonly deferredAnnotations: boolean;
	readonly lineLength: number;
	readonly formatter?: 'black' | 'ruff';
	/** `files` from the mypy config, when mypy is configured. */
	readonly mypy?: readonly string[];
	readonly pyright?: 'pyright' | 'basedpyright';
	readonly pythonFiles: readonly string[];
	readonly pythonPath: readonly string[];
	/** Modules loaded as pytest plugins: `-p` in addopts and the `pytest11` entry-point group. */
	readonly plugins: readonly string[];
	readonly dependencies: readonly string[];
	/** Why `.py` files are compiled (Cython or mypyc), if they are. */
	readonly compiled?: string;
	readonly entries: readonly ConfigEntry[];
}

const PYTEST = /^(tool\.pytest\.ini_options|pytest|tool:pytest)$/;

/** Reads the settings from `files` (path → text) of tracked config files, requirements files and setup.py. */
export function pyToolConfig(files: ReadonlyMap<string, string>): PyToolConfig {
	const entries = [...files].filter(([file]) => CONFIG_FILES.test(file) && !file.endsWith('.json') && !file.includes('/'))
		.flatMap(([file, text]) => configEntries(file, text));
	const requirements = [...files].filter(([file]) => /(^|\/)requirements[^/]*\.txt$/.test(file)).map(([, text]) => text);
	const requiresPython = entry(entries, /^project$/, 'requires-python')?.value ?? entry(entries, /^options$/, 'python_requires')?.value;
	const spec = requiresPython ? words(requiresPython)[0] : undefined;
	const minor = lowestMinor(spec);
	const length = entry(entries, /^tool\.(black|ruff)$|^$/, 'line-length')?.value;
	const mypyConfigured = entries.some(e => /^(tool\.mypy|mypy)$/.test(e.section)) || files.has('mypy.ini') || files.has('.mypy.ini');
	const mypyFiles = entry(entries, /^(tool\.mypy|mypy)$/, 'files');
	const pyrightConfig = entries.find(e => /^tool\.(pyright|basedpyright)$/.test(e.section))?.section;
	const addopts = entries.filter(e => PYTEST.test(e.section) && e.key === 'addopts').flatMap(e => words(e.value).join(' ').split(/\s+/));
	const plugins = [...addopts.flatMap((word, i) => (word === '-p' ? [addopts[i + 1]] : word.startsWith('-p') && word.length > 2 ? [word.slice(2)] : [])),
		...entries.filter(e => e.key === 'pytest11').flatMap(e => [...e.value.matchAll(/=\s*([\w.]+)/g)].map(m => m[1])),
		...entries.filter(e => /pytest11/.test(e.section)).flatMap(e => words(e.value).map(w => w.split(':')[0]))].filter(Boolean);
	const setup = files.get('setup.py') ?? '';
	const pyproject = files.get('pyproject.toml') ?? '';
	const compiled = /cythonize\s*\([^)]*\.py\b/.test(setup) ? 'setup.py builds .py files with Cython'
		: /\bmypycify\b/.test(setup) || /^\[tool\.mypyc\]|hatch-mypyc/m.test(pyproject) ? 'the project compiles .py files with mypyc' : undefined;
	return {
		requiresPython: spec, deferredAnnotations: minor !== undefined && minor >= 14, lineLength: length ? Number(words(length)[0]) || 88 : 88,
		formatter: entries.some(e => e.section === 'tool.black') ? 'black'
			: entries.some(e => /^tool\.ruff\.format$|^format$/.test(e.section)) ? 'ruff' : undefined,
		mypy: mypyConfigured ? (mypyFiles ? words(mypyFiles.value) : []) : undefined,
		pyright: files.has('pyrightconfig.json') || pyrightConfig === 'tool.pyright' ? 'pyright' : pyrightConfig ? 'basedpyright' : undefined,
		pythonFiles: (() => { const e = entry(entries, PYTEST, 'python_files'); return e ? words(e.value) : ['test_*.py', '*_test.py']; })(),
		pythonPath: (() => {
			const e = entry(entries, PYTEST, 'pythonpath');
			return e ? words(e.value).map(p => path.posix.normalize(p).replace(/\/$/, '')) : [];
		})(),
		plugins: [...new Set(plugins)], dependencies: dependencyNames(entries, requirements), compiled, entries,
	};
}

const TOOL_SECTION = /mypy|pyright|coverage|ruff|flake8|pytest|isort|pylint|bandit/;

/**
 * Where tracked tool config names the file by exact path or dotted module name (per-file ignores, mypy overrides,
 * pyright and coverage lists, `--cov=`), or where a packaging list names the file; undefined otherwise.
 */
export function configNaming(config: PyToolConfig, files: ReadonlyMap<string, string>, file: string, module: string): string | undefined {
	const exactPath = new RegExp(`(^|[\\s"'=,\\[:])(\\./)?${escape(file)}(?=$|[\\s"',\\]:])`, 'm');
	const dotted = new RegExp(`(^|[\\s"'=,\\[]|mypy-|--cov=)${escape(module)}(?=$|[\\s"',\\]])`, 'm');
	for (const e of config.entries) {
		if (exactPath.test(e.value) || exactPath.test(e.key)) { return `${e.file} names it in [${e.section}] ${e.key}`; }
		if ((TOOL_SECTION.test(e.section) || /addopts|module|omit|include|source/.test(e.key)) && (dotted.test(e.value) || dotted.test(e.section))) {
			return `${e.file} names ${module} in [${e.section}] ${e.key}`;
		}
	}
	const headers = config.entries.map(e => e.section).filter(s => s === `mypy-${module}`);
	if (headers.length) { return `a mypy config section [mypy-${module}] names it`; }
	const json = files.get('pyrightconfig.json') ?? '';
	return exactPath.test(json) ? 'pyrightconfig.json names it' : undefined;
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
