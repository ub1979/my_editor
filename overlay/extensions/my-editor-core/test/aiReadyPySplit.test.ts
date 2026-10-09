import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SplitPlan } from '../src/aiready/language';
import { facadeLine, filteredImport, isortOrder } from '../src/aiready/pyImports';
import type { PyFileContext } from '../src/aiready/pyRules';
import { buildPySplit } from '../src/aiready/pySplit';
import { facts, noPython, pyInfo, REPORT } from './pyFixture';

const skip = noPython();

const OPTIONS = { lineLength: 88, deferred: false };

async function split(plan: SplitPlan, text = REPORT, over: Partial<PyFileContext> = {}) {
	const info = await pyInfo('pkg/report.py', text, over);
	const result = buildPySplit(Buffer.from(text), info, plan, OPTIONS);
	return { original: result.original.toString('utf8'), files: Object.fromEntries(result.files.map(f => [f.name, f.text.toString('utf8')])) };
}

async function rejected(plan: SplitPlan, text = REPORT, over: Partial<PyFileContext> = {}): Promise<string> {
	const info = await pyInfo('pkg/report.py', text, over);
	try { buildPySplit(Buffer.from(text), info, plan, OPTIONS); } catch (error) { return (error as Error).message; }
	return '';
}

test('name rules: a staying helper or a type-only use of a staying class is rejected with both IDs; moving both passes', { skip }, async () => {
	assert.equal(await rejected([{ file: 'rows.py', declarations: [4] }]),
		'declaration 4 (caller) uses helper (3), which stays. Move it to the same file or leave both.');
	assert.equal(await rejected([{ file: 'checks.py', declarations: [6] }]),
		'declaration 6 (check) uses RowError (0), which stays. Move it to the same file or leave both.');
	assert.equal(await rejected([{ file: 'rows.py', declarations: [3, 4] }]), '');
});

test('sibling new files import each other one way; a cycle and a definition-time read across files are rejected', { skip }, async () => {
	const { original, files } = await split([{ file: 'calls.py', declarations: [4] }, { file: 'helpers.py', declarations: [3] }]);
	assert.match(files['calls.py'],
		/^# Split from report\.py by my_editor\.\n\nfrom __future__ import annotations\n\nfrom \.helpers import helper\n\n\ndef caller/);
	assert.ok(original.includes('\nfrom .calls import caller as caller\nfrom .helpers import helper as helper\n'),
		'isort order: each new file imports its own siblings');
	const ping = 'import os\n\n\ndef ping():\n    return pong()\n\n\ndef pong():\n    return ping()\n';
	assert.match(await rejected([{ file: 'a.py', declarations: [0] }, { file: 'b.py', declarations: [1] }], ping), /would import each other/);
	const early = 'import os\n\nX = 1\n\n\ndef f(x=X):\n    return x\n';
	assert.match(await rejected([{ file: 'a.py', declarations: [0] }, { file: 'b.py', declarations: [1] }], early),
		/declaration 1 \(f\) reads X \(0\) when it is defined, so both must move to the same file/);
	const hooked = 'import os\n\n\nclass Base:\n    def __init_subclass__(cls):\n        pass\n\n\nclass Sub(Base):\n    pass\n';
	assert.match(await rejected([{ file: 'bases.py', declarations: [0, 1] }], hooked), /subclasses Base, which defines __init_subclass__/);
});

test('patches that would stop working reject the plan; a patched helper with only staying callers moves', { skip }, async () => {
	const patches = (strings: [string, string][], objectUse?: string): Partial<PyFileContext> =>
		({ patches: { strings: new Map(strings), named: new Map(), assigned: new Map(), objectUse } });
	assert.match(await rejected([{ file: 'rows.py', declarations: [3, 4] }], REPORT, patches([['helper', 'tests/test_r.py:3']])),
		/tests\/test_r\.py:3 patches pkg\.report\.helper, which moved code reads/);
	assert.match(await rejected([{ file: 'rows.py', declarations: [1] }], REPORT, patches([['json', 'tests/test_r.py:9']])),
		/patches pkg\.report\.json/);
	assert.match(await rejected([{ file: 'rows.py', declarations: [1] }], REPORT, patches([], 'tests/test_r.py:4')), /by a computed name or object/);
	assert.equal(await rejected([{ file: 'helpers.py', declarations: [3] }], REPORT, patches([['helper', 'tests/test_r.py:3']])), '');
});

test('imports: filtered copies keep their layout and aliases, TYPE_CHECKING is filtered, fallbacks are copied whole, __future__ first', { skip }, async () => {
	const { files } = await split([{ file: 'rows.py', declarations: [1, 2] }, { file: 'dumping.py', declarations: [5] }, { file: 'paths.py', declarations: [3] }]);
	assert.equal(files['rows.py'], '# Split from report.py by my_editor.\n\nfrom __future__ import annotations\n\nimport json\nimport numpy as np\n'
		+ 'from typing import (\n    Optional,\n)\n\n\ndef parse_row(line: str) -> Optional[dict]:\n    return json.loads(line)\n\n\n'
		+ 'def _row_cache():\n    return np\n');
	assert.equal(files['dumping.py'], '# Split from report.py by my_editor.\n\nfrom __future__ import annotations\n\n'
		+ 'from typing import (\n    TYPE_CHECKING,\n)\n\n'
		+ 'if TYPE_CHECKING:\n    from decimal import Decimal\n\ntry:\n    import yaml\nexcept ImportError:\n    yaml = None\n\n\n'
		+ 'def dump(x: "Decimal"):\n    return yaml\n');
	assert.match(files['paths.py'], /\nimport os\.path\n\n\ndef helper/);
	const one = await facts('from m import a, b as c, d\n');
	assert.equal(filteredImport(Buffer.from('from m import a, b as c, d\n'), one.lead[0].imports[0], new Set(['a', 'd'])), 'from m import a, d');
});

test('the original keeps every byte but the moved spans, with two blank lines, and a facade naming every moved name', { skip }, async () => {
	const { original } = await split([{ file: 'rows.py', declarations: [0, 1, 2] }]);
	const lead = REPORT.slice(0, REPORT.indexOf('\n\n\nclass RowError'));
	assert.ok(original.startsWith(`${lead}\n\nfrom .rows import RowError as RowError\nfrom .rows import _row_cache as _row_cache\n`
		+ 'from .rows import parse_row as parse_row\n\n\ndef helper():'), original.slice(0, 600));
	assert.ok(original.includes('    return helper()\n\n\ndef dump('));
	assert.equal(facadeLine('rows', ['a_long_name', 'another_long_name'], 40),
		'from .rows import (\n    a_long_name as a_long_name,\n    another_long_name as another_long_name,\n)');
});

/** A module already clean under black and ruff's isort (I001): `ruff check --select I` and `black --check` accept it. */
const CLEAN = `"""Sales reports."""

from __future__ import annotations

import json
import logging

import numpy as np

LIMIT = 10
CURRENCY = "EUR"


def parse(line: str) -> dict:
    return json.loads(line)


def scale(x):
    return np.float64(x) * LIMIT


class Report:
    pass


def describe2(x):
    return x


def describe10(x):
    return x
`;

test('review items 12 and 13: the layout ruff isort and black keep (blank lines around the facade, one name per line, sorted)', { skip }, async () => {
	const { original, files } = await split([{ file: 'parsing.py', declarations: [0, 2, 3] }, { file: 'describe.py', declarations: [4, 5, 6] }], CLEAN);
	assert.equal(original, '"""Sales reports."""\n\nfrom __future__ import annotations\n\nimport json\nimport logging\n\nimport numpy as np\n\n'
		+ 'from .describe import Report as Report\nfrom .describe import describe2 as describe2\nfrom .describe import describe10 as describe10\n'
		+ 'from .parsing import LIMIT as LIMIT\nfrom .parsing import parse as parse\nfrom .parsing import scale as scale\n\nCURRENCY = "EUR"\n');
	assert.equal(files['parsing.py'], '# Split from report.py by my_editor.\n\nfrom __future__ import annotations\n\nimport json\n\nimport numpy as np\n\n'
		+ 'LIMIT = 10\n\n\ndef parse(line: str) -> dict:\n    return json.loads(line)\n\n\ndef scale(x):\n    return np.float64(x) * LIMIT\n');
	assert.equal(files['describe.py'], '# Split from report.py by my_editor.\n\nfrom __future__ import annotations\n\n\nclass Report:\n    pass\n\n\n'
		+ 'def describe2(x):\n    return x\n\n\ndef describe10(x):\n    return x\n');
	const docOnly = await split([{ file: 'funcs.py', declarations: [1] }], '"""Doc."""\n\n# comment about code\nX = 1\n\n\ndef f():\n    return 2\n');
	assert.equal(docOnly.original, '"""Doc."""\n\nfrom .funcs import f as f\n\n# comment about code\nX = 1\n');
	const header = await split([{ file: 'funcs.py', declarations: [1] }], '# Copyright 2026 ACME\n# SPDX: X\n\nX = 1\n\n\ndef f():\n    return 2\n');
	assert.equal(header.original, '# Copyright 2026 ACME\n# SPDX: X\n\nfrom .funcs import f as f\n\nX = 1\n');
	const tight = await split([{ file: 'consts.py', declarations: [0] }], 'import os\nX = 1\n\n\ndef f():\n    return os\n');
	assert.equal(tight.original, 'import os\n\nfrom .consts import X as X\n\n\ndef f():\n    return os\n');
	const sibling = await split([{ file: 'calls.py', declarations: [2] }, { file: 'base.py', declarations: [0, 1] }],
		'import os\n\n\ndef zeta():\n    return 1\n\n\ndef Alpha():\n    return 2\n\n\ndef both():\n    return zeta(), Alpha(), os\n');
	assert.match(sibling.files['calls.py'], /\nimport os\n\nfrom \.base import Alpha, zeta\n\n\ndef both/);
	assert.deepEqual(['describe10', 'Report', '_cache', 'LIMIT', 'describe2', 'X', '_ROWS', '_Private', 'a1b', 'A_b'].sort(isortOrder),
		['_ROWS', 'LIMIT', 'A_b', 'Report', 'X', '_cache', '_Private', 'a1b', 'describe2', 'describe10'], 'as ruff 0.12 sorts them');
});

test('review item 11: a second split keeps the first facade and sorts the new names in with it', { skip }, async () => {
	const text = 'import json\n\nfrom .old import a as a\n\n\ndef f():\n    return json\n\n\ndef g():\n    return 1\n';
	const { original } = await split([{ file: 'more.py', declarations: [1] }], text, { splitSiblings: ['old'] });
	assert.equal(original, 'import json\n\nfrom .more import g as g\nfrom .old import a as a\n\n\ndef f():\n    return json\n');
});

test('a file that is never split (a test file losing failing tests) only loses the spans, without a facade', { skip }, async () => {
	const text = 'import pytest\n\n\ndef test_a():\n    assert 1\n\n\ndef test_b():\n    assert 0\n';
	const info = await pyInfo('tests/test_report_ai.py', text);
	const result = buildPySplit(Buffer.from(text), info, [{ file: 'dropped.go', declarations: [1] }], OPTIONS);
	assert.equal(result.original.toString('utf8'), 'import pytest\n\n\ndef test_a():\n    assert 1\n');
	assert.deepEqual(result.files, []);
});
