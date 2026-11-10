import { strict as assert } from 'node:assert';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { buildGoHelper, goFileInfo } from '../src/aiready/goAst';
import { createGoAdapter, goInstallDirs, goTools, goVersionProblem } from '../src/aiready/goAdapter';
import { findTool, runCommand, runTool, splitCommand } from '../src/aiready/projectCommands';

const MAIN_GO = path.resolve(__dirname, '../../resources/goast/main.go');
const go = findTool('go', goInstallDirs());

/** Fails instead of hanging when a promise does not settle in time. */
function within<T>(ms: number, promise: Promise<T>): Promise<T> {
	return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`still running after ${ms} ms`)), ms).unref())]);
}

function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

/** A node script that ignores SIGTERM and writes its pid, so only SIGKILL ends it. */
function trapScript(dir: string): { script: string; pidFile: string } {
	const script = path.join(dir, 'trap.js');
	const pidFile = path.join(dir, 'pid');
	writeFileSync(script, `process.on('SIGTERM', () => {});\nrequire('fs').writeFileSync(process.argv[2], String(process.pid));\nsetInterval(() => {}, 1000);\n`);
	return { script, pidFile };
}

test('a command that ignores SIGTERM is killed with SIGKILL after the grace period', async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-trap-'));
	const { script, pidFile } = trapScript(dir);
	const command = `node ${script} ${pidFile}`;
	const result = await within(8_000, runCommand(command, { cwd: dir, approved: [command], timeoutMs: 1_000, graceMs: 300, logFile: path.join(dir, 'a.log') }));
	assert.equal(result.code, undefined);
	assert.ok(result.timedOut);
	assert.ok(!alive(Number(readFileSync(pidFile, 'utf8'))));
});

test('runTool also ends a tool that ignores SIGTERM', async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-trap-'));
	const { script, pidFile } = trapScript(dir);
	const result = await within(8_000, runTool(findTool('node')!, [script, pidFile], dir, undefined, { timeoutMs: 1_000, graceMs: 300 }));
	assert.notEqual(result.code, 0);
	assert.ok(!alive(Number(readFileSync(pidFile, 'utf8'))));
});

test('a log that cannot be written does not crash the run, and a given PATH is kept', async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-log-'));
	const script = path.join(dir, 'path.js');
	writeFileSync(script, 'console.log(process.env.PATH);\n');
	const command = `node ${script}`;
	mkdirSync(path.join(dir, 'logs', 'a.log'), { recursive: true });
	const broken = await within(8_000, runCommand(command, { cwd: dir, approved: [command], timeoutMs: 5_000, logFile: path.join(dir, 'logs', 'a.log') }));
	assert.equal(broken.code, 0);
	const kept = await runCommand(command, { cwd: dir, approved: [command], timeoutMs: 5_000, logFile: path.join(dir, 'b.log'), env: { PATH: '/only/this' } });
	assert.equal(kept.stdout.trim(), '/only/this');
});

/** A node script that leaves a sleeping process in its own group holding stdout, prints "done" and exits 0. */
function escapeScript(): { dir: string; script: string; pidFile: string } {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-escape-'));
	const script = path.join(dir, 'escape.js');
	const pidFile = path.join(dir, 'pid');
	writeFileSync(script, "const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], "
		+ `{ detached: true, stdio: 'inherit' }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); c.unref(); console.log('done');\n`);
	return { dir, script, pidFile };
}

function killEscaped(pidFile: string): void {
	try { process.kill(Number(readFileSync(pidFile, 'utf8'))); } catch { /* Gone. */ }
}

test('runCommand ends when the command exits, even if a process it left in another group keeps its output open', async () => {
	const { dir, script, pidFile } = escapeScript();
	const command = `node ${script}`;
	try {
		const result = await within(6_000, runCommand(command, { cwd: dir, approved: [command], timeoutMs: 15_000, logFile: path.join(dir, 'a.log') }));
		assert.equal(result.code, 0);
		assert.equal(result.timedOut, false);
		assert.match(result.stdout, /done/);
	} finally { killEscaped(pidFile); }
});

test('runTool ends when the tool exits, even if a process it left in another group keeps its output open', async () => {
	const { dir, script, pidFile } = escapeScript();
	try {
		const result = await within(6_000, runTool(process.execPath, [script], dir, undefined, { timeoutMs: 15_000 }));
		assert.equal(result.code, 0);
		assert.match(result.stdout, /done/);
	} finally { killEscaped(pidFile); }
});

test('findTool searches only PATH and generic folders unless the caller passes more', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-find-'));
	writeFileSync(path.join(dir, 'my-editor-fake-tool'), '#!/bin/sh\n');
	chmodSync(path.join(dir, 'my-editor-fake-tool'), 0o755);
	assert.equal(findTool('my-editor-fake-tool'), undefined);
	assert.equal(findTool('my-editor-fake-tool', [dir]), path.join(dir, 'my-editor-fake-tool'));
	const source = readFileSync(path.resolve(__dirname, '../../src/aiready/projectCommands.ts'), 'utf8');
	assert.doesNotMatch(source, /'sdk'|usr\/local\/go|'go', 'bin'/);
});

/** A `go` wrapper that logs its environment and arguments, then runs the real Go (or `build` writes junk). */
function fakeGo(dir: string, options: { version?: string; junkBuild?: boolean } = {}): { bin: string; log: string } {
	const bin = path.join(dir, 'go');
	const log = path.join(dir, 'go.log');
	writeFileSync(bin, ['#!/bin/sh', `echo "$GOTOOLCHAIN|$GOFLAGS|$GOPROXY|$GOOS|$1" >> ${log}`,
		...(options.version ? [`if [ "$1" = version ]; then echo "go version ${options.version} fake"; exit 0; fi`] : []),
		...(options.junkBuild ? ['if [ "$1" = build ]; then printf junk > "$3"; chmod +x "$3"; exit 0; fi'] : []),
		`exec ${go} "$@"`, ''].join('\n'));
	chmodSync(bin, 0o755);
	return { bin, log };
}

test('the helper is built for this machine whatever GOOS, GOARCH and GOFLAGS say, keyed by go version, and tried once', async t => {
	if (!go) { t.skip('Go is not installed'); return; }
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-helper-'));
	const saved = { GOOS: process.env.GOOS, GOARCH: process.env.GOARCH, GOFLAGS: process.env.GOFLAGS };
	Object.assign(process.env, { GOOS: 'windows', GOARCH: 'amd64', GOFLAGS: '-mod=vendor' });
	try {
		const helper = await buildGoHelper(MAIN_GO, path.join(dir, 'storage'), 'test', go);
		writeFileSync(path.join(dir, 'a.go'), 'package a\n');
		assert.equal((await goFileInfo(helper, path.join(dir, 'a.go'))).package, 'a');
		const other = fakeGo(mkdtempSync(path.join(dir, 'v-')), { version: 'go9.9' });
		assert.notEqual(await buildGoHelper(MAIN_GO, path.join(dir, 'storage'), 'test', other.bin), helper);
		const junk = fakeGo(mkdtempSync(path.join(dir, 'j-')), { version: 'go9.8', junkBuild: true });
		await assert.rejects(buildGoHelper(MAIN_GO, path.join(dir, 'storage'), 'test', junk.bin), /helper/);
		assert.equal(await buildGoHelper(MAIN_GO, path.join(dir, 'storage'), 'test', go), helper);
		assert.match(readFileSync(other.log, 'utf8'), /^local\|\|[^|]*\|\|build$/m);
	} finally {
		for (const [key, value] of Object.entries(saved)) { if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; } }
	}
});

test('every go call runs with GOTOOLCHAIN=local and no GOFLAGS; read-only ones with GOPROXY=off', async t => {
	if (!go) { t.skip('Go is not installed'); return; }
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-goenv-'));
	writeFileSync(path.join(dir, 'go.mod'), 'module example.com/a\n\ngo 1.22\n');
	writeFileSync(path.join(dir, 'a.go'), 'package a\n\nimport "fmt"\n\nfunc A() string { return fmt.Sprint(1) }\n');
	const tools = await goTools(MAIN_GO, path.join(os.tmpdir(), 'my-editor-goast-cache'), 'test');
	assert.equal(typeof tools, 'object', String(tools));
	const fake = fakeGo(mkdtempSync(path.join(dir, 'f-')));
	const saved = process.env.GOFLAGS;
	process.env.GOFLAGS = '-mod=mod';
	try {
		const adapter = createGoAdapter(dir, { ...(tools as Exclude<typeof tools, string>), go: fake.bin }, ['go.mod', 'a.go']);
		assert.deepEqual((await adapter.parse('a.go')).declarations[0].uses, ['fmt']);
		assert.deepEqual(await adapter.unitFiles('a.go'), ['a.go']);
		assert.deepEqual(adapter.commandEnv, { GOTOOLCHAIN: 'local', GOFLAGS: '' });
	} finally {
		if (saved === undefined) { delete process.env.GOFLAGS; } else { process.env.GOFLAGS = saved; }
	}
	const lines = readFileSync(fake.log, 'utf8').trim().split('\n');
	assert.ok(lines.length >= 2);
	for (const line of lines) { assert.match(line, /^local\|\|off\|[^|]*\|list$/); }
});

test('a go.mod that needs a newer Go than installed stops with a plain message', async t => {
	if (!go) { t.skip('Go is not installed'); return; }
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-gonewer-'));
	writeFileSync(path.join(dir, 'go.mod'), 'module example.com/a\n\ngo 1.99\n');
	assert.match(await goVersionProblem(go, dir) ?? '', /needs Go 1\.99 or newer, but the installed Go is go1\.\d+/);
	writeFileSync(path.join(dir, 'go.mod'), 'module example.com/a\n\ngo 1.21\n');
	assert.equal(await goVersionProblem(go, dir), undefined);
	assert.ok(!existsSync(path.join(dir, 'go.sum')));
});

test('the Go checks also build the changed package on its own, writing no binary', () => {
	const tools = { go: 'go', helper: '', platforms: { os: new Set<string>(), arch: new Set<string>() } };
	const adapter = createGoAdapter('/nowhere', tools, []);
	const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
	for (const check of adapter.checks('a.go')) { assert.ok(splitCommand(check.command), check.command); }
	assert.deepEqual(adapter.checks('internal/store/a.go'), [
		{ label: 'build', command: 'go build ./...' },
		{ label: 'build', command: `go build -o ${nul} ./internal/store`, verifies: true },
		{ label: 'vet', command: 'go vet ./internal/store', verifies: true },
		{ label: 'test', command: 'go test -count=1 -json ./internal/store' },
	]);
	assert.equal(adapter.checks('a.go')[1].command, `go build -o ${nul} .`);
});

test('failed Go package discovery reports the cause instead of pretending no source files exist', async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-go-list-failure-'));
	const bin = path.join(dir, 'go');
	writeFileSync(bin, '#!/bin/sh\necho "build cache is not writable" >&2\nexit 1\n');
	chmodSync(bin, 0o755);
	const adapter = createGoAdapter(dir, { go: bin, helper: '', platforms: { os: new Set(), arch: new Set() } }, []);
	await assert.rejects(adapter.unitFiles('a.go'), /Could not list the Go package.*build cache is not writable/);
});

test('a log folder that cannot be created is a failed result, and a short timeout is not rounded to 0 s', async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-nolog-'));
	writeFileSync(path.join(dir, 'file'), '');
	const command = `${process.execPath} -v`;
	const failed = await runCommand(command, { cwd: dir, approved: [command], timeoutMs: 5_000, logFile: path.join(dir, 'file', 'logs', 'a.log') });
	assert.equal(failed.code, undefined);
	assert.match(failed.error ?? '', /log/i);
	const slow = await runTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], dir, undefined, { timeoutMs: 300, graceMs: 100 });
	assert.match(slow.stderr, /timed out after 300 ms\./);
	assert.doesNotMatch(slow.stderr, /after 0 s/);
});

test('go list -e package errors are failures even when the process exits zero', async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-go-list-hidden-error-'));
	const bin = path.join(dir, 'go');
	writeFileSync(bin, '#!/bin/sh\n' + "printf '%s' '{\"Error\":{\"Err\":\"build cache access denied\"}}'\n");
	chmodSync(bin, 0o755);
	const adapter = createGoAdapter(dir, { go: bin, helper: '', platforms: { os: new Set(), arch: new Set() } }, []);
	await assert.rejects(adapter.unitFiles('a.go'), /Could not list the Go package.*build cache access denied/);
});
