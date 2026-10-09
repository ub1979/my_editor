import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import type { SplitPlan } from '../src/aiready/language';
import { checkMove } from '../src/aiready/moveCheck';
import { createPyAdapter } from '../src/aiready/pyAdapter';
import { pySameDeclarations } from '../src/aiready/pyMoveCheck';
import { findTool } from '../src/aiready/projectCommands';
import { HELPER, noPython, python, pyProjectFiles, REPORT } from './pyFixture';

const skip = noPython();

/** Splits pkg/report.py with the adapter, lets `edit` change what was written, and runs move rules 1–6 on the files re-parsed from disk. */
async function splitIn(plan: SplitPlan, edit: (texts: Record<string, string>) => void = () => undefined, text = REPORT, extra: Record<string, string> = {},
	written?: (root: string, texts: Record<string, string>) => void): Promise<string[]> {
	const { root, tracked } = pyProjectFiles({ 'pkg/__init__.py': '', 'pkg/report.py': text, ...extra });
	const adapter = createPyAdapter(root, python()!, { helperDir: HELPER, storageDir: root }, tracked);
	const file = 'pkg/report.py';
	const source = readFileSync(path.join(root, file));
	const info = await adapter.parse(file);
	const unitBefore = await Promise.all((await adapter.unitFiles(file)).map(f => adapter.parse(f)));
	const result = adapter.buildSplit(source, info, plan);
	const texts: Record<string, string> = { [file]: result.original.toString('utf8') };
	for (const f of result.files) { texts[`pkg/${f.name}`] = f.text.toString('utf8'); }
	edit(texts);
	for (const [name, body] of Object.entries(texts)) { writeFileSync(path.join(root, name), body); }
	written?.(root, texts);
	const read = async (name: string) => ({ text: readFileSync(path.join(root, name)), info: await adapter.parse(name) });
	const unitAfter = await Promise.all((await adapter.unitFiles(file)).map(f => adapter.parse(f)));
	return [
		...checkMove({ before: { text: source, info }, after: await read(file), files: await Promise.all(result.files.map(f => read(`pkg/${f.name}`))), plan,
			header: adapter.splitHeader(file), importProblems: adapter.importProblems, blankLines: adapter.blankLines,
			lineSuffixes: adapter.lineSuffixes }),
		...adapter.sameDeclarations(unitBefore, unitAfter),
	];
}

const PLAN: SplitPlan = [{ file: 'rows.py', declarations: [0, 1, 2] }, { file: 'calls.py', declarations: [3, 4, 5, 6] }];

test('move check: a clean split passes rules 1 to 6', { skip }, async () => {
	assert.deepEqual(await splitIn(PLAN), []);
	assert.deepEqual(await splitIn([{ file: 'rows.py', declarations: [3] }, { file: 'calls.py', declarations: [4] }]), []);
});

test('move check: a commented constant moves into a new module that needs no imports', { skip }, async () => {
	const text = 'import os\n\n# How amounts are shown.\nCURRENCY = "EUR"\n\n\ndef f():\n    return os\n';
	assert.deepEqual(await splitIn([{ file: 'money.py', declarations: [0] }], () => undefined, text), []);
	assert.deepEqual(await splitIn([{ file: 'money.py', declarations: [0] }], () => undefined, `# Copyright.\n\n${text.slice('import os\n\n'.length)}`
		.replace('return os', 'return 1')), []);
});

test('move check: an edited body, a dropped facade name, a new import and a facade naming another file fail', { skip }, async () => {
	const edited = await splitIn(PLAN, t => { t['pkg/rows.py'] = t['pkg/rows.py'].replace('return np', 'return None'); });
	assert.match(edited.join(' '), /Rule 1: rows\.py does not hold exactly its moved declarations/);
	const dropped = await splitIn(PLAN, t => { t['pkg/report.py'] = t['pkg/report.py'].replace('from .rows import _row_cache as _row_cache\n', ''); });
	assert.match(dropped.join(' '),
		/Rule 2: the facade imports RowError, parse_row from rows\.py, not exactly its moved names \(RowError, _row_cache, parse_row\)/);
	const comment = await splitIn(PLAN, t => {
		t['pkg/report.py'] = t['pkg/report.py'].replace('from .rows import RowError', '# hello\nfrom .rows import RowError');
	});
	assert.match(comment.join(' '), /Rule 2: the facade of pkg\/report\.py has more than import statements: `# hello`/);
	const future = await splitIn(PLAN, t => { t['pkg/rows.py'] = t['pkg/rows.py'].replace('from __future__ import annotations\n', ''); });
	assert.match(future.join(' '), /Rule 3: pkg\/rows\.py lacks `from __future__ import annotations`, which the original has/);
	const gained = await splitIn(PLAN, t => { t['pkg/rows.py'] = t['pkg/rows.py'].replace('import json\n', 'import json\nimport pickle\n'); });
	assert.match(gained.join(' '), /Rule 3: pkg\/rows\.py has `import pickle`, which is not a filtered copy of an import of the original/);
	const other = await splitIn(PLAN, t => { t['pkg/report.py'] = t['pkg/report.py'].replace('from .calls import', 'from .other import'); });
	assert.match(other.join(' '), /Rule 2: the leading imports of pkg\/report\.py changed|the facade does not import every new file/);
});

test('move check: a second split of an already split file passes', { skip }, async () => {
	const text = 'import json\n\nfrom .old import a as a\n\n\ndef f():\n    return json\n\n\ndef g():\n    return 1\n';
	const old = '# Split from report.py by my_editor.\n\n\ndef a():\n    return 1\n';
	assert.deepEqual(await splitIn([{ file: 'more.py', declarations: [1] }], () => undefined, text, { 'pkg/old.py': old }), []);
	assert.deepEqual(await splitIn([{ file: 'more.py', declarations: [0, 1] }], () => undefined, text, { 'pkg/old.py': old }), []);
});

test('move check: a changed __all__ and a binding that resolves elsewhere (rule 6) fail', { skip }, async () => {
	const withAll = REPORT.replace('\n\nclass RowError', '\n\n__all__ = ["report"]\n\n\nclass RowError');
	const plan: SplitPlan = [{ file: 'rows.py', declarations: [1, 2, 3] }];
	assert.deepEqual(await splitIn(plan, () => undefined, withAll), []);
	const changed = await splitIn(plan, t => { t['pkg/report.py'] = t['pkg/report.py'].replace('__all__ = ["report"]', '__all__ = ["report", "x"]'); }, withAll);
	assert.match(changed.join(' '), /__all__ in pkg\/report\.py changed/);
	const { root, tracked } = pyProjectFiles({ 'pkg/__init__.py': '', 'pkg/report.py': 'import json\n\n\ndef f():\n    return json\n',
		'pkg/rows.py': '# Split from report.py by my_editor.\n\nimport simplejson as json\n\n\ndef f():\n    return json\n' });
	const adapter = createPyAdapter(root, python()!, { helperDir: HELPER, storageDir: root }, tracked);
	const before = [await adapter.parse('pkg/report.py')];
	writeFileSync(path.join(root, 'pkg/report.py'), 'import json\nfrom .rows import f as f\n');
	const after = await Promise.all(['pkg/report.py', 'pkg/rows.py'].map(f => adapter.parse(f)));
	assert.match(pySameDeclarations(before, after).join(' '), /Rule 6: \d+ name bindings? differ after the move \(json\)/);
});

const LINTED = '"""Rows."""\n\nimport csv\nimport json\nimport os\nimport re  # patterns\n'
	+ 'from typing import (\n    TYPE_CHECKING,\n    List,\n    Optional,\n)\n\n'
	+ 'if TYPE_CHECKING:\n    from decimal import Decimal\n\n\ndef parse(line: "Decimal") -> List[str]:\n    return json.loads(re.sub("x", "", line))\n\n\n'
	+ 'def where(x: Optional[str]) -> str:\n    return os.path.join(x or "", csv.__name__)\n';
const RUFF = { 'pyproject.toml': '[tool.ruff]\n' };
const PARSE: SplitPlan = [{ file: 'rows.py', declarations: [0] }];
const edited = (from: string, to: string, extra: Record<string, string> = RUFF) =>
	splitIn(PARSE, t => { t['pkg/report.py'] = t['pkg/report.py'].replace(from, to); }, LINTED, extra);

test('a project linted by ruff or flake8: an import only moved code used gets `  # noqa: F401` on its first line, and rule 2 takes only that', { skip },
	async () => {
		let original = '';
		const lint: string[] = [];
		assert.deepEqual(await splitIn(PARSE, () => undefined, LINTED, RUFF, (root, texts) => {
			original = texts['pkg/report.py'];
			for (const [tool, args] of [['ruff', ['check', '--no-cache', 'pkg/report.py']], ['ruff', ['check', '--no-cache', '--select', 'I', 'pkg/report.py']],
				['black', ['--check', '-q', 'pkg/report.py']]] as const) {
				const bin = findTool(tool);
				const out = bin ? spawnSync(bin, args, { cwd: root, encoding: 'utf8' }) : undefined;
				if (out && out.status !== 0) { lint.push(`${tool} ${args.join(' ')}: ${out.stdout}${out.stderr}`); }
			}
		}), []);
		assert.equal(original.split('\n\n\n')[0], '"""Rows."""\n\nimport csv\nimport json  # noqa: F401\nimport os\nimport re  # patterns  # noqa: F401\n'
			+ 'from typing import (  # noqa: F401\n    TYPE_CHECKING,\n    List,\n    Optional,\n)\n\nif TYPE_CHECKING:\n'
			+ '    from decimal import Decimal  # noqa: F401\n\nfrom .rows import parse as parse');
		assert.deepEqual(lint, []);
		const near = (line: number) => new RegExp(`Rule 2: pkg/report\\.py changed beyond the moved spans near line ${line}:`);
		assert.match((await edited('import os\n', 'import os  # noqa: F401\n')).join(' '), near(5));
		assert.match((await edited('import json  # noqa: F401\n', 'import json\n')).join(' '), near(4));
		assert.match((await edited('json  # noqa: F401', 'json  # noqa: F401, E501')).join(' '), /Rule 2/);
		assert.match((await edited('    from decimal import Decimal  # noqa: F401', '    from decimal import Decimal')).join(' '), /Rule 2/);
		assert.match((await edited('import json\n', 'import json  # noqa: F401\n', {})).join(' '), /Rule 2/, 'unlinted: the imports stay byte for byte');
		assert.deepEqual(await splitIn(PARSE, () => undefined, LINTED), []);
	});

test('no noqa where black and isort would wrap the line, after a backslash, or where a noqa comment already is', { skip }, async () => {
	const head = 'import json \\\n    as j\nimport os  # noqa\nfrom collections import OrderedDict as an_ordered_dictionary_with_a_long_name_here\n';
	const text = `${head}\n\ndef f():\n    return j, os, an_ordered_dictionary_with_a_long_name_here\n\n\nX = 1\n`;
	let original = '';
	const keep = (_: string, texts: Record<string, string>) => { original = texts['pkg/report.py']; };
	assert.deepEqual(await splitIn([{ file: 'rows.py', declarations: [0] }], () => undefined, text, RUFF, keep), []);
	assert.ok(original.startsWith(head), original);
});

const FLAKE8 = { '.flake8': '[flake8]\nmax-line-length = 88\nextend-ignore = E203\n' };
const FACADE = 'import json\n\n\ndef parse(line):\n    return json.loads(line)\n\n\n'
	+ 'def a_function_whose_facade_line_wraps(x):\n    return x\n\n\ndef where():\n    return 1\n';

test('a flake8 project: each facade line carries `  # noqa: F401` (flake8 reads `x as x` as unused), and rule 2 takes it only there', { skip },
	async () => {
		const plan: SplitPlan = [{ file: 'rows.py', declarations: [0, 1] }];
		let original = '';
		const lint: string[] = [];
		assert.deepEqual(await splitIn(plan, () => undefined, FACADE, FLAKE8, (root, texts) => {
			original = texts['pkg/report.py'];
			for (const [tool, args] of [['flake8', ['pkg/report.py']], ['ruff', ['check', '--no-cache', '--isolated', 'pkg/report.py']],
				['ruff', ['check', '--no-cache', '--isolated', '--select', 'I', 'pkg/report.py']], ['black', ['--check', '-q', 'pkg/report.py']]] as const) {
				const bin = findTool(tool);
				const out = bin ? spawnSync(bin, args, { cwd: root, encoding: 'utf8' }) : undefined;
				if (out && out.status !== 0) { lint.push(`${tool} ${args.join(' ')}: ${out.stdout}${out.stderr}`); }
			}
		}), []);
		const long = 'a_function_whose_facade_line_wraps';
		assert.equal(original.split('\n\n\n')[0], `import json  # noqa: F401\n\nfrom .rows import (  # noqa: F401\n    ${long} as ${long},\n)\n`
			+ 'from .rows import parse as parse  # noqa: F401');
		assert.deepEqual(lint, []);
		const facadeEdit = (from: string, to: string, extra: Record<string, string>) =>
			splitIn(plan, t => { t['pkg/report.py'] = t['pkg/report.py'].replace(from, to); }, FACADE, extra);
		assert.match((await facadeEdit('parse as parse  # noqa: F401', 'parse as parse', FLAKE8)).join(' '),
			/Rule 2: the facade line `from \.rows import parse as parse` is not written as/);
		assert.match((await facadeEdit('parse as parse  # noqa: F401', 'parse as parse  # noqa', FLAKE8)).join(' '), /Rule 2: the facade line/);
		assert.match((await facadeEdit('parse as parse\n', 'parse as parse  # noqa: F401\n', RUFF)).join(' '), /Rule 2: the facade line/,
			'ruff takes `x as x` as a re-export: no noqa there');
		assert.deepEqual(await splitIn(plan, () => undefined, FACADE, RUFF), []);
	});
