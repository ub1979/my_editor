import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CheckResult, failureLines, runBaseline, runSetup } from '../src/aiready/baseline';
import { approvalDetail } from '../src/aiready/fixText';
import type { Declaration, FileInfo, ParsedFile, Span } from '../src/aiready/language';
import { checkMove, collapse } from '../src/aiready/moveCheck';
import { runCommand } from '../src/aiready/projectCommands';

test('runCommand finds the program on the command env PATH before the process PATH', async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-bin with space-'));
	writeFileSync(path.join(dir, 'python'), '#!/bin/sh\necho "fake python $1"\n');
	chmodSync(path.join(dir, 'python'), 0o755);
	const out = await runCommand('python -V', { cwd: dir, approved: ['python -V'], timeoutMs: 10_000, logFile: path.join(dir, 'log.txt'), env: { PATH: dir } });
	assert.equal(out.stdout.trim(), 'fake python -V');
});

test('runSetup asks ready() even when there is nothing to install', async () => {
	const runner = { check: async () => { throw new Error('no command runs'); }, cancelled: () => false, progress: () => undefined };
	assert.equal(await runSetup([], runner, async () => [], () => 'pkg resolves outside the working copy'), 'pkg resolves outside the working copy');
	assert.equal(await runSetup([], runner, async () => [], () => undefined), undefined);
});

test('failureLines strips pyright and mypy positions, so a moved error compares equal', () => {
	const before = failureLines('  /w/pkg/report.py:3:5 - error: "x" is not defined (reportUndefinedVariable)\npkg/report.py:9: error: Bad [misc]\n');
	const after = failureLines('  /w/pkg/rows.py:12:1 - error: "x" is not defined (reportUndefinedVariable)\npkg/rows.py:2: error: Bad [misc]\n');
	assert.deepEqual(before, ['error: "x" is not defined (reportUndefinedVariable)', 'error: Bad [misc]'].sort());
	assert.deepEqual(after, before);
});

test('runBaseline hands each check its own env', async () => {
	const seen: (Readonly<Record<string, string>> | undefined)[] = [];
	const result = (command: string): CheckResult => ({ command, code: 0, failures: [], tail: '', log: '' });
	const runner = { check: async (command: string, _label: string, env?: Readonly<Record<string, string>>) => { seen.push(env); return result(command); },
		cancelled: () => false, progress: () => undefined };
	await runBaseline([{ label: 'build', command: 'python -m my_editor_pycheck pkg.report', env: { PYTHONPATH: '/helper' } },
		{ label: 'test', command: 'python -m pytest' }], runner);
	assert.deepEqual(seen, [{ PYTHONPATH: '/helper' }, { PYTHONPATH: '/helper' }, undefined, undefined]);
});

test('the approval modal carries the adapter note (Python: the interpreter) before the closing sentence', () => {
	const detail = approvalDetail('/p/w', ['python -m pytest'], 'Python', false, 'Python: /p/.venv/bin/python (3.12.2, sys.prefix /p/.venv).');
	assert.match(detail, /local git commands there\. Python: \/p\/\.venv\/bin\/python \(3\.12\.2, sys\.prefix \/p\/\.venv\)\. Your files/);
});

test('collapse keeps the longer bordering blank run, at most two, in longest mode', () => {
	const gap = undefined;
	assert.deepEqual(collapse(['a', '', '', gap, '', '', 'b'], 'longest'), ['a', '', '', 'b']);
	assert.deepEqual(collapse(['a', '', gap, '', '', '', 'b'], 'longest'), ['a', '', '', 'b']);
	assert.deepEqual(collapse(['a', '', gap, '', 'b'], 'longest'), ['a', '', 'b']);
	assert.deepEqual(collapse(['a', gap, 'b'], 'longest'), ['a', 'b']);
	assert.deepEqual(collapse(['a', '', '', gap, '', '', 'b']), ['a', '', 'b']);
	assert.deepEqual(collapse(['a', '', '', gap, '', ''], 'longest'), ['a']);
});

function span(text: string, from: string, to?: string): Span {
	const start = text.indexOf(from);
	return { start, end: to === undefined ? text.length - 1 : text.indexOf(to, start) };
}

function decl(id: number, name: string, at: Span): Declaration {
	return { id, kind: 'def', names: [name], span: at, lines: 2, doc: '', docText: '', uses: [], movable: true };
}

function parsed(text: string, info: Omit<FileInfo, 'path' | 'frame' | 'imports'> & Partial<FileInfo>): ParsedFile {
	return { text: Buffer.from(text), info: { path: 'pkg/report.py', frame: [], imports: [], ...info } };
}

test('move check: Python keeps two blank lines where a moved definition was', () => {
	const header = '# Split from report.py by my_editor.\n\n';
	const before = 'import os\n\n\ndef a():\n    pass\n\n\ndef b():\n    pass\n\n\ndef c():\n    pass\n';
	const after = 'import os\nfrom .rows import b as b\n\n\ndef a():\n    pass\n\n\ndef c():\n    pass\n';
	const moved = `${header}def b():\n    pass\n`;
	const facade = after.indexOf('from .rows');
	const input = {
		before: parsed(before, {
			declarations: [decl(0, 'a', span(before, 'def a', '\n\n\ndef b')), decl(1, 'b', span(before, 'def b', '\n\n\ndef c')), decl(2, 'c', span(before, 'def c'))],
			importRegion: { start: before.indexOf('\n\n\ndef a') + 1, end: before.indexOf('\n\n\ndef a') + 1 },
		}),
		after: parsed(after, {
			declarations: [decl(0, 'a', span(after, 'def a', '\n\n\ndef c')), decl(1, 'c', span(after, 'def c'))],
			importRegion: { start: facade, end: after.indexOf('\n', facade) },
		}),
		files: [parsed(moved, { path: 'pkg/rows.py', declarations: [decl(0, 'b', span(moved, 'def b'))], frame: [{ start: 0, end: header.length }],
			prelude: { start: 0, end: header.length } })],
		plan: [{ file: 'rows.py', declarations: [1] }], header, importProblems: () => [],
	};
	assert.deepEqual(checkMove({ ...input, blankLines: 'longest' }), []);
	assert.match(checkMove(input).join(' '), /Rule 2: pkg\/report.py changed beyond the moved spans/);
});
