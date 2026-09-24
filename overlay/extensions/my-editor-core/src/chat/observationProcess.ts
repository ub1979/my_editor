import { spawn } from 'child_process';
import { redact } from '../records/redact';
import { ObservationCheck } from './observationProfile';

const MAX_CAPTURE = 160_000;
const MAX_CONTEXT = 12_000;

export interface ObservationResult {
	readonly status: 'completed' | 'failed' | 'timed_out' | 'stopped';
	readonly output: string;
}

/** Keep inherited API credentials out of project-authored subprocesses. */
function processEnvironment(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0' };
	for (const key of ['HOME', 'USER', 'PATH', 'LANG', 'LC_ALL', 'SSH_AUTH_SOCK']) {
		if (process.env[key]) { env[key] = process.env[key]; }
	}
	return env;
}

export function redactObservation(output: string): string {
	return redact(output)
		.replace(/((?:authorization|admin[_-]?key|password|secret|token)\s*[:=]\s*)[^\s"']+/gi, '$1[REDACTED]')
		.replace(/(?<![0-9])\+?[2-9][0-9]{9,14}(?![0-9])/g, '[PHONE]');
}

/** Runs only a previously approved, fixed recipe. The model never supplies command arguments. */
export function runObservationProcess(check: ObservationCheck, cwd: string, signal?: AbortSignal): Promise<ObservationResult> {
	return new Promise(resolve => {
		if (signal?.aborted) { resolve({ status: 'stopped', output: '' }); return; }
		const child = spawn(check.command, [...check.args], {
			cwd, env: processEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], shell: false,
		});
		let captured = '';
		let ended = false;
		let timedOut = false;
		let overLimit = false;
		let failedToStart = '';
		const append = (chunk: Buffer) => {
			if (captured.length < MAX_CAPTURE) { captured += chunk.toString('utf8').slice(0, MAX_CAPTURE - captured.length); }
			else { overLimit = true; child.kill('SIGTERM'); }
		};
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		child.on('error', error => { failedToStart = error.message; });
		let forceKill: NodeJS.Timeout | undefined;
		const stop = () => {
			if (ended || forceKill) { return; }
			child.kill('SIGTERM');
			forceKill = setTimeout(() => child.kill('SIGKILL'), 2_000);
		};
		signal?.addEventListener('abort', stop, { once: true });
		const timer = setTimeout(() => { timedOut = true; stop(); }, check.timeoutSeconds * 1_000);
		child.on('close', code => {
			if (ended) { return; }
			ended = true;
			clearTimeout(timer);
			if (forceKill) { clearTimeout(forceKill); }
			signal?.removeEventListener('abort', stop);
			const status = signal?.aborted ? 'stopped' : timedOut ? 'timed_out' : code === 0 && !overLimit && !failedToStart ? 'completed' : 'failed';
			const text = redactObservation(failedToStart || captured);
			resolve({ status, output: `${text.slice(0, MAX_CONTEXT)}${text.length > MAX_CONTEXT || overLimit ? '\n[Observation output limited]' : ''}` });
		});
		child.stdin.on('error', () => undefined);
		child.stdin.end(check.stdin ?? '');
	});
}
