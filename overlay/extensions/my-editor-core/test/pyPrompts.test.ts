import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PyDecl } from '../src/aiready/pyAst';
import { pySplitPrompt, pyTestPrompt } from '../src/aiready/pyPrompts';
import type { PyDeclaration, PyFileInfo } from '../src/aiready/pyRules';

interface DeclOver {
	readonly id: number;
	readonly names: string[];
	readonly reads?: string[];
	readonly sameFile?: string[];
	readonly annSameFile?: string[];
	readonly baseNames?: string[];
	readonly movable?: boolean;
	readonly reason?: string;
	readonly doc?: string;
	readonly kind?: string;
}

/** A declaration with only what the prompt reads. */
function decl(over: DeclOver): PyDeclaration {
	const py = { reads: over.reads ?? [], sameFile: over.sameFile ?? [], annSameFile: over.annSameFile ?? [], baseNames: over.baseNames ?? [] };
	return {
		id: over.id, kind: over.kind ?? 'def', names: over.names, span: { start: 0, end: 0 }, lines: 5, doc: over.doc ?? '', docText: '', uses: [],
		movable: over.movable ?? true, reason: over.reason, py: py as unknown as PyDecl,
	};
}

/** A Python file view with only what the prompt reads. */
function info(declarations: PyDeclaration[], over: { deferred?: boolean; future?: boolean } = {}): PyFileInfo {
	return {
		path: 'pkg/report.py', declarations, frame: [], imports: [],
		context: { module: 'pkg.report', deferred: over.deferred ?? false }, facts: { future: over.future ?? false },
	} as unknown as PyFileInfo;
}

/** The JSON object on each declaration line of a split prompt. */
function lines(text: string): Record<string, unknown>[] {
	return text.split('Declarations:\n')[1].split('\n\n')[0].split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
}

test('a Python split prompt names the module, its file and length, the folder, and the 400-line goal', () => {
	const prompt = pySplitPrompt(info([decl({ id: 0, names: ['parse'] })]), 640, ['__init__.py', 'report.py', 'rows']);
	assert.match(prompt.text, /^Module: pkg\.report \(pkg\/report\.py, 640 lines\)\nFiles and folders already in its folder: __init__\.py, report\.py, rows\n/);
	assert.match(prompt.text, /Plan new modules so report\.py and every new module are at most 400 lines\.$/);
	assert.match(prompt.system, /leaves a re-export line in the original/);
	assert.match(prompt.system, /not test_\*, \*_test, conftest, setup/);
	assert.match(prompt.system, /Reply with only a JSON array/);
});

test('needs lists the ids of other declarations a declaration reads, once each, never itself', () => {
	const out = lines(pySplitPrompt(info([
		decl({ id: 0, names: ['ROWS'] }),
		decl({ id: 1, names: ['parse'], reads: ['ROWS', 'ROWS', 'parse', 'json', 'helper'] }),
		decl({ id: 2, names: ['helper'] }),
	]), 500, []).text);
	assert.deepEqual(out[1].needs, [0, 2]);
	assert.ok(!('needs' in out[0]), 'no reads: no needs key');
	assert.ok(!('needs' in out[2]));
});

test('a name bound twice belongs to its first declaration', () => {
	const out = lines(pySplitPrompt(info([
		decl({ id: 0, names: ['cache'] }),
		decl({ id: 1, names: ['cache'] }),
		decl({ id: 2, names: ['use'], reads: ['cache'] }),
	]), 500, []).text);
	assert.deepEqual(out[2].needs, [0]);
});

test('readsWhenDefined joins same-file reads, annotations and base classes', () => {
	const out = lines(pySplitPrompt(info([
		decl({ id: 0, names: ['Base'] }),
		decl({ id: 1, names: ['DEFAULT'] }),
		decl({ id: 2, names: ['Hint'] }),
		decl({ id: 3, kind: 'class', names: ['Row'], sameFile: ['DEFAULT'], annSameFile: ['Hint'], baseNames: ['Base'] }),
	]), 500, []).text);
	assert.deepEqual(out[3].readsWhenDefined, [1, 2, 0]);
});

test('annotations are not read at definition time under deferred evaluation or `from __future__ import annotations`', () => {
	const decls = [decl({ id: 0, names: ['Hint'] }), decl({ id: 1, names: ['f'], annSameFile: ['Hint'] })];
	assert.deepEqual(lines(pySplitPrompt(info(decls), 500, []).text)[1].readsWhenDefined, [0]);
	assert.ok(!('readsWhenDefined' in lines(pySplitPrompt(info(decls, { deferred: true }), 500, []).text)[1]));
	assert.ok(!('readsWhenDefined' in lines(pySplitPrompt(info(decls, { future: true }), 500, []).text)[1]));
});

test('doc, movable and reason appear only when they say something', () => {
	const out = lines(pySplitPrompt(info([
		decl({ id: 0, names: ['_registry'], movable: false, reason: 'read by name at import time', doc: '' }),
		decl({ id: 1, names: ['parse'], doc: 'Parse one row.', reason: 'ignored while movable' }),
	]), 500, []).text);
	assert.deepEqual(out[0], { id: 0, kind: 'def', names: ['_registry'], lines: 5, movable: false, reason: 'read by name at import time' });
	assert.deepEqual(out[1], { id: 1, kind: 'def', names: ['parse'], lines: 5, firstDocLine: 'Parse one row.' });
});

test('a Python test prompt names the test file, the import, the runner, then the source', () => {
	const source = 'def add(a, b):\n    return a + b\n';
	const prompt = pyTestPrompt('pkg/calc.py', source, 'pkg.calc', 'tests/test_ai_calc.py', 'pytest');
	assert.equal(prompt.text, 'Write tests/test_ai_calc.py for pkg/calc.py (import it as pkg.calc); the project runs tests with pytest.\n\n'
		+ `=== pkg/calc.py ===\n${source}`);
	assert.match(prompt.system, /unittest\.TestCase classes named TestAi<Something>/);
	assert.match(prompt.system, /No network, sockets, http, urllib, subprocess/);
	assert.match(prompt.system, /```python code block/);
});

test('a Python test prompt redacts secrets and keeps at most 60,000 characters of source', () => {
	const secret = 'API_KEY = "sk-proj-abcdefghijklmnopqrstuv"\n';
	const redacted = pyTestPrompt('k.py', secret, 'k', 'test_ai_k.py', 'unittest');
	assert.doesNotMatch(redacted.text, /sk-proj-abcdefghijklmnopqrstuv/);
	assert.match(redacted.text, /\[REDACTED\]/);
	const long = `x = 1\n${'#'.repeat(80_000)}`;
	const body = pyTestPrompt('big.py', long, 'big', 'test_ai_big.py', 'pytest').text.split('=== big.py ===\n')[1];
	assert.equal(body.length, 60_000);
	assert.ok(long.startsWith(body));
});
