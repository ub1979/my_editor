import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const runner = resolve(__dirname, '../../media/test-runner.cjs');

async function run(source: string, timeout = 3000) {
	const root = mkdtempSync(join(tmpdir(), 'my-editor-test-output-'));
	const log = join(root, 'logs', 'run.log');
	try {
		const result = await new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
			execFile(process.execPath, [runner, log, String(timeout), process.execPath, '-e', source],
				{ timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
					resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
				});
		});
		return { ...result, log: readFileSync(log, 'utf8') };
	} finally { rmSync(root, { recursive: true, force: true }); }
}

test('test runner preserves failing exit code and both output streams for QA', async () => {
	const result = await run('console.log("test started"); console.error("expected 42, received 7"); process.exitCode = 3;');
	assert.equal(result.code, 3);
	assert.match(result.stdout, /test started/); assert.match(result.stderr, /expected 42/);
	assert.match(result.log, /test started/); assert.match(result.log, /expected 42, received 7/);
});

test('test runner bounds diagnostics while retaining the first failure and final summary', async () => {
	const result = await run('process.stdout.write("FIRST FAILURE\\n" + "x".repeat(100000) + "\\nFINAL SUMMARY");');
	assert.equal(result.code, 0);
	assert.ok(result.log.length < 65000);
	assert.ok(result.log.startsWith('FIRST FAILURE')); assert.ok(result.log.endsWith('FINAL SUMMARY'));
	assert.match(result.log, /Middle of test output omitted/);
});

test('test runner times out a hanging test without reporting a passing result', async () => {
	const result = await run('setInterval(() => {}, 1000);', 100);
	assert.equal(result.code, 124); assert.match(result.log, /timed out/);
});
