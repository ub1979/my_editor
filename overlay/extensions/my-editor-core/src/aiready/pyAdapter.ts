import { existsSync, readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import type { LanguageAdapter, LanguageInfo } from './language';
import { runTool } from './projectCommands';
import { pyFileFacts } from './pyAst';
import { PyInterpreter, pythonApprovalNote } from './pyInterpreter';
import { pyImportProblems, pySameDeclarations } from './pyMoveCheck';
import {
	checkCommands, importRootProblem, moduleOf, modulePatches, projectSkip, pyCommandEnv, PyProject, pyProject, warningFilter,
} from './pyProject';
import { pySplitPrompt, pyTestPrompt } from './pyPrompts';
import { PyFileContext, PyFileInfo, pyFileInfoView, pyFileNameProblems, pySkipReason } from './pyRules';
import type { PyPatches } from './pyScan';
import { buildPySplit, pySplitHeader } from './pySplit';
import { parsePyTests, pyTestFileName, pyTestNames, pyTestProblems } from './pyTests';

/** Python as the core sees it before an adapter exists. */
export const PY_LANGUAGE: LanguageInfo = {
	label: 'Python', extensions: ['.py'], fixes: ['split', 'tests'],
	mayDiffer: 'For moved classes and functions the module part of their full name differs: `__module__`, the `repr` of a class, the last line '
		+ 'of a traceback, error-tracker grouping, logging\'s `%(module)s`, `%(filename)s` and `%(lineno)d`, and Sphinx `automodule` listings. '
		+ 'Pickles written by this branch name the new module and do not load in code from before the split (projects that pickle moved only '
		+ 'constants). The original\'s `__annotations__` no longer lists moved annotated constants, the order of its `__dict__` changes, and the '
		+ 'package gains the new modules as attributes. Under Python 3.15\'s global lazy-import mode, which people running the program can turn '
		+ 'on, imports load when first used instead of in order; the checks here ran on the project\'s interpreter only. A module whose leading '
		+ 'imports come back to it (an import cycle) fails the import check and was not split.',
};

const NO_PATCHES: PyPatches = { strings: new Map(), named: new Map(), assigned: new Map() };

/** Names a module binds at its top level, from its text (enough to keep a new submodule from replacing one). */
function topLevelNames(text: string): string[] {
	const names = [...text.matchAll(/^(?:async\s+def|def|class)\s+(\w+)|^(\w+)\s*(?::[^=\n]*)?=(?!=)|^import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm)]
		.map(m => m[1] ?? m[2] ?? m[4] ?? m[3].split('.')[0]);
	for (const m of text.matchAll(/^from\s+\S+\s+import\s+(\([^)]*\)|[^\n]*)/gm)) {
		names.push(...m[1].replace(/[()]|#[^\n]*/g, '').split(',').map(p => p.trim().split(/\s+as\s+/).pop()!).filter(Boolean));
	}
	return names;
}

/**
 * The Python language adapter for one root (the user's folder for the picker, the worktree for fixes), with the
 * project's interpreter. All analysis is host-side: the shipped helper parses with the project's Python, isolated, and
 * the model only proposes groups of declaration IDs.
 */
export function createPyAdapter(root: string, python: PyInterpreter, dirs: { helperDir: string; storageDir: string }, tracked: readonly string[]):
	LanguageAdapter {
	let project: PyProject | undefined;
	const patches = new Map<string, PyPatches>();
	const facts = () => (project ??= pyProject(root, python, dirs.helperDir, dirs.storageDir, tracked));
	const entries = (file: string) => { try { return readdirSync(path.join(root, path.posix.dirname(file))); } catch { return []; } };
	const siblings = (file: string) => entries(file).filter(name => name.endsWith('.py') && name !== path.posix.basename(file)).filter(name => {
		try { return readFileSync(path.join(root, path.posix.dirname(file), name), 'utf8').split('\n')[0] === pySplitHeader(file).split('\n')[0]; }
		catch { return false; }
	});
	const context = (file: string): PyFileContext => {
		const p = facts();
		const found = moduleOf(p, file);
		const module = 'skip' in found ? '' : found.module;
		const pkg = 'skip' in found ? '' : found.package;
		if (module && !patches.has(module)) { patches.set(module, modulePatches(p, module)); }
		return {
			module, package: pkg, skip: 'skip' in found ? found.skip : projectSkip(p, file, module, pkg), constantsOnly: p.constantsOnly,
			deferred: p.config.deferredAnnotations, django: p.django, patches: patches.get(module) ?? NO_PATCHES, migrationWords: p.scan.migrationWords,
			warningFilter: module ? warningFilter(p, module) : undefined, shadowed: p.shadowed, splitSiblings: siblings(file).map(n => n.replace(/\.py$/, '')),
		};
	};
	const moduleName = (file: string) => { const found = moduleOf(facts(), file); return 'skip' in found ? undefined : found.module; };
	const testFileName = (file: string) => pyTestFileName(file, tracked, facts().roots.find(r => r !== '.' && file.startsWith(`${r}/`)) ?? '.');
	const runner = () => checkCommands(facts(), 'x').find(c => c.label === 'test')?.command.split(' ').slice(1, 3).join(' ') ?? 'pytest';
	return {
		id: 'py',
		...PY_LANGUAGE,
		blankLines: 'longest',
		testOutput: 'both',
		codeFence: 'python',
		get commandEnv() { return pyCommandEnv(facts()); },
		get approvalNote() { return pythonApprovalNote(python, facts().config.requiresPython, pyCommandEnv(facts())); },
		async parse(file) {
			const text = readFileSync(path.join(root, file));
			const pyFacts = await pyFileFacts(python.path, dirs.helperDir, path.join(root, file), dirs.storageDir);
			const ctx = context(file);
			return pyFileInfoView(file, text, pyFacts, ctx, pySkipReason(file, pyFacts, ctx));
		},
		fileNameProblems(name, original) {
			const dir = path.posix.dirname(original);
			const init = [path.posix.join(dir, '__init__.py'), path.posix.join(dir, '__init__.pyi')].filter(f => existsSync(path.join(root, f)));
			return pyFileNameProblems(name, original, {
				entries: entries(original), packageNames: init.flatMap(f => topLevelNames(readFileSync(path.join(root, f), 'utf8'))),
				stdlib: python.stdlib, installed: python.installed, testGlobs: facts().config.pythonFiles,
			});
		},
		splitHeader: pySplitHeader,
		buildSplit: (source, info, plan) => buildPySplit(source, info as PyFileInfo, plan,
			{ lineLength: facts().config.lineLength, deferred: facts().config.deferredAnnotations }),
		importProblems: pyImportProblems,
		sameDeclarations: pySameDeclarations,
		unitFiles: async file => [file, ...siblings(file).map(name => path.posix.join(path.posix.dirname(file), name))],
		async unformatted(files) {
			const formatter = facts().config.formatter;
			const bin = formatter && path.join(path.dirname(python.path), formatter);
			if (!files.length || !bin || !existsSync(bin)) { return []; }
			const result = await runTool(bin, formatter === 'ruff' ? ['format', '--check', ...files] : ['--check', ...files], root, pyCommandEnv(facts()));
			return `${result.stdout}\n${result.stderr}`.split('\n').map(line => /^(?:would reformat|Would reformat:) (.+)$/.exec(line.trim())?.[1] ?? '')
				.map(name => path.relative(root, path.resolve(root, name)).split(path.sep).join('/')).filter(name => files.includes(name));
		},
		checks: file => { const module = moduleName(file); return module ? checkCommands(facts(), module) : []; },
		ready: () => importRootProblem(facts()),
		parseTests: parsePyTests,
		testFileName,
		testNames: pyTestNames,
		testProblems: (text, info, source) => pyTestProblems(text, info as PyFileInfo, (source as PyFileInfo).context.module, python.stdlib),
		splitPrompt: (info, lines) => pySplitPrompt(info as PyFileInfo, lines, entries(info.path)),
		testPrompt: (file, source, info) => pyTestPrompt(file, source, (info as PyFileInfo).context.module, testFileName(file), runner()),
	};
}
