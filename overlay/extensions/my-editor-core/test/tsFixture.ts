import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SplitPlan, SplitResult } from '../src/aiready/language';
import { tsFileFacts } from '../src/aiready/tsAst';
import { analysisOptions, jsxRoots } from '../src/aiready/tsConfig';
import { loadTypeScript, Ts } from '../src/aiready/tsLoad';
import { specifierStyle, TsFileContext, TsFileInfo, tsFileInfoView, tsSkipReason } from '../src/aiready/tsRules';
import { buildTsSplit } from '../src/aiready/tsSplit';

/** The TypeScript the tests use: `MY_EDITOR_TS` (the editor's shipped copy) or the dev dependency. */
export const TS_DIR = process.env.MY_EDITOR_TS ?? path.dirname(require.resolve('typescript/package.json'));
const loaded = loadTypeScript(TS_DIR);
if (typeof loaded === 'string') { throw new Error(loaded); }
export const ts: Ts = loaded;

/** Writes the files into a new temp folder; `tracked` lists them, as `git ls-files` would. */
export function project(files: Record<string, string | undefined>): { root: string; tracked: string[] } {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-ts-'));
	const tracked: string[] = [];
	for (const [file, text] of Object.entries(files)) {
		if (text === undefined) { continue; }
		tracked.push(file);
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		writeFileSync(path.join(root, file), text);
	}
	return { root, tracked: tracked.sort() };
}

/** An ES module package checked by `tsc` with `node --test`, locked by npm. */
export const ESM: Record<string, string> = {
	'package.json': '{"name":"shop","type":"module","scripts":{"test":"node --test"}}',
	'package-lock.json': '{}',
	'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', strict: true }, include: ['src'] }),
};

export const CONTEXT: TsFileContext = {
	scope: 'runtime', jsx: 'automatic', emitDecoratorMetadata: false, cyclic: false, sideEffectFree: false, exportsWildcard: false, listedInFiles: false, generatedAttribute: false,
};
export const OPTIONS = analysisOptions(ts, { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022, strict: true });

/** A parsed file without a project: the given context (run-time scope by default) and specifier style (`.js`). */
export function tsInfo(file: string, text: string, context: Partial<TsFileContext> = {}, style?: TsFileInfo['style']): TsFileInfo {
	const facts = tsFileFacts(ts, file, text, OPTIONS);
	const full = { ...CONTEXT, ...context };
	const own = specifierStyle(facts);
	return tsFileInfoView(file, facts, full, tsSkipReason(file, text, facts, full), style ?? (own === 'mixed' ? undefined : own ?? 'js'), jsxRoots(undefined));
}

/** Every relative specifier resolves. */
export const RESOLVES = { resolves: () => true };

/** Splits text with a plan, or returns the thrown reasons. */
export function split(file: string, text: string, plan: SplitPlan, context: Partial<TsFileContext> = {}, style?: TsFileInfo['style']): SplitResult | string {
	try { return buildTsSplit(Buffer.from(text), tsInfo(file, text, context, style), plan, RESOLVES); }
	catch (error) { return error instanceof Error ? error.message : String(error); }
}

/** The text of a split's new file by index, or the original. */
export function text(result: SplitResult | string, index?: number): string {
	if (typeof result === 'string') { throw new Error(result); }
	return (index === undefined ? result.original : result.files[index].text).toString('utf8');
}
