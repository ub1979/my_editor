import { existsSync, readFileSync, realpathSync } from 'fs';
import * as path from 'path';
import type { CheckCommand } from './language';
import { builds, emitFormat, holder, readConfigs, TsConfig } from './tsConfig';
import type { Ts } from './tsLoad';
import { typesOnlyReason } from './tsTools';

/** The parts of a package.json the adapter reads. */
export interface PackageJson {
	readonly name?: string;
	readonly type?: string;
	readonly scripts?: Record<string, string>;
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
	readonly workspaces?: string[] | { packages?: string[] };
	readonly sideEffects?: boolean | string[];
	readonly exports?: unknown;
	readonly files?: string[];
	readonly packageManager?: string;
	readonly babel?: unknown;
	readonly jest?: { testMatch?: string[] };
	readonly prettier?: unknown;
}

export interface Manager {
	readonly name: 'npm' | 'pnpm' | 'yarn' | 'bun';
	readonly install: string;
	/** How to run a local binary: `npx --no -- tsc` (no download; `--` keeps `-p` from npx), `pnpm exec tsc`, `yarn tsc`. */
	readonly exec: string;
}

/** What may move in a file: run-time declarations, types only, or function declarations only (plain JS). */
export type Scope = 'runtime' | 'types' | 'functions';

/** Project-wide facts, read once per adapter. */
export interface TsProject {
	readonly root: string;
	readonly tracked: readonly string[];
	readonly configs: readonly TsConfig[];
	/** package.json files by folder (`.` for the root). */
	readonly packages: ReadonlyMap<string, PackageJson>;
	/** Undefined with no lockfile, or a plain reason when the lockfiles disagree. */
	readonly manager?: Manager | string;
	/** Why TS here is compiled by another tool, run without a compile step or run as CommonJS by ts-node (types-only moves), if it is. */
	readonly typesOnly?: string;
	/** Tests run under Jest. */
	readonly jest: boolean;
	/** Workspace package names and their folders. */
	readonly workspaces: ReadonlyMap<string, string>;
	/** Every dependency name of every package.json. */
	readonly dependencies: ReadonlySet<string>;
	/** Test globs from Jest `testMatch` and Vitest `include`. */
	readonly testGlobs: readonly string[];
}

export const LOCKFILES: readonly [string, Manager['name']][] = [['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'],
	['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun']];

function readJson(file: string): PackageJson | undefined {
	try { return JSON.parse(readFileSync(file, 'utf8')) as PackageJson; } catch { return undefined; }
}

function deps(pkg: PackageJson): string[] {
	return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];
}

/** Reads the project's package.json files, tsconfigs, lockfile, tools and workspaces. */
export function tsProject(ts: Ts, root: string, tracked: readonly string[]): TsProject {
	const packages = new Map<string, PackageJson>();
	for (const file of tracked.filter(f => /(^|\/)package\.json$/.test(f) && !/(^|\/)node_modules\//.test(f))) {
		const json = readJson(path.join(root, file));
		if (json) { packages.set(path.posix.dirname(file), json); }
	}
	const all = [...packages.values()];
	const dependencies = new Set(all.flatMap(deps));
	const has = (pattern: RegExp) => tracked.some(file => pattern.test(file));
	const scripts = all.flatMap(pkg => Object.values(pkg.scripts ?? {}));
	const typesOnly = typesOnlyReason(ts, { root, tracked, packages, dependencies });
	const jest = dependencies.has('jest') || dependencies.has('ts-jest') || has(/(^|\/)jest\.config\.\w+$/)
		|| scripts.some(script => /(^|[\s&|;])jest(\s|$)/.test(script));
	return {
		root, tracked, configs: readConfigs(ts, root, tracked), packages, manager: manager(root, packages.get('.')), typesOnly, jest,
		workspaces: workspaces(root, packages, tracked), dependencies, testGlobs: testGlobs(root, packages, tracked),
	};
}

function manager(root: string, pkg: PackageJson | undefined): Manager | string | undefined {
	const found = [...new Set(LOCKFILES.filter(([file]) => existsSync(path.join(root, file))).map(([, name]) => name))];
	const declared = /^(npm|pnpm|yarn|bun)@/.exec(pkg?.packageManager ?? '')?.[1] as Manager['name'] | undefined;
	const name = declared && found.includes(declared) ? declared : found.length === 1 ? found[0] : undefined;
	if (!name) { return found.length > 1 ? `the lockfiles of ${found.join(' and ')} disagree on how to install` : undefined; }
	const berry = existsSync(path.join(root, '.yarnrc.yml'));
	const install = {
		npm: 'npm ci', pnpm: 'pnpm install --frozen-lockfile', bun: 'bun install --frozen-lockfile',
		yarn: berry ? 'yarn install --immutable' : 'yarn install --frozen-lockfile',
	}[name];
	const exec = { npm: 'npx --no --', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'npx --no --' }[name];
	return { name, install, exec };
}

/** Why the project's dependencies cannot be installed on the branch exactly as in the user's folder, or undefined. */
export function lockfileProblem(root: string): string | undefined {
	const found = manager(root, readJson(path.join(root, 'package.json')));
	if (typeof found === 'object') { return undefined; }
	return found ? `In this project ${found}. Keep one lockfile, then try again.`
		: 'This project has no lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lock), so its dependencies cannot be installed '
			+ 'on the branch exactly as in your folder. Commit a lockfile, then try again.';
}

function globPrefix(glob: string): RegExp {
	const escaped = glob.replace(/\/+$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`^${escaped.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
}

/** Workspace packages (root `workspaces` or `pnpm-workspace.yaml`) by name, with their folders. */
function workspaces(root: string, packages: ReadonlyMap<string, PackageJson>, tracked: readonly string[]): Map<string, string> {
	const rootPkg = packages.get('.');
	const listed = Array.isArray(rootPkg?.workspaces) ? rootPkg!.workspaces as string[]
		: (rootPkg?.workspaces as { packages?: string[] } | undefined)?.packages ?? [];
	const yaml = tracked.includes('pnpm-workspace.yaml') ? readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8') : '';
	const globs = [...listed, ...[...yaml.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map(m => m[1])].filter(glob => !glob.startsWith('!'));
	const out = new Map<string, string>();
	for (const [dir, pkg] of packages) {
		if (dir !== '.' && pkg.name && globs.some(glob => globPrefix(glob).test(dir))) { out.set(pkg.name, dir); }
	}
	return out;
}

function testGlobs(root: string, packages: ReadonlyMap<string, PackageJson>, tracked: readonly string[]): string[] {
	const globs = [...packages.values()].flatMap(pkg => pkg.jest?.testMatch ?? []);
	for (const file of tracked.filter(f => /(^|\/)(jest|vitest|vite)\.config\.\w+$/.test(f))) {
		let text = '';
		try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
		for (const match of text.matchAll(/\b(?:testMatch|include)\s*:\s*\[([^\]]*)\]/g)) {
			globs.push(...[...match[1].matchAll(/(['"`])([^'"`]+)\1/g)].map(m => m[2]));
		}
	}
	return globs;
}

/** The nearest package.json at or above a file's folder, with its folder. */
export function nearestPackage(project: TsProject, file: string): { dir: string; pkg: PackageJson } | undefined {
	for (let dir = path.posix.dirname(file); ; dir = path.posix.dirname(dir)) {
		const pkg = project.packages.get(dir);
		if (pkg) { return { dir, pkg }; }
		if (dir === '.') { return undefined; }
	}
}

const JS = /\.(js|jsx|mjs|cjs)$/;

/**
 * What may move in a file under version 1, or why it is skipped. Every config that builds the file counts: CommonJS
 * output or type stripping in any of them narrows the scope; `config` is the nearest, the others are built too.
 */
export function fileScope(ts: Ts, project: TsProject, file: string):
	{ scope: Scope; config?: TsConfig; configs: TsConfig[]; reason?: string } | { skip: string } {
	const configs = builds(project.configs, file);
	const config = holder(configs, file);
	const type = nearestPackage(project, file)?.pkg.type;
	const broken = configs.find(c => c.error);
	if (broken) { return { skip: `${broken.path} could not be read fully (${broken.error})` }; }
	const unset = configs.find(c => c.options.module === undefined || c.options.moduleResolution === undefined);
	if (unset) {
		return { skip: `${unset.path} does not set both "module" and "moduleResolution", so the editor's TypeScript could read it differently from yours` };
	}
	const cjs = configs.find(c => emitFormat(ts, file, c.options, type) === 'cjs');
	if (JS.test(file)) {
		if (file.endsWith('.cjs')) { return { skip: 'CommonJS module' }; }
		if (!file.endsWith('.mjs') && type !== 'module') { return { skip: 'plain JavaScript that does not run as an ES module (no "type": "module" or .mjs)' }; }
		if (file.endsWith('.jsx')) { return { skip: 'JSX in plain JavaScript is compiled by another tool' }; }
		if (cjs) { return { skip: `${cjs.path} compiles it to CommonJS` }; }
		if (project.jest) { return { skip: 'tests run under Jest, which runs plain JavaScript as CommonJS' }; }
		if (project.typesOnly) { return { skip: `${project.typesOnly}` }; }
		return { scope: 'functions', config, configs };
	}
	if (!config) { return { skip: 'no tsconfig includes it' }; }
	const erasable = configs.find(c => c.options.erasableSyntaxOnly);
	const reason = cjs ? `${cjs.path} emits it as CommonJS` : project.jest ? 'tests run under Jest' : project.typesOnly
		?? (erasable ? `${erasable.path} sets erasableSyntaxOnly (Node type stripping)` : undefined);
	return reason ? { scope: 'types', config, configs, reason } : { scope: 'runtime', config, configs };
}

/** Why a file's scope is narrowed to types (for the prompt and the change note). */
export function scopeReason(ts: Ts, project: TsProject, file: string): string {
	const scope = fileScope(ts, project, file);
	return 'skip' in scope ? '' : scope.reason ?? '';
}

/** The install command, once per run. */
export function setupCommands(project: TsProject): CheckCommand[] {
	return typeof project.manager === 'object' ? [{ label: 'install', command: project.manager.install }] : [];
}

const RUNNER = /^\s*(?:npx\s+)?(jest|vitest|mocha|node\s+--test)\b[^&|;<>]*$/;

/** The test command of the nearest package.json with a test script, and the runner when it is one plain runner call. */
export function testCommand(project: TsProject, file: string): { command: string; runner?: string } | undefined {
	if (typeof project.manager !== 'object') { return undefined; }
	for (let dir = path.posix.dirname(file); ; dir = path.posix.dirname(dir)) {
		const pkg = project.packages.get(dir);
		const script = pkg?.scripts?.test;
		if (pkg && script && !/no test specified/.test(script)) {
			const runner = RUNNER.exec(script)?.[1].split(/\s/)[0];
			const flag = runner === 'jest' ? ' -- --json' : runner === 'vitest' ? ' -- --reporter=json' : runner === 'mocha' ? ' -- --reporter json' : '';
			const name = project.manager.name;
			const base = dir === '.' ? (name === 'npm' ? 'npm test' : name === 'bun' ? 'bun run test' : `${name} test`)
				: name === 'npm' ? `npm test -w ${dir}` : name === 'pnpm' ? `pnpm --filter ./${dir} test`
					: name === 'yarn' && pkg.name ? `yarn workspace ${pkg.name} test` : undefined;
			return base ? { command: `${base}${flag}`, runner } : undefined;
		}
		if (dir === '.') { return undefined; }
	}
}

/** Build and test commands for a file: `tsc` for each tsconfig that builds it (verifying), then its test script; plain JS gets only tests. */
export function checkCommands(ts: Ts, project: TsProject, file: string): CheckCommand[] {
	const scope = fileScope(ts, project, file);
	if ('skip' in scope || typeof project.manager !== 'object') { return []; }
	const tests = testCommand(project, file);
	const exec = project.manager.exec;
	const build = scope.scope === 'functions' ? [] : scope.configs.map(config => ({ label: 'build' as const, verifies: true,
		command: config.references ? `${exec} tsc -b ${config.path} --pretty false` : `${exec} tsc --noEmit -p ${config.path} --pretty false` }));
	return [...build, ...(tests ? [{ label: 'test' as const, command: tests.command, ...(build.length ? {} : { verifies: true }) }] : [])];
}

/** `NODE_OPTIONS` that makes `node --test` print TAP, when a test script is a plain `node --test` call. */
export function commandEnv(project: TsProject): Record<string, string> {
	const nodeTest = [...project.packages.values()].some(pkg => /^\s*node\s+--test\b/.test(pkg.scripts?.test ?? ''));
	return { CI: '1', NO_COLOR: '1', ...(nodeTest ? { NODE_OPTIONS: '--test-reporter=tap' } : {}) };
}

/** Why the worktree is not ready after install: a workspace package linked from outside it. */
export function workspaceLinkProblem(project: TsProject): string | undefined {
	const root = realpathSync(project.root);
	for (const name of project.workspaces.keys()) {
		const link = path.join(project.root, 'node_modules', name);
		if (!existsSync(link)) { continue; }
		const target = realpathSync(link);
		if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
			return `After installing, the workspace package ${name} resolves to ${target}, outside the working copy, so tests would run your folder's code.`;
		}
	}
	return undefined;
}
