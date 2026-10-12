import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GoTools } from './goAdapter';
import { goFileInfo, goPackage } from './goAst';
import { coverRan } from './goCover';
import { extractBuild, extractCheck, extractOutline, listPackage, type ExtractBuild, type ExtractTarget } from './goExtract';
import { goRefactorPrompt } from './goRefactorPrompt';
import type { GoFileInfo } from './goRules';
import type { FileInfo, RefactorHooks, RefactorTarget } from './language';

/** One file's refactor in progress: a temp folder with its package list, from `prompt` until `check`. */
interface Session {
	readonly dir: string;
	readonly target: ExtractTarget;
}

/** The 1-based line holding a byte offset. */
function lineAt(text: Buffer, offset: number): number {
	let line = 1;
	for (let i = text.indexOf(10); i >= 0 && i < offset; i = text.indexOf(10, i + 1)) { line++; }
	return line;
}

/** The function a refactor would shorten: the file's largest declaration, when it is a function (screening decided a refactor is needed). */
function goTarget(info: FileInfo): RefactorTarget | string {
	const largest = [...(info as GoFileInfo).go.decls].sort((a, b) => b.lines - a.lines)[0];
	if (!largest) { return 'it has no declarations'; }
	if (largest.kind !== 'func' && largest.kind !== 'method') { return `\`${largest.names[0] ?? '_'}\` is a ${largest.kind}, not a function`; }
	return { name: largest.names[0], ...(largest.receiver ? { receiver: largest.receiver } : {}), lines: largest.lines };
}

/** The Go adapter's refactor hooks (extract function), run with the `goextract` helper in `tools.extract`. */
export function createGoRefactor(root: string, tools: GoTools): RefactorHooks {
	const sessions = new Map<string, Session>();
	const helper = () => {
		if (!tools.extract) { throw new Error('The Go extract helper is not built.'); }
		return tools.extract;
	};
	const end = (file: string) => {
		const session = sessions.get(file);
		if (session) { rmSync(session.dir, { recursive: true, force: true }); }
		sessions.delete(file);
	};
	const session = (file: string) => {
		const found = sessions.get(file);
		if (!found) { throw new Error(`No refactor of ${file} is in progress.`); }
		return found;
	};
	return {
		target: goTarget,
		coverage: (file, index) => {
			const profile = `.my_editor-cover-${index}.out`;
			return { command: { label: 'test', command: `go test -count=1 -coverprofile=${profile} ${goPackage(file)}` }, profile };
		},
		async ran(profileText, file, target) {
			const text = readFileSync(path.join(root, file));
			const ast = await goFileInfo(tools.helper, path.join(root, file));
			const decl = ast.decls.find(d => (d.kind === 'func' || d.kind === 'method') && d.names[0] === target.name
				&& (d.receiver || undefined) === target.receiver);
			return !!decl && coverRan(profileText, path.posix.basename(file), lineAt(text, decl.start), lineAt(text, decl.end));
		},
		async prompt(file, target) {
			end(file);
			const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-refactor-'));
			let kept = false;
			try {
				const listed = await listPackage(tools.go, root, file, path.join(dir, 'list.json'));
				if (typeof listed === 'string') { return listed; }
				const extract: ExtractTarget = { ...listed, file: path.join(root, file), func: target.name, recv: target.receiver };
				const outline = await extractOutline(helper(), extract);
				if (outline.refused) { return outline.refused; }
				sessions.set(file, { dir, target: extract });
				kept = true;
				return goRefactorPrompt(file, readFileSync(extract.file, 'utf8'), outline);
			} finally {
				if (!kept) { rmSync(dir, { recursive: true, force: true }); }
			}
		},
		async build(file, _target, chunks) {
			const { dir, target } = session(file);
			writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(chunks));
			const built: ExtractBuild = await extractBuild(helper(), target, path.join(dir, 'plan.json'), path.join(dir, 'out.go'));
			if (built.problems.length) { return { problems: built.problems }; }
			return {
				problems: [], text: readFileSync(path.join(dir, 'out.go')), functionLines: built.functionLines, facts: JSON.stringify(built),
				helpers: (built.helpers ?? []).map(h => ({
					name: h.name, params: h.params.map(p => (p.pointer ? `*${p.name}` : p.name)), outputs: h.outputs.map(o => o.name), returns: h.returns,
				})),
			};
		},
		async check(file, before, _target, built) {
			try {
				// Only a successful build with helpers has facts; the helper's check refuses anything else.
				if (!built.facts) { return ['The build reported no helpers, so there is nothing to check.']; }
				const { dir, target } = session(file);
				writeFileSync(path.join(dir, 'before.go'), before);
				writeFileSync(path.join(dir, 'build.json'), built.facts ?? '{}');
				return await extractCheck(helper(), target, path.join(dir, 'before.go'), path.join(dir, 'build.json'));
			} finally {
				end(file);
			}
		},
		abandon: end,
		mayDiffer: 'Helper functions add frames to stack traces and to runtime.Caller, log.Lshortfile and slog source lookups; inlining and escape '
			+ 'analysis may differ (a variable passed by pointer may move to the heap), which changes speed and allocations, not results.',
		approvalNote: 'For refactors, my_editor also runs go list -export on those packages, which compiles their dependencies as go build does, '
			+ 'and type-checks them with its own helper.',
	};
}
