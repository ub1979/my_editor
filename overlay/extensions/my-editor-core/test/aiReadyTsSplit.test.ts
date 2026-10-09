import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { buildTsSplit } from '../src/aiready/tsSplit';
import { split, text, ts, tsInfo } from './tsFixture';

const REPORT = `import { z } from 'zod';
import { helper } from './util.js';
import type { Options } from './options.js';

/** A row. */
export interface Row { name: string; size: number }

/** Parses one row. */
export function parseRow(line: string): Row {
	const [name, size] = line.split(',');
	return { name: z.string().parse(name), size: Number(size) };
}

export function formatRow(row: Row): string {
	return \`\${row.name}: \${row.size}\`;
}

export function report(lines: string[], options: Options): string {
	return lines.map(parseRow).map(formatRow).join(helper(options));
}
`;

/** Writes files into a temp folder and runs one with Node; returns its output. */
function run(files: Record<string, string>, main: string): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-probe-'));
	for (const [name, body] of Object.entries(files)) { writeFileSync(path.join(dir, name), body); }
	return execFileSync(process.execPath, [main], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

test('a split moves spans byte for byte, copies only the imports they use, and leaves a facade after the imports', () => {
	const result = split('src/report.ts', REPORT, [{ file: 'rows.ts', declarations: [0, 1, 2] }]);
	assert.equal(text(result, 0), `// Split from report.ts by my_editor.

import { z } from 'zod';

/** A row. */
export interface Row { name: string; size: number }

/** Parses one row. */
export function parseRow(line: string): Row {
	const [name, size] = line.split(',');
	return { name: z.string().parse(name), size: Number(size) };
}

export function formatRow(row: Row): string {
	return \`\${row.name}: \${row.size}\`;
}
`);
	assert.equal(text(result), `import 'zod';
import { helper } from './util.js';
import type { Options } from './options.js';
import { parseRow, formatRow } from './rows.js';
export { parseRow, formatRow } from './rows.js';
export type { Row } from './rows.js';

export function report(lines: string[], options: Options): string {
	return lines.map(parseRow).map(formatRow).join(helper(options));
}
`);
});

test('probe p4: a helper moves with every user; a non-exported helper used by staying code or by two new files is refused, so no export is added', () => {
	const orig = 'export function f() { return helper(); }\nfunction helper() { return 1; }\nexport const g = 1;\nexport function k() { return 2; }\n';
	assert.match(String(split('lib/orig.mjs', orig, [{ file: 'n.mjs', declarations: [0] }], { scope: 'functions' })), /declaration 0 \(f\) uses helper \(1\), which stays/);
	const moved = split('lib/orig.mjs', orig, [{ file: 'n.mjs', declarations: [0, 1] }], { scope: 'functions' });
	assert.equal(text(moved, 0), '// Split from orig.mjs by my_editor.\n\nexport function f() { return helper(); }\n\nfunction helper() { return 1; }\n');
	const index = "export * from './orig.mjs';\n";
	const keys = (files: Record<string, string>) => run({ ...files, 'index.mjs': index, 'main.mjs': "import * as ns from './index.mjs';\nconsole.log(Object.keys(ns).join(','));\n" }, 'main.mjs');
	assert.equal(keys({ 'orig.mjs': text(moved), 'n.mjs': text(moved, 0) }), keys({ 'orig.mjs': orig }));
	const staying = 'function helper() { return 1; }\nexport function k() { return helper(); }\n';
	assert.match(String(split('lib/orig.mjs', staying, [{ file: 'n.mjs', declarations: [0] }], { scope: 'functions' })), /stays and uses helper \(0\), which is not exported/);
	const two = 'function helper() { return 1; }\nexport function a() { return helper(); }\nexport function b() { return helper(); }\n';
	assert.match(String(split('lib/orig.mjs', two, [{ file: 'a2.mjs', declarations: [0, 1] }, { file: 'b2.mjs', declarations: [2] }], { scope: 'functions' })),
		/declaration 2 \(b\) uses helper \(0\), which is not exported: a helper moves to the same file/);
});

test('names across new files: an exported name is imported from its new file, type-only cycles pass, value cycles do not', () => {
	const src = 'export interface A { b?: B }\nexport interface B { a?: A }\nexport function f() { return g(); }\nexport function g() { return 1; }\nexport function h() { return f(); }\n';
	const types = split('src/t.ts', src, [{ file: 'ta.ts', declarations: [0] }, { file: 'tb.ts', declarations: [1] }]);
	assert.match(text(types, 0), /import type \{ B \} from '\.\/tb\.js';/);
	assert.match(text(types, 1), /import type \{ A \} from '\.\/ta\.js';/);
	const values = split('src/t.ts', src, [{ file: 'fa.ts', declarations: [2] }, { file: 'fb.ts', declarations: [3, 4] }]);
	assert.match(String(values), /import values from each other/);
	assert.match(text(split('src/t.ts', src, [{ file: 'fa.ts', declarations: [2, 4] }, { file: 'fb.ts', declarations: [3] }]), 0), /import \{ g \} from '\.\/fb\.js';/);
});

test('a type-only use of an exported staying type gets import type from the original; a non-exported one or a value use is refused', () => {
	const src = 'export interface Row { a: string }\ninterface Hidden { b: string }\nexport function f(r: Row): string { return r.a; }\nexport function h(x: Hidden) { return x.b; }\nexport function v() { return list; }\nexport const list: Row[] = [];\n';
	assert.match(text(split('src/t.ts', src, [{ file: 'f.ts', declarations: [2] }]), 0), /^import type \{ Row \} from '\.\/t\.js';$/m);
	assert.match(String(split('src/t.ts', src, [{ file: 'h.ts', declarations: [3] }])), /declaration 3 \(h\) uses Hidden \(1\), which stays/);
	assert.match(String(split('src/t.ts', src, [{ file: 'v.ts', declarations: [4] }])), /declaration 4 \(v\) uses list \(5\), which stays/);
	assert.match(String(split('src/t.ts', 'export interface I { a: 1 }\nexport { I as J };\n', [{ file: 'i.ts', declarations: [0] }])), /export list \(1\) names the type I/);
});

test('probe p3: a definition-time read must stay in order in one new file (const x = y before y would hit the temporal dead zone)', () => {
	const tdz = 'export const x = y;\nexport const y = 1;\n';
	assert.throws(() => run({ 'orig.mjs': tdz, 'main.mjs': "import './orig.mjs';\n" }, 'main.mjs'));
	assert.match(String(split('src/orig.mts', tdz, [{ file: 'n.mts', declarations: [0] }, { file: 'm.mts', declarations: [1] }])), /reads y \(1\) when it is defined; move both to the same file, y first/);
	assert.match(String(split('src/orig.mts', tdz, [{ file: 'n.mts', declarations: [0, 1] }])), /reads y \(1\) when it is defined, so y must come earlier/);
	assert.equal(typeof split('src/orig.mts', 'export const y = 1;\nexport const x = y;\n', [{ file: 'n.mts', declarations: [0, 1] }]), 'object');
});

test('copied imports keep as, type, default, namespace, attributes, quotes and semicolons; side-effect imports stay in the original', () => {
	const src = 'import D, { a as b, type T, c } from "./m.js"\nimport * as ns from "./ns.js"\nimport data from "./d.json" with { type: "json" }\nimport "./polyfill.js"\n\n'
		+ 'export function f(t: T) { return [D, b, ns.x, data, t]; }\nexport function g() { return c; }\n';
	const result = split('src/t.ts', src, [{ file: 'f.ts', declarations: [0] }]);
	assert.equal(text(result, 0), '// Split from t.ts by my_editor.\n\nimport D, { a as b, type T } from "./m.js"\nimport * as ns from "./ns.js"\n'
		+ 'import data from "./d.json" with { type: "json" }\n\nexport function f(t: T) { return [D, b, ns.x, data, t]; }\n');
	assert.equal(text(result), 'import { c } from "./m.js"\nimport "./ns.js"\nimport "./d.json" with { type: "json" }\nimport "./polyfill.js"\nexport { f } from "./f.js"\n\nexport function g() { return c; }\n');
});

test('probe p2: classic JSX copies the React import; automatic JSX does not', () => {
	const src = "import React from 'react';\nimport { useState } from 'react';\n\nexport function Counter() { const [n] = useState(0); return <b>{n}</b>; }\nexport function App() { return <Counter />; }\n";
	const classic = split('src/app.tsx', src, [{ file: 'counter.tsx', declarations: [0] }], { jsx: 'classic' });
	assert.match(text(classic, 0), /^import React from 'react';\nimport \{ useState \} from 'react';\n/m);
	assert.match(text(classic), /^import React from 'react';\nimport 'react';\nimport \{ Counter \} from '\.\/counter\.js';\nexport \{ Counter \} from '\.\/counter\.js';\n/);
	const automatic = split('src/app.tsx', src, [{ file: 'counter.tsx', declarations: [0] }], { jsx: 'automatic' });
	assert.doesNotMatch(text(automatic, 0), /import React/);
	assert.match(String(split('src/app.tsx', src.replace("import React from 'react';\n", ''), [{ file: 'counter.tsx', declarations: [0] }], { jsx: 'classic' })), /needs React in scope/);
});

test('the original keeps imports byte-identical unless a type specifier lost its last use or a value specifier its last value use', () => {
	const src = "import type { A, B } from './t.js';\nimport { a, type T } from './m.js';\nimport { type U } from './u.js';\nimport { Config } from './c.js';\n\n"
		+ 'export function moved(b: B, t: T, u: U, c: Config) { return [b, t, u, c]; }\nexport function stays(x: A, c: Config) { return [x, a, c]; }\n';
	const result = text(split('src/t.ts', src, [{ file: 'moved.ts', declarations: [0] }]));
	assert.match(result, /^import type \{ A \} from '\.\/t\.js';\nimport \{ a \} from '\.\/m\.js';\nimport \{ type U \} from '\.\/u\.js';\nimport \{ Config \} from '\.\/c\.js';\n/);
	const rejected = "import { a, b } from './m.js';\n\nexport function moved() { return a(); }\nexport function stays(x: typeof b) { return x; }\n";
	assert.match(String(split('src/t.ts', rejected, [{ file: 'moved.ts', declarations: [0] }])), /might no longer load it/);
	const still = "import { a } from './m.js';\n\nexport function moved() { return a(); }\nexport function stays(x: typeof a) { return x; }\n";
	assert.match(String(split('src/t.ts', still, [{ file: 'moved.ts', declarations: [0] }])), /still uses it as a type/);
});

test('probe p5: an import used only as a type stays in place, so modules still load in the same order', () => {
	const files = { 'package.json': '{"type":"module"}', 'config.ts': 'console.log("config loaded");\nexport class Config { x = 1 }\n', 'other.ts': 'console.log("other loaded");\n' };
	const orig = "import { Config } from './config.ts';\nimport './other.ts';\nexport function use(c: Config) { return c.x; }\n";
	const result = split('orig.ts', orig, [{ file: 'n.ts', declarations: [0] }]);
	assert.equal(text(result), "import { Config } from './config.ts';\nimport './other.ts';\nexport { use } from './n.ts';\n");
	if (process.features.typescript) {
		const main = "import { use } from './orig.ts';\nconsole.log(typeof use);\n";
		assert.equal(run({ ...files, 'orig.ts': text(result), 'n.ts': text(result, 0), 'main.ts': main }, 'main.ts'), 'config loaded\nother loaded\nfunction\n');
		assert.equal(run({ ...files, 'orig.ts': orig, 'main.ts': main }, 'main.ts'), 'config loaded\nother loaded\nfunction\n');
	}
});

test('a types-only move leaves the original\'s emitted JavaScript identical under both verbatimModuleSyntax and import elision', () => {
	const src = "import { type Shape, area } from './geo.js';\nimport type { Unit } from './units.js';\n\nexport interface Box { shape: Shape; unit: Unit }\nexport type Boxes = Box[];\n\n"
		+ 'export function total(boxes: Boxes): number { return boxes.reduce((n, b) => n + area(b.shape), 0); }\n';
	const result = split('src/box.ts', src, [{ file: 'boxes.ts', declarations: [0, 1] }], { scope: 'types' });
	assert.match(text(result), /^import \{ area \} from '\.\/geo\.js';\nimport type \{ Boxes \} from '\.\/boxes\.js';\nexport type \{ Box, Boxes \} from '\.\/boxes\.js';\n/);
	for (const verbatimModuleSyntax of [true, false]) {
		const emit = (code: string) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax } }).outputText;
		assert.equal(emit(text(result)), emit(src), `verbatimModuleSyntax: ${verbatimModuleSyntax}`);
	}
});

test('the facade: export default function re-exports as default and is imported by name; a file without imports gets it after use strict', () => {
	const src = "'use strict';\n\n/** Main. */\nexport default function main() { return 1; }\n\nexport const run = () => main();\n";
	const result = split('src/m.ts', src, [{ file: 'main-impl.ts', declarations: [0] }]);
	assert.equal(text(result), "'use strict';\n\nimport main from './main-impl.js';\nexport { default } from './main-impl.js';\n\nexport const run = () => main();\n");
});

test('specifiers copy the original\'s style: .js, .ts or none; .mts maps to .mjs and .cts to .cjs; no style or no resolution is refused', () => {
	const src = 'export function a() {}\nexport function b() { return a(); }\n';
	const plan = (file: string) => [{ file, declarations: [0] }];
	assert.match(text(split('src/x.ts', src, plan('a1.ts'), {}, 'ts')), /from '\.\/a1\.ts';/);
	assert.match(text(split('src/x.ts', src, plan('a1.ts'), {}, 'none')), /from '\.\/a1';/);
	assert.match(text(split('src/x.mts', src, plan('a1.mts'))), /from '\.\/a1\.mjs';/);
	assert.match(text(split('src/x.cts', 'export interface A {}\nexport type B = A;\n', plan('a1.cts'), { scope: 'types' })), /from '\.\/a1\.cjs';/);
	const info = tsInfo('src/x.ts', src);
	assert.throws(() => buildTsSplit(Buffer.from(src), { ...info, style: undefined }, plan('a1.ts'), { resolves: () => true }), /no relative import in the file or its folder/);
	assert.throws(() => buildTsSplit(Buffer.from(src), info, plan('a1.ts'), { resolves: () => false }), /'\.\/a1\.js' would not resolve to a1\.ts/);
});

test('staying code that reads a moved name when it is defined, before that name, is refused (a var would be read early)', () => {
	const src = 'export class S { static s = y; }\nexport var y = 1;\n';
	assert.equal(run({ 'orig.mjs': 'export class S { static s = y; }\nexport var y = 1;\nconsole.log(S.s);\n' }, 'orig.mjs'), 'undefined\n');
	assert.match(String(split('src/orig.ts', src, [{ file: 'n.ts', declarations: [1] }])), /stays and reads y \(1\) when it is defined, before y is defined now/);
	assert.equal(typeof split('src/orig.ts', 'export var y = 1;\nexport class S { static s = y; }\n', [{ file: 'n.ts', declarations: [0] }]), 'object');
});

test('a default-exported type is imported on its own type line', () => {
	const src = 'export default interface Row { a: string }\nexport interface Col { b: string }\nexport function f(r: Row, c: Col) { return [r, c]; }\n';
	assert.match(text(split('src/t.ts', src, [{ file: 'rows.ts', declarations: [0, 1] }])), /^import type Row from '\.\/rows\.js';\nimport type \{ Col \} from '\.\/rows\.js';\nexport type \{ default, Col \} from '\.\/rows\.js';\n/);
});

test('a type specifier that was already unused before the split stays; only one whose last use moved is dropped', () => {
	const src = "import type { A, Unused } from './t.js';\nimport type { Other } from './o.js';\nimport { type T, v } from './v.js';\n\n"
		+ 'export function moved(a: A, t: T) { return [a, t]; }\nexport function stays() { return v; }\n';
	const result = text(split('src/t.ts', src, [{ file: 'moved.ts', declarations: [0] }]));
	assert.match(result, /^import type \{ Unused \} from '\.\/t\.js';\nimport type \{ Other \} from '\.\/o\.js';\nimport \{ v \} from '\.\/v\.js';\n/);
});
