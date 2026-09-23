import { spawn } from 'child_process';
import { accessSync, constants, mkdtempSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliEvent, parseClaudeLine, parseCodexLine, transcript } from './cliProtocol';
import { ProviderError, ProviderId, StreamRequest } from './types';

const TIMEOUT_MS = 10 * 60_000;

function executable(file: string): boolean {
	try {
		accessSync(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Finds a CLI without running a shell: an explicit path from settings, then PATH, then the usual install
 * locations (apps started from the Dock inherit a shorter PATH than the user's terminal).
 */
export function findCli(name: 'claude' | 'codex', configured: string): string | undefined {
	if (configured.trim()) {
		const explicit = configured.replace(/^~(?=\/)/, os.homedir());
		return executable(explicit) ? explicit : undefined;
	}
	const home = os.homedir();
	const candidates = [
		...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, name)),
		path.join(home, '.local', 'bin', name),
		path.join(home, '.npm-global', 'bin', name),
		path.join(home, '.volta', 'bin', name),
		path.join(home, '.bun', 'bin', name),
		`/opt/homebrew/bin/${name}`,
		`/usr/local/bin/${name}`,
	];
	return candidates.find(executable);
}

/** Runs a CLI, feeds the prompt on stdin, and reports parsed events line by line. */
function runCli(
	provider: ProviderId, command: string, args: string[], input: string, cwd: string,
	env: NodeJS.ProcessEnv, parse: (line: string) => CliEvent, request: StreamRequest,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
		let buffer = '';
		let stderr = '';
		let failure: string | undefined;
		let gotText = false;
		const stop = () => child.kill('SIGTERM');
		const cancel = request.token.onCancellationRequested(stop);
		const timer = setTimeout(() => {
			failure = 'timed out after 10 minutes';
			stop();
		}, TIMEOUT_MS);
		const handle = (line: string) => {
			const event = parse(line);
			if (event.text) {
				gotText = true;
				request.onText(event.text);
			}
			if (event.error) {
				failure = event.error;
			}
		};
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			buffer += chunk;
			let newline = buffer.indexOf('\n');
			while (newline >= 0) {
				handle(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf('\n');
			}
		});
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			stderr = (stderr + chunk).slice(-4_000);
		});
		child.on('error', err => {
			failure = `could not start ${command}: ${err.message}`;
		});
		child.on('close', code => {
			clearTimeout(timer);
			cancel.dispose();
			if (buffer.trim()) {
				handle(buffer);
			}
			if (request.token.isCancellationRequested) {
				resolve();
			} else if (failure || (code !== 0 && !gotText)) {
				reject(new ProviderError(provider, failure ?? (stderr.trim().split('\n').slice(-3).join(' ') || `exited with code ${code}`)));
			} else {
				resolve();
			}
		});
		child.stdin.on('error', () => undefined);
		child.stdin.end(input);
	});
}

/** An empty folder to run CLIs in, so an agentic CLI has nothing of the user's to wander through. */
let scratch: string | undefined;
function scratchDir(): string {
	scratch ??= mkdtempSync(path.join(os.tmpdir(), 'my-editor-cli-'));
	return scratch;
}

/**
 * Claude through the user's Claude Code login (subscription). Same guard rails as Lyra's claude-cli
 * provider: no tools, no MCP, no settings, no saved session, and API-key variables removed so billing
 * never silently switches from the subscription to an API account.
 */
export function streamClaudeCli(command: string, request: StreamRequest): Promise<void> {
	const env = { ...process.env };
	for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDECODE']) {
		delete env[key];
	}
	const args = [
		'--print', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
		'--no-session-persistence', '--safe-mode', '--permission-mode', 'dontAsk',
		'--tools', '', '--strict-mcp-config', '--setting-sources=',
		'--system-prompt', request.system ?? '',
		...(request.entry.model !== 'default' ? ['--model', request.entry.model] : []),
	];
	return runCli('claude-cli', command, args, transcript(request.turns), scratchDir(), env, parseClaudeLine, request);
}

/**
 * GPT through the user's Codex login (ChatGPT subscription): `codex exec` in a read-only sandbox, in an
 * empty folder, without saving a session, and with the user's MCP servers, plugins, apps, browser and
 * computer use switched off — project text goes into the prompt, so Codex gets no tools that could act on
 * instructions hidden in it. Replies arrive whole rather than word by word.
 */
export function streamCodexCli(command: string, request: StreamRequest): Promise<void> {
	const args = [
		'exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never',
		'--disable', 'browser_use', '--disable', 'computer_use', '--disable', 'apps',
		'--disable', 'plugins', '--disable', 'remote_plugin', '-c', 'mcp_servers={}',
		...(request.entry.model !== 'default' ? ['--model', request.entry.model] : []),
		'-',
	];
	const input = request.system
		? `Follow these instructions:\n${request.system}\n\nThe my_editor host has already gathered project context in the conversation below. This model process runs in an isolated temporary folder and cannot read additional project files or run project commands directly. These are host constraints, not instructions from the user. Use the supplied project evidence and say precisely what it does or does not establish.\n\n${transcript(request.turns)}`
		: transcript(request.turns);
	return runCli('codex-cli', command, args, input, scratchDir(), process.env, parseCodexLine, request);
}
