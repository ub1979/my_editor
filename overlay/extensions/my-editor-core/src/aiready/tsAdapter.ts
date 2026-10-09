import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'fs';
import * as path from 'path';
import type { FileInfo, LanguageAdapter, LanguageInfo } from './language';
import { runTool } from './projectCommands';
import { tsFileFacts } from './tsAst';
import { analysisOptions, builds, holder, jsxMode, jsxRoots, readConfigs, TsConfig } from './tsConfig';
import { cyclicFiles } from './tsGraph';
import type { Ts } from './tsLoad';
import { tsImportProblems, tsSameDeclarations } from './tsMoveCheck';
import {
	checkCommands, commandEnv, fileScope, LOCKFILES, nearestPackage, PackageJson, scopeReason, setupCommands, TsProject, tsProject, workspaceLinkProblem,
} from './tsProject';
import { tsSplitPrompt, tsTestPrompt } from './tsPrompts';
import { specifierStyle, TsFileContext, TsFileInfo, tsFileInfoView, tsFileNameProblems, tsSkipReason } from './tsRules';
import { findsFolder, frameworkFolder, globRegExp, PathFinder, pathFinders } from './tsScan';
import { buildTsSplit, tsSplitHeader } from './tsSplit';
import { parseTsTests } from './tsTests';
import { unitFacts, unitOf } from './tsUnit';

const CODE = /\.(?:[cm]?[jt]sx?)$/;

/** TypeScript and JavaScript as the core sees them before an adapter exists. */
export const TS_LANGUAGE: LanguageInfo = {
	label: 'TypeScript/JavaScript', extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs'], fixes: ['split'],
	mayDiffer: 'File names and line numbers in stack traces, `console.trace` and logger caller fields may differ for moved code, and so may '
		+ 'bundler chunk contents, hot-reload boundaries and source maps. Interfaces and type aliases moved in a types-only project change no '
		+ 'emitted JavaScript. The program’s behavior does not change.',
};

/** The lockfiles' hash while `node_modules` exists: what the install made is still in place. */
function installStamp(root: string): string | undefined {
	if (!existsSync(path.join(root, 'node_modules'))) { return undefined; }
	const hash = createHash('sha256');
	for (const [file] of LOCKFILES) {
		if (existsSync(path.join(root, file))) { hash.update(`${file}\0`).update(readFileSync(path.join(root, file))).update('\0'); }
	}
	return hash.digest('hex');
}

/** Whether the nearest package.json marks a file side-effect-free (`false`, or a list that does not match it). */
function sideEffectFree(found: { dir: string; pkg: PackageJson } | undefined, file: string): boolean {
	const flag = found?.pkg.sideEffects;
	if (flag === false) { return true; }
	if (!Array.isArray(flag)) { return false; }
	const relative = found!.dir === '.' ? file : file.slice(found!.dir.length + 1);
	return !flag.some(glob => globRegExp(glob.replace(/^\.\//, '').includes('/') ? glob.replace(/^\.\//, '') : `**/${glob}`).test(relative));
}

function hasWildcard(exports: unknown): boolean {
	if (!exports || typeof exports !== 'object') { return false; }
	return Object.entries(exports as Record<string, unknown>).some(([key, value]) => key.includes('*') || hasWildcard(value));
}

/** Files a `.gitattributes` marks `linguist-generated`. */
function generatedPatterns(root: string, tracked: readonly string[]): RegExp[] {
	return tracked.filter(file => file.endsWith('.gitattributes')).flatMap(file => {
		const dir = path.posix.dirname(file);
		let text = '';
		try { text = readFileSync(path.join(root, file), 'utf8'); } catch { return []; }
		return text.split('\n').filter(line => /\blinguist-generated(?!=false)\b/.test(line) && !/-linguist-generated/.test(line)).map(line => {
			const pattern = line.trim().split(/\s+/)[0].replace(/^\//, '');
			return globRegExp(`${dir === '.' ? '' : `${dir}/`}${pattern.includes('/') ? pattern : `**/${pattern}`}`);
		});
	});
}

/** The relative-import style of the original, else of its siblings when they all agree. */
function styleOf(root: string, file: string, own: ReturnType<typeof specifierStyle>, tracked: readonly string[]): TsFileInfo['style'] {
	if (own && own !== 'mixed') { return own; }
	if (own === 'mixed') { return undefined; }
	const dir = path.posix.dirname(file);
	const styles = new Set<string>();
	for (const sibling of tracked.filter(f => f !== file && path.posix.dirname(f) === dir && CODE.test(f))) {
		let text = '';
		try { text = readFileSync(path.join(root, sibling), 'utf8'); } catch { continue; }
		for (const match of text.matchAll(/\bfrom\s+['"](\.\.?\/[^'"]+)['"]/g)) {
			const ext = path.extname(match[1]);
			styles.add(/^\.[cm]?jsx?$/.test(ext) ? 'js' : /^\.[cm]?tsx?$/.test(ext) ? 'ts' : ext === '' ? 'none' : 'other');
		}
	}
	styles.delete('other');
	return styles.size === 1 ? [...styles][0] as TsFileInfo['style'] : undefined;
}

/**
 * The TypeScript and JavaScript language adapter for one root (the user's folder for the picker, the worktree for
 * fixes). All analysis runs here with the editor's TypeScript `ts`; the model only proposes groups of declaration IDs.
 */
export function createTsAdapter(root: string, ts: Ts, tracked: readonly string[]): LanguageAdapter {
	let project: TsProject | undefined;
	let cyclic: Set<string> | undefined;
	let finders: PathFinder[] | undefined;
	let generated: RegExp[] | undefined;
	const facts = () => (project ??= tsProject(ts, root, tracked));
	/** The tsconfig for a file; a new file uses the one that holds a sibling in its folder. */
	const nearest = (file: string) => holder(builds(facts().configs, file), file);
	const configFor = (file: string): TsConfig | undefined => nearest(file)
		?? facts().tracked.filter(f => path.posix.dirname(f) === path.posix.dirname(file)).map(nearest).find(Boolean);
	const optionsFor = (file: string) => analysisOptions(ts, configFor(file)?.options);
	const context = (file: string): TsFileContext => {
		const p = facts();
		const scoped = fileScope(ts, p, file);
		const config = configFor(file);
		const dir = path.posix.dirname(file);
		cyclic ??= cyclicFiles(ts, p);
		finders ??= pathFinders(p);
		generated ??= generatedPatterns(root, tracked);
		const finder = finders.find(f => f.file !== file && findsFolder(f, dir, [file, `${dir}/zzprobe${path.extname(file)}`]));
		const where = dir === '.' ? 'the top folder' : `${dir}/`;
		const pkg = nearestPackage(p, file);
		return {
			scope: 'skip' in scoped ? { skip: scoped.skip } : scoped.scope, scopeReason: scopeReason(ts, p, file),
			jsx: config ? jsxMode(ts, config.options) : 'other', emitDecoratorMetadata: !!config?.options.emitDecoratorMetadata, cyclic: cyclic.has(file),
			foundByPath: frameworkFolder(p, file) ?? (finder ? `${finder.file} finds files in ${where} by a path string` : undefined),
			sideEffectFree: sideEffectFree(pkg, file), exportsWildcard: hasWildcard(pkg?.pkg.exports),
			listedInFiles: !!pkg?.pkg.files?.some(entry => path.posix.normalize(path.posix.join(pkg.dir, entry)) === file),
			generatedAttribute: generated.some(re => re.test(file)),
		};
	};
	const roots = [root, ...(existsSync(root) ? [realpathSync(root)] : [])];
	const entries = (file: string) => { try { return readdirSync(path.join(root, path.posix.dirname(file))); } catch { return []; } };
	return {
		id: 'ts',
		...TS_LANGUAGE,
		get commandEnv() { return commandEnv(facts()); },
		async parse(file) {
			const text = readFileSync(path.join(root, file), 'utf8');
			const options = optionsFor(file);
			const fileFacts = tsFileFacts(ts, file, text, options);
			const ctx = context(file);
			const skip = facts().tracked.includes(file) ? tsSkipReason(file, text, fileFacts, ctx) : undefined;
			const info = tsFileInfoView(file, fileFacts, ctx, skip, styleOf(root, file, specifierStyle(fileFacts), tracked), jsxRoots(configFor(file)?.options));
			return skip ? info : { ...info, ...unitFacts(ts, root, file, unitOf(ts, root, file, options), options) } as FileInfo;
		},
		fileNameProblems: (name, original) => tsFileNameProblems(name, original, entries(original), facts().testGlobs),
		splitHeader: tsSplitHeader,
		buildSplit(source, info, plan) {
			const dir = path.join(root, path.posix.dirname(info.path));
			const planned = new Set(plan.map(group => path.join(dir, group.file)));
			const host = { ...ts.sys, fileExists: (name: string) => planned.has(path.resolve(name)) || ts.sys.fileExists(name) };
			const resolves = (specifier: string, fileName: string) =>
				ts.resolveModuleName(specifier, path.join(root, info.path), optionsFor(info.path), host).resolvedModule?.resolvedFileName === path.join(dir, fileName);
			return buildTsSplit(source, info as TsFileInfo, plan, { resolves });
		},
		sameDeclarations(before, after) {
			const original = before[0].path;
			const added = after.filter(a => !before.some(b => b.path === a.path)).map(a => a.path);
			const configs = readConfigs(ts, root, facts().tracked);
			const membership = configs.flatMap(config => added.filter(file => config.files.has(file) !== config.files.has(original))
				.map(file => `Rule 4: ${config.path} ${config.files.has(original) ? 'does not include' : 'now includes'} ${file}.`));
			return [...tsSameDeclarations(before, after), ...membership];
		},
		unitFiles: async file => unitOf(ts, root, file, optionsFor(file)),
		async unformatted(files) {
			const bin = path.join(root, 'node_modules', '.bin', 'prettier');
			const configured = facts().tracked.some(f => /^(\.prettierrc[^/]*|prettier\.config\.\w+)$/.test(f)) || !!facts().packages.get('.')?.prettier;
			if (!files.length || !configured || !existsSync(bin)) { return []; }
			const result = await runTool(bin, ['--check', ...files], root);
			return `${result.stdout}\n${result.stderr}`.split('\n').map(line => /^\[warn\] (.+)$/.exec(line.trim())?.[1] ?? '')
				.filter(name => files.includes(name));
		},
		checks: file => checkCommands(ts, facts(), file),
		setup: () => setupCommands(facts()),
		ready: () => workspaceLinkProblem(facts()),
		setupStamp: () => installStamp(root),
		importProblems: tsImportProblems,
		parseTests: output => parseTsTests(output, roots),
		testFileName: file => file.replace(/(\.[cm]?[jt]sx?)$/, '.ai.test$1'),
		testNames: () => [],
		testProblems: () => ['adding TypeScript and JavaScript tests comes in a later version'],
		splitPrompt: (info, lines) => tsSplitPrompt(info as TsFileInfo, lines, entries(info.path)),
		testPrompt: file => tsTestPrompt(file),
	};
}
