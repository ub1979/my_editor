import type { Outcome, TestRun } from './baseline';

interface JestFile {
	readonly name?: string;
	readonly testFilePath?: string;
	readonly status?: string;
	readonly assertionResults?: readonly { readonly ancestorTitles?: readonly string[]; readonly title?: string; readonly status?: string }[];
}

interface MochaTest {
	readonly fullTitle?: string;
	readonly title?: string;
	readonly file?: string;
}

const OUTCOME: Record<string, Outcome> = { passed: 'pass', failed: 'fail', pending: 'skip', skipped: 'skip', todo: 'skip', disabled: 'skip' };

/** A test file's path relative to the project (the worktree's absolute prefix removed), with no spaces. */
function relative(file: string, roots: readonly string[]): string {
	const root = roots.find(r => file.startsWith(`${r}/`));
	return (root ? file.slice(root.length + 1) : file).replace(/\s/g, '_');
}

/** The JSON report in a test command's output (npm prints its own lines first), or undefined. */
function jsonReport(output: string): unknown {
	const end = output.lastIndexOf('}');
	for (let start = output.indexOf('{'); start >= 0 && start < end; start = output.indexOf('{', start + 1)) {
		if (start > 0 && output[start - 1] !== '\n') { continue; }
		try { return JSON.parse(output.slice(start, end + 1)); } catch { /* Not the report; try the next line. */ }
	}
	return undefined;
}

/** `node --test` TAP: `# Subtest:` lines give the path of nested tests; `ok`/`not ok` lines their outcome. */
function parseTap(output: string): TestRun {
	const tests: Record<string, Outcome> = {};
	const stack: string[] = [];
	let failed = false;
	for (const line of output.split('\n')) {
		const subtest = /^(\s*)# Subtest: (.*)$/.exec(line);
		if (subtest) { stack.length = subtest[1].length / 4; stack.push(subtest[2]); continue; }
		const result = /^(\s*)(not ok|ok) \d+ - (.*?)(?:\s+#\s+(SKIP|TODO)\b.*)?$/.exec(line);
		if (!result) { continue; }
		const level = result[1].length / 4;
		const name = [...stack.slice(0, level), result[3].replace(/\\#/g, '#')].join(' › ');
		let key = `node:test ${name}`;
		for (let n = 2; key in tests; n++) { key = `node:test ${name} #${n}`; }
		const outcome: Outcome = result[4] ? 'skip' : result[2] === 'ok' ? 'pass' : 'fail';
		failed ||= outcome === 'fail';
		tests[key] = outcome;
	}
	return { tests, packages: Object.keys(tests).length ? { 'node:test': failed ? 'fail' : 'pass' } : {} };
}

/**
 * Per-test outcomes from a TS/JS test command: Jest or Vitest `--json` reports, Mocha's JSON reporter, or `node --test`
 * TAP. Keys are `<test file> <describe › test>` (`node:test <path>` for TAP). Anything else gives no tests, so the run
 * is compared by exit code.
 */
export function parseTsTests(output: string, roots: readonly string[]): TestRun {
	const report = jsonReport(output) as { testResults?: readonly JestFile[]; tests?: readonly MochaTest[]; passes?: readonly MochaTest[]; failures?: readonly MochaTest[] } | undefined;
	const tests: Record<string, Outcome> = {};
	const packages: Record<string, Outcome> = {};
	if (report?.testResults) {
		for (const file of report.testResults) {
			const name = relative(file.name ?? file.testFilePath ?? 'unknown', roots);
			packages[name] = file.status === 'failed' ? 'fail' : 'pass';
			for (const result of file.assertionResults ?? []) {
				tests[`${name} ${[...(result.ancestorTitles ?? []), result.title ?? ''].join(' › ')}`] = OUTCOME[result.status ?? ''] ?? 'fail';
			}
		}
		return { tests, packages };
	}
	if (report?.tests) {
		const key = (test: MochaTest) => `${relative(test.file ?? 'unknown', roots)} ${test.fullTitle ?? test.title ?? ''}`;
		const passed = new Set((report.passes ?? []).map(key));
		const failedKeys = new Set((report.failures ?? []).map(key));
		for (const test of report.tests) {
			const k = key(test);
			tests[k] = failedKeys.has(k) ? 'fail' : passed.has(k) ? 'pass' : 'skip';
			const file = k.slice(0, k.indexOf(' '));
			packages[file] = packages[file] === 'fail' || tests[k] === 'fail' ? 'fail' : 'pass';
		}
		return { tests, packages };
	}
	return /^\s*(not ok|ok) \d+ - /m.test(output) ? parseTap(output) : { tests, packages };
}
