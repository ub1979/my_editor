import { ChildProcess } from 'child_process';
import { createServer } from 'net';

/** OpenCode 1.19.3 treats --port 0 as “try 4096 first”. Select a private port ourselves. */
export async function privateOpenCodePort(signal: AbortSignal): Promise<number> {
	if (signal.aborted) { throw new Error('OpenCode startup stopped.'); }
	const reservation = createServer();
	try {
		return await new Promise<number>((resolve, reject) => {
			const abort = () => { reservation.close(); reject(new Error('OpenCode startup stopped.')); };
			signal.addEventListener('abort', abort, { once: true });
			reservation.once('error', reject);
			reservation.once('close', () => signal.removeEventListener('abort', abort));
			reservation.listen(0, '127.0.0.1', () => {
				const address = reservation.address();
				if (!address || typeof address === 'string') { reject(new Error('Could not reserve an OpenCode loopback port.')); return; }
				reservation.close(error => error ? reject(error) : resolve(address.port));
			});
		});
	} finally { if (reservation.listening) { reservation.close(); } }
}

/** Complete, exact readiness line only. Never expose runtime output, credentials or context in errors. */
export function waitOpenCodeReady(child: ChildProcess, port: number, signal: AbortSignal, timeoutMs = 15000): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = '', stdoutBytes = 0, stderrBytes = 0, failureCode = '', settled = false;
		const started = Date.now();
		const done = (error?: Error, value?: string) => {
			if (settled) { return; } settled = true;
			clearTimeout(timer); signal.removeEventListener('abort', abort);
			child.removeListener('error', onError); child.removeListener('exit', onExit);
			child.stdout?.removeListener('data', stdout); child.stderr?.removeListener('data', stderr);
			// Keep pipes drained after readiness; never accumulate or persist raw diagnostics.
			child.stdout?.resume(); child.stderr?.resume();
			error ? reject(error) : resolve(value!);
		};
		const summary = () => `readiness; elapsed=${Date.now() - started}ms; stdout=${stdoutBytes}B; stderr=${stderrBytes}B${failureCode ? '; ' + failureCode : ''}`;
		const abort = () => done(new Error('OpenCode startup stopped.'));
		const onError = (error: Error) => done(error);
		const onExit = (code: number | null, sig: string | null) => done(new Error(`OpenCode exited during startup (${code ?? sig}; ${summary()}).`));
		const stdout = (chunk: Buffer) => {
			stdoutBytes += chunk.length; output = (output + chunk.toString()).slice(-8192);
			const lines = output.split('\n'); output = lines.pop()!;
			for (const line of lines) {
				if (!line.startsWith('opencode server listening on ')) { continue; }
				const expected = `http://127.0.0.1:${port}`;
				if (line.trim() !== `opencode server listening on ${expected}`) { done(new Error('OpenCode announced an unexpected listener.')); return; }
				done(undefined, expected); return;
			}
		};
		const stderr = (chunk: Buffer) => {
			stderrBytes += chunk.length;
			const code = /\b(EADDRINUSE|EACCES|ENOMEM|EMFILE|ENFILE)\b/.exec(chunk.toString());
			if (code) { failureCode = code[1]; }
		};
		const timer = setTimeout(() => done(new Error(`OpenCode startup timed out (${summary()}).`)), timeoutMs);
		child.once('error', onError); child.once('exit', onExit);
		child.stdout!.on('data', stdout); child.stderr!.on('data', stderr);
		signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) { abort(); }
	});
}
