import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CheckResult, failureLines, flakyTests, runBaseline } from '../src/aiready/baseline';
import type { LanguageAdapter } from '../src/aiready/language';
import { adapterFor, fixableFinding } from '../src/aiready/languages';
import { runCommand, tail } from '../src/aiready/projectCommands';
import { createPyAdapter } from '../src/aiready/pyAdapter';
import { runAddTests, runSplit, StepContext } from '../src/aiready/steps';
import { prepare } from '../src/aiready/worktree';
import { fakePython, HELPER, noPython, python, pyProjectFiles } from './pyFixture';

const skip = noPython();
const EXT = path.resolve(__dirname, '../..');
const store = () => mkdtempSync(path.join(os.tmpdir(), 'my-editor-py-store-'));

const REPORT = '"""Rows."""\nimport json\n\nLIMIT = 10\n\n\ndef parse(line):\n    return json.loads(line)\n\n\ndef clamp(x):\n    return min(x, LIMIT)\n\n\n'
	+ 'def report(lines):\n    return [clamp(parse(line)) for line in lines]\n';
const TESTS = 'import unittest\n\nfrom pkg import report\n\n\nclass TestReport(unittest.TestCase):\n    def test_report(self):\n'
	+ '        self.assertEqual(report.report(["3", "30"]), [3, 10])\n';

test('Python projects get the Python adapter; its findings are fixable; the version gate stops a 3.15 interpreter', async () => {
	assert.ok(fixableFinding('pkg/report.py', 'too-long') && fixableFinding('pkg/report.py', 'untested'));
	const { root } = pyProjectFiles({ 'pyproject.toml': '[project]\nname = "x"\n' });
	const late = fakePython(path.join(store(), 'bin'), [3, 15, 0]);
	assert.equal(await adapterFor(root, { extensionPath: EXT, storageDir: store(), version: 't', appRoot: '', choosePython: async () => late }),
		'Python splitting needs Python 3.9 to 3.14 for now.');
	const { root: plain } = pyProjectFiles({ 'README.md': 'x\n' });
	assert.match(await adapterFor(plain, { extensionPath: EXT, storageDir: store(), version: 't', appRoot: '' }) as string,
		/`requirements\.txt`, `Pipfile` or `manage\.py`/);
});

test('commands start with the interpreter file name; a path with spaces stays in the env, never in the command text', { skip }, async () => {
	const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'my editor-')), '.venv', 'bin');
	mkdirSync(dir, { recursive: true });
	symlinkSync(python()!.path, path.join(dir, 'python'));
	const { root, tracked } = pyProjectFiles({ 'requirements.txt': '', 'pkg/__init__.py': '', 'pkg/report.py': REPORT, 'tests/__init__.py': '',
		'tests/test_report.py': TESTS });
	const factory = await adapterFor(root,
		{ extensionPath: EXT, storageDir: store(), version: 't', appRoot: '', choosePython: async () => path.join(dir, 'python') });
	assert.ok(typeof factory === 'function');
	const adapter = factory(root, tracked);
	const pycheck = `python ${path.join(HELPER, 'my_editor_pycheck.py')} pkg.report`;
	assert.equal(adapter.checks('pkg/report.py')[0].command, pycheck);
	assert.ok(adapter.commandEnv!.PATH.startsWith(`${dir}${path.delimiter}`));
	assert.match(adapter.approvalNote!('/w/x.ai-ready'), /^Python: .*my editor-.*\/\.venv\/bin\/python \(3\./);
	writeFileSync(path.join(root, 'my_editor_pycheck.py'), 'print("shadowed")\n');
	writeFileSync(path.join(root, 'my_editor_pyast.py'), 'raise SystemExit("shadowed")\n');
	const out = await runCommand(pycheck, { cwd: root, approved: [pycheck], timeoutMs: 60_000,
		logFile: path.join(store(), 'log'), env: { ...adapter.commandEnv, ...adapter.checks('pkg/report.py')[0].env } });
	assert.equal(out.code, 0, out.output);
	assert.match(out.output, /pkg\.report imports; its split modules share every object/);
});

const WHERE = 'import os\nimport unittest\n\nimport pkg.report\n\n\nclass TestWhere(unittest.TestCase):\n    def test_imports_the_working_copy(self):\n'
	+ '        here = os.path.realpath(os.getcwd())\n        self.assertTrue(os.path.realpath(pkg.report.__file__).startswith(here + os.sep), pkg.report.__file__)\n';

test('every command runs on the working copy: PYTHONPATH, the import check and the tests resolve the module there, and the modal shows that path',
	{ skip }, async () => {
		const env = mkdtempSync(path.join(os.tmpdir(), 'venv-'));
		execFileSync(python()!.path, ['-m', 'venv', '--without-pip', env]);
		const { root } = pyProjectFiles({ 'pyproject.toml': '[project]\nname = "pkg"\n', 'src/pkg/__init__.py': '', 'src/pkg/report.py': REPORT,
			'tests/__init__.py': '', 'tests/test_where.py': WHERE }, true);
		// An editable install of the user's folder, as `pip install -e .` leaves it.
		writeFileSync(path.join(env, 'lib', readdirSync(path.join(env, 'lib'))[0], 'site-packages', '__editable__.pkg.pth'), `${path.join(root, 'src')}\n`);
		const venv = { ...python()!, path: path.join(env, 'bin', 'python'), prefix: env, venv: true,
			tools: { pytest: false, randomly: false, mypy: false, black: false, pytestDjango: false } };
		const dirs = { helperDir: HELPER, storageDir: store() };
		const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
		const local = createPyAdapter(root, venv, dirs, tracked);
		const worktree = (await prepare(root)).path;
		const inWorktree = createPyAdapter(worktree, venv, dirs, tracked);
		const wt = realpathSync(worktree);
		assert.ok(inWorktree.commandEnv!.PYTHONPATH.split(path.delimiter).every(p => realpathSync(p).startsWith(wt)), inWorktree.commandEnv!.PYTHONPATH);
		assert.ok(local.approvalNote!(worktree).includes(`PYTHONPATH=${inWorktree.commandEnv!.PYTHONPATH},`), local.approvalNote!(worktree));
		assert.equal(inWorktree.ready!(), undefined);
		const checks = inWorktree.checks('src/pkg/report.py');
		assert.deepEqual(checks.map(c => c.label), ['build', 'test']);
		const run = (command: string, over: Readonly<Record<string, string>>) => runCommand(command, { cwd: worktree, approved: [command],
			timeoutMs: 60_000, logFile: path.join(store(), 'log'), env: over });
		for (const check of checks) {
			const out = await run(check.command, inWorktree.commandEnv!);
			assert.equal(out.code, 0, out.output);
		}
		// The same commands with the user's folder on PYTHONPATH import the user's code: both checks catch that.
		const build = await run(checks[0].command, local.commandEnv!);
		assert.match(build.output, /pkg\.report resolves to .*, outside this folder/);
		assert.notEqual((await run(checks[1].command, local.commandEnv!)).code, 0);
	});

/** A step context on a repository with the real interpreter, the baseline recorded, and the model replaced by fixed replies. */
async function context(files: Record<string, string>, replies: string[]): Promise<{ ctx: StepContext; root: string; adapter: LanguageAdapter }> {
	const { root, tracked } = pyProjectFiles(files, true);
	// The machine's tools must not decide the test command (pytest installed or not): unittest, as a bare interpreter would run.
	const tools = { pytest: false, randomly: false, mypy: false, black: false, pytestDjango: false };
	const adapter = createPyAdapter(root, { ...python()!, tools, installed: [] }, { helperDir: HELPER, storageDir: store() }, tracked);
	const approved = adapter.checks('pkg/report.py').map(c => c.command);
	const check = async (command: string, label: string, env?: Readonly<Record<string, string>>): Promise<CheckResult> => {
		const out = await runCommand(command,
			{ cwd: root, approved, timeoutMs: 120_000, logFile: path.join(store(), 'log'), env: { ...adapter.commandEnv, ...env } });
		return { command, label, code: out.code, failures: label === 'test' ? [] : failureLines(out.output), tail: tail(out.output), log: '',
			tests: label === 'test' ? adapter.parseTests(adapter.testOutput === 'both' ? out.output : out.stdout) : undefined };
	};
	const outcome = await runBaseline(adapter.checks('pkg/report.py'), { check, cancelled: () => false, progress: () => undefined });
	assert.ok('baseline' in outcome);
	const flaky = Object.values(outcome.baseline).flatMap(([a, b]) => flakyTests(a.tests, b.tests));
	let asked = 0;
	const ctx: StepContext = { adapter, worktree: root, baseline: outcome.baseline, flaky, check, cancelled: () => false, progress: () => undefined,
		ask: async () => replies[Math.min(asked++, replies.length - 1)] };
	return { ctx, root, adapter };
}

const PROJECT = { '.gitignore': '__pycache__/\n', 'setup.cfg': '[metadata]\nname = pkg\n', 'pkg/__init__.py': '', 'pkg/report.py': REPORT,
	'tests/__init__.py': '', 'tests/test_report.py': TESTS };

test('a split runs end to end: plan, move check, the import check and the tests, then one commit', { skip }, async () => {
	const { ctx, root } = await context(PROJECT, [JSON.stringify([{ file: 'limits.py', declarations: [0, 2] }])]);
	const step = await runSplit(ctx, { file: 'pkg/report.py', kind: 'split', lines: 0 });
	assert.equal(step !== 'stopped' && step.status, 'committed', JSON.stringify(step));
	assert.equal(readFileSync(path.join(root, 'pkg/report.py'), 'utf8'),
		'"""Rows."""\nimport json\n\nfrom .limits import LIMIT as LIMIT\nfrom .limits import clamp as clamp\n\n\ndef parse(line):\n    return json.loads(line)\n\n\n'
		+ 'def report(lines):\n    return [clamp(parse(line)) for line in lines]\n');
	assert.equal(readFileSync(path.join(root, 'pkg/limits.py'), 'utf8'),
		'# Split from report.py by my_editor.\n\n\nLIMIT = 10\n\n\ndef clamp(x):\n    return min(x, LIMIT)\n');
});

test('a plan using a staying helper is refused after its retry', { skip }, async () => {
	const { ctx } = await context(PROJECT, [JSON.stringify([{ file: 'limits.py', declarations: [2] }])]);
	const step = await runSplit(ctx, { file: 'pkg/report.py', kind: 'split', lines: 0 });
	assert.equal(step !== 'stopped' && step.status, 'refused');
	assert.match(step !== 'stopped' ? step.reason ?? '' : '', /declaration 2 \(clamp\) uses LIMIT \(0\), which stays/);
});

test('add tests: a reply without a code block names the fence Python uses', { skip }, async () => {
	const { ctx } = await context(PROJECT, ['Here are the tests you asked for.']);
	const step = await runAddTests(ctx, { file: 'pkg/report.py', kind: 'tests', lines: 0 });
	assert.equal(step !== 'stopped' && step.reason, 'The tests did not work: The reply had no ```python code block.');
});

test('add tests: a failing generated test class is dropped by its span and the rest is committed', { skip }, async () => {
	const reply = '```python\nimport unittest\n\nfrom pkg import report\n\n\nclass TestAiGood(unittest.TestCase):\n    def test_clamp(self):\n'
		+ '        self.assertEqual(report.clamp(99), 10)\n\n\nclass TestAiBad(unittest.TestCase):\n    def test_parse(self):\n'
		+ '        self.assertEqual(report.parse("1"), 2)\n```';
	const { ctx, root, adapter } = await context(PROJECT, [reply]);
	const plans: string[] = [];
	const step = await runAddTests({ ...ctx, adapter: { ...adapter, buildSplit: (source, info, plan) => {
		plans.push(...plan.map(g => g.file));
		return adapter.buildSplit(source, info, plan);
	} } }, { file: 'pkg/report.py', kind: 'tests', lines: 0 });
	assert.deepEqual(plans, ['dropped.py']);
	assert.equal(step !== 'stopped' && step.status, 'committed', JSON.stringify(step));
	assert.deepEqual(step !== 'stopped' && step.dropped, ['TestAiBad']);
	const written = readFileSync(path.join(root, 'tests/test_report_ai.py'), 'utf8');
	assert.ok(written.includes('class TestAiGood') && !written.includes('TestAiBad') && !written.includes('from .dropped'));
});
