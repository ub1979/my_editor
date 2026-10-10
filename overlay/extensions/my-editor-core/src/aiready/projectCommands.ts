import { ChildProcess, spawn } from 'child_process';
import { accessSync, constants, createWriteStream, mkdirSync } from 'fs';
import * as path from 'path';

/** A cancellation token; `vscode.CancellationToken` fits. */
export interface Cancel {
	readonly isCancellationRequested: boolean;
	onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface CommandOutput {
	/** Undefined when the command could not start, timed out or was stopped. */
	readonly code: number | undefined;
	readonly stdout: string;
	/** Stdout and stderr together, interleaved as they arrived. */
	readonly output: string;
	readonly timedOut: boolean;
	readonly error?: string;
}

const SHELL_CHARACTERS = /[;&|<>`$(){}[\]*?!~"'\\\n]/;
const MAX_OUTPUT = 64 * 1024 * 1024;
/** How long a stopped process group gets between SIGTERM and SIGKILL. */
const GRACE_MS = 5_000;
/** How long output may still arrive after the command exits, before its pipes are closed. */
const EXIT_GRACE_MS = 1_000;

/**
 * Finds a tool without a shell: PATH first, then the usual install folders, because apps started from the Dock get a
 * shorter PATH than the user's terminal. Language adapters pass their own install folders; `firstPath` (a command env's
 * PATH) is searched before the process's.
 */
export function findTool(name: string, extraDirs: readonly string[] = [], firstPath = ''): string | undefined {
	const dirs = [...`${firstPath}${path.delimiter}${process.env.PATH ?? ''}`.split(path.delimiter).filter(Boolean), '/opt/homebrew/bin', '/usr/local/bin',
		'/usr/bin', ...extraDirs];
	return dirs.map(dir => path.join(dir, name)).find(file => {
		try { accessSync(file, constants.X_OK); return true; } catch { return false; }
	});
}

/** An approved command line as program and arguments; undefined when it has anything a shell would interpret. */
export function splitCommand(text: string): { bin: string; args: string[] } | undefined {
	if (SHELL_CHARACTERS.test(text)) { return undefined; }
	const [bin, ...args] = text.trim().split(/\s+/);
	return bin ? { bin, args } : undefined;
}

export interface RunOptions {
	readonly cwd: string;
	/** The exact command lines the user approved; anything else is refused. */
	readonly approved: readonly string[];
	readonly timeoutMs: number;
	/** The full output is written here. */
	readonly logFile: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly cancel?: Cancel;
	/** Between SIGTERM and SIGKILL when stopped; about 5 s by default. */
	readonly graceMs?: number;
}

/** Stops a detached child and everything it started: SIGTERM to its process group, then SIGKILL after the grace period. */
function stopper(child: ChildProcess, graceMs: number): () => void {
	let stopping = false;
	const signal = (name: NodeJS.Signals) => {
		try { process.kill(-child.pid!, name); } catch { try { child.kill(name); } catch { /* Already gone. */ } }
	};
	return () => {
		if (stopping || child.pid === undefined) { return; }
		stopping = true;
		signal('SIGTERM');
		setTimeout(() => signal('SIGKILL'), graceMs).unref();
	};
}

/**
 * A process the child left in another process group (Go's telemetry child, say) can hold the pipes open for many
 * minutes after the child exits, so 'close' would not come: shortly after the exit, close the pipes and finish.
 */
function endAfterExit(child: ChildProcess, finish: (code: number | null) => void): void {
	child.on('exit', code => setTimeout(() => {
		child.stdout?.destroy();
		child.stderr?.destroy();
		finish(code);
	}, EXIT_GRACE_MS));
}

/** Runs one approved command without a shell, in its own process group so Stop and the timeout end its children too. */
export function runCommand(text: string, options: RunOptions): Promise<CommandOutput> {
	const parts = splitCommand(text);
	if (!options.approved.includes(text) || !parts) {
		return Promise.resolve({ code: undefined, stdout: '', output: '', timedOut: false, error: `Refused a command that was not approved: ${text}` });
	}
	const bin = path.isAbsolute(parts.bin) ? parts.bin : findTool(parts.bin, [], options.env?.PATH);
	if (!bin) { return Promise.resolve({ code: undefined, stdout: '', output: '', timedOut: false, error: `${parts.bin} was not found.` }); }
	try { mkdirSync(path.dirname(options.logFile), { recursive: true }); }
	catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return Promise.resolve({ code: undefined, stdout: '', output: '', timedOut: false, error: `Could not create the log folder: ${message}` });
	}
	const log = createWriteStream(options.logFile);
	// A log that cannot be written must not crash the extension host; the run goes on without it.
	let logFailed = false;
	let settle: (() => void) | undefined;
	log.on('error', () => { logFailed = true; settle?.(); });
	log.write(`$ ${text}\n# in ${options.cwd}\n`);
	return new Promise(resolve => {
		const child = spawn(bin, parts.args, {
			cwd: options.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, ...options.env, PATH: options.env?.PATH ?? `${path.dirname(bin)}${path.delimiter}${process.env.PATH ?? ''}` },
		});
		const stdout: Buffer[] = [];
		const output: Buffer[] = [];
		let size = 0;
		let timedOut = false;
		let ended = false;
		const kill = stopper(child, options.graceMs ?? GRACE_MS);
		const keep = (into: Buffer[]) => (chunk: Buffer) => {
			if (!logFailed) { log.write(chunk); }
			size += chunk.length;
			if (size > MAX_OUTPUT) { kill(); return; }
			into.push(chunk);
			output.push(chunk);
		};
		child.stdout.on('data', keep(stdout));
		child.stderr.on('data', keep([]));
		const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
		const cancelled = options.cancel?.onCancellationRequested(kill);
		const finish = (code: number | undefined, error?: string) => {
			if (ended) { return; }
			ended = true;
			clearTimeout(timer);
			cancelled?.dispose();
			const stopped = timedOut || options.cancel?.isCancellationRequested || size > MAX_OUTPUT;
			const result = {
				code: stopped ? undefined : code, stdout: Buffer.concat(stdout).toString('utf8'), output: Buffer.concat(output).toString('utf8'),
				timedOut, error,
			};
			// Resolve once the log is on disk, so it is complete when the result is read.
			let resolved = false;
			settle = () => { if (!resolved) { resolved = true; resolve(result); } };
			if (logFailed) { settle(); return; }
			log.end(`\n# exit ${code ?? (timedOut ? 'timeout' : 'stopped')}\n`, settle);
		};
		child.on('error', error => finish(undefined, `Could not start ${parts.bin}: ${error.message}`));
		child.on('close', code => finish(code ?? undefined));
		endAfterExit(child, code => finish(code ?? undefined));
	});
}

/** The last lines of a command's output, for Pair. */
export function tail(output: string, lines = 20): string {
	return output.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

export interface ToolLimits {
	/** Default 2 minutes. */
	readonly timeoutMs?: number;
	readonly graceMs?: number;
}

/**
 * Runs a read-only tool (git, go list, gofmt -l, the parser helper) and returns its output. Like `runCommand`, it runs
 * in its own process group, so a timeout ends its children too.
 */
export function runTool(bin: string, args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv, limits: ToolLimits = {}):
	Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise(resolve => {
		const child = spawn(bin, [...args], { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
		const stop = stopper(child, limits.graceMs ?? GRACE_MS);
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let size = 0;
		let failure = '';
		const keep = (into: Buffer[]) => (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_OUTPUT) { failure ||= `${path.basename(bin)} printed too much output.`; stop(); return; }
			into.push(chunk);
		};
		child.stdout!.on('data', keep(stdout));
		child.stderr!.on('data', keep(stderr));
		const timeoutMs = limits.timeoutMs ?? 120_000;
		const after = timeoutMs < 1000 ? `${timeoutMs} ms` : `${Math.round(timeoutMs / 1000)} s`;
		const timer = setTimeout(() => { failure ||= `${path.basename(bin)} timed out after ${after}.`; stop(); }, timeoutMs);
		let ended = false;
		const finish = (code: number, error = '') => {
			if (ended) { return; }
			ended = true;
			clearTimeout(timer);
			const err = Buffer.concat(stderr).toString('utf8');
			resolve({
				code: failure && code === 0 ? 1 : code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: [err, failure, error].filter(Boolean).join('\n'),
			});
		};
		child.on('error', error => finish(1, error.message));
		child.on('close', code => finish(code ?? 1));
		endAfterExit(child, code => finish(code ?? 1));
	});
}
