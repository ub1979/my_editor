import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { goInstallDirs } from '../src/aiready/goAdapter';
import { buildGoTool } from '../src/aiready/goBuildTool';
import { findTool } from '../src/aiready/projectCommands';

const main = (word: string) => `package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("${word}") }\n`;

test('a Go helper is built once from its folder and rebuilt when a source changes', async t => {
	const go = findTool('go', goInstallDirs());
	if (!go) { t.skip('Go is not installed'); return; }
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-gotool-src-'));
	const storage = mkdtempSync(path.join(os.tmpdir(), 'my-editor-gotool-store-'));
	writeFileSync(path.join(dir, 'go.mod'), 'module example.com/tool\n\ngo 1.22\n');
	writeFileSync(path.join(dir, 'main.go'), main('v1'));
	let probes = 0;
	const probe = async (binary: string) => { probes++; return execFileSync(binary).toString().length > 0; };
	const first = await buildGoTool(dir, 'tool', storage, '1.0', go, probe);
	assert.equal(await buildGoTool(dir, 'tool', storage, '1.0', go, probe), first);
	assert.equal(probes, 1);
	assert.equal(path.basename(first), 'tool');
	assert.equal(execFileSync(first).toString(), 'v1\n');
	writeFileSync(path.join(dir, 'main.go'), main('v2'));
	const second = await buildGoTool(dir, 'tool', storage, '1.0', go, probe);
	assert.notEqual(second, first);
	assert.equal(execFileSync(second).toString(), 'v2\n');
	writeFileSync(path.join(dir, 'main_test.go'), 'package main\n');
	assert.equal(await buildGoTool(dir, 'tool', storage, '1.0', go, probe), second);
	await assert.rejects(buildGoTool(dir, 'tool', storage, '1.1', go, async () => false), /The Go helper `tool` was built but does not run\./);
});

test('a failed build is not retried in this session, and leaves no empty folder behind', async t => {
	const go = findTool('go', goInstallDirs());
	if (!go) { t.skip('Go is not installed'); return; }
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-gotool-src-'));
	const storage = mkdtempSync(path.join(os.tmpdir(), 'my-editor-gotool-store-'));
	writeFileSync(path.join(dir, 'go.mod'), 'module example.com/tool\n\ngo 1.22\n');
	writeFileSync(path.join(dir, 'main.go'), main('v1'));
	let probes = 0;
	const broken = async () => { probes++; return false; };
	await assert.rejects(buildGoTool(dir, 'tool', storage, 'neg-1', go, broken), /was built but does not run/);
	await assert.rejects(buildGoTool(dir, 'tool', storage, 'neg-1', go, broken), /was built but does not run/);
	assert.equal(probes, 1, 'the failure is remembered for this version and these sources');
	assert.deepEqual(readdirSync(path.join(storage, 'tool')), [], 'no empty hash folder');
	writeFileSync(path.join(dir, 'main.go'), 'package main\n\nfunc main() {\n');
	await assert.rejects(buildGoTool(dir, 'tool', storage, 'neg-1', go, broken), /Could not build the Go helper `tool`/);
	assert.deepEqual(readdirSync(path.join(storage, 'tool')), []);
	writeFileSync(path.join(dir, 'main.go'), main('v2'));
	const fixed = await buildGoTool(dir, 'tool', storage, 'neg-1', go, async () => true);
	assert.ok(existsSync(fixed), 'other sources build again');
});
