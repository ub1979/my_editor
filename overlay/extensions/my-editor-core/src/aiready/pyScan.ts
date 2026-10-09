import * as path from 'path';

/** Where a tracked file does something a rule cares about: `file:line`. */
type Where = string;

/** How tracked code patches or assigns one module's attributes, for *Patches that would stop working*. */
export interface PyPatches {
	/** `'<module>.X'` string literals (patch targets), by X. */
	readonly strings: ReadonlyMap<string, Where>;
	/** `patch.object`, `monkeypatch.setattr`, `setattr`, `delattr`… on the module with a literal name, by name. */
	readonly named: ReadonlyMap<string, Where>;
	/** `<module>.X = …` and `del <module>.X`, by X. */
	readonly assigned: ReadonlyMap<string, Where>;
	/** Any of those calls on the module at all (a non-literal name included). */
	readonly objectUse?: Where;
	/** A string built with the module's dotted name as a prefix (an f-string or concatenation). */
	readonly prefix?: Where;
}

/** Project-wide facts from the text of tracked files. */
export interface PyScan {
	/** Why the project may pickle by reference (a tracked file's use), if it may. */
	readonly pickles?: string;
	/** Why the project looks at where things are defined (`__module__`, `inspect.getmodule`…), if it does. */
	readonly moduleReaders?: string;
	readonly scriptPaths: ReadonlySet<string>;
	readonly scriptModules: ReadonlySet<string>;
	readonly folderScans: readonly { readonly file: string; readonly literal?: string; readonly own?: boolean; readonly below?: boolean }[];
	readonly migrationWords: ReadonlySet<string>;
	readonly pytestPlugins: ReadonlySet<string>;
	readonly starImports: readonly { readonly file: string; readonly module: string }[];
	readonly warningLines: readonly { readonly file: string; readonly text: string }[];
}

const PICKLERS = ['pickle', 'cPickle', '_pickle', 'dill', 'cloudpickle', 'joblib', 'shelve', 'jsonpickle', 'copyreg', 'multiprocessing', 'celery', 'rq',
	'dramatiq', 'ray', 'dask'];
const PICKLE_IMPORT = new RegExp(`^[ \\t]*(?:import\\s+(?:[\\w.]+(?:\\s+as\\s+\\w+)?\\s*,\\s*)*|from\\s+)(${PICKLERS.join('|')})\\b`, 'm');
const PICKLE_USE = /\bProcessPoolExecutor\b|\btorch\.(?:save|load)\s*\(|\byaml\.(?:unsafe_load|Loader|UnsafeLoader)\b|\bdef\s+__reduce(?:_ex)?__\b/;
const MODULE_READ = /\b__module__\b|\binspect\.(?:getmodule|getmembers)\b|\b(?:getmodule|getmembers)\s*\(|\bpyclbr\b/;
/** An interpreter (`python3.12`, `$(PYTHON)`, `${PYTHON}`, tox's `{envpython}`), options (`-W error`, `-X dev`), then `-m` or a file. */
const SCRIPT = new RegExp([/(?:\bpython(?:\d+(?:\.\d+)?)?|\$\(\w*PYTHON\w*\)|\$\{\w*PYTHON\w*\}|\{envpython\})(?:\.exe)?\s+/,
	/(?:-[WX]\s*\S+\s+|-[A-Za-z]+\s+)*(?:-m\s*([\w.]+)|([\w./-]+\.py)\b)/].map(re => re.source).join(''), 'g');
/** `[sys.executable, "-m", "pkg.mod"]`-style argument lists and `runpy.run_module("pkg.mod")`. */
const SCRIPT_CALL = /["']-m["']\s*,\s*["']([\w.]+)["']|\brunpy\.run_module\s*\(\s*["']([\w.]+)["']|\brunpy\.run_path\s*\(\s*["']([\w./-]+\.py)["']/g;
const FOLDER_CALL = new RegExp([/\b(?:pkgutil\.)?(?:iter_modules|walk_packages)\s*\(/, /\bos\.(?:listdir|scandir|walk)\s*\(/, /\bglob\.i?glob\s*\(/,
	/\.r?glob\s*\(/, /\.iterdir\s*\(/, /\bresources\.files\s*\(/].map(re => re.source).join('|'), 'g');

function lineAt(text: string, index: number): number {
	return text.slice(0, index).split('\n').length;
}

/** The text of a call's arguments (and the line before it, for a receiver like `Path(__file__).parent.glob(`). */
function callText(text: string, index: number, length: number): string {
	const start = text.lastIndexOf('\n', index) + 1;
	let depth = 0;
	let end = index + length;
	for (; end < text.length && end < index + 400; end++) {
		if (text[end] === '(') { depth++; } else if (text[end] === ')') { if (depth === 0) { break; } depth--; }
	}
	return text.slice(start, end);
}

/** Names a file binds to the project's modules (or names in them): `import pkg.x as m`, `from pkg import x`, relative imports, `import_module`. */
function projectNames(text: string, packages: readonly string[]): string[] {
	const ours = (module: string) => packages.includes(module.split('.')[0]);
	const names: string[] = [];
	for (const m of text.matchAll(/^[ \t]*import\s+([^\n#]+)/gm)) {
		for (const [name, alias] of m[1].split(',').map(p => p.trim().split(/\s+as\s+/))) { if (ours(name)) { names.push(alias ?? name.split('.')[0]); } }
	}
	for (const m of text.matchAll(/^[ \t]*from\s+(\.*)([\w.]*)\s+import\s+(\([^)]*\)|[^\n#]*)/gm)) {
		if (!m[1] && !ours(m[2])) { continue; }
		names.push(...m[3].replace(/#[^\n]*|[()]/g, '').split(',').map(p => p.trim().split(/\s+as\s+/).pop()!).filter(n => /^\w+$/.test(n)));
	}
	for (const m of text.matchAll(/^[ \t]*(\w+)\s*=\s*(?:importlib\.)?import_module\s*\(\s*["']([\w.]+)["']/gm)) { if (ours(m[2])) { names.push(m[1]); } }
	return [...new Set(names)];
}

/** `vars(m)` or `m.__dict__` of a name bound to a project module: the project lists what a module defines. */
function moduleView(text: string, packages: readonly string[]): RegExpExecArray | null {
	const names = projectNames(text, packages).map(esc).join('|');
	return names ? new RegExp(`\\bvars\\s*\\(\\s*(?:${names})\\b[\\w.]*\\s*\\)|(?<![\\w.])(?:${names})(?:\\.\\w+)*\\.__dict__\\b`).exec(text) : null;
}

/** Scans tracked files: `.py`/`.pyi` code for uses, and every text file for script references and `!!python/` tags. */
export function pyScan(texts: ReadonlyMap<string, string>, packages: readonly string[] = []): PyScan {
	let pickles: string | undefined;
	let moduleReaders: string | undefined;
	const scriptPaths = new Set<string>();
	const scriptModules = new Set<string>();
	const folderScans: PyScan['folderScans'][number][] = [];
	const migrationWords = new Set<string>();
	const pytestPlugins = new Set<string>();
	const starImports: { file: string; module: string }[] = [];
	const warningLines: { file: string; text: string }[] = [];
	for (const [file, text] of texts) {
		const code = /\.pyi?$/.test(file);
		if (!code) {
			if (!pickles && text.includes('!!python/')) { pickles = `${file} uses a PyYAML !!python/ tag`; }
		}
		for (const m of [...text.matchAll(SCRIPT), ...text.matchAll(SCRIPT_CALL)]) {
			const module = m[1] ?? (m.length > 3 ? m[2] : undefined);
			const file = m.length > 3 ? m[3] : m[2];
			if (module) { scriptModules.add(module); } else if (file) { scriptPaths.add(path.posix.normalize(file)); }
		}
		for (const line of text.split('\n').filter(l => /filterwarnings|simplefilter|-W\s*\S|PYTHONWARNINGS/.test(l))) { warningLines.push({ file, text: line }); }
		// A call spread over lines names its module= on a later one: the whole call counts.
		for (const m of code ? text.matchAll(/\b(?:filterwarnings|simplefilter)\s*\(/g) : []) {
			warningLines.push({ file, text: callText(text, m.index!, m[0].length) });
		}
		if (!code) { continue; }
		const pickle = PICKLE_IMPORT.exec(text) ?? PICKLE_USE.exec(text);
		if (!pickles && pickle) { pickles = `${file}:${lineAt(text, pickle.index)} uses ${(pickle[1] ?? pickle[0]).trim()}`; }
		const reader = MODULE_READ.exec(text) ?? moduleView(text, packages);
		if (!moduleReaders && reader) { moduleReaders = `${file}:${lineAt(text, reader.index)} reads ${reader[0].replace(/\s*\($/, '')}`; }
		for (const m of text.matchAll(FOLDER_CALL)) {
			const call = callText(text, m.index!, m[0].length);
			const literal = [...call.matchAll(/["']([\w./-]+)["']/g)].map(l => l[1]).find(l => !l.includes('*'));
			if (/\w\.__path__/.test(call)) { folderScans.push({ file, below: true }); }
			else if (/__file__|__path__/.test(call)) { folderScans.push({ file, own: true }); }
			else if (literal) { folderScans.push({ file, literal }); }
			else { folderScans.push({ file, below: true }); }
		}
		for (const m of text.matchAll(/\bimport_module\s*\(\s*(?:f["']([\w.]+)\{|["']([\w.]+)["']\s*\+)/g)) {
			folderScans.push({ file, literal: (m[1] ?? m[2]).replace(/\.$/, '') });
		}
		if (/(^|\/)migrations\//.test(file)) { for (const w of text.match(/\b[A-Za-z_]\w*\b/g) ?? []) { migrationWords.add(w); } }
		for (const m of text.matchAll(/^pytest_plugins\s*=\s*([^\n]*(?:\n[ \t][^\n]*)*)/gm)) {
			for (const w of m[1].matchAll(/["']([\w.]+)["']/g)) { pytestPlugins.add(w[1]); }
		}
		for (const m of text.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import\s+\*/gm)) { starImports.push({ file, module: m[1] }); }
	}
	return { pickles, moduleReaders, scriptPaths, scriptModules, folderScans, migrationWords, pytestPlugins, starImports, warningLines };
}

/** Whether a scan finds the folder `dir` (relative, `.` for the top) holding `file`: by `__file__`/`__path__`, a literal, or below a non-literal. */
export function folderScanned(scan: PyScan, dir: string, roots: readonly string[]): string | undefined {
	const under = (folder: string) => dir === folder || folder === '.' || dir.startsWith(`${folder}/`);
	for (const s of scan.folderScans) {
		const own = path.posix.dirname(s.file);
		if (s.own && own === dir) { return `${s.file} lists the files of ${dir}/`; }
		if (s.below && under(own)) { return `${s.file} lists files in a folder it computes, which may be ${dir}/`; }
		if (s.literal) {
			const candidates = [s.literal, path.posix.join(own, s.literal), ...roots.map(r => path.posix.join(r, s.literal!.replace(/\./g, '/')))];
			if (candidates.map(c => path.posix.normalize(c).replace(/\/$/, '')).includes(dir)) { return `${s.file} lists the files of ${dir}/ by name`; }
		}
	}
	return undefined;
}

/** Local names (or dotted chains) that a file binds to `module`, from its import lines. */
export function moduleAliases(text: string, module: string, filePackage: string): string[] {
	const [parent, leaf] = module.includes('.') ? [module.slice(0, module.lastIndexOf('.')), module.slice(module.lastIndexOf('.') + 1)] : ['', module];
	const found = new Set<string>();
	for (const m of text.matchAll(/^[ \t]*import\s+([^\n#]+)/gm)) {
		for (const part of m[1].split(',').map(p => p.trim())) {
			const [name, alias] = part.split(/\s+as\s+/);
			if (name === module) { found.add(alias ?? module); }
		}
	}
	for (const m of text.matchAll(/^[ \t]*(\w+)\s*=\s*(?:importlib\.)?import_module\s*\(\s*["']([\w.]+)["']\s*\)/gm)) {
		if (m[2] === module) { found.add(m[1]); }
	}
	for (const m of text.matchAll(/^[ \t]*from\s+(\.*)([\w.]*)\s+import\s+(\([^)]*\)|[^\n]*)/gm)) {
		const base = m[1] ? resolveRelative(filePackage, m[1].length, m[2]) : m[2];
		if (base !== parent) { continue; }
		for (const part of m[3].replace(/#[^\n]*/g, '').replace(/[()]/g, '').split(',').map(p => p.trim()).filter(Boolean)) {
			const [name, alias] = part.split(/\s+as\s+/);
			if (name === leaf) { found.add(alias ?? leaf); }
		}
	}
	return [...found];
}

export function resolveRelative(pkg: string, level: number, module: string): string {
	const base = pkg.split('.').slice(0, Math.max(0, pkg.split('.').length - (level - 1))).join('.');
	return module ? (base ? `${base}.${module}` : module) : base;
}

function esc(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How tracked `.py`/`.pyi` files patch, assign or name attributes of `module` (dotted). */
export function patchFacts(texts: ReadonlyMap<string, string>, module: string, packageOf: (file: string) => string): PyPatches {
	const strings = new Map<string, Where>();
	const named = new Map<string, Where>();
	const assigned = new Map<string, Where>();
	let objectUse: Where | undefined;
	let prefix: Where | undefined;
	const m = esc(module);
	for (const [file, text] of texts) {
		if (!/\.pyi?$/.test(file)) { continue; }
		const at = (index: number) => `${file}:${lineAt(text, index)}`;
		for (const s of text.matchAll(new RegExp(`["']${m}\\.(\\w+)`, 'g'))) { if (!strings.has(s[1])) { strings.set(s[1], at(s.index!)); } }
		const built = new RegExp([`(?<![\\w])(?:[rRbB]?[fF]|[fF][rRbB])["']${m}\\.`, `["']${m}\\.(?=[{%])`, `["']${m}\\.["']\\s*\\+`,
			`["']${m}["']\\s*\\+\\s*["']\\.`,
			`%\\s*\\(?\\s*["']${m}["']`, `\\.format\\s*\\([^)]*["']${m}["']`].join('|')).exec(text);
		if (built && !prefix) { prefix = at(built.index); }
		const chains = [...new Set([...moduleAliases(text, module, packageOf(file)), module])].map(esc);
		for (const chain of chains) {
			const call = `\\b(?:patch\\.object|patch\\.multiple|monkeypatch\\.setattr|monkeypatch\\.delattr|setattr|delattr)\\s*\\(\\s*${chain}`;
			for (const c of text.matchAll(new RegExp(`${call}\\s*,\\s*(["'](\\w+)["'])?`, 'g'))) {
				objectUse ??= at(c.index!);
				if (c[2] && !named.has(c[2])) { named.set(c[2], at(c.index!)); }
			}
			for (const t of targets(text)) {
				for (const a of t.text.matchAll(new RegExp(`(?<![\\w.])${chain}\\.(\\w+)\\s*(?=[,)]|$)`, 'g'))) {
					if (!assigned.has(a[1])) { assigned.set(a[1], at(t.index)); }
				}
			}
		}
	}
	return { strings, named, assigned, objectUse, prefix };
}

/** Assignment targets (tuples included, not calls) and `del` lists of each line, with where the line starts. */
function targets(text: string): { text: string; index: number }[] {
	const out: { text: string; index: number }[] = [];
	for (const m of text.matchAll(/^[ \t]*(?:del\s+([^\n#]+)|([^\n=#"']*?)\s*(?:\*\*|\/\/|<<|>>|[-+*/%@&|^])?=(?!=))/gm)) {
		const found = (m[1] ?? m[2]).trim();
		if (m[1] !== undefined || !/\w\s*\(|[<>!]$/.test(found)) { out.push({ text: found, index: m.index! }); }
	}
	return out;
}

/** Where tracked code reloads `module` or a name it cannot resolve, or edits `sys.modules` for it, its package or a computed key. */
export function replacedModule(texts: ReadonlyMap<string, string>, module: string, packageOf: (file: string) => string): string | undefined {
	const pkg = module.includes('.') ? module.slice(0, module.lastIndexOf('.')) : module;
	const names = (key: string) => key === module || key === pkg || module.startsWith(`${key}.`);
	for (const [file, text] of texts) {
		if (!/\.py$/.test(file)) { continue; }
		const aliases = new Set(moduleAliases(text, module, packageOf(file)));
		const imported = new Set([...text.matchAll(/^[ \t]*(?:from\s+\S+\s+)?import\s+([^\n#]+)/gm)].flatMap(m => m[1].replace(/[()]/g, '').split(',')
			.map(p => (p.trim().split(/\s+as\s+/)[1] ?? p.trim().split('.')[0]).trim())));
		for (const r of text.matchAll(/\b(?:importlib\.|imp\.)?reload\s*\(\s*([\w.]+)\s*\)/g)) {
			if (aliases.has(r[1]) || r[1] === module || !imported.has(r[1].split('.')[0])) { return `${file}:${lineAt(text, r.index!)} reloads ${r[1]}`; }
		}
		const edits = new RegExp([/\bsys\.modules\s*(?:\[\s*([^\]]+?)\s*\]\s*(?:=(?!=)|$)|\.(?:pop|update|setdefault|clear)\s*\(([^)]*))/,
			/\bdel\s+sys\.modules\s*\[\s*([^\]]+)\]/].map(re => re.source).join('|'), 'gm');
		for (const s of text.matchAll(edits)) {
			const key = (s[1] ?? s[2] ?? s[3] ?? '').trim();
			const literal = /^["']([\w.]+)["']/.exec(key)?.[1];
			if (!literal || names(literal)) { return `${file}:${lineAt(text, s.index!)} changes sys.modules[${key || '…'}]`; }
		}
		for (const p of text.matchAll(/\bpatch\.dict\s*\(\s*(?:sys\.modules|["']sys\.modules["'])\s*,\s*(\{[^}]*\}|[^,)]+)/g)) {
			const keys = [...p[1].matchAll(/["']([\w.]+)["']\s*:/g)].map(k => k[1]);
			if (!p[1].trim().startsWith('{') || keys.some(names)) { return `${file}:${lineAt(text, p.index!)} patches sys.modules`; }
		}
	}
	return undefined;
}
