import * as path from 'path';
import type * as TS from 'typescript';
import type { Ts } from './tsLoad';

/** One tsconfig or jsconfig, parsed with its `extends` chain. */
export interface TsConfig {
	/** Relative to the root, `/`-separated. */
	readonly path: string;
	readonly options: TS.CompilerOptions;
	/** The files it holds, relative. */
	readonly files: ReadonlySet<string>;
	/** It has `references` (built with `tsc -b`). */
	readonly references: boolean;
	/** Another tracked config extends it and it is not a plain `tsconfig.json` (a base, not a build of its own). */
	readonly base: boolean;
	/** Why it could not be read fully (say, an `extends` that does not resolve). */
	readonly error?: string;
}

const CONFIG = /(^|\/)(tsconfig[^/]*|jsconfig)\.json$/;

/** Every tracked tsconfig and jsconfig under the root (not in `node_modules`), parsed from disk. */
export function readConfigs(ts: Ts, root: string, tracked: readonly string[]): TsConfig[] {
	const files = tracked.filter(file => CONFIG.test(file) && !/(^|\/)node_modules\//.test(file));
	const extended = new Set(files.flatMap(file => {
		const raw = ts.readConfigFile(path.join(root, file), ts.sys.readFile).config as { extends?: string | string[] } | undefined;
		const names = typeof raw?.extends === 'string' ? [raw.extends] : Array.isArray(raw?.extends) ? raw!.extends : [];
		return names.filter(name => name.startsWith('.')).map(name => path.posix.join(path.posix.dirname(file), name.endsWith('.json') ? name : `${name}.json`));
	}));
	return files.flatMap(file => {
		const parsed = parseConfig(ts, root, file);
		return parsed ? [{ ...parsed, base: extended.has(file) && !/(^|\/)[jt]sconfig\.json$/.test(file) }] : [];
	});
}

/** One config, or undefined when it cannot be read. Its file list reflects the files on disk now. */
export function parseConfig(ts: Ts, root: string, file: string): TsConfig | undefined {
	const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined };
	let parsed: TS.ParsedCommandLine | undefined;
	try { parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, file), {}, host); } catch { parsed = undefined; }
	if (!parsed) { return undefined; }
	const files = new Set(parsed.fileNames.map(name => path.relative(root, name).split(path.sep).join('/')));
	const error = parsed.errors.find(e => e.code !== 18003);
	return { path: file, options: parsed.options, files, references: !!parsed.projectReferences?.length, base: false,
		...(error ? { error: ts.flattenDiagnosticMessageText(error.messageText, ' ') } : {}) };
}

/** The config that holds a file: the one nearest to it (deepest folder first, `tsconfig.json` before others). */
export function holder(configs: readonly TsConfig[], file: string): TsConfig | undefined {
	const depth = (config: TsConfig) => config.path.split('/').length;
	const plain = (config: TsConfig) => (/(^|\/)tsconfig\.json$/.test(config.path) ? 0 : 1);
	return configs.filter(config => config.files.has(file)).sort((a, b) => depth(b) - depth(a) || plain(a) - plain(b))[0];
}

/** Every config that builds a file: those holding it that no other config extends (or the bases, when only they hold it). */
export function builds(configs: readonly TsConfig[], file: string): TsConfig[] {
	const holding = configs.filter(config => config.files.has(file));
	const own = holding.filter(config => !config.base);
	return own.length ? own : holding;
}

/** How a file is emitted: ES modules or CommonJS. `packageType` is the nearest package.json `type`. */
export function emitFormat(ts: Ts, file: string, options: TS.CompilerOptions, packageType: string | undefined): 'esm' | 'cjs' {
	const ext = path.extname(file);
	if (ext === '.cts' || ext === '.cjs') { return 'cjs'; }
	if (ext === '.mts' || ext === '.mjs') { return 'esm'; }
	const kind = options.module ?? ts.ModuleKind.None;
	if (kind <= ts.ModuleKind.System) { return 'cjs'; }
	if (kind >= ts.ModuleKind.Node16 && kind <= ts.ModuleKind.NodeNext) { return packageType === 'module' ? 'esm' : 'cjs'; }
	return 'esm';
}

/** How JSX is compiled: `classic` needs the factory in scope, `automatic` needs nothing, `other` is left to another tool. */
export function jsxMode(ts: Ts, options: TS.CompilerOptions | undefined): 'classic' | 'automatic' | 'other' {
	const jsx = options?.jsx;
	if (jsx === ts.JsxEmit.React) { return 'classic'; }
	if (jsx === ts.JsxEmit.ReactJSX || jsx === ts.JsxEmit.ReactJSXDev) { return 'automatic'; }
	return 'other';
}

/** The root names classic JSX needs in scope: the factory's and the fragment factory's (`React` by default). */
export function jsxRoots(options: TS.CompilerOptions | undefined): string[] {
	const root = (name: string | undefined) => (name ?? 'React').split('.')[0];
	return [...new Set([root(options?.jsxFactory ?? options?.reactNamespace), root(options?.jsxFragmentFactory ?? options?.reactNamespace)])];
}

/** Options for the analysis programs: the project's, without libraries or global types, and allowing JS. */
export function analysisOptions(ts: Ts, options: TS.CompilerOptions | undefined): TS.CompilerOptions {
	return {
		...options, noLib: true, types: [], typeRoots: [], noEmit: true, allowJs: true, checkJs: false, skipLibCheck: true,
		composite: false, incremental: false, declaration: false, tsBuildInfoFile: undefined,
		module: options?.module ?? ts.ModuleKind.ESNext,
		moduleResolution: options?.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
		jsx: options?.jsx ?? ts.JsxEmit.Preserve,
	};
}
