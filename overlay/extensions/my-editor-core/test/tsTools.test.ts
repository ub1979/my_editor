import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PackageJson } from '../src/aiready/tsProject';
import { typesOnlyReason } from '../src/aiready/tsTools';
import { project, ts } from './tsFixture';

/**
 * Why only types may move in a project with these files, root package.json and extra dependencies.
 * `typesOnlyReason` reads tracked configs and build scripts from disk, so each case writes a temp project.
 */
function reason(files: Record<string, string>, pkg: PackageJson = {}, deps: string[] = []): string | undefined {
	const { root, tracked } = project({ 'package.json': JSON.stringify(pkg), 'src/a.ts': 'export const a = 1;\n', ...files });
	return typesOnlyReason(ts, { root, tracked, packages: new Map([['package.json', pkg]]), dependencies: new Set(deps) });
}

test('a plain tsc project has no reason: everything may move', () => {
	assert.equal(reason({ 'tsconfig.json': '{}' }, { scripts: { build: 'tsc -p .', test: 'node --test dist' } }, ['typescript']), undefined);
});

test('a bundler or other compiler named by a dependency narrows to types', () => {
	assert.equal(reason({}, {}, ['next', 'vite']), 'Next.js compiles the code with its own compiler', 'the first match wins');
	assert.equal(reason({}, {}, ['vitest']), 'Vitest runs the tests through Vite, which compiles each file with esbuild');
	assert.equal(reason({}, {}, ['ts-loader']), 'webpack compiles the code with ts-loader');
	assert.equal(reason({}, {}, ['@rollup/plugin-typescript']), 'Rollup compiles the code with @rollup/plugin-typescript');
	assert.equal(reason({}, {}, ['@swc/core']), 'swc compiles each file');
	assert.equal(reason({}, {}, ['@babel/preset-typescript']), 'Babel compiles the code');
	assert.equal(reason({}, {}, ['expo']), 'Metro (React Native) compiles the code with Babel');
});

test('tracked config files narrow to types; ones under node_modules do not', () => {
	assert.equal(reason({ 'vite.config.ts': 'export default {};\n' }), 'Vite compiles each file with esbuild');
	assert.equal(reason({ '.babelrc': '{}' }), 'Babel compiles the code');
	assert.equal(reason({ 'deno.json': '{}' }), 'Deno runs the TypeScript without a compile step');
	assert.equal(reason({ 'bun.lockb': '' }), 'Bun runs the TypeScript without a compile step');
	assert.equal(reason({ 'node_modules/x/vite.config.ts': '' }), undefined);
});

test('package scripts that run TypeScript without tsc narrow to types', () => {
	assert.equal(reason({}, { scripts: { dev: 'tsx watch src/a.ts' } }), 'tsx compiles each file with esbuild');
	assert.equal(reason({}, { scripts: { start: 'node --import tsx src/a.ts' } }), 'tsx compiles each file with esbuild');
	assert.equal(reason({}, { scripts: { start: 'ts-node src/a.ts' } }), 'ts-node compiles each file as it runs');
	assert.equal(reason({}, { scripts: { start: 'node src/a.ts' } }), 'Node\'s type stripping runs the TypeScript without a compile step');
	assert.equal(reason({}, { scripts: { start: 'node --experimental-strip-types x' } }), 'Node\'s type stripping runs the TypeScript without a compile step');
	assert.equal(reason({}, { scripts: { build: 'esbuild src/a.ts --bundle' } }), 'esbuild compiles each file');
	assert.equal(reason({}, { scripts: { start: 'node dist/a.js', lint: 'eslint src' } }), undefined, 'plain node on JavaScript is fine');
});

test('a tracked build script that loads esbuild narrows to types, even without a dependency', () => {
	assert.equal(reason({ 'build.mjs': "import { build } from 'esbuild';\nawait build({});\n" }), 'esbuild compiles each file');
	assert.equal(reason({ 'build.js': "require('esbuild').buildSync({ tsconfigRaw: {} });\n" }), 'esbuild compiles each file');
	assert.equal(reason({ 'notes.md': "import 'esbuild'\n" }), undefined, 'only script and JSON files are read');
});

test('ts-node running CommonJS wins over every other reason', () => {
	const commonJs = { 'tsconfig.json': JSON.stringify({ 'ts-node': { compilerOptions: { module: 'CommonJS' } } }) };
	assert.equal(reason(commonJs, {}, ['next']), 'ts-node runs it as CommonJS (the "ts-node" section of tsconfig.json)');
	const moduleTypes = { 'tsconfig.build.json': JSON.stringify({ 'ts-node': { moduleTypes: { '**/*.cts': 'cjs' } } }) };
	assert.equal(reason(moduleTypes), 'ts-node runs it as CommonJS (the "ts-node" section of tsconfig.build.json)');
	assert.equal(reason({ '.mocharc.json': '{"require":"ts-node/register"}' }), 'ts-node runs it as CommonJS (-r ts-node/register)');
	assert.equal(reason({}, { scripts: { test: 'mocha -r ts-node/register' } }), 'ts-node runs it as CommonJS (-r ts-node/register)');
});

test('a "ts-node" section emitting ES modules is not a reason', () => {
	assert.equal(reason({ 'tsconfig.json': JSON.stringify({ 'ts-node': { esm: true, compilerOptions: { module: 'NodeNext' } } }) }), undefined);
});

test('a package\'s "babel" field narrows to types', () => {
	assert.equal(reason({}, { babel: { presets: [] } }), 'Babel compiles the code');
});
