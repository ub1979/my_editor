import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { TsImport } from '../src/aiready/tsImports';
import { originalImports, rebuildOriginal } from '../src/aiready/tsOriginal';
import type { TsFileContext } from '../src/aiready/tsRules';
import { tsInfo } from './tsFixture';

/** The original's import rewrites when the given declarations move, by import text, with the problems found. */
function rewrites(text: string, moved: number[], context: Partial<TsFileContext> = {}): { out: Map<string, string | null>; problems: string[] } {
	const info = tsInfo('src/a.ts', text, context);
	const problems: string[] = [];
	const result = originalImports(info, info.declarations, new Map(moved.map(id => [id, 0])), problems);
	return { out: new Map([...result].map(([imp, rewritten]) => [imp.text, rewritten])), problems };
}

/** The original's text after the given declarations move, its imports rewritten, and the facade lines added. */
function rebuilt(text: string, moved: number[], facade: string[] = []): string {
	const info = tsInfo('src/a.ts', text);
	const result = originalImports(info, info.declarations, new Map(moved.map(id => [id, 0])), []);
	return rebuildOriginal(Buffer.from(text), info, new Set(moved), result as Map<TsImport, string | null>, facade).toString('utf8');
}

test('imports still used by staying code are unchanged', () => {
	const src = "import { a } from './m.js';\n\nexport function moved() { return a; }\n\nexport function stays() { return a; }\n";
	const { out, problems } = rewrites(src, [0]);
	assert.equal(out.size, 0);
	assert.deepEqual(problems, []);
});

test('an import used only by moved code becomes a side-effect import, so the module still loads in its place', () => {
	const src = "import { a } from './m.js';\n\nexport function moved() { return a; }\n\nexport function stays() { return 1; }\n";
	assert.deepEqual([...rewrites(src, [0]).out], [["import { a } from './m.js';", "import './m.js';"]]);
});

test('`import type` whose last use moved is dropped; a type specifier unused before the split stays', () => {
	const src = "import type { T } from './t.js';\nimport { type U, v } from './u.js';\n\n"
		+ 'export function moved(t: T) { return t; }\n\nexport function stays() { return v; }\n';
	const { out } = rewrites(src, [0]);
	assert.deepEqual([...out], [["import type { T } from './t.js';", null]]);
});

test('a type specifier whose last use moved is filtered out of a mixed import', () => {
	const src = "import { type T, v } from './m.js';\n\nexport function moved(t: T) { return t; }\n\nexport function stays() { return v; }\n";
	assert.deepEqual([...rewrites(src, [0]).out], [["import { type T, v } from './m.js';", "import { v } from './m.js';"]]);
});

test('refuses when a moved value use leaves a staying type use that would stop loading the module', () => {
	const src = "import { K } from './k.js';\n\nexport function moved() { return new K(); }\n\nexport function stays(k: K) { return k; }\n";
	const { out, problems } = rewrites(src, [0]);
	assert.equal(out.size, 0);
	assert.match(problems.join('\n'), /The last value use of K \(from '\.\/k\.js'\) moves, but staying code still uses it as a type/);
});

test('refuses to filter values when the names left might no longer load the module', () => {
	const src = "import { a, b } from './m.js';\n\nexport function moved() { return a; }\n\nexport function stays(x: typeof b) { return x; }\n";
	const { out, problems } = rewrites(src, [0]);
	assert.equal(out.size, 0);
	assert.match(problems.join('\n'), /The last value use of a \(from '\.\/m\.js'\) moves, and the names left in that import might no longer load it/);
});

test('a types-only move refuses to drop an import not written as a type', () => {
	const src = "import { v } from './m.js';\n\nexport function moved() { return v; }\n\nexport function stays() { return 1; }\n";
	const { out, problems } = rewrites(src, [0], { scope: 'types' });
	assert.equal(out.size, 0);
	assert.match(problems.join('\n'), /v \(from '\.\/m\.js'\) is not written as a type, and a types-only move may drop only imports written as types/);
});

test('`import x = require()` losing its last use is refused, never rewritten', () => {
	const src = "import fs = require('fs');\n\nexport function moved() { return fs; }\n\nexport function stays() { return 1; }\n";
	const { out, problems } = rewrites(src, [0]);
	assert.equal(out.size, 0);
	assert.deepEqual(problems, ["import fs = require('fs'); would lose its last use; it is never rewritten."]);
});

test('re-exports and side-effect imports are never rewritten', () => {
	const src = "import './polyfill.js';\nexport { x } from './x.js';\n\nexport function moved() { return 1; }\n";
	assert.equal(rewrites(src, [0]).out.size, 0);
});

test('rebuildOriginal removes moved spans, collapses the gap to one blank line and adds the facade after the imports', () => {
	const src = "import { a } from './m.js';\n\nexport function moved() { return a; }\n\nexport function stays() { return 1; }\n";
	assert.equal(rebuilt(src, [0], ["export { moved } from './moved.js';"]),
		"import './m.js';\nexport { moved } from './moved.js';\n\nexport function stays() { return 1; }\n");
});

test('rebuildOriginal without imports puts the facade first, then a blank line', () => {
	const src = 'export function moved() { return 1; }\n\nexport function stays() { return 2; }\n';
	assert.equal(rebuilt(src, [0], ["export { moved } from './moved.js';"]),
		"export { moved } from './moved.js';\n\nexport function stays() { return 2; }\n");
});

test('rebuildOriginal keeps a missing final newline missing, and a trailing gap leaves no blank line', () => {
	const src = 'export function stays() { return 2; }\n\nexport function moved() { return 1; }';
	assert.equal(rebuilt(src, [1]), 'export function stays() { return 2; }');
});

test('rebuildOriginal never expands `$` patterns in a rewritten import', () => {
	const src = "import { $$, $1 } from './$&.js';\n\nexport function moved() { return $1; }\n\nexport function stays() { return $$; }\n";
	assert.match(rebuilt(src, [0]), /^import \{ \$\$ \} from '\.\/\$&\.js';\n/);
});
