import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { TsFileContext } from '../src/aiready/tsRules';
import { tsFileNameProblems } from '../src/aiready/tsRules';
import { tsInfo } from './tsFixture';

/** Why the last declaration of the text may not move, or 'movable'. */
function last(text: string, context: Partial<TsFileContext> = {}, file = 'src/a.ts'): string {
	const info = tsInfo(file, text, context);
	const decl = info.declarations[info.declarations.length - 1];
	return decl.movable ? 'movable' : decl.reason ?? '';
}

test('spans: attached JSDoc and // comments, a trailing comment and @ts-expect-error move; a detached comment stays; overloads are one declaration', () => {
	const text = "import { x } from './x.js';\n\n// detached\n\n/** Doc. */\n// eslint-disable-next-line\nexport function a() { return x; } // trailing\n\n"
		+ "// @ts-expect-error old\nexport const b: number = 'x';\nexport function f(a: string): void;\nexport function f(a: number): void;\nexport function f(a: unknown) {}\n"
		+ 'const k = 1; const m = 2;\n';
	const info = tsInfo('src/a.ts', text);
	const source = Buffer.from(text);
	const spans = info.declarations.map(d => source.subarray(d.span.start, d.span.end).toString());
	assert.deepEqual(spans.slice(0, 3), ['/** Doc. */\n// eslint-disable-next-line\nexport function a() { return x; } // trailing',
		"// @ts-expect-error old\nexport const b: number = 'x';", 'export function f(a: string): void;\nexport function f(a: number): void;\nexport function f(a: unknown) {}']);
	assert.equal(info.declarations[0].doc, 'Doc.');
	assert.deepEqual(info.declarations.slice(3).map(d => d.reason), ['it shares a line with other code', 'it shares a line with other code']);
	assert.deepEqual(info.declarations.map(d => d.names), [['a'], ['b'], ['f'], ['k'], ['m']]);
});

test('spans are UTF-8 byte offsets even after an emoji and an accent', () => {
	const text = "export const s = 'é😀';\n\nexport function g() {}\n";
	const info = tsInfo('src/a.ts', text);
	const g = info.declarations[1];
	assert.equal(g.span.start, Buffer.byteLength("export const s = 'é😀';\n\n"));
	assert.notEqual(g.span.start, text.indexOf('export function g'));
	assert.equal(Buffer.from(text).subarray(g.span.start, g.span.end).toString(), 'export function g() {}');
});

test('purity: literals, functions, module reads, plain arrays and objects and new Map() are pure; operators, reads, calls and globals are not', () => {
	const pure = ['/a/', "'x'", '`x`', '() => 1', '[1, A]', '{ a: 1, f() { return 1; } }', 'new Map()', 'undefined', '-1', 'A as unknown'];
	const impure = ['`${A}`', 'A + 1', 'A.b', "'k' in A", 'A instanceof Object', '[...A]', '{ [A]: 1 }', '{ get x() { return 1; } }', '{ ...A }',
		'new Map([[1, 2]])', "Symbol('s')", 'Object.freeze({})', 'A()', 'window', 'process'];
	for (const expr of pure) { assert.equal(last(`import { A } from './a.js';\n\nexport const v = ${expr};\n`), 'movable', expr); }
	for (const expr of impure) { assert.match(last(`import { A } from './a.js';\n\nexport const v = ${expr};\n`), /its definition runs code/, expr); }
});

test('probe p3: a template with a substitution runs code (a getter read twice would swap values), so it never moves', () => {
	const text = "import { counter } from './c.mjs';\nexport const a = counter.next;\nexport const b = `${{ toString: () => 'id' + counter.next }}`;\n";
	assert.match(last(text, {}, 'src/orig.mts'), /its definition runs code/);
});

test('the quiet window: a function after init() moves, a const or class after it does not; extends an import after quiet statements does', () => {
	assert.equal(last("import { init } from './i.js';\n\ninit();\n\nexport function f() {}\n"), 'movable');
	assert.match(last("import { init } from './i.js';\n\ninit();\n\nexport const c = 1;\n"), /code runs before it/);
	assert.match(last("import { init } from './i.js';\n\ninit();\n\nexport class K {}\n"), /code runs before it/);
	assert.equal(last("import { Base } from './b.js';\n\nexport const n = 1;\nexport type T = string;\n\nexport class K extends Base {}\n"), 'movable');
	assert.match(last('export class K extends Error {}\n'), /its definition runs code/);
	assert.match(last('export const x = window;\n'), /its definition runs code/);
});

test('classes: a decorator, a static block calling code and extends mixin(B) do not move; a literal enum moves, a computed one and a const enum do not', () => {
	assert.match(last('declare const d: any;\n\nexport class K { @d m() {} }\n'), /decorators/);
	assert.match(last("import { setup } from './s.js';\n\nexport class K { static { setup(); } }\n"), /its definition runs code/);
	assert.match(last("import { mixin, B } from './m.js';\n\nexport class K extends mixin(B) {}\n"), /its definition runs code/);
	assert.equal(last('export class K { static n = 1; x = Date.now(); m() { return this; } }\n'), 'movable');
	assert.equal(last('export enum E { A = 1, B = A, C = \'c\' }\n'), 'movable');
	assert.match(last("import { f } from './f.js';\n\nexport enum E { A = f() }\n"), /a member is computed/);
	assert.match(last('export const enum E { A = 1 }\n'), /const enum/);
});

test('names: assigned elsewhere, merged, declare, namespace, destructuring and statements do not move', () => {
	assert.match(last('export let n = 0;\nexport function reset() { n = 0; }\n\nexport let m = 0;\n'), /^movable$/);
	assert.match(tsInfo('src/a.ts', 'export let n = 0;\nexport function reset() { n = 0; }\n').declarations[0].reason ?? '', /n is assigned elsewhere/);
	assert.match(tsInfo('src/a.ts', 'export function f() {}\nf = () => 1;\n').declarations[0].reason ?? '', /f is assigned elsewhere/);
	assert.match(tsInfo('src/a.ts', 'export class K {}\nexport function g() { K = class {}; }\n').declarations[0].reason ?? '', /K is assigned elsewhere/);
	assert.match(last('export interface I { a: 1 }\nexport interface I { b: 2 }\n'), /more than one declaration/);
	assert.match(last('export declare const x: number;\n'), /ambient/);
	assert.match(last('declare global { interface Window { a: 1 } }\nexport {};\n'), /not a declaration/);
	assert.match(last('export namespace N { export const a = 1; }\n'), /namespace/);
	assert.match(last("import { o } from './o.js';\n\nexport const { a } = o;\n"), /destructures/);
	assert.match(last("import { o } from './o.js';\n\nconsole.log(o);\n"), /not a declaration/);
});

test('module-relative code: import.meta.url, __filename, top-level this, and this or arguments in top-level arrows refuse; __dirname and require(literal) in a function move', () => {
	assert.match(last('export const u = () => import.meta.url;\n'), /import\.meta/);
	assert.equal(last('export const d = () => import.meta.dirname;\n'), 'movable');
	assert.match(last('export function f() { return __filename; }\n'), /__filename/);
	assert.match(last('export const t = () => this;\n'), /`this` at module level/);
	assert.match(last('export const t = () => () => this;\n'), /`this` at module level/);
	assert.match(last('export const t = () => arguments.length;\n'), /`arguments` at module level/);
	assert.equal(last('export function f() { return this; }\n'), 'movable');
	assert.equal(last("export function f() { return [__dirname, require('./x')]; }\n"), 'movable');
	assert.match(last('export function f(n: string) { return require(n); }\n'), /require/);
	assert.match(last("import { readdirSync } from 'fs';\n\nexport function list() { return readdirSync('.'); }\n"), /lists a folder/);
});

test('probe p2: JSX moves under react-jsx or classic JSX, never under jsx preserve or without a tsconfig; JSDoc @typedef refuses', () => {
	const tsx = "import React from 'react';\n\nexport function C() { return <div />; }\n";
	assert.equal(last(tsx, { jsx: 'automatic' }, 'src/c.tsx'), 'movable');
	assert.equal(last(tsx, { jsx: 'classic' }, 'src/c.tsx'), 'movable');
	assert.match(last(tsx, { jsx: 'other' }, 'src/c.tsx'), /JSX is compiled by another tool/);
	assert.match(last('/** @typedef {{ a: number }} Row */\nexport function f() {}\n', { scope: 'functions' }, 'lib/a.mjs'), /@typedef/);
});

test('scope: types-only files move only interfaces and type aliases; plain JS moves only functions', () => {
	const text = 'export interface I { a: 1 }\nexport type T = string;\nexport function f() {}\n';
	const types = tsInfo('src/a.ts', text, { scope: 'types', scopeReason: 'it is emitted as CommonJS' });
	assert.deepEqual(types.declarations.map(d => d.reason), [undefined, undefined, 'only interfaces and type aliases may move here: it is emitted as CommonJS']);
	assert.deepEqual(tsInfo('lib/a.mjs', 'export const c = 1;\nexport function f() {}\n', { scope: 'functions' }).declarations.map(d => d.reason),
		['only function declarations may move in plain JavaScript', undefined]);
});

test('skipped files: module format, directives, tool comments, CRLF, parse errors, tests, generated code, decorators with metadata and imports after code', () => {
	const skip = (file: string, text: string, context: Partial<TsFileContext> = {}) => tsInfo(file, text, context).skip ?? 'none';
	assert.equal(skip('src/a.ts', 'export const a = 1;\n'), 'none');
	assert.match(skip('lib/a.js', "const x = require('x');\nmodule.exports = { x };\n", { scope: 'functions' }), /CommonJS module/);
	assert.match(skip('src/a.ts', 'const a = 1;\nexport = a;\n'), /export =/);
	assert.match(skip('src/a.ts', 'const a = 1;\n'), /script file/);
	assert.match(skip('src/a.tsx', "'use client';\nexport const a = 1;\n"), /'use client'/);
	assert.equal(skip('src/a.ts', "'use strict';\nexport const a = 1;\n"), 'none');
	assert.match(skip('src/a.ts', '// @ts-nocheck\nexport const a = 1;\n'), /@ts-nocheck/);
	assert.match(skip('src/a.ts', '/* eslint-disable */\nexport const a = 1;\n'), /eslint-disable/);
	assert.equal(skip('src/a.ts', '// eslint-disable-next-line\nexport const a = 1;\n'), 'none');
	assert.match(skip('src/a.ts', 'export const a = 1;\r\n'), /CRLF/);
	assert.match(skip('src/a.ts', 'export const = ;\n'), /parser reports errors/);
	assert.match(skip('src/a.d.ts', 'export declare const a: 1;\n'), /declaration file/);
	assert.match(skip('src/a.test.ts', 'export const a = 1;\n'), /test/);
	assert.match(skip('src/__mocks__/a.ts', 'export const a = 1;\n'), /test/);
	assert.match(skip('vite.config.ts', 'export const a = 1;\n'), /config/);
	assert.match(skip('src/a.ts', '// Code generated by protoc. DO NOT EDIT.\nexport const a = 1;\n'), /generated/);
	assert.match(skip('src/a.ts', `export const a = '${'x'.repeat(1001)}';\n`), /minified/);
	assert.match(skip('src/a.ts', 'declare const d: any;\n@d class K {}\nexport { K };\n', { emitDecoratorMetadata: true }), /emitDecoratorMetadata/);
	assert.match(skip('src/a.ts', "export const a = 1;\nimport { b } from './b.js';\n"), /imports are not one block/);
	assert.match(skip('src/a.ts', 'export const a = 1;\n', { cyclic: true }), /import cycle/);
	assert.match(skip('src/a.ts', 'export const a = 1;\n', { scope: { skip: 'no tsconfig includes it' } }), /no tsconfig/);
});

test('skipped files: side-effect-free packages with code at load, folders found by path, public wildcard subpaths and files lists', () => {
	const skip = (text: string, context: Partial<TsFileContext>) => tsInfo('src/a.ts', text, context).skip ?? 'none';
	assert.match(skip("import { f } from './f.js';\n\nf();\nexport const a = 1;\n", { sideEffectFree: true }), /side-effect-free/);
	assert.match(skip("import './polyfill.js';\n\nexport const a = 1;\n", { sideEffectFree: true }), /side-effect-free/);
	assert.equal(skip('export const a = 1;\nexport function f() {}\n', { sideEffectFree: true }), 'none');
	assert.match(skip('export const a = 1;\n', { foundByPath: 'src/load.ts finds files in this folder by a path string' }), /finds files/);
	assert.match(skip('export const a = 1;\n', { exportsWildcard: true }), /wildcard/);
	assert.match(skip('export const a = 1;\n', { listedInFiles: true }), /"files"/);
});

test('file names: same extension, not index or a framework name, no stem clash with a file or folder, not matched by test globs', () => {
	const entries = ['report.ts', 'utils', 'rows.js'];
	assert.deepEqual(tsFileNameProblems('formatting.ts', 'src/report.ts', entries, []), []);
	assert.match(tsFileNameProblems('formatting.tsx', 'src/report.ts', entries, []).join(' '), /extension \.ts/);
	assert.match(tsFileNameProblems('index.ts', 'src/report.ts', entries, []).join(' '), /index files/);
	assert.match(tsFileNameProblems('page.tsx', 'app/report.tsx', [], []).join(' '), /frameworks/);
	assert.match(tsFileNameProblems('utils.ts', 'src/report.ts', entries, []).join(' '), /utils already uses the name utils/);
	assert.match(tsFileNameProblems('Rows.ts', 'src/report.ts', entries, []).join(' '), /rows\.js already uses the name Rows/);
	assert.match(tsFileNameProblems('rows.test.ts', 'src/report.ts', entries, []).join(' '), /test/);
	assert.match(tsFileNameProblems('_rows.ts', 'src/report.ts', entries, []).join(' '), /starting with a letter or digit/);
	assert.match(tsFileNameProblems('checks.ts', 'src/report.ts', entries, ['src/**/check*.ts']).join(' '), /test pattern src\/\*\*\/check\*\.ts matches it/);
});
