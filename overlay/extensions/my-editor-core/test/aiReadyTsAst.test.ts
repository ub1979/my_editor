import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { keepBindings, tsFileFacts, utf8Table } from '../src/aiready/tsAst';
import { analysisOptions } from '../src/aiready/tsConfig';
import { ts } from './tsFixture';

const OPTIONS = analysisOptions(ts, { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
const facts = (text: string, file = 'src/a.ts') => tsFileFacts(ts, file, text, OPTIONS);

test('facts: statements with attached comments to the end of their line, overloads grouped, imports apart', () => {
	const text = "import { x } from './x.js';\n\n// detached\n\n/** Doc. */\nexport function a(): number { return x; } // why\n"
		+ 'export function f(a: string): void;\nexport function f(a: unknown) {}\nconst k = 1; const m = 2;\n';
	const f = facts(text);
	assert.deepEqual(f.decls.map(d => [d.kind, d.names, text.slice(d.start, d.end), d.own]), [
		['function', ['a'], '/** Doc. */\nexport function a(): number { return x; } // why', true],
		['function', ['f'], 'export function f(a: string): void;\nexport function f(a: unknown) {}', true],
		['const', ['k'], 'const k = 1; const m = 2;', false],
		['const', ['m'], 'const k = 1; const m = 2;', false],
	]);
	assert.deepEqual(f.imports.map(i => [i.kind, i.specifier, i.bindings.map(b => b.local)]), [['import', "'./x.js'", ['x']]]);
	assert.equal(f.decls[0].docText, '/** Doc. */');
	assert.deepEqual([f.importsAtTop, f.module, f.parseErrors], [true, true, 0]);
});

test('UTF-16 offsets map to UTF-8 bytes through one table', () => {
	const text = "const s = 'é😀';\nx";
	const bytes = utf8Table(text);
	assert.equal(bytes(text.indexOf('x')), Buffer.byteLength(text.slice(0, text.indexOf('x'))));
	assert.equal(bytes(text.length), Buffer.byteLength(text));
});

test('an import is rebuilt from its own pieces, keeping as, type, default, quotes, layout and semicolons', () => {
	const f = facts('import D, { a as b, type T, c } from "./m.js"\nimport {\n\tp,\n\tq,\n\tr,\n} from \'./n.js\';\n'
		+ 'export const z = [D, b, c, p, q, r] as T[];\n');
	const [m, n] = f.imports;
	assert.equal(keepBindings(m, new Set(['b', 'T'])), 'import { a as b, type T } from "./m.js"');
	assert.equal(keepBindings(m, new Set(['D'])), 'import D from "./m.js"');
	assert.equal(keepBindings(m, new Set(['D', 'c'])), 'import D, { c } from "./m.js"');
	assert.equal(keepBindings(n, new Set(['p', 'r'])), "import {\n\tp,\n\tr,\n} from './n.js';");
	assert.equal(keepBindings(n, new Set()), undefined);
	assert.deepEqual(m.bindings.map(b => [b.local, b.imported, b.typeOnly]), [['D', 'default', false], ['b', 'a', false], ['T', 'T', true], ['c', 'c', false]]);
});

test('uses are split into values and types; definition-time reads, purity and quietness come from the binder', () => {
	const f = facts("import { Base, make } from './b.js';\nimport type { Opt } from './o.js';\n\nexport class K extends Base { m(o: Opt) { return make(o); } }\n"
		+ 'export const w = window;\nexport let n = 0;\nexport function bump() { n++; return this; }\nexport const t = () => this;\n');
	const [k, w, n, bump, t] = f.decls;
	assert.deepEqual([k.valueUses.sort(), k.typeUses, k.defReads, k.pure, k.quiet], [['Base', 'make'], ['Opt'], ['Base'], true, true]);
	assert.deepEqual([w.pure, w.quiet], [false, false]);
	assert.deepEqual([n.assigned, bump.problems, t.problems], [['n'], [], ['it uses `this` at module level, which differs per module']]);
});

test('a shorthand { __filename } names the module, and a for-of destructuring target is a write', () => {
	const f = facts('export function where() { return { __filename }; }\nexport let x = 1;\nexport function loop() { for ([x] of [[2]]) { void 0; } }\n');
	assert.deepEqual(f.decls[0].problems, ['it uses `__filename`, which names its module or file']);
	assert.deepEqual(f.decls[1].assigned, ['x']);
});
