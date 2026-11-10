import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { openCodeRequest } from '../src/runtime/openCodeTransport';

test('OpenCode transport handles delayed responses, cancellation and disconnects without replaying a turn', async () => {
	let posts = 0;
	let started!: () => void;
	const pending = new Promise<void>(resolve => { started = resolve; });
	const server = createServer((req, res) => {
		posts++;
		assert.equal(req.method, 'POST');
		assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('my_editor:fixture').toString('base64'));
		req.resume();
		if (req.url === '/session/disconnected') { req.socket.destroy(); }
		else if (req.url === '/session/cancelled') { started(); }
		else { setTimeout(() => res.end('{"info":{"completed":true}}'), 30); }
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const url = `http://127.0.0.1:${address.port}`;
	const abort = new AbortController();
	try {
		const deadline = AbortSignal.timeout(3000);
		assert.deepEqual(await openCodeRequest(url, '/session/slow', 'fixture', deadline, {}), { info: { completed: true } });
		await assert.rejects(openCodeRequest(url, '/session/disconnected', 'fixture', deadline, {}), /OpenCode session connection failed \(ECONNRESET\)/);
		const stopped = assert.rejects(openCodeRequest(url, '/session/cancelled', 'fixture', AbortSignal.any([deadline, abort.signal]), {}), /OpenCode request stopped/);
		await Promise.race([pending, stopped]);
		abort.abort();
		await stopped;
		assert.equal(posts, 3);
	} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
