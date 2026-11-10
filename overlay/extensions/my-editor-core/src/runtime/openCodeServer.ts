import { execFile, spawn, ChildProcess } from 'child_process';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, isAbsolute } from 'path';
import { randomBytes } from 'crypto';
import { promisify } from 'util';
import { privateOpenCodePort, waitOpenCodeReady } from './openCodeStartup';
import { isolatedEnvironment, openCodeConfig, OPENCODE_VERSION, verifyEffectiveConfig } from './openCodeConfig';
import { openCodeRequest } from './openCodeTransport';

export interface OpenCodeServer {
	request(path: string, body?: unknown, signal?: AbortSignal): Promise<any>;
	close(): Promise<void>;
	readonly root: string;
}

/** A private owned process, never the user's OpenCode server or the application directory. */
export async function startOpenCode(binary: string, bridgeUrl: string, secret: string, signal: AbortSignal): Promise<OpenCodeServer> {
	if (!isAbsolute(binary)) { throw new Error('OpenCode executable must be an absolute user-configured path.'); }
	const root = await mkdtemp(join(tmpdir(), `my-editor-opencode-${process.pid}-`));
	const password = randomBytes(24).toString('hex'), config = openCodeConfig(bridgeUrl, secret);
	let child: ChildProcess | undefined, closed = false;
	const close = async () => {
		if (closed) { return; } closed = true;
		if (child?.pid && child.exitCode === null && child.signalCode === null) {
			const ended = new Promise<void>(resolve => child!.once('exit', () => resolve()));
			child.kill('SIGTERM'); const force = setTimeout(() => child?.kill('SIGKILL'), 1000);
			await ended; clearTimeout(force);
		}
		await rm(root, { recursive: true, force: true });
	};
	try {
		for (const directory of ['config', 'data', 'cache', 'state', 'home', 'work']) { await mkdir(join(root, directory), { mode: 0o700 }); }
		const env = isolatedEnvironment(root, config, password, process.env);
		const version = await promisify(execFile)(binary, ['--version'], { cwd: join(root, 'work'), env, timeout: 5000, maxBuffer: 4096, signal });
		if (version.stdout.trim() !== OPENCODE_VERSION) { throw new Error(`OpenCode ${OPENCODE_VERSION} is required; found ${version.stdout.trim()}. No runtime was started.`); }
		const port = await privateOpenCodePort(signal);
		if (signal.aborted) { throw new Error('OpenCode startup stopped.'); }
		// The reservation must be released before native bind. A race fails closed; it never redirects to another server.
		child = spawn(binary, ['serve', '--pure', '--hostname', '127.0.0.1', '--port', String(port)],
			{ cwd: join(root, 'work'), env, stdio: ['ignore', 'pipe', 'pipe'] });
		// Startup reports its own errors; later transport errors surface through the session request.
		child.on('error', () => {});
		const url = await waitOpenCodeReady(child, port, signal);
		const request = async (path: string, body?: unknown, requestSignal = signal): Promise<any> => {
			if (closed) { throw new Error('OpenCode session is closed.'); }
			return openCodeRequest(url, path, password, requestSignal, body);
		};
		const startupSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
		const health = await request('/global/health', undefined, startupSignal);
		if (health.version !== OPENCODE_VERSION || health.healthy !== true) { throw new Error('OpenCode health/version validation failed.'); }
		verifyEffectiveConfig(await request('/config', undefined, startupSignal), config);
		return { request, close, root };
	} catch (error) { await close(); throw error; }
}
