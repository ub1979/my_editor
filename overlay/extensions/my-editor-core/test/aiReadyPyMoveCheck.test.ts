import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import type { SplitPlan } from '../src/aiready/language';
import { checkMove } from '../src/aiready/moveCheck';
import { createPyAdapter } from '../src/aiready/pyAdapter';
import { pySameDeclarations } from '../src/aiready/pyMoveCheck';
import { HELPER, noPython, python, pyProjectFiles, REPORT } from './pyFixture';

const skip = noPython();

/** Splits pkg/report.py with the adapter, lets `edit` change what was written, and runs move rules 1–6 on the files re-parsed from disk. */
async function splitIn(plan: SplitPlan, edit: (texts: Record<string, string>) => void = () => undefined, text = REPORT, extra: Record<string, string> = {}):
	Promise<string[]> {
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
	const read = async (name: string) => ({ text: readFileSync(path.join(root, name)), info: await adapter.parse(name) });
	const unitAfter = await Promise.all((await adapter.unitFiles(file)).map(f => adapter.parse(f)));
	return [
		...checkMove({ before: { text: source, info }, after: await read(file), files: await Promise.all(result.files.map(f => read(`pkg/${f.name}`))), plan,
			header: adapter.splitHeader(file), importProblems: adapter.importProblems, blankLines: adapter.blankLines }),
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
