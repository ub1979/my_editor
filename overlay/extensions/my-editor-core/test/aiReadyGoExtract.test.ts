import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { goInstallDirs } from '../src/aiready/goAdapter';
import { extractBuild, extractCheck, extractOutline, listPackage, type ExtractTarget } from '../src/aiready/goExtract';
import { findTool } from '../src/aiready/projectCommands';
import { EXTRACT_DIR, extractHelper, goModule } from './goExtractFixture';

const BASIC = readFileSync(path.join(EXTRACT_DIR, 'testdata/cases/basic/a.go'), 'utf8');

test('outline, build and check run the extract helper on a small module', async t => {
	const helper = await extractHelper();
	const go = findTool('go', goInstallDirs());
	if (!helper || !go) { t.skip('Go is not installed'); return; }
	const root = goModule({ 'a.go': BASIC });
	const listed = await listPackage(go, root, 'a.go', path.join(root, 'list.json'));
	assert.deepEqual(listed, { list: path.join(root, 'list.json'), pkg: 'example.com/m' });
	if (typeof listed === 'string') { return; }
	const target: ExtractTarget = { ...listed, file: path.join(root, 'a.go'), func: 'Report' };
	const outline = await extractOutline(helper, target);
	assert.equal(outline.refused, undefined);
	assert.deepEqual([outline.function.name, outline.function.lines], ['Report', 12]);
	const plan = path.join(root, 'plan.json');
	writeFileSync(plan, JSON.stringify([{ name: 'collectItems', from: 11, to: 14 }]));
	const built = await extractBuild(helper, target, plan, path.join(root, 'out.go'));
	assert.deepEqual(built.problems, []);
	assert.deepEqual(built.helpers?.map(h => [h.name, h.params.map(p => p.name), h.outputs.map(o => o.name), h.returns]),
		[['collectItems', ['items'], ['out'], false]]);
	const out = readFileSync(path.join(root, 'out.go'), 'utf8');
	assert.equal(out, readFileSync(path.join(EXTRACT_DIR, 'testdata/want/basic.go.txt'), 'utf8'));
	writeFileSync(path.join(root, 'before.go'), BASIC);
	writeFileSync(path.join(root, 'build.json'), JSON.stringify(built));
	writeFileSync(target.file, out);
	assert.deepEqual(await extractCheck(helper, target, path.join(root, 'before.go'), path.join(root, 'build.json')), []);
});

test('a package that does not type-check comes back as a refusal, not a crash', async t => {
	const helper = await extractHelper();
	const go = findTool('go', goInstallDirs());
	if (!helper || !go) { t.skip('Go is not installed'); return; }
	const root = goModule({ 'a.go': 'package m\n\nvar x int = "s"\n\nfunc F() int {\n\treturn x\n}\n' });
	const listed = await listPackage(go, root, 'a.go', path.join(root, 'list.json'));
	if (typeof listed === 'string') { assert.fail(listed); }
	const outline = await extractOutline(helper, { ...listed, file: path.join(root, 'a.go'), func: 'F' });
	assert.match(outline.refused ?? '', /^the package does not type-check/);
	assert.deepEqual(outline.blocks, []);
	assert.match(String(await listPackage(go, root, 'missing/a.go', path.join(root, 'list2.json'))), /^`go list` could not load \.\/missing: /);
});
