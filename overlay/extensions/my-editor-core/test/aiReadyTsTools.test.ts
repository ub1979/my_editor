import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileScope, tsProject } from '../src/aiready/tsProject';
import { findsFolder, pathFinders } from '../src/aiready/tsScan';
import { ESM, project, ts } from './tsFixture';

const OK = JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true }, include: ['src'] });

/** `scope: reason` (or `skip: reason`) for a file of an ES module project with the extra files. */
function scope(files: Record<string, string>, file = 'src/a.ts'): string {
	const { root, tracked } = project({ ...ESM, 'tsconfig.json': OK, [file]: 'export const a = 1;\n', ...files });
	const result = fileScope(ts, tsProject(ts, root, tracked), file);
	return 'skip' in result ? `skip: ${result.skip}` : `${result.scope}: ${result.reason ?? ''}`;
}

const pkg = (extra: Record<string, unknown>) => JSON.stringify({ name: 'p', type: 'module', ...extra });

test('ts-node running TS as CommonJS (its tsconfig section, -r ts-node/register, .mocharc) narrows to types, named as ts-node', () => {
	const section = JSON.stringify({ ...JSON.parse(OK), 'ts-node': { compilerOptions: { module: 'commonjs' } } });
	assert.equal(scope({ 'tsconfig.json': section }), 'types: ts-node runs it as CommonJS (the "ts-node" section of tsconfig.json)');
	for (const script of ['mocha -r ts-node/register "src/**/*.test.ts"', 'node --require ts-node/register src/a.ts', 'NODE_OPTIONS="-r ts-node/register" mocha']) {
		assert.equal(scope({ 'package.json': pkg({ scripts: { test: script } }) }), 'types: ts-node runs it as CommonJS (-r ts-node/register)', script);
	}
	assert.equal(scope({ '.mocharc.json': '{"require":["ts-node/register"],"spec":"src/**/*.test.ts"}' }),
		'types: ts-node runs it as CommonJS (-r ts-node/register)');
	assert.equal(scope({ '.mocharc.yml': 'require: ts-node/register\n' }, 'src/a.mjs'), 'skip: ts-node runs it as CommonJS (-r ts-node/register)');
	assert.equal(scope({ 'package.json': pkg({ scripts: { start: 'ts-node src/a.ts' } }) }), 'types: ts-node compiles each file as it runs');
	assert.equal(scope({ 'package.json': pkg({ scripts: { start: 'ts-node-esm src/a.ts' } }) }), 'types: ts-node compiles each file as it runs');
	assert.equal(scope({ 'package.json': pkg({ scripts: { start: 'node src/main.ts' } }) }), 'types: Node\'s type stripping runs the TypeScript without a compile step');
});

test('transform tools from dependencies or config files narrow to types-only moves, each with a plain reason', () => {
	const dep = (name: string, extra: Record<string, unknown> = {}) => ({ 'package.json': pkg({ devDependencies: { [name]: '1' }, ...extra }) });
	const cases: [Record<string, string>, string][] = [
		[dep('next'), 'Next.js compiles the code with its own compiler'],
		[dep('vite'), 'Vite compiles each file with esbuild'],
		[{ 'vite.config.ts': 'export default {};\n' }, 'Vite compiles each file with esbuild'],
		[dep('vitest'), 'Vitest runs the tests through Vite, which compiles each file with esbuild'],
		[{ 'vitest.config.mts': 'export default {};\n' }, 'Vitest runs the tests through Vite, which compiles each file with esbuild'],
		[{ 'package.json': pkg({ scripts: { build: 'esbuild src/a.ts --bundle --outdir=dist' } }) }, 'esbuild compiles each file'],
		[{ 'scripts/build.mjs': "import { build } from 'esbuild';\nawait build({});\n" }, 'esbuild compiles each file'],
		[dep('tsup'), 'tsup compiles each file with esbuild'],
		[{ 'package.json': pkg({ scripts: { start: 'bun src/a.ts' } }) }, 'Bun runs the TypeScript without a compile step'],
		[{ 'bunfig.toml': '' }, 'Bun runs the TypeScript without a compile step'],
		[dep('tsx'), 'tsx compiles each file with esbuild'],
		[{ 'package.json': pkg({ scripts: { dev: 'npx tsx watch src/a.ts' } }) }, 'tsx compiles each file with esbuild'],
		[dep('@swc/core'), 'swc compiles each file'],
		[dep('@swc/cli'), 'swc compiles each file'],
		[{ '.swcrc': '{}' }, 'swc compiles each file'],
		[dep('@rollup/plugin-typescript'), 'Rollup compiles the code with @rollup/plugin-typescript'],
		[dep('rollup-plugin-esbuild'), 'Rollup compiles the code with rollup-plugin-esbuild'],
		[dep('ts-loader', { dependencies: { webpack: '5' } }), 'webpack compiles the code with ts-loader'],
		[dep('babel-loader'), 'webpack compiles the code with babel-loader'],
		[dep('parcel'), 'Parcel compiles the code'],
		[{ '.parcelrc': '{}' }, 'Parcel compiles the code'],
		[{ '.babelrc': '{}' }, 'Babel compiles the code'],
	];
	for (const [files, reason] of cases) { assert.equal(scope(files), `types: ${reason}`, JSON.stringify(files)); }
	assert.equal(scope(dep('esbuild')), 'runtime: ', 'esbuild as a dependency alone does not say it builds the code');
	assert.equal(scope(dep('rollup')), 'runtime: ');
});

/** Which files find `src/plugins/` by a path string, as `file:below` or `file:patterns`. */
function finders(files: Record<string, string>): string[] {
	const { root, tracked } = project({ 'package.json': '{"name":"p"}', 'src/plugins/a.ts': 'export const a = 1;\n', ...files });
	const found = pathFinders(tsProject(ts, root, tracked));
	return found.filter(f => findsFolder(f, 'src/plugins', ['src/plugins/a.ts', 'src/plugins/zzprobe.ts'])).map(f => `${f.file}:${f.below ?? f.patterns?.join('|')}`);
}

test('folder loaders: arrays of globs, member calls, a glob joined to __dirname, package.json scripts and .mocharc spec find a folder', () => {
	assert.deepEqual(finders({ 'src/main.ts': "const m = import.meta.glob(['./plugins/*.ts', '!./plugins/x.ts']);\n" }), ['src/main.ts:./plugins/*.ts|!./plugins/x.ts']);
	assert.deepEqual(finders({ 'scripts/b.mjs': "globSync(['lib/*.ts', 'src/plugins/*.ts']);\n" }), ['scripts/b.mjs:lib/*.ts|src/plugins/*.ts']);
	assert.deepEqual(finders({ 'scripts/b.mjs': "fg.sync('src/plugins/*.ts');\nglob.sync('src/**/*.ts');\nawait globby.globby(['src/plugins']);\n" }),
		['scripts/b.mjs:src/plugins/*.ts', 'scripts/b.mjs:src/**/*.ts', 'scripts/b.mjs:src/plugins']);
	assert.deepEqual(finders({ 'src/db.ts': "new DataSource({ entities: [__dirname + '/plugins/*.ts'] });\n" }), ['src/db.ts:src']);
	assert.deepEqual(finders({ 'src/db.ts': "new DataSource({ entities: [User], migrations: options.migrations });\n" }), []);
	assert.deepEqual(finders({ 'package.json': '{"name":"p","scripts":{"build":"esbuild \'src/plugins/*.ts\' --outdir=dist","x":"tsc"}}' }),
		['package.json:src/plugins/*.ts']);
	assert.deepEqual(finders({ '.mocharc.yml': "spec: 'src/plugins/**/*.ts'\n" }), ['.mocharc.yml:src/plugins/**/*.ts']);
	assert.deepEqual(finders({ '.mocharc.yaml': 'require: x\nspec:\n  - lib/*.ts\n  - src/plugins/**/*.ts\nui: bdd\n' }), ['.mocharc.yaml:lib/*.ts|src/plugins/**/*.ts']);
	assert.deepEqual(finders({ '.mocharc.json': '{"spec":["src/plugins/*.ts"]}' }), ['.mocharc.json:src/plugins/*.ts']);
	assert.deepEqual(finders({ 'scripts/b.mjs': "globSync(['lib/*.ts']);\nfg.sync('lib/**');\n" }), []);
});
