import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { split, text, tsInfo } from './tsFixture';

/** `name: movable` or `name: reason` for each declaration. */
function verdicts(src: string): string[] {
	return tsInfo('src/a.ts', src).declarations.map(d => `${d.names.join(',')}: ${d.movable ? 'movable' : d.reason}`);
}

const THIS = 'it uses `this` at module level, which differs per module';

test('this in a computed member name or a decorator runs in the scope around the member, so in a top-level arrow it is module this', () => {
	const src = "import { k } from './k.js';\n"
		+ 'export const f3 = () => class { [this.k]() { return 1; } };\n'
		+ 'export const f4 = () => class { [this.k] = 1; };\n'
		+ 'export function f5() { return () => class { m(a = this) { return a; } }; }\n'
		+ 'export const f6 = () => ({ [this.k]: 1 });\n'
		+ 'export const f7 = () => class { static [this.k] = 1 };\n'
		+ 'export const f8 = () => class X { static { this; } };\n'
		+ 'export function f9() { return () => this; }\n'
		+ 'export const f10 = () => class { accessor [this.k] = 1 };\n'
		+ 'export const f11 = () => { class C { @(this as any).dec m() {} } return C; };\n'
		+ 'export const f12 = () => function (this: any) { return this; };\n'
		+ 'export const f13 = () => class { m(@((this as any).p) a: number) { return a; } };\n'
		+ 'export const f14 = () => class { m() { return { [this.k]: k }; } };\n';
	assert.deepEqual(verdicts(src), [
		`f3: ${THIS}`, `f4: ${THIS}`, 'f5: movable', `f6: ${THIS}`, `f7: ${THIS}`, 'f8: movable', 'f9: movable', `f10: ${THIS}`, `f11: ${THIS}`,
		'f12: movable', `f13: ${THIS}`, 'f14: movable',
	]);
});

test('a computed class or object key is pure only when it is a literal: reading a name there converts it to a key, which runs code', () => {
	const RUNS = 'its definition runs code (a call, a property read, an operator or a global read)';
	const read = "import { cfg, key } from './r.js';\n"
		+ 'export const m = class { static [cfg] = 1; };\n'
		+ 'export class K { [key]() { return 1; } }\n'
		+ 'export const o = { [cfg]: 1 };\n';
	assert.deepEqual(verdicts(read), [`m: ${RUNS}`, `K: ${RUNS}`, `o: ${RUNS}`]);
	const literal = "import { cfg } from './r.js';\n"
		+ "export class L { ['a']() { return 1; } static [2] = 3; [`b`] = 4; }\n"
		+ "export const p = { ['a']: 1, [2]() { return cfg; } };\n";
	assert.deepEqual(verdicts(literal), ['L: movable', 'p: movable']);
});

test('using and await using are never quiet: they dispose their value when the module body ends', () => {
	const EARLY = 'code runs before it in the file, so it would be defined earlier than now';
	assert.deepEqual(verdicts("import { res } from './r.js';\nusing h = res;\nexport const after = 1;\n").slice(1), [`after: ${EARLY}`]);
	const awaited = "import { res } from './r.js';\nawait using h = res;\nexport class After {}\n";
	assert.deepEqual(tsInfo('src/a.ts', awaited).declarations.map(d => [d.kind, d.ts.quiet]), [['using', false], ['export class', true]]);
	assert.deepEqual(verdicts(awaited).slice(1), [`After: ${EARLY}`]);
});

test('{@link name} and @see in a doc comment are not uses, so a doc link to a staying helper does not hold a move back', () => {
	const src = "import { q } from './q.js';\n\n/**\n * Like {@link helper} and {@linkcode helper}.\n * @see helper\n */\n"
		+ 'export function f() { return 1; }\n\nfunction helper() { return q; }\nexport function g() { return helper(); }\n';
	assert.deepEqual(tsInfo('src/a.ts', src).declarations[0].ts.valueUses, []);
	assert.match(text(split('src/a.ts', src, [{ file: 'b.ts', declarations: [0] }]), 0), /Like \{@link helper\}/);
});
