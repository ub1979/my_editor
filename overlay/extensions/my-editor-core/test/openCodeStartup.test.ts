import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { waitOpenCodeReady } from '../src/runtime/openCodeStartup';

function fixture() {
	const process = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
	return { process, child: process as unknown as ChildProcess, abort: new AbortController() };
}
test('OpenCode readiness waits for the complete matching loopback address', async () => {
	const { process, child, abort } = fixture(); let settled = false;
	const ready = waitOpenCodeReady(child, 54321, abort.signal, 1000).then(url => { settled = true; return url; });
	process.stdout.write('opencode server listening on http://127.0.0.1:5');
	await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
	process.stdout.write('4321\n'); assert.equal(await ready, 'http://127.0.0.1:54321');
	assert.equal(process.stdout.listenerCount('data'), 0);
});
test('OpenCode never accepts a different port or external readiness address', async () => {
	for (const address of ['http://127.0.0.1:54322', 'http://remote.example:54321', 'http://127.0.0.1:54321/redirect']) {
		const { process, child, abort } = fixture(); const ready = waitOpenCodeReady(child, 54321, abort.signal, 1000);
		process.stdout.write(`opencode server listening on ${address}\n`);
		await assert.rejects(ready, /unexpected listener/);
	}
});
test('Startup diagnostics identify bounded failure codes without disclosing output or credentials', async () => {
	const { process, child, abort } = fixture(); const ready = waitOpenCodeReady(child, 54321, abort.signal, 20);
	process.stderr.write('fixture-private-secret EADDRINUSE with private context');
	await assert.rejects(ready, error => {
		assert.match(String(error), /timed out \(readiness; elapsed=\d+ms; stdout=0B; stderr=\d+B; EADDRINUSE/);
		assert.doesNotMatch(String(error), /fixture-private-secret|private context/); return true;
	});
});
test('Cancellation and early process exit end readiness without accepting late output', async () => {
	for (const kind of ['cancel', 'exit', 'already-cancelled']) {
		const { process, child, abort } = fixture();
		if (kind === 'already-cancelled') { abort.abort(); }
		const ready = waitOpenCodeReady(child, 54321, abort.signal, 1000);
		if (kind === 'cancel') { abort.abort(); }
		if (kind === 'exit') { process.emit('exit', 7, null); }
		process.stdout.write('opencode server listening on http://127.0.0.1:54321\n');
		await assert.rejects(ready, kind === 'exit' ? /exited during startup \(7;/ : /startup stopped/);
		assert.equal(process.stdout.listenerCount('data'), 0);
	}
});
