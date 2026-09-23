import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { extractFacts, resolveImport } from '../src/brain/facts';

const CART = `import { Product } from './product';
import type { Money } from "../money";

/** A shopping cart that keeps line items and computes totals. More detail here. */
export class Cart {}
export function total(): number { return 0; }
export const TAX = 0.2;
export interface Line { id: string }
export { helper as publicHelper, other };
export * from './reexported';
`;

test('extractFacts reads TypeScript imports, exports and role', () => {
	const facts = extractFacts('src/cart.ts', CART);
	assert.deepEqual(facts.imports, ['./product', '../money', './reexported']);
	assert.deepEqual(facts.exports, ['Cart', 'total', 'TAX', 'Line', 'publicHelper', 'other']);
	assert.equal(facts.role, 'A shopping cart that keeps line items and computes totals.');
	assert.equal(facts.language, 'ts');
});

test('extractFacts skips a license header when picking the role', () => {
	const text = '/*---\n * Copyright (c) Example. All rights reserved.\n *--*/\n/** Parses things. */\nexport function parse() {}\n';
	assert.equal(extractFacts('a.ts', text).role, 'Parses things.');
});

test('extractFacts reads Python imports, top-level defs and the module docstring', () => {
	const py = '"""Brain freshness checks for Studio builds.\n\nLonger text."""\nimport os, sys\nfrom pathlib import Path\n\nclass Brain:\n    def inner(self): ...\n\ndef state(path):\n    return path\n';
	const facts = extractFacts('brain.py', py);
	assert.deepEqual(facts.imports, ['pathlib', 'os', 'sys']);
	assert.deepEqual(facts.exports, ['Brain', 'state']);
	assert.equal(facts.role, 'Brain freshness checks for Studio builds.');
});

test('resolveImport maps relative specifiers to known files', () => {
	const known = new Set(['src/product.ts', 'src/util/index.ts', 'money.ts']);
	assert.equal(resolveImport('src/cart.ts', './product', known), 'src/product.ts');
	assert.equal(resolveImport('src/cart.ts', './util', known), 'src/util/index.ts');
	assert.equal(resolveImport('src/cart.ts', '../money.js', known), 'money.ts');
	assert.equal(resolveImport('src/cart.ts', 'react', known), undefined);
});

test('extractFacts prefers the doc of the export named like the file', () => {
	const text = "import x from './x';\n\n/** Where the caret is. */\nexport interface CursorContext {}\n\n/** The lyric editor with meter rails. */\nexport function LyricsEditor() {}\n";
	assert.equal(extractFacts('src/editor/LyricsEditor.tsx', text).role, 'The lyric editor with meter rails.');
});

test('extractFacts takes a header doc comment before the imports', () => {
	const text = "/** Talks to the native side. */\nimport x from './x';\n\n/** Other. */\nexport const a = 1;\n";
	assert.equal(extractFacts('src/api.ts', text).role, 'Talks to the native side.');
});

test('extractFacts falls back to the first documented export', () => {
	const text = "import x from './x';\n\n/** Formats money. */\nexport function format() {}\n";
	assert.equal(extractFacts('src/money-utils.ts', text).role, 'Formats money.');
});

test('extractFacts reads several statements on one line (minified or compact code)', () => {
	const text = 'import type { Node } from "prosemirror-model"; import { lyricsSchema } from "./schema"; export function a() {} export const b = 1;';
	const facts = extractFacts('src/editor/serialize.ts', text);
	assert.deepEqual(facts.imports, ['prosemirror-model', './schema']);
	assert.deepEqual(facts.exports, ['a', 'b']);
});

test('extractFacts does not count re-exports as local exports', () => {
	assert.deepEqual(extractFacts('i.ts', "export { a } from './a';\n").exports, []);
});
