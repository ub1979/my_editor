import * as path from 'path';
import type { Outcome, TestRun } from './baseline';
import type { FileInfo } from './language';
import type { PyFileInfo } from './pyRules';

const PYTEST = /^(PASSED|FAILED|ERROR|XFAIL|XPASS) (\S[^\n]*?)(?: - [^\n]*)?$/gm;
const PYTEST_OUTCOME: Record<string, Outcome> = { PASSED: 'pass', FAILED: 'fail', ERROR: 'fail', XFAIL: 'skip', XPASS: 'pass' };
const UNITTEST = /^(\w+) \(([\w.]+)\)(?:\n[^\n]*?)? \.\.\. (ok|FAIL|ERROR|skipped|expected failure|unexpected success)\b/gm;
const UNITTEST_OUTCOME: Record<string, Outcome> = {
	ok: 'pass', FAIL: 'fail', ERROR: 'fail', skipped: 'skip', 'expected failure': 'skip', 'unexpected success': 'pass',
};

const worse = (a: Outcome | undefined, b: Outcome): Outcome => (a === 'fail' || b === 'fail' ? 'fail' : a === 'pass' || b === 'pass' ? 'pass' : 'skip');

/** Adds a test and, like Go's parent tests, every prefix of its path (`Class`, `Class/test`), with the worst outcome below it. */
function add(run: { tests: Record<string, Outcome>; packages: Record<string, Outcome> }, file: string, parts: readonly string[], outcome: Outcome): void {
	for (let i = 1; i <= parts.length; i++) {
		const key = `${file} ${parts.slice(0, i).join('/')}`;
		run.tests[key] = i === parts.length && !(key in run.tests) ? outcome : worse(run.tests[key], outcome);
	}
	run.packages[file] = worse(run.packages[file], outcome);
}

/**
 * Per-test outcomes from pytest's `-rA` summary or unittest's `-v` lines; undefined for any other output (compared by
 * exit code then). pytest keys are `<file> <Class>/<test>/[<param>]`, unittest keys `<module> <Class>/<test>`; a pytest
 * collection error is `<file> (collection)`. `SKIPPED` summary lines carry no test ID and are not keyed.
 */
export function parsePyTests(output: string): TestRun | undefined {
	const run = { tests: {} as Record<string, Outcome>, packages: {} as Record<string, Outcome> };
	for (const m of output.matchAll(PYTEST)) {
		const [file, ...rest] = m[2].split('::');
		if (!/\.py$/.test(file)) { continue; }
		if (!rest.length) { add(run, file, ['(collection)'], 'fail'); continue; }
		const last = rest.pop()!;
		const param = /^([^[]+)(\[.*\])$/.exec(last);
		add(run, file, [...rest, ...(param ? [param[1], param[2]] : [last])], PYTEST_OUTCOME[m[1]]);
	}
	if (Object.keys(run.tests).length || /^(?:=+ )?no tests ran\b/m.test(output)) { return run; }
	for (const m of output.matchAll(UNITTEST)) {
		const dotted = m[2].endsWith(`.${m[1]}`) ? m[2].slice(0, -(m[1].length + 1)) : m[2];
		const cut = dotted.lastIndexOf('.');
		add(run, dotted.slice(0, Math.max(0, cut)) || dotted, [dotted.slice(cut + 1), m[1]], UNITTEST_OUTCOME[m[3]]);
	}
	return Object.keys(run.tests).length || /^Ran \d+ tests? in /m.test(output) ? run : undefined;
}

/** Top-level `test_*` functions and `Test*` classes a test file declares. */
export function pyTestNames(info: FileInfo): string[] {
	return info.declarations.filter(d => (/def$/.test(d.kind) && /^test/.test(d.names[0] ?? '')) || (d.kind === 'class' && /^Test/.test(d.names[0] ?? '')))
		.map(d => d.names[0]);
}

const BLOCKED = new Set(['socket', 'ssl', 'http', 'urllib', 'subprocess', 'ftplib', 'smtplib', 'poplib', 'imaplib', 'nntplib', 'telnetlib', 'xmlrpc',
	'socketserver', 'webbrowser', 'multiprocessing', 'ctypes']);
const REMOTE_URL = /\bhttps?:\/\/(?!(?:localhost|127\.0\.0\.1|\[::1\]|example\.(?:com|org|net))(?:[:/"'`]|$))/;

/**
 * Why a generated test file may not be used: it imports something other than the module under test, pytest, unittest
 * and the standard library minus network and process modules, starts subprocesses through asyncio, names a remote URL,
 * or declares no tests.
 */
export function pyTestProblems(text: string, info: PyFileInfo, module: string, stdlib: readonly string[]): string[] {
	const problems: string[] = [];
	if (!pyTestNames(info).length) { problems.push('it declares no test_ functions or Test classes'); }
	const top = module.split('.')[0];
	const parent = module.slice(0, Math.max(0, module.lastIndexOf('.')));
	const leaf = module.slice(module.lastIndexOf('.') + 1);
	const imports = [...text.matchAll(/^[ \t]*(?:from\s+(\.*[\w.]*)\s+import\s+(\([^)]*\)|[^\n#]*)|import\s+([\w., \t]+))/gm)].flatMap(m => (m[3] !== undefined
		? m[3].split(',').map(p => ({ name: p.trim().split(/\s+/)[0], names: [] as string[] }))
		: [{ name: m[1], names: m[2].replace(/[()]/g, '').split(',').map(p => p.trim().split(/\s+/)[0]).filter(Boolean) }]));
	for (const { name, names } of imports) {
		const first = name.split('.')[0];
		if (name.startsWith('.')) { problems.push(`it uses the relative import ${name}`); }
		else if (BLOCKED.has(first)) { problems.push(`it imports ${name}`); }
		else if (first === top) {
			const other = name === parent ? names.find(n => n !== leaf) : name !== module && !module.startsWith(`${name}.`) ? name : undefined;
			if (other) { problems.push(`it imports ${name === parent ? `${parent}.${other}` : other}; only ${module} is under test`); }
		} else if (!['pytest', 'unittest'].includes(first) && !stdlib.includes(first)) { problems.push(`it imports ${name}, which is not in the standard library`); }
	}
	if (/\bcreate_subprocess_(?:exec|shell)\b/.test(text)) { problems.push('it starts a subprocess'); }
	if (REMOTE_URL.test(text)) { problems.push('it names a remote URL'); }
	return [...new Set(problems)];
}

/** `tests/…/test_<stem>_ai.py` when the project keeps tests in a top-level folder (mirroring the package path when it does), else next to the source. */
export function pyTestFileName(file: string, tracked: readonly string[], root: string): string {
	const base = path.posix.basename(file) === '__init__.py' ? path.posix.basename(path.posix.dirname(file)) : path.posix.basename(file, '.py');
	const name = `test_${base}_ai.py`;
	const folder = ['tests', 'test'].find(dir => tracked.some(f => f.startsWith(`${dir}/`)));
	if (!folder) { return path.posix.join(path.posix.dirname(file), name); }
	const rel = path.posix.dirname(root === '.' ? file : file.slice(root.length + 1));
	const mirrored = path.posix.join(folder, rel);
	return path.posix.join(tracked.some(f => f.startsWith(`${mirrored}/`)) ? mirrored : folder, name);
}
