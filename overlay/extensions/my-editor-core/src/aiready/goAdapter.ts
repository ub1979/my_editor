import { existsSync, readdirSync, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildGoHelper, GO_ENV, GO_READ_ENV, goFileInfo, goPackage } from './goAst';
import { buildGoTool } from './goBuildTool';
import { probeExtract } from './goExtract';
import { goSplitPrompt, goTestPrompt } from './goPrompts';
import { createGoRefactor } from './goRefactor';
import { directiveLines, goFileInfoView, GoFileInfo, goFileNameProblems, GoModuleFacts, goSkipReason, Platforms, platforms } from './goRules';
import { buildGoSplit, goSplitHeader } from './goSplit';
import { goTestNames, goTestProblems, parseGoTest } from './goTests';
import type { LanguageAdapter, LanguageInfo } from './language';
import { declarationProblems } from './moveCheck';
import { findTool, runTool } from './projectCommands';

export { goPackage };

/** The Go tools a run needs, found and built once. */
export interface GoTools {
	readonly go: string;
	readonly gofmt?: string;
	readonly helper: string;
	readonly platforms: Platforms;
	/** The extract helper (`resources/goextract`); unset when it does not build, and then no refactor is offered. */
	readonly extract?: string;
}

/** Where `go build -o` writes nothing; not `os.devNull`, whose Windows form has backslashes that `splitCommand` refuses. */
const NULL_FILE = process.platform === 'win32' ? 'NUL' : '/dev/null';

/** Where Go is usually installed besides PATH: the official installer, `go install`, and `golang.org/dl` SDKs. */
export function goInstallDirs(): string[] {
	const home = os.homedir();
	let sdks: string[] = [];
	try { sdks = readdirSync(path.join(home, 'sdk')).filter(dir => dir.startsWith('go')).map(dir => path.join(home, 'sdk', dir, 'bin')); } catch { sdks = []; }
	return ['/usr/local/go/bin', path.join(home, 'go', 'bin'), ...sdks];
}

/** A plain message when the project's go.mod needs a newer Go than the installed one (no toolchain is downloaded). */
export async function goVersionProblem(go: string, root: string): Promise<string | undefined> {
	const result = await runTool(go, ['list', '-m'], root, GO_READ_ENV);
	const needed = /requires go >= ([\w.-]+)/.exec(result.stderr)?.[1];
	if (result.code === 0 || !needed) { return undefined; }
	const running = /running go ([\w.-]+)/.exec(result.stderr)?.[1];
	return `This project's go.mod needs Go ${needed} or newer, but the installed Go is go${running ?? ' (unknown)'}. `
		+ 'my_editor does not download Go toolchains. Install a newer Go, then try again.';
}

/**
 * Finds Go and gofmt, builds the parser helper and the extract helper (no refactors when that fails), and reads Go's platform
 * list. Returns a plain message on failure.
 */
export async function goTools(mainGo: string, storageDir: string, version: string): Promise<GoTools | string> {
	const go = findTool('go', goInstallDirs());
	if (!go) { return 'Go was not found. Install Go or add it to your PATH, then try again.'; }
	let helper: string;
	try { helper = await buildGoHelper(mainGo, storageDir, version, go); }
	catch (error) { return error instanceof Error ? error.message : String(error); }
	const extract = await buildGoTool(path.join(path.dirname(path.dirname(mainGo)), 'goextract'), 'goextract', storageDir, version, go, probeExtract)
		.catch(() => undefined);
	const dist = await runTool(go, ['tool', 'dist', 'list'], storageDir, GO_READ_ENV);
	const goroot = (await runTool(go, ['env', 'GOROOT'], storageDir, GO_READ_ENV)).stdout.trim();
	const bundled = goroot && path.join(goroot, 'bin', 'gofmt');
	return {
		go, helper, extract, platforms: platforms(dist.stdout), gofmt: bundled && existsSync(bundled) ? bundled : findTool('gofmt', goInstallDirs()),
	};
}

/** Go as the core sees it before an adapter exists. */
export const GO_LANGUAGE: LanguageInfo = {
	label: 'Go', extensions: ['.go'], fixes: ['split', 'tests', 'refactor'],
	mayDiffer: 'File names and line numbers in panics, `runtime.Caller`, `log.Lshortfile`, `slog` source attributes and package-level closure names '
		+ '(`glob..funcN`) may differ for moved code. The program’s behavior does not.',
};

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
			names.set(pkg, runTool(tools.go, ['list', '-deps', '-e', '-f', '{{.ImportPath}} {{.Name}}', pkg], root, GO_READ_ENV).then(result =>
				new Map(result.stdout.split('\n').map(line => line.trim().split(' ')).filter(parts => parts.length === 2 && parts[1]) as [string, string][])));
		}
		return names.get(pkg)!;
	};
	const testFileName = (file: string) => file.replace(/\.go$/, '_ai_test.go');
	return {
		id: 'go',
		codeFence: 'go',
		...GO_LANGUAGE,
		fixes: tools.extract ? ['split', 'tests', 'refactor'] : ['split', 'tests'],
		refactor: tools.extract ? createGoRefactor(root, tools) : undefined,
		commandEnv: GO_ENV,
		async parse(file) {
			const ast = await goFileInfo(tools.helper, path.join(root, file));
			return goFileInfoView(file, ast, await packageNames(file), goSkipReason(file, ast, moduleFacts(), tools.platforms));
		},
		fileNameProblems: name => goFileNameProblems(name, tools.platforms),
		splitHeader: goSplitHeader,
		buildSplit: (source, info, plan) => buildGoSplit(source, info as GoFileInfo, plan),
		sameDeclarations: declarationProblems,
		async unitFiles(file) {
			const listed = await runTool(tools.go, ['list', '-e', '-f', '{{join .GoFiles "\\n"}}', goPackage(file)], root, GO_READ_ENV);
			const dir = path.posix.dirname(file);
			return listed.stdout.split('\n').map(name => name.trim()).filter(Boolean).map(name => (dir === '.' ? name : `${dir}/${name}`));
		},
		async unformatted(files) {
			if (!tools.gofmt || !files.length) { return []; }
			const result = await runTool(tools.gofmt, ['-l', ...files], root);
			return result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
		},
		// The package on its own too: `./...` may already fail for an unrelated reason (a missing cgo header) and hide a new break.
		checks: file => [
			{ label: 'build', command: 'go build ./...' },
			{ label: 'build', command: `go build -o ${NULL_FILE} ${goPackage(file)}`, verifies: true },
			{ label: 'vet', command: `go vet ${goPackage(file)}`, verifies: true },
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
