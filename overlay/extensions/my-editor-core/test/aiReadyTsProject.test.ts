import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { splitCommand } from '../src/aiready/projectCommands';
import { cyclicFiles } from '../src/aiready/tsGraph';
import { loadTypeScript } from '../src/aiready/tsLoad';
import { checkCommands, commandEnv, fileScope, scopeReason, setupCommands, tsProject } from '../src/aiready/tsProject';
import { findsFolder, frameworkFolder, globRegExp, pathFinders } from '../src/aiready/tsScan';
import { ESM, project, ts } from './tsFixture';

const TSCONFIG = (options: Record<string, unknown>) => JSON.stringify({ compilerOptions: { target: 'es2022', strict: true, ...options }, include: ['src'] });

function scope(files: Record<string, string | undefined>, file = 'src/a.ts'): string {
	const { root, tracked } = project({ ...ESM, [file]: 'export const a = 1;\n', ...files });
	const result = fileScope(ts, tsProject(ts, root, tracked), file);
	return 'skip' in result ? `skip: ${result.skip}` : result.scope;
}

test('TypeScript loads once from a folder and only as major 5 or 6', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-ts7-'));
	writeFileSync(path.join(dir, 'package.json'), '{"main":"index.js"}');
	writeFileSync(path.join(dir, 'index.js'), 'module.exports = { version: "7.0.0", createProgram() {} };');
	assert.match(String(loadTypeScript(dir)), /needs the editor's TypeScript 5 or 6\. Found 7\.0\.0/);
	assert.match(String(loadTypeScript(path.join(dir, 'missing'))), /not found/);
	assert.match(ts.version, /^[56]\./);
});

test('scope: an ES module project checked only by tsc may move run-time declarations', () => {
	assert.equal(scope({}), 'runtime');
	assert.equal(scope({ 'tsconfig.json': TSCONFIG({ module: 'esnext', moduleResolution: 'bundler' }), 'package.json': '{"name":"x"}' }), 'runtime');
});

test('scope (probe p1): CommonJS output anywhere reduces a file to types-only moves', () => {
	assert.equal(scope({ 'tsconfig.json': TSCONFIG({ module: 'commonjs', moduleResolution: 'node10' }) }), 'types');
	assert.equal(scope({}, 'src/a.cts'), 'types');
	assert.equal(scope({ 'package.json': '{"name":"shop"}' }), 'types');
	assert.equal(scope({ 'package.json': '{"name":"shop","type":"module","devDependencies":{"jest":"29"}}' }), 'types');
});

test('scope: a transform tool or TS run without a compile step reduces a file to types-only moves', () => {
	for (const files of [{ '.babelrc': '{}' }, { '.swcrc': '{}' }, { 'build.config.mjs': 'export default { tsconfigRaw: {} };' },
		{ 'package.json': '{"type":"module","devDependencies":{"sucrase":"3"}}' }, { 'package.json': '{"type":"module","dependencies":{"react-native":"0.7"}}' },
		{ 'package.json': '{"type":"module","devDependencies":{"tsx":"4"}}' }, { 'package.json': '{"type":"module","scripts":{"start":"node src/main.ts"}}' },
		{ 'package.json': '{"type":"module","scripts":{"start":"node --experimental-strip-types src/main.mts"}}' },
		{ 'tsconfig.json': TSCONFIG({ module: 'nodenext', moduleResolution: 'nodenext', erasableSyntaxOnly: true }) }, { 'bun.lock': '' }, { 'deno.json': '{}' }]) {
		assert.equal(scope(files), 'types', JSON.stringify(files));
	}
});

test('scope: a tsconfig without module or moduleResolution skips; plain JS moves functions only as native ES modules', () => {
	assert.match(scope({ 'tsconfig.json': TSCONFIG({ module: 'esnext' }) }), /^skip: tsconfig.json does not set both "module" and "moduleResolution"/);
	assert.match(scope({ 'tsconfig.json': TSCONFIG({ moduleResolution: 'bundler' }) }), /^skip: tsconfig.json does not set both/);
	assert.match(scope({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.ts'), /^skip: no tsconfig includes it/);
	assert.equal(scope({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.mjs'), 'functions');
	assert.equal(scope({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.js'), 'functions');
	assert.match(scope({ 'tsconfig.json': '{"files":[]}', 'package.json': '{"name":"x"}' }, 'lib/a.js'), /^skip: plain JavaScript that does not run as an ES module/);
	assert.match(scope({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.cjs'), /^skip: CommonJS module/);
	assert.match(scope({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.jsx'), /^skip: JSX in plain JavaScript/);
	assert.match(scope({ 'tsconfig.json': '{"files":[]}', 'package.json': '{"type":"module","devDependencies":{"jest":"29"}}' }, 'lib/a.mjs'), /^skip: tests run under Jest/);
});

test('commands: the lockfile\'s install, tsc for the file\'s tsconfig with npx --no, and the nearest test script with its reporter', () => {
	const commands = (files: Record<string, string | undefined>, file = 'src/a.ts') => {
		const { root, tracked } = project({ ...ESM, [file]: 'export const a = 1;\n', ...files });
		const p = tsProject(ts, root, tracked);
		return { setup: setupCommands(p).map(c => c.command), checks: checkCommands(ts, p, file), env: commandEnv(p) };
	};
	const npm = commands({});
	assert.deepEqual(npm.setup, ['npm ci']);
	assert.deepEqual(npm.checks, [{ label: 'build', verifies: true, command: 'npx --no -- tsc --noEmit -p tsconfig.json --pretty false' }, { label: 'test', command: 'npm test' }]);
	assert.deepEqual(npm.env, { CI: '1', NO_COLOR: '1', NODE_OPTIONS: '--test-reporter=tap' });
	assert.equal(commands({ 'package.json': '{"type":"module","scripts":{"test":"jest --ci"}}' }).checks[1].command, 'npm test -- --json');
	assert.equal(commands({ 'package.json': '{"type":"module","scripts":{"test":"vitest run"}}' }).checks[1].command, 'npm test -- --reporter=json');
	assert.equal(commands({ 'package.json': '{"type":"module","scripts":{"test":"mocha"}}' }).checks[1].command, 'npm test -- --reporter json');
	assert.equal(commands({ 'package.json': '{"type":"module","scripts":{"test":"tsc && node --test"}}' }).checks[1].command, 'npm test');
	const pnpm = commands({ 'package-lock.json': undefined, 'pnpm-lock.yaml': '', 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
		'packages/a/package.json': '{"name":"a","type":"module","scripts":{"test":"vitest run"}}', 'packages/a/tsconfig.json': TSCONFIG({ module: 'nodenext', moduleResolution: 'nodenext' }) }, 'packages/a/src/x.ts');
	assert.deepEqual(pnpm.setup, ['pnpm install --frozen-lockfile']);
	assert.deepEqual(pnpm.checks.map(c => c.command), ['pnpm exec tsc --noEmit -p packages/a/tsconfig.json --pretty false', 'pnpm --filter ./packages/a test -- --reporter=json']);
	const yarn = commands({ 'package-lock.json': undefined, 'yarn.lock': '', '.yarnrc.yml': '', 'package.json': '{"type":"module","workspaces":["packages/*"]}',
		'packages/b/package.json': '{"name":"@x/b","type":"module","scripts":{"test":"node --test"}}', 'packages/b/tsconfig.json': TSCONFIG({ module: 'nodenext', moduleResolution: 'nodenext' }) }, 'packages/b/src/x.ts');
	assert.deepEqual(yarn.setup, ['yarn install --immutable']);
	assert.deepEqual(yarn.checks.map(c => c.command), ['yarn tsc --noEmit -p packages/b/tsconfig.json --pretty false', 'yarn workspace @x/b test']);
	assert.equal(commands({ 'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' }, include: ['src'], references: [{ path: './lib' }] }) }).checks[0].command,
		'npx --no -- tsc -b tsconfig.json --pretty false');
	assert.deepEqual(commands({ 'tsconfig.json': '{"files":[]}' }, 'lib/a.mjs').checks, [{ label: 'test', command: 'npm test', verifies: true }]);
	const none = commands({ 'package-lock.json': undefined });
	assert.deepEqual([none.setup, none.checks], [[], []]);
	for (const command of [...npm.setup, ...npm.checks.map(c => c.command), ...pnpm.checks.map(c => c.command), ...yarn.checks.map(c => c.command)]) {
		assert.ok(splitCommand(command), command);
		assert.doesNotMatch(command, /\b(push|fetch|remote)\b/);
	}
});

test('folders found by path: readdirSync strings, import.meta.glob, ORM entity globs and computed readdir arguments', () => {
	const { root, tracked } = project({
		'src/load.ts': "import { readdirSync } from 'fs';\nexport const plugins = readdirSync('./src/plugins');\n",
		'src/routes.ts': "export const pages = import.meta.glob('./pages/*.ts');\n",
		'src/db.ts': "export const options = { entities: ['src/**/*.entity.ts'] };\n",
		'tools/scan.ts': "import { readdirSync } from 'fs';\nimport * as path from 'path';\nexport const all = readdirSync(path.join(__dirname, 'x'));\n",
	});
	const finders = pathFinders({ root, tracked } as never);
	const found = (file: string) => finders.some(f => findsFolder(f, path.posix.dirname(file), [file, `${path.posix.dirname(file)}/zzprobe.ts`]));
	assert.ok(found('src/plugins/a.ts'));
	assert.ok(found('src/pages/home.ts'));
	assert.ok(found('src/models/user.entity.ts'));
	assert.ok(found('tools/deep/x.ts'));
	assert.ok(!found('src/other/report.ts'));
	assert.ok(globRegExp('**/?(*.)+(spec|test).[jt]s?(x)').test('src/a.test.ts'));
	assert.ok(!globRegExp('src/*.ts').test('src/a/b.ts'));
});

test('framework convention folders are skipped when the dependency is present, and api/ always', () => {
	const at = (dep: string, file: string) => frameworkFolder({ dependencies: new Set([dep]) } as never, file);
	assert.match(at('nuxt', 'composables/useCart.ts') ?? '', /nuxt/);
	assert.match(at('next', 'src/app/page-helpers.ts') ?? '', /next/);
	assert.match(at('expo-router', 'app/home.tsx') ?? '', /expo-router/);
	assert.match(at('@sveltejs/kit', 'src/routes/cart.ts') ?? '', /sveltejs/);
	assert.match(at('astro', 'src/pages/a.ts') ?? '', /astro/);
	assert.equal(at('next', 'src/lib/a.ts'), undefined);
	assert.match(at('x', 'api/users.ts') ?? '', /serverless/);
});

test('cycles: static, require in a function, import(), jest.requireActual, a self-import, a workspace name and a computed require; type-only edges are not cycles', () => {
	const { root, tracked } = project({
		...ESM, 'package.json': '{"name":"shop","type":"module","workspaces":["packages/*"]}',
		'src/a.ts': "import { b } from './b.js';\nexport const a = () => b;\n", 'src/b.ts': "import { a } from './a.js';\nexport const b = () => a;\n",
		'src/c.ts': "export function c() { return require('./d.js'); }\n", 'src/d.ts': "import { c } from './c.js';\nexport const d = c;\n",
		'src/e.ts': "export const e = () => import('./f.js');\n", 'src/f.ts': "import { e } from './e.js';\nexport const f = e;\n",
		'src/g.ts': "jest.requireActual('./h.js');\nexport const g = 1;\n", 'src/h.ts': "import { g } from './g.js';\nexport const h = g;\n",
		'src/self.ts': "import './self.js';\nexport const s = 1;\n", 'src/dyn.ts': 'export const load = (name: string) => require(name);\n',
		'src/t1.ts': "import type { T2 } from './t2.js';\nexport interface T1 { b?: T2 }\n", 'src/t2.ts': "import type { T1 } from './t1.js';\nexport interface T2 { a?: T1 }\n",
		'packages/p/package.json': '{"name":"@shop/p"}', 'packages/p/src/index.ts': "import { w } from '@shop/q';\nexport const p = w;\n",
		'packages/q/package.json': '{"name":"@shop/q"}', 'packages/q/src/index.ts': "import { p } from '@shop/p';\nexport const w = () => p;\n",
		'src/plain.ts': "import { a } from './a.js';\nexport const plain = a;\n",
	});
	const cyclic = cyclicFiles(ts, tsProject(ts, root, tracked));
	assert.deepEqual([...cyclic].sort(), ['packages/p/src/index.ts', 'packages/q/src/index.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/dyn.ts',
		'src/e.ts', 'src/f.ts', 'src/g.ts', 'src/h.ts', 'src/self.ts']);
});

test('the analysis never reads node_modules or untracked configs', () => {
	const { root, tracked } = project({ ...ESM, 'src/a.ts': '' });
	mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
	writeFileSync(path.join(root, 'node_modules', 'x', 'tsconfig.json'), '{}');
	assert.deepEqual(tsProject(ts, root, tracked).configs.map(c => c.path), ['tsconfig.json']);
});

test('scope reads every config that builds a file: a CommonJS build beside the ESM one, base configs, and an extends that does not resolve', () => {
	const cjs = JSON.stringify({ extends: './tsconfig.json', compilerOptions: { module: 'commonjs', moduleResolution: 'node10', outDir: 'dist/cjs' } });
	const { root, tracked } = project({ ...ESM, 'src/a.ts': 'export const a = 1;\n', 'tsconfig.cjs.json': cjs });
	const dual = tsProject(ts, root, tracked);
	assert.equal(scopeReason(ts, dual, 'src/a.ts'), 'tsconfig.cjs.json emits it as CommonJS');
	assert.deepEqual(checkCommands(ts, dual, 'src/a.ts').map(c => c.command), ['npx --no -- tsc --noEmit -p tsconfig.cjs.json --pretty false',
		'npx --no -- tsc --noEmit -p tsconfig.json --pretty false', 'npm test']);
	const based = JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' }, include: ['src'] });
	assert.equal(scope({ 'tsconfig.base.json': '{"compilerOptions":{"strict":true}}', 'tsconfig.json': based }), 'runtime');
	const missing = JSON.stringify({ extends: '@tsconfig/strictest/tsconfig.json', compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' }, include: ['src'] });
	assert.match(scope({ 'tsconfig.json': missing }), /^skip: tsconfig\.json could not be read fully/);
	assert.equal(scope({ 'package.json': '{"type":"module","scripts":{"dev":"node --import ./reg.js src/main.ts"}}' }), 'types');
	const allowJs = JSON.stringify({ compilerOptions: { module: 'commonjs', moduleResolution: 'node10', allowJs: true }, include: ['lib'] });
	assert.match(scope({ 'tsconfig.json': allowJs }, 'lib/a.js'), /^skip: tsconfig\.json compiles it to CommonJS/);
});

test('cycles also run through a .js file with a .d.ts beside it and through workspace packages found by "exports"; an unresolved workspace import counts as a cycle', () => {
	const { root, tracked } = project({
		'package.json': '{"name":"w","type":"module","workspaces":["packages/*"]}', 'package-lock.json': '{}',
		'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', allowJs: true }, include: ['src', 'packages'] }),
		'src/a.js': "import { b } from './b.js';\nexport const a = () => b;\n", 'src/b.js': "import { a } from './a.js';\nexport const b = () => a;\n",
		'src/b.d.ts': 'export declare const b: () => unknown;\n',
		'packages/p/package.json': '{"name":"@w/p","exports":"./lib/main.ts"}', 'packages/p/lib/main.ts': "import { q } from '@w/q';\nexport const p = () => q;\n",
		'packages/q/package.json': '{"name":"@w/q","exports":{".":"./lib/main.ts"}}', 'packages/q/lib/main.ts': "import { p } from '@w/p';\nexport const q = () => p;\n",
		'src/sub.ts': "import { x } from '@w/p/missing';\nexport const s = x;\n",
	});
	assert.deepEqual([...cyclicFiles(ts, tsProject(ts, root, tracked))].sort(), ['packages/p/lib/main.ts', 'packages/q/lib/main.ts', 'src/a.js', 'src/b.js', 'src/sub.ts']);
});

test('path strings are found in Vue, Svelte, Astro, HTML and YAML files too', () => {
	const { root, tracked } = project({ 'src/App.vue': "<script setup>\nconst pages = import.meta.glob('./components/*.ts', { eager: true });\n</script>\n" });
	const finders = pathFinders({ root, tracked } as never);
	assert.ok(finders.some(f => findsFolder(f, 'src/components', ['src/components/a.ts'])));
});
