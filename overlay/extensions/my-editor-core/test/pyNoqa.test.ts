import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PyImport, PyLead } from '../src/aiready/pyAst';
import { NOQA, noqaLines, pyLineSuffixes, readNames, suffixed } from '../src/aiready/pyNoqa';
import type { PyFileInfo } from '../src/aiready/pyRules';

/** `import a, b as c` or `from m import x as y`: the statement starting at `line` of `source`. */
function imp(source: string, line: string, kind: 'import' | 'from', aliases: [string, string?][], module = ''): PyImport {
	const lineStart = source.indexOf(line);
	assert.ok(lineStart >= 0, `${line} is in the source`);
	return {
		kind, module, level: 0, line: 0, start: lineStart, end: lineStart + line.length, lineStart,
		aliases: aliases.map(([name, asname]) => ({ name, asname: asname ?? null, start: 0, end: 0 })),
	};
}

function lead(kind: PyLead['kind'], imports: PyImport[], needs: string[] = []): PyLead {
	return { kind, start: 0, end: 0, line: 0, endLine: 0, binds: [], needs, imports };
}

interface View {
	readonly lead?: PyLead[];
	readonly facade?: number[];
	readonly lineLength?: number;
	readonly declarations?: { id: number; names: string[]; reads: string[] }[];
	readonly spans?: string[];
}

/** A Python file view with only what pyNoqa reads. */
function info(view: View): PyFileInfo {
	return {
		path: 'pkg/m.py', frame: [], imports: [], facade: view.facade ?? [], spans: view.spans ?? [],
		declarations: (view.declarations ?? []).map(d => ({ id: d.id, names: d.names, py: { reads: d.reads } })),
		facts: { lead: view.lead ?? [] },
		context: { lintsImports: view.lineLength === undefined ? undefined : { lineLength: view.lineLength, flake8: false } },
	} as unknown as PyFileInfo;
}

const SOURCE = 'import json\nimport os, re\nfrom typing import Optional as Opt\n';

test('readNames collects what kept declarations read and what leading conditions need', () => {
	const view = info({
		lead: [lead('typecheck', [], ['TYPE_CHECKING'])],
		declarations: [{ id: 0, names: ['a'], reads: ['json'] }, { id: 1, names: ['b'], reads: ['os'] }],
	});
	assert.deepEqual([...readNames(view)].sort(), ['TYPE_CHECKING', 'json', 'os']);
	assert.deepEqual([...readNames(view, new Set([1]))].sort(), ['TYPE_CHECKING', 'json'], 'a moved declaration no longer counts');
});

test('readNames counts the identifier strings in __all__ as read, but not other strings', () => {
	const view = info({
		declarations: [{ id: 0, names: ['__all__'], reads: [] }, { id: 1, names: ['doc'], reads: [] }],
		spans: ['__all__ = ["parse", \'Row\', "not a name"]', 'doc = "json"'],
	});
	assert.deepEqual([...readNames(view)].sort(), ['Row', 'parse']);
});

test('noqaLines marks nothing when the project does not lint imports', () => {
	const view = info({ lead: [lead('import', [imp(SOURCE, 'import json', 'import', [['json']])])] });
	assert.equal(noqaLines(Buffer.from(SOURCE), view, new Set(['json']), new Set()).size, 0);
});

test('noqaLines marks the first line of an import that binds a name only moved code read', () => {
	const view = info({
		lineLength: 88,
		lead: [
			lead('import', [imp(SOURCE, 'import json', 'import', [['json']])]),
			lead('import', [imp(SOURCE, 'import os, re', 'import', [['os'], ['re']])]),
			lead('import', [imp(SOURCE, 'from typing import Optional as Opt', 'from', [['Optional', 'Opt']], 'typing')]),
		],
	});
	const marked = noqaLines(Buffer.from(SOURCE), view, new Set(['json', 'os', 're', 'Opt']), new Set(['json', 're']));
	assert.deepEqual([...marked.entries()], [[SOURCE.indexOf('import os'), NOQA], [SOURCE.indexOf('from typing'), NOQA]]);
});

test('noqaLines leaves an import alone when its names were never read or are still read', () => {
	const view = info({ lineLength: 88, lead: [lead('import', [imp(SOURCE, 'import json', 'import', [['json']])])] });
	assert.equal(noqaLines(Buffer.from(SOURCE), view, new Set(), new Set()).size, 0, 'never read: nothing the split changed');
	assert.equal(noqaLines(Buffer.from(SOURCE), view, new Set(['json']), new Set(['json'])).size, 0);
});

test('`import a.b` binds its top name `a`', () => {
	const source = 'import os.path\n';
	const view = info({ lineLength: 88, lead: [lead('import', [imp(source, 'import os.path', 'import', [['os.path']])])] });
	assert.equal(noqaLines(Buffer.from(source), view, new Set(['os']), new Set()).size, 1);
	assert.equal(noqaLines(Buffer.from(source), view, new Set(['path']), new Set()).size, 0);
});

test('noqaLines refuses facade imports, docstrings, __future__ and redundant aliases', () => {
	const source = 'from __future__ import annotations\nfrom .rows import parse as parse\nimport json\n';
	const future = imp(source, 'from __future__ import annotations', 'from', [['annotations']], '__future__');
	const reexport = imp(source, 'from .rows import parse as parse', 'from', [['parse', 'parse']], 'rows');
	const facade = imp(source, 'import json', 'import', [['json']]);
	const view = info({
		lineLength: 88, facade: [3],
		lead: [lead('doc', []), lead('import', [future]), lead('import', [reexport]), lead('import', [facade])],
	});
	assert.equal(noqaLines(Buffer.from(source), view, new Set(['annotations', 'parse', 'json']), new Set()).size, 0);
});

test('noqaLines refuses a line that already says noqa, ends in a backslash, or would grow past the line length', () => {
	const source = 'import json  # NOQA\nimport os, \\\n    re\nimport csv\n';
	const at = (line: string, aliases: [string, string?][]) => lead('import', [imp(source, line, 'import', aliases)]);
	const items = [at('import json', [['json']]), at('import os, \\', [['os'], ['re']]), at('import csv', [['csv']])];
	const all = new Set(['json', 'os', 're', 'csv']);
	assert.deepEqual([...noqaLines(Buffer.from(source), info({ lineLength: 88, lead: items }), all, new Set()).keys()],
		[source.indexOf('import csv')]);
	const tight = 'import csv'.length + NOQA.length;
	assert.equal(noqaLines(Buffer.from(source), info({ lineLength: tight, lead: items }), all, new Set()).size, 1, 'exactly the limit fits');
	assert.equal(noqaLines(Buffer.from(source), info({ lineLength: tight - 1, lead: items }), all, new Set()).size, 0);
});

test('noqaLines measures the line in characters, not bytes, and handles a last line without a newline', () => {
	const source = 'import café as cafe';
	const view = (lineLength: number) => info({ lineLength, lead: [lead('import', [imp(source, source, 'import', [['café', 'cafe']])])] });
	const limit = [...source].length + NOQA.length;
	assert.equal(noqaLines(Buffer.from(source), view(limit), new Set(['cafe']), new Set()).size, 1);
	assert.equal(noqaLines(Buffer.from(source), view(limit - 1), new Set(['cafe']), new Set()).size, 0);
});

test('an import inside a TYPE_CHECKING block gets the suffix on its own first line', () => {
	const source = 'if TYPE_CHECKING:\n    from decimal import Decimal\n';
	const inner = imp(source, '    from decimal import Decimal', 'from', [['Decimal']], 'decimal');
	const view = info({ lineLength: 88, lead: [lead('typecheck', [inner], ['TYPE_CHECKING'])] });
	assert.deepEqual([...noqaLines(Buffer.from(source), view, new Set(['Decimal']), new Set()).keys()], [source.indexOf('    from')]);
});

test('pyLineSuffixes compares what the original read before and after the split', () => {
	const text = Buffer.from(SOURCE);
	const imports = [lead('import', [imp(SOURCE, 'import json', 'import', [['json']])])];
	const before = info({ lineLength: 88, lead: imports, declarations: [{ id: 0, names: ['f'], reads: ['json'] }] });
	const after = info({ lineLength: 88, lead: imports, declarations: [] });
	assert.deepEqual([...pyLineSuffixes({ text, info: before }, { text, info: after }).entries()], [[0, NOQA]]);
	assert.equal(pyLineSuffixes({ text, info: before }, { text, info: before }).size, 0);
});

test('suffixed appends each suffix at the end of its line, only inside the range', () => {
	const source = Buffer.from('a\nbb\nccc\n');
	const suffixes = new Map([[0, ' #A'], [2, ' #B'], [5, ' #C']]);
	assert.equal(suffixed(source, 0, source.length, suffixes), 'a #A\nbb #B\nccc #C\n');
	assert.equal(suffixed(source, 2, 5, suffixes), 'bb #B\n', 'keys outside [start, end) are ignored');
	assert.equal(suffixed(source, 0, source.length, new Map()), 'a\nbb\nccc\n');
});

test('suffixed stops at the range end on a last line without a newline, and keeps suffix order by position', () => {
	const source = Buffer.from('x\ny');
	assert.equal(suffixed(source, 0, source.length, new Map([[2, '!'], [0, '?']])), 'x?\ny!');
	assert.equal(suffixed(source, 0, 1, new Map([[0, '?']])), 'x?', 'a line cut by the range end gets the suffix at the end');
});
