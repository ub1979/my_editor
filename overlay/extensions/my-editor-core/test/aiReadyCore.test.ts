import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CheckResult, failureLines, runSetup } from '../src/aiready/baseline';
import { detectCommands } from '../src/aiready/commandDetect';
import { approvalDetail } from '../src/aiready/fixText';
import type { Declaration, FileInfo, LanguageAdapter, ParsedFile, Span } from '../src/aiready/language';
import { checkMove } from '../src/aiready/moveCheck';
import { oversizeNotes, planProblems } from '../src/aiready/splitPlan';

const HEADER = '// Split from x.ts by my_editor.\n\n';

/** A span from the first byte of `from` to the byte before `to` (or the end), both found in `text`. */
function span(text: string, from: string, to?: string): Span {
	const start = text.indexOf(from);
	return { start, end: to === undefined ? text.length - 1 : text.indexOf(to, start) };
}

function decl(id: number, name: string, at: Span): Declaration {
	return { id, kind: 'function', names: [name], span: at, lines: 1, doc: '', docText: '', uses: [], movable: true };
}

function parsed(text: string, info: Omit<FileInfo, 'path' | 'frame' | 'imports'> & Partial<FileInfo>): ParsedFile {
	return { text: Buffer.from(text), info: { path: 'x.ts', frame: [], imports: [], ...info } };
}

test('move check: an empty import region marks where the facade goes, after a directive and with no imports', () => {
	const before = "'use strict';\n\n/** A. */\nexport function a() {}\n\nexport function b() {}\n";
	const after = "'use strict';\n\nexport { a } from './a.js';\n\nexport function b() {}\n";
	const moved = `${HEADER}/** A. */\nexport function a() {}\n`;
	const at = before.indexOf('/** A.');
	const input = {
		before: parsed(before, {
			declarations: [decl(0, 'a', span(before, '/** A.', '\n\nexport function b')), decl(1, 'b', span(before, 'export function b'))],
			importRegion: { start: at, end: at },
		}),
		after: parsed(after, { declarations: [decl(0, 'b', span(after, 'export function b'))], importRegion: span(after, 'export { a }', '\n\nexport function b') }),
		files: [parsed(moved, {
			declarations: [decl(0, 'a', span(moved, '/** A.'))], frame: [{ start: 0, end: HEADER.length }], prelude: { start: 0, end: HEADER.length },
		})],
		plan: [{ file: 'a.ts', declarations: [0] }], header: HEADER,
	};
	assert.deepEqual(checkMove(input), []);
	const extra = after.replace('\nexport function b', '\nconsole.log(1);\nexport function b');
	const changed = parsed(extra, { declarations: [], importRegion: span(extra, 'export { a }', '\n\nconsole') });
	assert.match(checkMove({ ...input, after: changed }).join(' '), /Rule 2/);
});

test('move check: blank lines right after the import region are not compared, and the adapter may check imports itself', () => {
	const before = "import { x } from 'x';\n\nexport function a() { return x; }\n\nexport const c = 1;\n";
	const after = "import { x } from 'x';\nexport { a } from './a.js';\n\nexport const c = 1;\n";
	const moved = `${HEADER}import { x } from 'x';\n\nexport function a() { return x; }\n`;
	const input = {
		before: parsed(before, { declarations: [decl(0, 'a', span(before, 'export function a', '\n\nexport const')), decl(1, 'c', span(before, 'export const'))],
			importRegion: span(before, 'import', '\n\nexport function'), imports: ['x x'] }),
		after: parsed(after, {
			declarations: [decl(0, 'c', span(after, 'export const'))], importRegion: span(after, 'import', '\n\nexport const'), imports: ['x x', 'a ./a.js'],
		}),
		files: [parsed(moved, { declarations: [decl(0, 'a', span(moved, 'export function a'))], imports: ['x x'],
			frame: [{ start: 0, end: HEADER.length }, span(moved, 'import', '\n\nexport')], prelude: { start: 0, end: HEADER.length } })],
		plan: [{ file: 'a.ts', declarations: [0] }], header: HEADER,
	};
	assert.match(checkMove(input).join(' '), /gained the import a \.\/a\.js/);
	assert.deepEqual(checkMove({ ...input, importProblems: () => [] }), []);
	assert.deepEqual(checkMove({ ...input, importProblems: () => ['Imports: the facade names b.ts.'] }), ['Imports: the facade names b.ts.']);
});

test('tsc error lines lose their path(line,col) position like Go lines lose path:line:col', () => {
	assert.deepEqual(failureLines("src/a.ts(3,14): error TS2322: Type 'string' is not assignable to type 'number'.\n./b.go:4:2: undefined: x\n"),
		["error TS2322: Type 'string' is not assignable to type 'number'.", 'undefined: x']);
	assert.deepEqual(failureLines("src/rows.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'."),
		failureLines("src/report.ts(40,2): error TS2322: Type 'string' is not assignable to type 'number'."));
});

test('the detected type check never downloads a package named tsc', () => {
	assert.deepEqual(detectCommands({ names: ['package.json', 'tsconfig.json'] }).checks, ['npx --no tsc --noEmit']);
});

test('a plan file name is checked against the original it is split from', () => {
	const seen: string[] = [];
	const adapter = { fileNameProblems: (name: string, original: string) => { seen.push(`${name} ${original}`); return ['no']; } } as unknown as LanguageAdapter;
	const info: FileInfo = { path: 'src/report.ts', declarations: [decl(0, 'a', { start: 0, end: 5 })], frame: [], imports: [] };
	assert.deepEqual(planProblems(adapter, { source: Buffer.from('a();\n'), info, existing: [] }, [{ file: 'rows.ts', declarations: [0] }]), ['"rows.ts": no']);
	assert.deepEqual(seen, ['rows.ts src/report.ts']);
});

test('setup runs once before the baseline: a failed install or a changed tracked file stops the run', async () => {
	const result = (code: number | undefined): CheckResult => ({ command: 'npm ci', code, failures: [], tail: 'npm ERR! missing lockfile', log: '' });
	const runner = (code: number | undefined) => ({ check: async () => result(code), cancelled: () => false, progress: () => undefined });
	const install = [{ label: 'install' as const, command: 'npm ci' }];
	assert.equal(await runSetup(install, runner(0), async () => [], () => undefined), undefined);
	assert.match(await runSetup(install, runner(1), async () => [], () => undefined) ?? '', /`npm ci` failed \(exit 1\): npm ERR! missing lockfile/);
	assert.match(await runSetup(install, runner(0), async () => ['src/gen.ts'], () => undefined) ?? '', /changed tracked files: src\/gen\.ts/);
	assert.match(await runSetup(install, runner(0), async () => [], () => 'pkg-a resolves outside the working copy') ?? '', /pkg-a resolves outside/);
	assert.equal(await runSetup(install, { ...runner(0), cancelled: () => true }, async () => [], () => undefined), 'stopped');
	assert.equal(await runSetup([], runner(1), async () => ['x'], () => 'no'), undefined);
});

test('the approval modal says what an install does: registry, install scripts, repository config, and a command chosen by my_editor', () => {
	const detail = approvalDetail('/p/w', ['npm ci', 'npm test'], 'TypeScript/JavaScript', 1, true);
	assert.match(detail, /my_editor chose `npm ci` from the lockfile\. It downloads packages from the registry this repository configures/);
	assert.match(detail, /\(or your default one\)/);
	assert.match(detail, /runs the install scripts of the project and of its dependencies/);
	assert.match(detail, /\.npmrc, \.yarnrc\.yml or \.pnpmfile\.cjs can also run code during the install\./);
	assert.doesNotMatch(approvalDetail('/p/w', ['go build ./...'], 'Go'), /install scripts/);
});

test('a file may stay over 400 lines when nothing left in it may move (a types-only project keeps its run-time code)', () => {
	const reason = 'only interfaces and type aliases may move here';
	const stuck = Array.from({ length: 450 }, (_, i) => ({ ...decl(i + 1, `f${i}`, { start: 0, end: 0 }), movable: false, reason }));
	const info: FileInfo = { path: 'src/big.ts', declarations: [decl(0, 'T', { start: 0, end: 0 }), ...stuck], frame: [], imports: [] };
	const original = Buffer.from('x();\n'.repeat(450));
	const files = [{ name: 't.ts', text: Buffer.from('type T = 1;\n') }];
	const adapter = { fileNameProblems: () => [], buildSplit: () => ({ original, files }) } as unknown as LanguageAdapter;
	const plan = [{ file: 't.ts', declarations: [0] }];
	assert.deepEqual(planProblems(adapter, { source: original, info, existing: [] }, plan), []);
	assert.deepEqual(oversizeNotes(adapter.buildSplit(original, info, plan), info, plan), [`src/big.ts stays at 450 lines: the rest may not move (${reason}).`]);
	const movable: FileInfo = { ...info, declarations: [...info.declarations, decl(451, 'g', { start: 0, end: 0 })] };
	assert.match(planProblems(adapter, { source: original, info: movable, existing: [] }, plan).join(' '), /would still have 450 lines/);
});
