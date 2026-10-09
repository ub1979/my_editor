import { strict as assert } from 'node:assert';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import type { SplitPlan } from '../src/aiready/language';
import { checkMove } from '../src/aiready/moveCheck';
import { createTsAdapter } from '../src/aiready/tsAdapter';
import type { TsFileInfo } from '../src/aiready/tsRules';
import { tsProject, workspaceLinkProblem } from '../src/aiready/tsProject';
import { parseTsTests } from '../src/aiready/tsTests';
import { ESM, project, ts } from './tsFixture';

const REPORT = `import { helper } from './util.js';

/** A row. */
export interface Row { name: string; size: number }

/** Parses one row. */
export function parseRow(line: string): Row {
	const [name, size] = line.split(',');
	return { name, size: Number(size) };
}

export function formatRow(row: Row): string {
	return \`\${row.name}: \${row.size}\`;
}

export class Store { rows: Row[] = []; }

export function report(lines: string[]): string {
	return lines.map(parseRow).map(formatRow).join(helper());
}
`;
const UTIL = "export function helper(): string { return '\\n'; }\n";

/** Splits a file of a temp project with the adapter, writes the result, and runs move rules 1–6 on what is on disk. */
async function splitIn(files: Record<string, string>, file: string, plan: SplitPlan) {
	const { root, tracked } = project(files);
	const adapter = createTsAdapter(root, ts, tracked);
	const info = await adapter.parse(file);
	const source = readFileSync(path.join(root, file));
	const unitBefore = await Promise.all((await adapter.unitFiles(file)).map(f => adapter.parse(f)));
	const result = adapter.buildSplit(source, info, plan);
	const names = result.files.map(f => `${path.posix.dirname(file)}/${f.name}`);
	const check = async (edit: { original?: (t: string) => string; first?: (t: string) => string } = {}) => {
		writeFileSync(path.join(root, file), edit.original ? edit.original(result.original.toString()) : result.original);
		result.files.forEach((f, i) => writeFileSync(path.join(root, names[i]), i === 0 && edit.first ? edit.first(f.text.toString()) : f.text));
		const read = async (name: string) => ({ text: readFileSync(path.join(root, name)), info: await adapter.parse(name) });
		const after = await read(file);
		const news = await Promise.all(names.map(read));
		const unitAfter = await Promise.all((await adapter.unitFiles(file)).map(f => adapter.parse(f)));
		return [...checkMove({ before: { text: source, info }, after, files: news, plan, header: adapter.splitHeader(file), importProblems: adapter.importProblems }),
			...adapter.sameDeclarations(unitBefore, unitAfter)];
	};
	return { check, result, adapter, info: info as TsFileInfo, root };
}

const FILES = { ...ESM, 'src/report.ts': REPORT, 'src/util.ts': UTIL };
const PLAN: SplitPlan = [{ file: 'rows.ts', declarations: [0, 1, 2] }];

test('the adapter parses with the project: unit, export surface, bindings, checks and the prompt', async () => {
	const { adapter, info } = await splitIn(FILES, 'src/report.ts', PLAN);
	assert.equal(info.skip, undefined);
	assert.deepEqual(await adapter.unitFiles('src/report.ts'), ['src/report.ts', 'src/util.ts']);
	assert.ok(info.surface?.some(entry => entry.startsWith('Store|vt|at:')));
	assert.ok(info.bindings?.length);
	assert.deepEqual(adapter.checks('src/report.ts').map(c => c.command), ['npx --no -- tsc --noEmit -p tsconfig.json --pretty false', 'npm test']);
	assert.deepEqual(adapter.setup?.().map(c => c.command), ['npm ci']);
	assert.deepEqual(adapter.fixes, ['split']);
	const prompt = adapter.splitPrompt(info, 22).text;
	assert.match(prompt, /"id":1,"kind":"export function","names":\["parseRow"\],"lines":5,"firstDocLine":"Parses one row\.","typeNeeds":\[0\]/);
	assert.match(prompt, /"id":4,"kind":"export function","names":\["report"\],"lines":3,"needs":\[1,2\]/);
	assert.match(prompt, /Files already in its folder: .*util\.ts/);
	assert.deepEqual(adapter.fileNameProblems('Util.ts', 'src/report.ts'),
		['util.ts already uses the name Util, so an import of ./Util could resolve differently']);
});

test('the move check passes a clean split: byte-identical spans, the facade, the same exports and the same bindings', async () => {
	const { check } = await splitIn(FILES, 'src/report.ts', PLAN);
	assert.deepEqual(await check(), []);
});

test('the move check fails on an edited body, an added side-effect import, a foreign import or an added export in a new file', async () => {
	const { check } = await splitIn(FILES, 'src/report.ts', PLAN);
	assert.match((await check({ first: t => t.replace('Number(size)', 'Number(size) + 0') })).join(' '), /Rule 1/);
	const added = (line: string) => (t: string) => t.replace('by my_editor.\n\n', `by my_editor.\n\n${line}\n`);
	assert.match((await check({ first: added("import './polyfill.js';") })).join(' '), /Rule 3: src\/rows\.ts has the side-effect import/);
	assert.match((await check({ first: added("import { x } from 'other';") })).join(' '), /not a filtered copy of an import of the original/);
	assert.match((await check({ first: t => `${t}\nexport { formatRow as fmt };\n` })).join(' '), /Rule [13]/);
});

test('the move check fails on a facade naming another file, a dropped export, a changed export meaning and a rebinding import (rule 6)', async () => {
	const { check } = await splitIn(FILES, 'src/report.ts', [{ file: 'rows.ts', declarations: [0, 1, 2, 3] }]);
	assert.deepEqual(await check(), []);
	const edited = async (from: string, to: string) => (await check({ original: t => t.replace(from, to) })).join(' ');
	const rowType = "export type { Row } from './rows.js';";
	assert.match(await edited(rowType, `${rowType}\nexport { helper } from './util.js';`), /gained export \{ helper \} from '\.\/util\.js';/);
	assert.match(await edited(`${rowType}\n`, ''), /Rule 4: src\/report\.ts no longer exports Row/);
	const storeAsType = "export { parseRow, formatRow } from './rows.js';\nexport type { Store } from './rows.js';";
	assert.match(await edited("export { parseRow, formatRow, Store } from './rows.js';", storeAsType),
		/Rule 4: src\/report\.ts no longer exports Store the same way/);
	assert.match(await edited("import { parseRow, formatRow } from './rows.js';", "import { formatRow as parseRow, formatRow } from './rows.js';"),
		/Rule 6: \d+ identifier bindings? differ/);
});

test('the move check fails when a tsconfig that lists the original does not list the new file', async () => {
	const compilerOptions = { module: 'nodenext', moduleResolution: 'nodenext', strict: true };
	const files = { ...FILES, 'tsconfig.json': JSON.stringify({ compilerOptions, files: ['src/report.ts', 'src/util.ts'] }) };
	const { check } = await splitIn(files, 'src/report.ts', PLAN);
	assert.match((await check()).join(' '), /Rule 4: tsconfig\.json does not include src\/rows\.ts/);
});

test('test output: Jest and Vitest JSON, Mocha JSON and node --test TAP give per-test results keyed by file and path', () => {
	const roots = ['/w'];
	const jest = '> shop@1.0.0 test\n> jest --json\n\n{"numTotalTests":2,"testResults":[{"name":"/w/src/a.test.ts","status":"failed","assertionResults":['
		+ '{"ancestorTitles":["rows"],"title":"parses","status":"passed"},{"ancestorTitles":["rows"],"title":"fails","status":"failed"},'
		+ '{"ancestorTitles":[],"title":"later","status":"todo"}]}]}\n';
	assert.deepEqual(parseTsTests(jest, roots), {
		tests: { 'src/a.test.ts rows › parses': 'pass', 'src/a.test.ts rows › fails': 'fail', 'src/a.test.ts later': 'skip' },
		packages: { 'src/a.test.ts': 'fail' },
	});
	const mocha = '{"stats":{},"tests":[{"title":"a","fullTitle":"g a","file":"/w/test/a.js"},{"title":"b","fullTitle":"g b","file":"/w/test/a.js"}],'
		+ '"passes":[{"title":"a","fullTitle":"g a","file":"/w/test/a.js"}],"failures":[{"title":"b","fullTitle":"g b","file":"/w/test/a.js"}],"pending":[]}';
	assert.deepEqual(parseTsTests(mocha, roots), { tests: { 'test/a.js g a': 'pass', 'test/a.js g b': 'fail' }, packages: { 'test/a.js': 'fail' } });
	const tap = 'TAP version 13\n# Subtest: top passes\nok 1 - top passes\n  ---\n  ...\n# Subtest: group\n'
		+ '    # Subtest: inner fails\n    not ok 1 - inner fails\n'
		+ '    # Subtest: inner ok\n    ok 2 - inner ok\n    1..2\nnot ok 2 - group\n# Subtest: skipped one\nok 3 - skipped one # SKIP\n';
	assert.deepEqual(parseTsTests(tap, roots), {
		tests: {
			'node:test top passes': 'pass', 'node:test group › inner fails': 'fail', 'node:test group › inner ok': 'pass', 'node:test group': 'fail',
			'node:test skipped one': 'skip',
		},
		packages: { 'node:test': 'fail' },
	});
	assert.equal(parseTsTests('> build && jest\nPASS src/a.test.ts\n', roots), undefined);
});

test('Prettier is asked only when it is installed and configured, and only about the given files', async () => {
	const { root, tracked } = project({ ...FILES, '.prettierrc': '{}' });
	const adapter = createTsAdapter(root, ts, tracked);
	assert.deepEqual(await adapter.unformatted(['src/report.ts']), []);
	mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
	const bin = path.join(root, 'node_modules', '.bin', 'prettier');
	const warn = "for (const f of process.argv.slice(3)) { if (f.includes('report')) { console.log('[warn] ' + f); } }";
	writeFileSync(bin, `#!${process.execPath}\nconsole.log('Checking formatting...');\n${warn}\n`);
	chmodSync(bin, 0o755);
	assert.deepEqual(await adapter.unformatted(['src/report.ts', 'src/util.ts']), ['src/report.ts']);
	assert.deepEqual(await createTsAdapter(root, ts, tracked.filter(f => f !== '.prettierrc')).unformatted(['src/report.ts']), []);
});

test('after install, a workspace package linked from outside the working copy stops the run', () => {
	const { root, tracked } = project({ ...ESM, 'package.json': '{"name":"shop","workspaces":["packages/*"]}', 'packages/b/package.json': '{"name":"@shop/b"}' });
	mkdirSync(path.join(root, 'node_modules', '@shop'), { recursive: true });
	symlinkSync(path.join(root, 'packages', 'b'), path.join(root, 'node_modules', '@shop', 'b'));
	assert.equal(workspaceLinkProblem(tsProject(ts, root, tracked)), undefined);
	const outside = mkdtempSync(path.join(os.tmpdir(), 'my-editor-outside-'));
	const other = project({ ...ESM, 'package.json': '{"name":"shop","workspaces":["packages/*"]}', 'packages/b/package.json': '{"name":"@shop/b"}' });
	mkdirSync(path.join(other.root, 'node_modules', '@shop'), { recursive: true });
	symlinkSync(outside, path.join(other.root, 'node_modules', '@shop', 'b'));
	assert.match(workspaceLinkProblem(tsProject(ts, other.root, other.tracked)) ?? '', /@shop\/b resolves to .*outside the working copy/);
});

test('plain JS run as native ES modules (no tsconfig) moves function declarations only, checked by its tests', async () => {
	const { root, tracked } = project({ 'package.json': '{"type":"module","scripts":{"test":"node --test"}}', 'package-lock.json': '{}',
		'lib/a.js': "import { b } from './b.js';\n\nexport const c = 1;\nexport function f() { return b; }\n", 'lib/b.js': 'export const b = 2;\n' });
	const adapter = createTsAdapter(root, ts, tracked);
	const info = await adapter.parse('lib/a.js');
	assert.deepEqual(info.declarations.map(d => d.reason), ['only function declarations may move in plain JavaScript', undefined]);
	assert.deepEqual(adapter.checks('lib/a.js'), [{ label: 'test', command: 'npm test', verifies: true }]);
});

test('a namespace import of a module in the same folder binds to that module, and the split passes', async () => {
	const report = "import * as util from './util.js';\n\nexport function a() { return util.helper(); }\n\nexport function b() { return a(); }\n";
	const files = { ...ESM, 'src/report.ts': report, 'src/util.ts': UTIL };
	const { check, info } = await splitIn(files, 'src/report.ts', [{ file: 'part.ts', declarations: [0] }]);
	assert.ok(info.bindings?.some(entry => entry.endsWith('|module:src/util.ts')));
	assert.deepEqual(await check(), []);
});
