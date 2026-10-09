import { readFileSync } from 'fs';
import * as path from 'path';
import type { Ts } from './tsLoad';
import type { PackageJson } from './tsProject';

/** What tool detection reads: tracked files, package.json files and every dependency name. */
export interface ToolInput {
	readonly root: string;
	readonly tracked: readonly string[];
	readonly packages: ReadonlyMap<string, PackageJson>;
	readonly dependencies: ReadonlySet<string>;
}

const OUTSIDE = /(^|\/)node_modules\//;
const BABEL = /(^|\/)(\.babelrc(\.\w+)?|babel\.config\.\w+)$/;
const MOCHARC = /(^|\/)\.mocharc(\.\w+)?$/;
const TS_NODE_REGISTER = /\bts-node\/register\b/;
const TS_NODE_RUN = /(^|[\s&|;(])(ts-node(-esm|-script)?|ts-node\/esm)\b/;
/** `node` (not `ts-node`) on a `.ts`/`.mts` file, or Node's type-stripping flags. */
const STRIP_SCRIPT = /--experimental-(strip|transform)-types|(^|[\s&|;(])node\s[^&|;]*?[^\s&|;]+\.m?ts\b/;
const COMMAND = (name: string) => new RegExp(`(^|[\\s&|;(])${name}\\s`);
/** A tracked build script or config that loads esbuild, or esbuild's `tsconfigRaw` option. */
const ESBUILD_TEXT = /\btsconfigRaw\b|(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*)['"]esbuild['"]/;
const ROLLUP_PLUGINS = /^(@rollup\/plugin-(typescript|babel|sucrase|swc)|rollup-plugin-(typescript2?|esbuild|swc3?|sucrase))$/;

function read(root: string, file: string): string {
	try { return readFileSync(path.join(root, file), 'utf8'); } catch { return ''; }
}

/** Why TS here runs as CommonJS through ts-node: a tsconfig `"ts-node"` section emitting CommonJS, or its require hook. */
function tsNodeCommonJs(ts: Ts, input: ToolInput, scripts: readonly string[]): string | undefined {
	for (const file of input.tracked.filter(f => /(^|\/)tsconfig[^/]*\.json$/.test(f) && !OUTSIDE.test(f))) {
		const raw = ts.readConfigFile(path.join(input.root, file), ts.sys.readFile).config as { 'ts-node'?: Record<string, unknown> } | undefined;
		const section = raw?.['ts-node'];
		const module = String((section?.compilerOptions as { module?: unknown } | undefined)?.module ?? '');
		const types = Object.values((section?.moduleTypes as Record<string, unknown> | undefined) ?? {});
		if (/^commonjs$/i.test(module) || types.includes('cjs')) { return `ts-node runs it as CommonJS (the "ts-node" section of ${file})`; }
	}
	const mocharc = input.tracked.filter(f => MOCHARC.test(f) && !OUTSIDE.test(f)).some(f => TS_NODE_REGISTER.test(read(input.root, f)));
	return mocharc || scripts.some(script => TS_NODE_REGISTER.test(script)) ? 'ts-node runs it as CommonJS (-r ts-node/register)' : undefined;
}

/**
 * Why TS here is compiled by a tool other than `tsc`, run without a compile step, or run as CommonJS by ts-node, if
 * it is: then only interfaces and type aliases may move. The first match names the tool.
 */
export function typesOnlyReason(ts: Ts, input: ToolInput): string | undefined {
	const { dependencies: deps, tracked } = input;
	const all = [...input.packages.values()];
	const scripts = all.flatMap(pkg => Object.values(pkg.scripts ?? {}));
	const has = (pattern: RegExp) => tracked.some(file => pattern.test(file) && !OUTSIDE.test(file));
	const dep = (pattern: RegExp) => [...deps].find(name => pattern.test(name));
	const script = (pattern: RegExp) => scripts.some(text => pattern.test(text));
	const esbuildText = () => tracked.some(file => /\.(m?[jt]s|c[jt]s|json)$/.test(file) && !OUTSIDE.test(file) && ESBUILD_TEXT.test(read(input.root, file)));
	const rollup = dep(ROLLUP_PLUGINS);
	const loader = dep(/^(ts-loader|babel-loader)$/);
	const commonJs = tsNodeCommonJs(ts, input, scripts);
	if (commonJs) { return commonJs; }
	const checks: [boolean | (() => boolean), string][] = [
		[deps.has('next'), 'Next.js compiles the code with its own compiler'],
		[deps.has('vitest') || has(/(^|\/)vitest\.(config|workspace)\.\w+$/), 'Vitest runs the tests through Vite, which compiles each file with esbuild'],
		[deps.has('vite') || has(/(^|\/)vite\.config\.\w+$/), 'Vite compiles each file with esbuild'],
		[!!loader, `webpack compiles the code with ${loader}`],
		[deps.has('parcel') || !!dep(/^@parcel\//) || has(/(^|\/)\.parcelrc$/), 'Parcel compiles the code'],
		[!!rollup, `Rollup compiles the code with ${rollup}`],
		[deps.has('tsup') || has(/(^|\/)tsup\.config\.\w+$/), 'tsup compiles each file with esbuild'],
		[() => script(COMMAND('esbuild')) || esbuildText(), 'esbuild compiles each file'],
		[deps.has('tsx') || script(/(^|[\s&|;(])tsx\s|--(import|loader)[\s=]+tsx\b/), 'tsx compiles each file with esbuild'],
		[has(BABEL) || all.some(pkg => pkg.babel) || !!dep(/^(@babel\/(core|register|preset-typescript)|babel-jest)$/), 'Babel compiles the code'],
		[has(/(^|\/)\.swcrc$/) || !!dep(/^(@swc\/.+|@swc-node\/.+|unplugin-swc)$/), 'swc compiles each file'],
		[!!dep(/^(sucrase|@sucrase\/.+)$/), 'Sucrase compiles each file'],
		[!!dep(/^(metro|react-native|expo)$/) || has(/(^|\/)metro\.config\.\w+$/), 'Metro (React Native) compiles the code with Babel'],
		[!!dep(/^(esbuild-register|@esbuild-kit\/.+)$/), 'esbuild-register compiles each file as it runs'],
		[script(TS_NODE_RUN), 'ts-node compiles each file as it runs'],
		[has(/(^|\/)(bun\.lockb?|bunfig\.toml)$/) || script(COMMAND('bunx?')), 'Bun runs the TypeScript without a compile step'],
		[has(/(^|\/)deno\.jsonc?$/), 'Deno runs the TypeScript without a compile step'],
		[script(STRIP_SCRIPT), 'Node\'s type stripping runs the TypeScript without a compile step'],
	];
	return checks.find(([test]) => (typeof test === 'function' ? test() : test))?.[1];
}
