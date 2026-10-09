import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CheckResult, failureLines } from '../src/aiready/baseline';
import { adapterFor, fixableFinding } from '../src/aiready/languages';
import { runCommand, tail } from '../src/aiready/projectCommands';
import { runSplit, StepContext } from '../src/aiready/steps';
import { createTsAdapter } from '../src/aiready/tsAdapter';
import { lockfileProblem } from '../src/aiready/tsProject';
import { prepare, trackedFiles } from '../src/aiready/worktree';
import { project, ts, TS_DIR } from './tsFixture';

const SHOP = `import { helper } from './util.js';

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

export function report(lines: string[]): string {
	return lines.map(parseRow).map(formatRow).join(helper());
}
`;
const TEST = `import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { report, parseRow } from '../src/shop.js';

test('report formats rows', () => { assert.equal(report(['a,1', 'b,2']), 'a: 1\\nb: 2'); });
test('parseRow reads the size', () => { assert.equal(parseRow('x,3').size, 3); });
`;
const NODE_MODULES = path.resolve(__dirname, '../../node_modules');

test('steps: a TS split on a worktree is planned by ID, checked by tsc and node --test against the baseline, and committed', async () => {
	const parent = mkdtempSync(path.join(os.tmpdir(), 'my-editor-ts-steps-'));
	const root = path.join(parent, 'shop');
	mkdirSync(path.join(root, 'src'), { recursive: true });
	mkdirSync(path.join(root, 'test'));
	const files: Record<string, string> = {
		'.gitignore': 'node_modules\ndist\n', 'package-lock.json': '{}', 'src/shop.ts': SHOP, 'src/util.ts': "export function helper(): string { return '\\n'; }\n",
		'test/shop.test.ts': TEST,
		'package.json': JSON.stringify({ name: 'shop', type: 'module', scripts: { pretest: 'tsc -p .', test: 'node --test "dist/test/*.test.js"' } }),
		'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', strict: true, outDir: 'dist', rootDir: '.', types: ['node'] }, include: ['src', 'test'] }),
	};
	for (const [file, text] of Object.entries(files)) { writeFileSync(path.join(root, file), text); }
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	git('init', '--quiet');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	const wt = await prepare(root);
	symlinkSync(NODE_MODULES, path.join(wt.path, 'node_modules'));
	const adapter = createTsAdapter(wt.path, ts, await trackedFiles(wt.path));
	const checks = adapter.checks('src/shop.ts');
	assert.deepEqual(checks.map(c => c.command), ['npx --no -- tsc --noEmit -p tsconfig.json --pretty false', 'npm test']);
	const approved = checks.map(c => c.command);
	const check = async (command: string, label: string): Promise<CheckResult> => {
		// Without NODE_TEST_CONTEXT: a `node --test` started inside a test file reports to this run instead of printing TAP.
		const env = { ...adapter.commandEnv, NODE_TEST_CONTEXT: undefined };
		const out = await runCommand(command, { cwd: wt.path, approved, timeoutMs: 120_000, env, logFile: path.join(parent, 'logs', `${Date.now()}.log`) });
		return { command, code: out.code, failures: label === 'test' ? [] : failureLines(out.output), tests: label === 'test' ? adapter.parseTests(out.stdout) : undefined, tail: tail(out.output), log: '' };
	};
	const baseline: Record<string, [CheckResult, CheckResult]> = {};
	for (const { command, label } of checks) { baseline[command] = [await check(command, label), await check(command, label)]; }
	assert.equal(baseline['npm test'][0].code, 0, baseline['npm test'][0].tail);
	assert.deepEqual(Object.keys(baseline['npm test'][0].tests?.tests ?? {}), ['node:test report formats rows', 'node:test parseRow reads the size']);
	let replies = ['[{"file":"rows.ts","declarations":[0,1,2]}]'];
	const ctx: StepContext = { adapter, worktree: wt.path, baseline, flaky: [], check, cancelled: () => false, progress: () => undefined, ask: async () => replies.shift() ?? '[]' };
	const step = await runSplit(ctx, { file: 'src/shop.ts', kind: 'split', lines: 18 });
	assert.equal(step === 'stopped' ? 'stopped' : step.status, 'committed', step === 'stopped' ? '' : step.reason);
	assert.match(readFileSync(path.join(wt.path, 'src/shop.ts'), 'utf8'), /^import \{ helper \} from '\.\/util\.js';\nimport \{ parseRow, formatRow \} from '\.\/rows\.js';\nexport \{ parseRow, formatRow \} from '\.\/rows\.js';\nexport type \{ Row \} from '\.\/rows\.js';\n/);
	assert.match(execFileSync('git', ['log', '--format=%s', '-1'], { cwd: wt.path, encoding: 'utf8' }), /my_editor: split into 1 file \(src\/shop\.ts\)/);
	replies = ['[{"file":"more.ts","declarations":[3]}]', '[{"file":"more.ts","declarations":[3]}]'];
	const refused = await runSplit(ctx, { file: 'src/shop.ts', kind: 'split', lines: 8 });
	assert.equal(refused === 'stopped' ? 'stopped' : refused.status, 'refused');
	assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
});

test('a TS project needs the editor\'s TypeScript and a lockfile; mixed repositories stay Go-first', async () => {
	const appRoot = mkdtempSync(path.join(os.tmpdir(), 'my-editor-app-'));
	mkdirSync(path.join(appRoot, 'extensions', 'node_modules'), { recursive: true });
	symlinkSync(TS_DIR, path.join(appRoot, 'extensions', 'node_modules', 'typescript'));
	const host = { extensionPath: '/nowhere', storageDir: os.tmpdir(), version: 'test', appRoot };
	const locked = project({ 'package.json': '{"type":"module"}', 'package-lock.json': '{}' });
	assert.equal(typeof await adapterFor(locked.root, host), 'function');
	const loose = project({ 'package.json': '{"type":"module"}' });
	assert.match(String(await adapterFor(loose.root, host)), /no lockfile/);
	assert.match(lockfileProblem(project({ 'package-lock.json': '{}', 'yarn.lock': '' }).root) ?? '', /lockfiles of npm and yarn disagree/);
	assert.match(String(await adapterFor(locked.root, { ...host, appRoot: '/nowhere' })), /needs the editor's TypeScript 5 or 6/);
	assert.ok(!existsSync(path.join(locked.root, 'node_modules')));
	assert.ok(fixableFinding('src/a.ts', 'too-long') && fixableFinding('a.go', 'untested') && !fixableFinding('src/a.ts', 'untested') && !fixableFinding('a.rs', 'too-long'));
});
