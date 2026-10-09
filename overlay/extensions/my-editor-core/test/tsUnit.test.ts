import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { unitFacts, unitOf } from '../src/aiready/tsUnit';
import { ESM, OPTIONS, project, ts } from './tsFixture';

/** `unitOf` and `unitFacts` read and resolve files on disk, so each case writes a temp NodeNext project. */
function unit(files: Record<string, string>, file = 'src/a.ts'): string[] {
	const { root } = project({ ...ESM, ...files });
	return unitOf(ts, root, file, OPTIONS);
}

function facts(files: Record<string, string>, file = 'src/a.ts') {
	const { root } = project({ ...ESM, ...files });
	return unitFacts(ts, root, file, unitOf(ts, root, file, OPTIONS), OPTIONS);
}

test('unitOf follows same-folder imports and re-exports transitively, the file first', () => {
	assert.deepEqual(unit({
		'src/a.ts': "import { b } from './b.js';\nexport type { T } from './t.js';\nexport const a = b;\n",
		'src/b.ts': "import c = require('./c.js');\nexport const b = c;\n",
		'src/c.ts': 'export const c = 1;\n',
		'src/t.ts': 'export interface T { n: number }\n',
	}), ['src/a.ts', 'src/b.ts', 'src/t.ts', 'src/c.ts']);
});

test('unitOf leaves out other folders, packages, declaration files and specifiers that do not resolve', () => {
	assert.deepEqual(unit({
		'src/a.ts': "import { x } from '../lib/x.js';\nimport { y } from './sub/y.js';\nimport 'node:fs';\n"
			+ "import type { D } from './d.js';\nimport { gone } from './gone.js';\nexport const a = [x, y, gone];\n",
		'lib/x.ts': 'export const x = 1;\n',
		'src/sub/y.ts': 'export const y = 1;\n',
		'src/d.d.ts': 'export interface D {}\n',
	}), ['src/a.ts']);
});

test('unitOf stops at cycles and lists each module once', () => {
	assert.deepEqual(unit({
		'src/a.ts': "import { b } from './b.js';\nexport const a = () => b;\n",
		'src/b.ts': "import { a } from './a.js';\nexport const b = () => a;\n",
	}), ['src/a.ts', 'src/b.ts']);
});

test('unitOf of a missing file is just the file', () => {
	assert.deepEqual(unit({}, 'src/missing.ts'), ['src/missing.ts']);
});

test('the surface lists each export with its meanings: value, type, namespace', () => {
	const { surface } = facts({
		'src/a.ts': 'export interface I { n: number }\nexport const v = 1;\nexport class C {}\nexport namespace N { export const x = 1; }\n'
			+ "export type { W } from './w.js';\n",
		'src/w.ts': 'export class W {}\n',
	});
	assert.deepEqual(surface.map(line => line.split('|').slice(0, 2).join('|')), ['C|vt', 'I|t', 'N|vn', 'W|t', 'v|v']);
	assert.ok(surface.every(line => /\|at:[0-9a-f]{12}:\d+$/.test(line)), surface.join('\n'));
});

test('a name moved to a new file and re-exported traces to the same declaration as before', () => {
	const before = facts({ 'src/a.ts': 'export function f() { return 1; }\n\nexport const g = () => f();\n' });
	const after = facts({
		'src/a.ts': "import { f } from './f.js';\nexport { f } from './f.js';\n\nexport const g = () => f();\n",
		'src/f.ts': 'export function f() { return 1; }\n',
	});
	assert.deepEqual(after.surface, before.surface);
	for (const binding of after.bindings) { assert.ok(before.bindings.includes(binding), binding); }
});

test('bindings name imports from outside the unit by specifier and name, and unresolved names as none', () => {
	const { bindings } = facts({ 'src/a.ts': "import { readFile as rf } from 'node:fs';\nexport const read = () => [rf, Math];\n" });
	const targets = bindings.map(line => line.split('|')[2]);
	assert.ok(targets.includes("import:'node:fs':readFile"), targets.join('\n'));
	assert.ok(targets.includes('none:Math'), targets.join('\n'));
	assert.ok(bindings.every(line => /^[0-9a-f]{12}\|\d+\|/.test(line)));
});

test('bindings skip import declarations and re-exports with a specifier', () => {
	const { bindings } = facts({
		'src/a.ts': "import { b } from './b.js';\nexport { b as c } from './b.js';\n",
		'src/b.ts': 'export const b = 1;\n',
	});
	assert.deepEqual(bindings, []);
});

test('a file outside the program has no facts', () => {
	const { root } = project({ ...ESM });
	assert.deepEqual(unitFacts(ts, root, 'src/none.ts', ['src/none.ts'], OPTIONS), { surface: [], bindings: [] });
});
