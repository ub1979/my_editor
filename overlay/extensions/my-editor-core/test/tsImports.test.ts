import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { importOf, keepBindings, sideEffectText, TsImport } from '../src/aiready/tsImports';
import { ts } from './tsFixture';

/** The import facts of a file's first statement, as a full `TsImport` (span and ownership are not under test). */
function first(text: string, file = 'a.ts'): TsImport | undefined {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const facts = importOf(ts, source.statements[0], source);
	return facts && { ...facts, span: { start: 0, end: text.length }, own: true };
}

function imported(text: string, file?: string): TsImport {
	const imp = first(text, file);
	assert.ok(imp, `not an import: ${text}`);
	return imp;
}

test('a statement that is not an import, require or re-export has no import facts', () => {
	assert.equal(first('export function f() {}'), undefined);
	assert.equal(first('const x = require("./a");'), undefined);
	assert.equal(first('import x = Foo.Bar;'), undefined, 'an import alias of a namespace loads no module');
	assert.equal(first('export { a };'), undefined, 'a local export list has no module specifier');
});

test('named, default and namespace bindings keep their local and imported names and their exact text', () => {
	const imp = imported("import def, { a, b as c, type T } from './m.js';");
	assert.equal(imp.kind, 'import');
	assert.equal(imp.module, './m.js');
	assert.equal(imp.specifier, "'./m.js'");
	assert.equal(imp.sideEffect, false);
	assert.deepEqual(imp.bindings.map(b => [b.local, b.imported, b.typeOnly, b.text]), [
		['def', 'default', false, 'def'], ['a', 'a', false, 'a'], ['c', 'b', false, 'b as c'], ['T', 'T', true, 'type T'],
	]);
	const ns = imported('import * as all from "./ns";');
	assert.deepEqual(ns.bindings.map(b => [b.local, b.imported, b.text]), [['all', '*', '* as all']]);
	assert.equal(ns.pieces.namespaceText, '* as all');
});

test('`import type` makes every binding type-only, the default included', () => {
	const imp = imported("import type D, { A } from './types';");
	assert.equal(imp.typeOnly, true);
	assert.ok(imp.bindings.every(b => b.typeOnly));
});

test('a bare import and an empty clause load the module for side effects; `import type {}` loads nothing', () => {
	for (const text of ["import './polyfill';", "import {} from './polyfill';"]) {
		const imp = imported(text);
		assert.equal(imp.sideEffect, true, text);
		assert.deepEqual(imp.bindings, []);
	}
	const typed = imported("import type {} from './types';");
	assert.equal(typed.sideEffect, false);
	assert.equal(typed.typeOnly, true);
});

test('`import x = require()` is one `=` binding; its whole text is the prefix', () => {
	const imp = imported("import fs = require('fs');");
	assert.equal(imp.kind, 'equals');
	assert.equal(imp.module, 'fs');
	assert.deepEqual(imp.bindings.map(b => [b.local, b.imported]), [['fs', '=']]);
	assert.equal(imp.pieces.prefix, imp.text);
	assert.equal(imported("import type T = require('./t');").typeOnly, true);
});

test('re-exports: named ones bind the exported name, `export *` is a star with no bindings', () => {
	const named = imported("export { a as b, type C } from './m';");
	assert.equal(named.kind, 'export');
	assert.deepEqual(named.bindings.map(b => [b.local, b.imported, b.typeOnly]), [['b', 'a', false], ['C', 'C', true]]);
	const star = imported("export * from './m';");
	assert.equal(star.star, true);
	assert.deepEqual(star.bindings, []);
	assert.equal(imported("export * as ns from './m';").star, false, 'a namespace re-export has a clause');
});

test('keepBindings returns the text unchanged when every binding stays', () => {
	const imp = imported("import a, { b, c } from './m';");
	assert.equal(keepBindings(imp, new Set(['a', 'b', 'c', 'extra'])), imp.text);
});

test('keepBindings drops named bindings with their own separators and keeps the formatting', () => {
	const imp = imported("import {\n\ta,\n\tb as bee,\n\tc,\n} from './m';");
	assert.equal(keepBindings(imp, new Set(['a', 'c'])), "import {\n\ta,\n\tc,\n} from './m';");
	assert.equal(keepBindings(imp, new Set(['bee'])), "import {\n\tb as bee,\n} from './m';");
});

test('keepBindings handles default plus named and default plus namespace', () => {
	const named = imported("import d, { x, y } from './m';");
	assert.equal(keepBindings(named, new Set(['d'])), "import d from './m';");
	assert.equal(keepBindings(named, new Set(['y'])), "import { y } from './m';");
	assert.equal(keepBindings(named, new Set(['d', 'x'])), "import d, { x } from './m';");
	const ns = imported("import d, * as all from './m';");
	assert.equal(keepBindings(ns, new Set(['all'])), "import * as all from './m';");
	assert.equal(keepBindings(ns, new Set(['d'])), "import d from './m';");
});

test('keepBindings keeps import attributes and the semicolon after the specifier', () => {
	const imp = imported("import { a, b } from './data.json' with { type: 'json' };");
	assert.equal(keepBindings(imp, new Set(['b'])), "import { b } from './data.json' with { type: 'json' };");
});

test('keepBindings refuses to rebuild: nothing kept, a re-export or `import =`', () => {
	assert.equal(keepBindings(imported("import { a } from './m';"), new Set()), undefined);
	assert.equal(keepBindings(imported("export { a, b } from './m';"), new Set(['a'])), undefined);
	assert.equal(keepBindings(imported("import fs = require('fs');"), new Set()), undefined);
});

test('sideEffectText keeps the specifier and its attributes, never the clause', () => {
	assert.equal(sideEffectText(imported("import { a, b } from './m.js';")), "import './m.js';");
	assert.equal(sideEffectText(imported("import d from\t\"./m\" with { type: 'json' };")), "import \"./m\" with { type: 'json' };");
});
