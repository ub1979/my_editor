import { request } from 'http';

/** Native turns may take longer than fetch's five-minute response-header timeout.
 * The owning turn's AbortSignal supplies the deadline and cancellation instead.
 * Never retry a POST: it may already have started model work.
 */
export function openCodeRequest(url: string, path: string, password: string, signal: AbortSignal, body?: unknown): Promise<any> {
	const target = new URL(url + path);
	if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') { throw new Error('OpenCode transport requires its private loopback listener.'); }
	return new Promise((resolve, reject) => {
		const operation = path.split('/')[1] || 'runtime';
		const fail = (error: NodeJS.ErrnoException) => {
			const code = ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ABORT_ERR'].includes(error.code ?? '') ? ` (${error.code})` : '';
			reject(new Error(signal.aborted ? 'OpenCode request stopped or reached its turn deadline.'
				: `OpenCode ${operation} connection failed${code}. Retry this request to start a fresh session.`));
		};
		const req = request(target, { method: body === undefined ? 'GET' : 'POST', signal, agent: false,
			headers: { Authorization: 'Basic ' + Buffer.from(`my_editor:${password}`).toString('base64'), 'content-type': 'application/json' } }, res => {
			const chunks: Buffer[] = []; let size = 0;
			res.on('error', fail);
			res.on('data', (chunk: Buffer) => {
				size += chunk.length;
				if (size > 16 * 1024 * 1024) { res.destroy(new Error('Response exceeded the host limit.')); return; }
				chunks.push(chunk);
			});
			res.on('end', () => {
				if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
					reject(new Error(`OpenCode ${operation} request failed (${res.statusCode}).`)); return;
				}
				try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
				catch { reject(new Error(`OpenCode ${operation} returned an invalid response.`)); }
			});
		});
		req.on('error', fail);
		req.end(body === undefined ? undefined : JSON.stringify(body));
	});
}
