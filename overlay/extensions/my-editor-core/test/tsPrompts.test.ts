import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { tsSplitPrompt, tsTestPrompt } from '../src/aiready/tsPrompts';
import type { TsFileContext } from '../src/aiready/tsRules';
import { tsInfo } from './tsFixture';

/** The declarations listed in a split prompt, parsed back from their JSON lines. */
function declarations(text: string): Record<string, unknown>[] {
	const body = text.split('Declarations:\n')[1].split('\n\n')[0];
	return body.split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
}

function prompt(src: string, context: Partial<TsFileContext> = {}) {
	return tsSplitPrompt(tsInfo('src/shop/cart.ts', src, context), 812, ['cart.ts', 'rows.ts']);
}

test('the split prompt names the file, its size, its folder and the 400-line goal', () => {
	const { system, text } = prompt('export function a() { return 1; }\n');
	assert.match(text, /^File: src\/shop\/cart\.ts \(812 lines\)\nFiles already in its folder: cart\.ts, rows\.ts\nDeclarations:\n/);
	assert.match(text, /Plan new files so cart\.ts and every new file are at most 400 lines\.$/);
	assert.match(system, /Refer to declarations only by their numeric "id"/);
	assert.match(system, /Reply with only a JSON array/);
});

test('needs are value uses by id; typeNeeds are only-type uses not already needed; a declaration never needs itself', () => {
	const src = 'export interface Row { n: number }\n\nexport const base = 1;\n\n'
		+ 'export function total(rows: Row[]): number { return rows.length + base + total.length; }\n\n'
		+ 'export function both(r: Row): Row { return { n: base }; }\n';
	const [row, base, total, both] = declarations(prompt(src).text);
	assert.deepEqual([row.id, row.names, row.kind], [0, ['Row'], 'export interface']);
	assert.equal(base.needs, undefined);
	assert.deepEqual([total.needs, total.typeNeeds], [[1], [0]]);
	assert.deepEqual([both.needs, both.typeNeeds], [[1], [0]]);
});

test('definition-time reads are listed as readsWhenDefined', () => {
	const src = 'const SIZE = 4;\n\nexport const grid = new Array(SIZE);\n';
	const [, grid] = declarations(prompt(src).text);
	assert.deepEqual(grid.readsWhenDefined, [0]);
});

test('an unmovable declaration carries movable: false with its reason; movable ones omit both', () => {
	const src = 'export function a() { return 1; }\n\nexport function b() { return import.meta.url; }\n';
	const [a, b] = declarations(prompt(src).text);
	assert.equal('movable' in a, false);
	assert.equal(b.movable, false);
	assert.match(String(b.reason), /import\.meta/);
});

test('the first doc line is passed as firstDocLine only when there is one', () => {
	const src = '/** Adds the rows up.\n * Second line. */\nexport function sum() { return 0; }\n\nexport function plain() { return 1; }\n';
	const [sum, plain] = declarations(prompt(src).text);
	assert.equal(sum.firstDocLine, 'Adds the rows up.');
	assert.equal('firstDocLine' in plain, false);
});

test('names declared by an export list are not owners, so nothing needs the list', () => {
	const src = 'function hidden() { return 1; }\n\nexport function user() { return hidden(); }\n\nexport { hidden };\n';
	const decls = declarations(prompt(src).text);
	assert.deepEqual(decls[1].needs, [0]);
	assert.equal(decls[2].kind, 'export list');
});

test('the test prompt is a placeholder that says tests are not available yet', () => {
	assert.deepEqual(tsTestPrompt('src/a.ts'), { system: 'Adding TypeScript and JavaScript tests is not available yet.', text: 'src/a.ts' });
});
