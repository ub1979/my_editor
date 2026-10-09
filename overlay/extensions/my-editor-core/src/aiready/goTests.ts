import type { Outcome, TestRun } from './baseline';
import type { GoFileInfo } from './goRules';
import type { FileInfo } from './language';

const OUTCOMES = new Set<string>(['pass', 'fail', 'skip']);
const NETWORK_IMPORTS = new Set(['net', 'net/smtp', 'net/rpc', 'net/rpc/jsonrpc', 'os/exec', 'syscall', 'unsafe', 'plugin']);
const REMOTE_URL = /\bhttps?:\/\/(?!(?:localhost|127\.0\.0\.1|\[::1\]|example\.(?:com|org|net))(?:[:/"`]|$))/;

/**
 * Per-test outcomes from `go test -json` output. Test keys are `<package> <test>`; package events have no Test.
 * Other actions (run, output, pause, start, build-output, build-fail) and non-JSON lines are ignored.
 */
export function parseGoTest(output: string): TestRun {
	const tests: Record<string, Outcome> = {};
	const packages: Record<string, Outcome> = {};
	for (const line of output.split('\n')) {
		if (!line.startsWith('{')) { continue; }
		let event: { Action?: string; Package?: string; Test?: string };
		try { event = JSON.parse(line) as typeof event; } catch { continue; }
		if (!event.Action || !OUTCOMES.has(event.Action) || !event.Package) { continue; }
		if (event.Test) { tests[`${event.Package} ${event.Test}`] = event.Action as Outcome; }
		else { packages[event.Package] = event.Action as Outcome; }
	}
	return { tests, packages };
}

/** Top-level test functions a Go test file declares. */
export function goTestNames(info: FileInfo): string[] {
	return info.declarations.filter(d => d.kind === 'func' && /^Test(?:[^a-z]|$)/.test(d.names[0] ?? '') && d.names[0] !== 'TestMain')
		.map(d => d.names[0]);
}

/** Why a generated Go test file may not be used: wrong package, TestMain, or a way to reach the network or other programs. */
export function goTestProblems(text: string, info: GoFileInfo, source: GoFileInfo): string[] {
	const problems: string[] = [];
	if (info.go.package !== source.go.package) { problems.push(`it must be in package ${source.go.package}, not ${info.go.package}`); }
	if (!goTestNames(info).length) { problems.push('it declares no Test functions'); }
	if (info.declarations.some(d => d.names.includes('TestMain') || d.names.includes('init'))) { problems.push('it must not declare TestMain or init'); }
	const paths = info.go.imports.map(spec => spec.path);
	for (const path of paths.filter(p => NETWORK_IMPORTS.has(p))) { problems.push(`it imports ${path}`); }
	if (paths.includes('net/http') && !paths.includes('net/http/httptest')) { problems.push('it imports net/http without net/http/httptest'); }
	if (REMOTE_URL.test(text)) { problems.push('it names a remote URL'); }
	return problems;
}
