import { spawn } from 'child_process';
import { accessSync, constants, realpathSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EXCLUDE_GLOB } from '../brain/brain';
import { elidesCode } from '../pair/codeBlock';
import { changeContext } from '../project/gitHistory';
import { redact } from '../records/redact';
import { isSensitiveFile } from '../records/sensitive';
import { safeRelativePath, testSpec } from './agentProtocol';
import { Proposals } from './proposals';

const MAX_READ_BYTES = 400_000;
const MAX_READ_LINES = 160;
const MAX_SEARCH_FILES = 1_500;

export interface ToolResult {
	readonly text: string;
	readonly proposalId?: string;
}

/** Workspace tools shared by every model provider. No model process receives workspace access directly. */
export class AgentTools {
	private testsRun = 0;
	constructor(private readonly proposals: Proposals, private readonly token: vscode.CancellationToken) {}

	async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
		if (this.token.isCancellationRequested) { return { text: 'Stopped.' }; }
		try {
			switch (name) {
				case 'list_files': return { text: await this.listFiles(args.glob) };
				case 'search': return { text: await this.search(args.query) };
				case 'read_file': return { text: await this.readFile(args.path, args.start, args.lines) };
				case 'git_history': return { text: (await changeContext(typeof args.question === 'string' ? args.question.slice(0, 300) : '', undefined, true)).slice(0, 10_000) };
				case 'run_tests': return { text: await this.runTests(args.command) };
				case 'propose_file': return this.proposeFile(args.path, args.content);
				default: return { text: `Unknown tool: ${name}. Choose a tool from the system instructions.` };
			}
		} catch (error) {
			return { text: `Tool error: ${error instanceof Error ? error.message : String(error)}` };
		}
	}

	private workspace(): vscode.WorkspaceFolder {
		const root = vscode.workspace.workspaceFolders?.[0];
		if (!root || root.uri.scheme !== 'file') { throw new Error('Open a local project folder to use project tools.'); }
		return root;
	}

	private file(value: unknown, creating = false): { uri: vscode.Uri; relative: string } {
		const relative = safeRelativePath(value);
		if (!relative || isSensitiveFile(relative)) { throw new Error('Use a non-sensitive path relative to the open project.'); }
		const root = this.workspace().uri.fsPath;
		const target = path.resolve(root, relative);
		const boundary = realpathSync(root);
		const existing = creating ? path.dirname(target) : target;
		let resolved: string;
		try { resolved = realpathSync(existing); }
		catch { throw new Error(creating ? 'The parent directory must already exist.' : 'That file does not exist.'); }
		if (resolved !== boundary && !resolved.startsWith(boundary + path.sep)) { throw new Error('Path is outside the project.'); }
		return { uri: vscode.Uri.file(target), relative };
	}

	private async listFiles(glob: unknown): Promise<string> {
		const pattern = typeof glob === 'string' && glob.length <= 120 && !glob.includes('..') && !glob.startsWith('/') ? glob : '**/*';
		const files = await vscode.workspace.findFiles(pattern, EXCLUDE_GLOB, 300);
		const root = this.workspace().uri.fsPath;
		const visible = files.filter(uri => uri.fsPath.startsWith(root + path.sep))
			.map(uri => path.relative(root, uri.fsPath).split(path.sep).join('/'))
			.filter(file => safeRelativePath(file) && !isSensitiveFile(file));
		return visible.length ? `Matching files (${visible.length}${files.length === 300 ? '+' : ''}):\n${visible.join('\n').slice(0, 12_000)}` : 'No matching files found.';
	}

	private async search(query: unknown): Promise<string> {
		if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120) { return 'Search needs a literal query of 2–120 characters.'; }
		const fast = await ripgrepSearch(query, this.workspace().uri.fsPath, this.token);
		if (fast !== undefined) { return fast; }
		// Dock-launched apps may not inherit a PATH containing rg. Keep a bounded editor API fallback.
		const files = await vscode.workspace.findFiles('**/*', EXCLUDE_GLOB, MAX_SEARCH_FILES);
		const needle = query.toLowerCase();
		const matches: string[] = [];
		let inspected = 0;
		const root = this.workspace().uri.fsPath;
		for (const uri of files) {
			if (this.token.isCancellationRequested) { return 'Stopped.'; }
			if (!uri.fsPath.startsWith(root + path.sep)) { continue; }
			const relative = path.relative(root, uri.fsPath).split(path.sep).join('/');
			if (!safeRelativePath(relative) || isSensitiveFile(relative)) { continue; }
			try {
				const stat = await vscode.workspace.fs.stat(uri);
				if (stat.size > MAX_READ_BYTES) { continue; }
				const source = new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(uri));
				if (source.includes('\0')) { continue; }
				inspected++;
				const lines = source.split('\n');
				for (let i = 0; i < lines.length; i++) {
					if (lines[i].toLowerCase().includes(needle)) {
						matches.push(`${relative}:${i + 1}: ${redact(lines[i].slice(0, 300))}`);
						if (matches.length >= 60) { break; }
					}
				}
			} catch { /* Binary, unreadable or moved file. */ }
			if (matches.length >= 60) { break; }
		}
		return `Searched ${inspected} readable files${files.length === MAX_SEARCH_FILES ? ' (file limit reached)' : ''}.\n${matches.length ? matches.join('\n') : 'No matches.'}${matches.length >= 60 ? '\nMatch limit reached.' : ''}`;
	}

	private async readFile(value: unknown, startValue: unknown, linesValue: unknown): Promise<string> {
		const { uri, relative } = this.file(value);
		const stat = await vscode.workspace.fs.stat(uri);
		if (stat.size > MAX_READ_BYTES) { return `${relative} is over 400 KB. Search for a specific symbol or inspect it in the editor.`; }
		const source = new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(uri));
		if (source.includes('\0')) { return 'Binary files cannot be read by Pair.'; }
		const all = source.split('\n');
		const start = Number.isInteger(startValue) ? Math.max(1, Math.min(Number(startValue), all.length)) : 1;
		const count = Number.isInteger(linesValue) ? Math.max(1, Math.min(Number(linesValue), MAX_READ_LINES)) : 100;
		const selected = all.slice(start - 1, start - 1 + count).map((line, index) => `${start + index}| ${line}`).join('\n');
		return `File: ${relative} (lines ${start}–${Math.min(all.length, start + count - 1)} of ${all.length})\n${redact(selected).slice(0, 16_000)}`;
	}

	private async proposeFile(value: unknown, content: unknown): Promise<ToolResult> {
		if (typeof content !== 'string' || content.length > 80_000) { return { text: 'A complete file proposal must be text under 80,000 characters.' }; }
		const relative = safeRelativePath(value);
		if (!relative || isSensitiveFile(relative)) { return { text: 'Use a non-sensitive path relative to the project.' }; }
		const root = this.workspace().uri.fsPath;
		const target = path.resolve(root, relative);
		let exists = false;
		try { realpathSync(target); exists = true; } catch { /* New file. */ }
		const { uri } = this.file(relative, !exists);
		if (exists) {
			const document = await vscode.workspace.openTextDocument(uri);
			if (document.getText().length > 80_000) { return { text: 'This file is too long for a whole-file proposal. Change a smaller file.' }; }
			if (elidesCode(content)) { return { text: 'The proposal contains omitted-code placeholders that could delete existing lines. Send complete file content.' }; }
		}
		const proposal = await this.proposals.propose(uri, content);
		return { text: `Proposed ${relative} (${proposal.added} added, ${proposal.removed} removed). The user must review and Keep this proposal before it changes the project.`, proposalId: proposal.id };
	}

	private async runTests(value: unknown): Promise<string> {
		if (this.testsRun >= 2) { return 'Test limit reached for this request.'; }
		const command = typeof value === 'string' ? value.trim() : '';
		const spec = testSpec(command);
		if (!spec) { return 'Unsupported test command. Use npm test, npm run test, go test ./..., cargo test, or pytest -q.'; }
		const choice = await vscode.window.showInformationMessage(`Pair wants to run: ${command}`, { modal: true, detail: `In ${this.workspace().uri.fsPath}. Tests may execute project code.` }, 'Run tests');
		if (choice !== 'Run tests') { this.testsRun = 2; return 'The user declined tests. Do not request another test command in this reply.'; }
		this.testsRun++;
		return `${await runTestProcess(spec.bin, spec.args, this.workspace().uri.fsPath, this.token)}\nThis ran against the current workspace; unkept proposals were not included.`;
	}
}

/** Search a large repository without loading its files into the extension host. */
function ripgrepSearch(query: string, cwd: string, token: vscode.CancellationToken): Promise<string | undefined> {
	return new Promise(resolve => {
		const command = ripgrepPath();
		if (!command) { resolve(undefined); return; }
		const child = spawn(command, [
			'--json', '--no-messages', '--hidden', '--ignore-case', '--fixed-strings', '--max-columns', '300',
			'--glob', '!**/.git/**', '--glob', '!**/node_modules/**', '--glob', '!**/dist/**',
			'--glob', '!**/target/**', '--glob', '!**/vendor/**', '--glob', '!**/.my_editor/**', '--', query, '.',
		], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
		let buffer = '';
		const matches: string[] = [];
		let unavailable = false;
		let ended = false;
		const timer = setTimeout(() => child.kill('SIGTERM'), 20_000);
		const cancelled = token.onCancellationRequested(() => child.kill('SIGTERM'));
		const finish = () => {
			if (ended) { return; }
			ended = true;
			clearTimeout(timer);
			cancelled.dispose();
			resolve(unavailable ? undefined : token.isCancellationRequested ? 'Stopped.' : `Search results:\n${matches.length ? matches.join('\n') : 'No matches.'}${matches.length >= 60 ? '\nMatch limit reached.' : ''}`);
		};
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			buffer += chunk;
			let newline = buffer.indexOf('\n');
			while (newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				try {
					const event = JSON.parse(line) as { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
					if (event.type === 'match') {
						const relative = event.data?.path?.text?.replace(/^\.\//, '') ?? '';
						if (safeRelativePath(relative) && !isSensitiveFile(relative)) {
							matches.push(`${relative}:${event.data?.line_number ?? '?'}: ${redact((event.data?.lines?.text ?? '').trimEnd().slice(0, 300))}`);
						}
					}
				} catch { /* A malformed event cannot become model context. */ }
				if (matches.length >= 60) { child.kill('SIGTERM'); break; }
				newline = buffer.indexOf('\n');
			}
		});
		child.on('error', () => { unavailable = true; finish(); });
		child.on('close', finish);
	});
}

function ripgrepPath(): string | undefined {
	const candidates = [
		...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'rg')),
		'/opt/homebrew/bin/rg', '/usr/local/bin/rg',
		path.join(vscode.env.appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', 'rg'),
	];
	return candidates.find(candidate => {
		try { accessSync(candidate, constants.X_OK); return true; } catch { return false; }
	});
}

function runTestProcess(bin: string, args: string[], cwd: string, token: vscode.CancellationToken): Promise<string> {
	return new Promise(resolve => {
		const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		let ended = false;
		let timedOut = false;
		const append = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-12_000); };
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 120_000);
		const cancelled = token.onCancellationRequested(() => child.kill('SIGTERM'));
		const finish = (status: string) => {
			if (ended) { return; }
			ended = true;
			clearTimeout(timer);
			cancelled.dispose();
			resolve(`Test ${status}. Output (last 12,000 characters):\n${redact(output) || '(none)'}`);
		};
		child.on('error', error => finish(`could not start: ${error.message}`));
		child.on('close', code => finish(token.isCancellationRequested ? 'stopped' : timedOut ? 'timed out after 2 minutes' : `exited ${code}`));
	});
}
