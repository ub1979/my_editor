import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CheckResult, failureLines } from '../src/aiready/baseline';
import { createGoAdapter, goInstallDirs, goTools } from '../src/aiready/goAdapter';
import type { LanguageAdapter } from '../src/aiready/language';
import { findTool, runCommand, tail } from '../src/aiready/projectCommands';
import { runAddTests, runSplit, StepContext } from '../src/aiready/steps';
import { changedFiles, prepare, remove, trackedFiles } from '../src/aiready/worktree';

const SHOP = `package shop

import (
	"fmt"
	"strings"
)

// Upper shouts.
func Upper(s string) string { return strings.ToUpper(s) }

// Describe prints a number.
func Describe(n int) string { return fmt.Sprint(n) }
`;
const TEST = 'package shop\n\nimport "testing"\n\nfunc TestUpper(t *testing.T) {\n\tif Upper("a") != "A" {\n\t\tt.Fatal()\n\t}\n}\n';
const NEW_TESTS = 'package shop\n\nimport "testing"\n\nfunc TestAiDescribe(t *testing.T) {\n\tif Describe(2) != "2" {\n\t\tt.Fatal()\n\t}\n}\n\n'
	+ 'func TestAiWrong(t *testing.T) { t.Fatal("pins nothing") }\n';

/** A Go module in a fresh Git repository, with a worktree, a Go adapter on it and its baseline. */
async function setup(): Promise<{ root: string; worktree: string; adapter: LanguageAdapter; ctx: Omit<StepContext, 'ask'> } | undefined> {
	if (!findTool('go', goInstallDirs())) { return undefined; }
	const parent = mkdtempSync(path.join(os.tmpdir(), 'my-editor-steps-'));
	const root = path.join(parent, 'shop');
	mkdirSync(root);
	writeFileSync(path.join(root, 'go.mod'), 'module example.com/shop\n\ngo 1.22\n');
	writeFileSync(path.join(root, 'shop.go'), SHOP);
	writeFileSync(path.join(root, 'shop_test.go'), TEST);
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	git('init', '--quiet');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	const tools = await goTools(path.resolve(__dirname, '../../resources/goast/main.go'), path.join(os.tmpdir(), 'my-editor-goast-cache'), 'test');
	assert.equal(typeof tools, 'object', String(tools));
	const wt = await prepare(root);
	const adapter = createGoAdapter(wt.path, tools as Exclude<typeof tools, string>, await trackedFiles(wt.path));
	const approved = adapter.checks('shop.go').map(check => check.command);
	const check = async (command: string, label: string): Promise<CheckResult> => {
		const out = await runCommand(command, { cwd: wt.path, approved, timeoutMs: 120_000, logFile: path.join(parent, 'logs', `${Date.now()}.log`) });
		return { command, code: out.code, failures: label === 'test' ? [] : failureLines(out.output), tests: label === 'test' ? adapter.parseTests(out.stdout) : undefined, tail: tail(out.output), log: '' };
	};
	const baseline: Record<string, [CheckResult, CheckResult]> = {};
	for (const { command, label } of adapter.checks('shop.go')) { baseline[command] = [await check(command, label), await check(command, label)]; }
	return { root, worktree: wt.path, adapter, ctx: { adapter, worktree: wt.path, baseline, flaky: [], check, cancelled: () => false, progress: () => undefined } };
}

test('steps: a split is planned by ID, checked and committed; a bad plan is refused after one retry; new tests drop failures', async t => {
	const run = await setup();
	if (!run) { t.skip('Go is not installed'); return; }
	const { root, worktree, ctx } = run;
	const asked: string[] = [];
	const bad = await runSplit({ ...ctx, ask: async (_system, text) => { asked.push(text); return '[{"file":"shop_linux.go","declarations":[9]}]'; } },
		{ file: 'shop.go', kind: 'split', lines: 13 });
	assert.equal(asked.length, 2);
	assert.match(asked[1], /It was rejected:\n- Declaration 9 does not exist/);
	assert.equal(typeof bad === 'object' && bad.status, 'refused');
	assert.deepEqual(await changedFiles(worktree), []);

	const split = await runSplit({ ...ctx, ask: async () => '[{"file":"shop_describe.go","declarations":[1]}]' }, { file: 'shop.go', kind: 'split', lines: 13 });
	assert.ok(typeof split === 'object' && split.status === 'committed', JSON.stringify(split));
	assert.deepEqual(split.moved, [{ file: 'shop_describe.go', names: ['Describe'] }]);
	assert.equal(readFileSync(path.join(worktree, 'shop.go'), 'utf8'),
		'package shop\n\nimport (\n\t"strings"\n)\n\n// Upper shouts.\nfunc Upper(s string) string { return strings.ToUpper(s) }\n');
	const log = execFileSync('git', ['log', '--format=%s', '-2', 'my_editor/ai-ready'], { cwd: root, encoding: 'utf8' });
	assert.match(log, /^my_editor: split into 1 file \(shop.go\)\nfirst\n$/);

	const tests = await runAddTests({ ...ctx, ask: async () => `\`\`\`go\n${NEW_TESTS}\`\`\`` }, { file: 'shop_describe.go', kind: 'tests', lines: 6 });
	assert.ok(typeof tests === 'object' && tests.status === 'committed', JSON.stringify(tests));
	assert.deepEqual(tests.dropped, ['TestAiWrong']);
	assert.doesNotMatch(readFileSync(path.join(worktree, 'shop_describe_ai_test.go'), 'utf8'), /TestAiWrong/);

	const stopped = await runSplit({ ...ctx, cancelled: () => true, ask: async () => '[]' }, { file: 'shop.go', kind: 'split', lines: 8 });
	assert.equal(stopped, 'stopped');
	await remove(root, worktree);
	assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
});
