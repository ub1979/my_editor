import type { CheckCommand } from './language';

export type Outcome = 'pass' | 'fail' | 'skip';

/** Per-test and per-package outcomes of one test command. Test keys are `<package> <test>`. */
export interface TestRun {
	readonly tests: Readonly<Record<string, Outcome>>;
	readonly packages: Readonly<Record<string, Outcome>>;
}

/** One run of one check command. */
export interface CheckResult {
	readonly command: string;
	/** The check's label (`test` for a test command), when known. */
	readonly label?: string;
	/** Exit code; undefined when the command could not start, timed out or was stopped. */
	readonly code: number | undefined;
	/** Error lines with file positions removed, so a moved declaration's error still compares equal. */
	readonly failures: readonly string[];
	readonly tests?: TestRun;
	readonly tail: string;
	readonly log: string;
	readonly timedOut?: boolean;
}

const POSITION = /^(?:\.{0,2}\/)?[^\s:(]+\.\w+(?::\d+:\d+ -|:\d+(?::\d+)?:|\(\d+,\d+\):)\s*/;

/**
 * Non-empty output lines with leading `file:line:col:` (Go, mypy), `file:line:col -` (pyright) or `file(line,col):` (tsc)
 * positions removed, sorted and unique.
 */
export function failureLines(output: string): string[] {
	return [...new Set(output.split(/\r?\n/).map(line => line.trim().replace(POSITION, '')).filter(Boolean))].sort();
}

/** Tests and packages whose outcome differs between the two baseline runs, or that appear in only one. */
export function flakyTests(first: TestRun | undefined, second: TestRun | undefined): string[] {
	const differs = (a: Readonly<Record<string, Outcome>>, b: Readonly<Record<string, Outcome>>) =>
		[...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => a[key] !== b[key]);
	if (!first || !second) { return []; }
	return [...differs(first.tests, second.tests), ...differs(first.packages, second.packages).map(name => `${name} (package)`)].sort();
}

/** Named new tests that did not pass in this run, including ones that never ran (say, the test binary did not build). */
export function unverified(names: readonly string[], run: TestRun | undefined): string[] {
	const outcomes = Object.entries(run?.tests ?? {}).map(([key, outcome]) => ({ test: key.slice(key.indexOf(' ') + 1), outcome }));
	return names.filter(name => !outcomes.some(o => o.test === name && o.outcome === 'pass')
		|| outcomes.some(o => (o.test === name || o.test.startsWith(`${name}/`)) && o.outcome === 'fail'));
}

/** Whether a test key belongs to one of the named top-level tests, subtests included. */
function belongsTo(key: string, names: readonly string[]): boolean {
	const test = key.slice(key.indexOf(' ') + 1);
	return names.some(name => test === name || test.startsWith(`${name}/`));
}

export interface Comparison {
	readonly problems: string[];
	/** New tests (from `allowNew`) that did not pass. */
	readonly newFailing: string[];
}

/**
 * Compares one run with the baseline's two runs. The exit status must match the first run, and the failure lines
 * both runs share (lines in only one are volatile and ignored);
 * every test that was not flaky must have the same outcome; tests may only be added when they are named in
 * `allowNew`, and those are reported when they do not pass.
 */
export function compareWithBaseline(baseline: readonly [CheckResult, CheckResult], now: CheckResult, allowNew: readonly string[] = []): Comparison {
	const [first, second] = baseline;
	const problems: string[] = [];
	if (now.code === undefined) {
		return { problems: [`\`${now.command}\` ${now.timedOut ? 'timed out' : 'did not finish'}.`], newFailing: [] };
	}
	const exitDiffers = (now.code === 0) !== (first.code === 0);
	if (!first.tests) {
		if (exitDiffers) { problems.push(exitProblem(now)); }
		// Lines in only one baseline run (`go: downloading …`) are volatile, like flaky tests.
		const stable = first.failures.filter(line => second.failures.includes(line));
		const volatile = new Set([...first.failures, ...second.failures].filter(line => !stable.includes(line)));
		const added = now.failures.filter(line => !stable.includes(line) && !volatile.has(line));
		const gone = stable.filter(line => !now.failures.includes(line));
		if (now.code !== 0 && first.code !== 0 && (added.length || gone.length)) {
			problems.push(`\`${now.command}\` failed differently: ${[...added.map(line => `+ ${line}`), ...gone.map(line => `- ${line}`)].slice(0, 6).join(' | ')}`);
		}
		return { problems, newFailing: [] };
	}
	const flaky = new Set(flakyTests(first.tests, second.tests));
	const tests = now.tests ?? { tests: {}, packages: {} };
	const newFailing: string[] = [];
	for (const [key, outcome] of Object.entries(first.tests.tests)) {
		if (flaky.has(key)) { continue; }
		const result = tests.tests[key];
		if (result !== outcome) { problems.push(`${key}: ${outcome} before, ${result ?? 'missing'} now.`); }
	}
	for (const [key, outcome] of Object.entries(tests.tests)) {
		if (key in first.tests.tests || flaky.has(key)) { continue; }
		if (!belongsTo(key, allowNew)) { problems.push(`${key}: a test that did not exist before.`); }
		else if (outcome === 'fail') { newFailing.push(key); }
	}
	// A package that gained tests may go from "no test files" (skip) to pass, or fail only through its new tests.
	const gained = new Set(Object.keys(tests.tests).filter(key => !(key in first.tests!.tests)).map(key => key.slice(0, key.indexOf(' '))));
	for (const [name, outcome] of Object.entries(first.tests.packages)) {
		if (flaky.has(`${name} (package)`) || gained.has(name)) { continue; }
		const result = tests.packages[name];
		if (result !== outcome) { problems.push(`Package ${name}: ${outcome} before, ${result ?? 'missing'} now.`); }
	}
	if (exitDiffers && !(gained.size && (now.code === 0 || newFailing.length))) { problems.push(exitProblem(now)); }
	return { problems, newFailing };
}

function exitProblem(now: CheckResult): string {
	return `\`${now.command}\` ${now.code === 0 ? 'now passes but failed before' : `failed (exit ${now.code}) but passed before`}.`;
}

type Baseline = Readonly<Record<string, readonly [CheckResult, CheckResult]>>;

/**
 * A one-line summary of a passing step's checks. A build or vet that failed before is `not a check`; a test run that
 * failed before is still compared test by test, unless its output was not recognised (then only its exit code was).
 */
export function checkSummary(results: readonly CheckResult[], flaky: readonly string[], baseline: Baseline): string {
	const outcomes = Object.values([...results].reverse().find(result => result.tests)?.tests?.tests ?? {});
	const passed = outcomes.filter(outcome => outcome === 'pass').length;
	const state = (command: string) => {
		const before = baseline[command]?.[0];
		// A test command whose output no parser knew was compared by its exit code only.
		const exitOnly = before?.label === 'test' && !before.tests ? '; exit code only (test output not recognised)' : '';
		if (before?.code === 0) { return `passed${exitOnly}`; }
		return before?.tests ? 'already failing; tests compared one by one' : `already failing before this run (not a check)${exitOnly}`;
	};
	const commands = [...new Set(results.map(result => result.command))].map(command => `\`${command}\`: ${state(command)}`);
	const counted = outcomes.length ? ` (${passed} of ${outcomes.length} tests passing)` : '';
	return `${commands.join('; ')}${counted}${flaky.length ? `; ${flaky.length} flaky excluded` : ''}.`;
}

const ERROR_LINE = /error|undefined|cannot/i;

/** The most telling line of a failed run: the first error-looking line of the output in its original order, else the first line that is not a `#` header. */
function errorLine(run: CheckResult): string {
	const lines = run.tail.split('\n').map(line => line.trim()).filter(Boolean);
	const line = lines.find(l => ERROR_LINE.test(l)) ?? lines.find(l => !l.startsWith('#')) ?? run.failures.find(l => !l.startsWith('#')) ?? 'no output';
	return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/**
 * A step needs at least one passing verifying check (adapters mark them, say a compile check of the package). Returns
 * why the step must be skipped when none passed at baseline, else undefined.
 */
export function noVerifyingCheck(checks: readonly CheckCommand[], baseline: Baseline, unit: string): string | undefined {
	const recorded = checks.filter(check => check.verifies && baseline[check.command]);
	if (!recorded.length) { return `No compile check of ${unit} was recorded for this run.`; }
	if (recorded.some(check => baseline[check.command].every(run => run.code === 0))) { return undefined; }
	const line = errorLine(baseline[recorded[0].command][0]);
	return `Nothing here can compile ${unit} to check this split: its build already fails (${line}). Fix the build, then run this again.`;
}

/** What recording a baseline needs from the run. */
export interface BaselineRunner {
	/** `env` is the check's own `CheckCommand.env`, set over the adapter's `commandEnv`. */
	readonly check: (command: string, label: string, env?: Readonly<Record<string, string>>) => Promise<CheckResult>;
	readonly cancelled: () => boolean;
	readonly progress: (text: string) => void;
}

/**
 * Runs the adapter's setup commands (an install) once in the new worktree. Undefined when it is ready; else a plain
 * message (a command failed, tracked files changed, or `ready` names a problem), or 'stopped'. With `installed`, what
 * the commands made is still in place (Continue): they do not run again, and only `ready` is asked; so it is with no
 * commands at all (Python installs nothing but still checks where imports resolve).
 */
export async function runSetup(commands: readonly CheckCommand[], runner: BaselineRunner, changed: () => Promise<string[]>,
	ready: () => string | undefined, installed = false): Promise<string | 'stopped' | undefined> {
	if (!commands.length || installed) { return ready(); }
	for (const { command, label } of commands) {
		runner.progress(`Preparing the working copy: \`${command}\`…`);
		const result = await runner.check(command, label);
		if (runner.cancelled()) { return 'stopped'; }
		if (result.code !== 0) {
			return `\`${command}\` ${result.code === undefined ? (result.timedOut ? 'timed out' : 'did not start') : `failed (exit ${result.code})`}: `
				+ `${result.tail.split('\n').filter(Boolean).slice(-1)[0] ?? 'no output'}. Fix it in your folder, then try again.`;
		}
	}
	const files = await changed();
	if (files.length) { return `Installing the dependencies changed tracked files: ${files.join(', ')}. This project cannot be fixed on a branch.`; }
	return ready();
}

export type BaselineOutcome =
	| { readonly baseline: Record<string, readonly [CheckResult, CheckResult]> }
	| { readonly stopped: true }
	| { readonly problem: string };

/**
 * Runs every check twice on the untouched branch. A run that timed out or did not start leaves nothing to compare
 * with, so the run stops with what to change.
 */
export async function runBaseline(checks: readonly CheckCommand[], runner: BaselineRunner): Promise<BaselineOutcome> {
	const baseline: Record<string, readonly [CheckResult, CheckResult]> = {};
	for (const { command, label, env } of checks) {
		const runs: CheckResult[] = [];
		for (const round of [1, 2]) {
			runner.progress(`Baseline ${round} of 2: \`${command}\`…`);
			const result = await runner.check(command, label, env);
			if (runner.cancelled()) { return { stopped: true }; }
			if (result.code === undefined) {
				return {
					problem: result.timedOut
						? `\`${command}\` timed out while recording how the project behaves before any change. Raise `
							+ '**myEditor.aiReady.commandTimeoutMinutes** in Settings, or fix the command, then try again.'
						: `\`${command}\` did not start: ${result.tail.split('\n')[0] || 'no output'}. Install the tool or fix the command, then try again.`,
				};
			}
			runs.push(result);
		}
		baseline[command] = [runs[0], runs[1]];
	}
	return { baseline };
}
