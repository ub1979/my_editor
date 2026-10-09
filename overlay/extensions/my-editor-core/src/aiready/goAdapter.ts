import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { buildGoHelper, goFileInfo } from './goAst';
import { goSplitPrompt, goTestPrompt } from './goPrompts';
import { directiveLines, goFileInfoView, GoFileInfo, goFileNameProblems, GoModuleFacts, goSkipReason, Platforms, platforms } from './goRules';
import { buildGoSplit } from './goSplit';
import { goTestNames, goTestProblems, parseGoTest } from './goTests';
import type { LanguageAdapter } from './language';
import { declarationProblems } from './moveCheck';
import { findTool, runTool } from './projectCommands';

/** The Go tools a run needs, found and built once. */
export interface GoTools {
	readonly go: string;
	readonly gofmt?: string;
	readonly helper: string;
	readonly platforms: Platforms;
}

/** Finds Go and gofmt, builds the parser helper, and reads Go's platform list. Returns a plain message on failure. */
export async function goTools(mainGo: string, storageDir: string, version: string): Promise<GoTools | string> {
	const go = findTool('go');
	if (!go) { return 'Go was not found. Install Go or add it to your PATH, then try again.'; }
	let helper: string;
	try { helper = await buildGoHelper(mainGo, storageDir, version, go); }
	catch (error) { return error instanceof Error ? error.message : String(error); }
	const local = { GOTOOLCHAIN: 'local' };
	const dist = await runTool(go, ['tool', 'dist', 'list'], storageDir, local);
	const goroot = (await runTool(go, ['env', 'GOROOT'], storageDir, local)).stdout.trim();
	const bundled = goroot && path.join(goroot, 'bin', 'gofmt');
	return { go, helper, platforms: platforms(dist.stdout), gofmt: bundled && existsSync(bundled) ? bundled : findTool('gofmt') };
}

/** The `./dir` form `go` wants for a file's package. */
export function goPackage(file: string): string {
	const dir = path.posix.dirname(file);
	return dir === '.' ? '.' : `./${dir}`;
}

/**
 * The Go language adapter for one root (the user's folder for the picker, the worktree for fixes). `tracked` lists the
 * root's tracked files, for nested modules and `//go:generate`/`//go:embed` lines.
 */
export function createGoAdapter(root: string, tools: GoTools, tracked: readonly string[]): LanguageAdapter {
	let facts: GoModuleFacts | undefined;
	const names = new Map<string, Promise<Map<string, string>>>();
	const moduleFacts = (): GoModuleFacts => {
		facts ??= {
			nestedModules: tracked.filter(file => file.endsWith('/go.mod')).map(file => path.posix.dirname(file)),
			directiveLines: tracked.filter(file => file.endsWith('.go')).flatMap(file => {
				let text = '';
				try { text = readFileSync(path.join(root, file), 'utf8'); } catch { return []; }
				return text.includes('//go:') ? directiveLines(file, text) : [];
			}),
		};
		return facts;
	};
	const packageNames = (file: string) => {
		const pkg = goPackage(file);
		if (!names.has(pkg)) {
			names.set(pkg, runTool(tools.go, ['list', '-deps', '-e', '-f', '{{.ImportPath}} {{.Name}}', pkg], root).then(result =>
				new Map(result.stdout.split('\n').map(line => line.trim().split(' ')).filter(parts => parts.length === 2 && parts[1]) as [string, string][])));
		}
		return names.get(pkg)!;
	};
	const testFileName = (file: string) => file.replace(/\.go$/, '_ai_test.go');
	return {
		id: 'go',
		label: 'Go',
		extensions: ['.go'],
		async parse(file) {
			const ast = await goFileInfo(tools.helper, path.join(root, file));
			return goFileInfoView(file, ast, await packageNames(file), goSkipReason(file, ast, moduleFacts(), tools.platforms));
		},
		fileNameProblems: name => goFileNameProblems(name, tools.platforms),
		buildSplit: (source, info, plan) => buildGoSplit(source, info as GoFileInfo, plan),
		sameDeclarations: declarationProblems,
		async unitFiles(file) {
			const listed = await runTool(tools.go, ['list', '-e', '-f', '{{join .GoFiles "\\n"}}', goPackage(file)], root);
			const dir = path.posix.dirname(file);
			return listed.stdout.split('\n').map(name => name.trim()).filter(Boolean).map(name => (dir === '.' ? name : `${dir}/${name}`));
		},
		async unformatted(files) {
			if (!tools.gofmt || !files.length) { return []; }
			const result = await runTool(tools.gofmt, ['-l', ...files], root);
			return result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
		},
		checks: file => [
			{ label: 'build', command: 'go build ./...' },
			{ label: 'vet', command: `go vet ${goPackage(file)}` },
			{ label: 'test', command: `go test -count=1 -json ${goPackage(file)}` },
		],
		parseTests: parseGoTest,
		testFileName,
		testNames: goTestNames,
		testProblems: (text, info, source) => goTestProblems(text, info as GoFileInfo, source as GoFileInfo),
		splitPrompt: (info, lines) => goSplitPrompt(info as GoFileInfo, lines),
		testPrompt: (file, source, info) => goTestPrompt(file, source, info as GoFileInfo, path.posix.basename(testFileName(file))),
	};
}
