import * as vscode from 'vscode';
import { neighbourSummary } from '../brain/brain';
import { loadCatalog, pickDefault } from '../models/catalog';
import { streamModel } from '../models/stream';
import { ModelEntry } from '../models/types';
import { ApiKeys } from '../models/secrets';
import { readProjectNote } from '../pair/context';
import { redact } from '../records/redact';
import { isSensitiveFile } from '../records/sensitive';
import { changedHunks, Hunk, parseFindings } from './hunks';

const SKIPPED_LANGUAGES = new Set(['markdown', 'plaintext', 'json', 'jsonc', 'log', 'csv', 'ignore', 'properties']);
const MAX_LINES = 4_000;
const CONTEXT_LINES = 3;
const DEBOUNCE_MS = 1_200;
const TIMEOUT_MS = 90_000;

const SYSTEM = `You are the navigator in a pair-programming session. The user is typing; you watch their latest change
and speak up only about things worth interrupting for: likely bugs, broken project conventions or architecture, and
code that duplicates something the project already has. Never comment on whitespace, blank lines, formatting, naming
taste, missing validation "just in case", or anything outside the changed lines. Most saves deserve no comment: an
empty array is the normal answer, and one precise finding beats three vague ones.
Reply with ONLY a JSON array, at most 3 items:
[{"line": <line number in the file>, "severity": "warning" | "info", "message": "<one short sentence>"}]
Use "warning" for likely bugs and broken rules, "info" for a worthwhile suggestion.`;

/**
 * Advises on each save (D7): reviews only the changed lines and shows at most three findings as editor
 * diagnostics. It never edits code. Muted per file or per session.
 */
export class Navigator implements vscode.Disposable {
	private readonly diagnostics = vscode.languages.createDiagnosticCollection('my_editor');
	private readonly baselines = new Map<string, string>();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private readonly muted = new Set<string>();
	private readonly busy = new vscode.EventEmitter<boolean>();
	readonly onDidChangeBusy = this.busy.event;
	private sessionOff = false;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly keys: ApiKeys, private readonly log: vscode.LogOutputChannel) {
		for (const document of vscode.workspace.textDocuments) {
			this.baselines.set(document.uri.toString(), document.getText());
		}
		this.disposables.push(
			this.diagnostics,
			this.busy,
			vscode.workspace.onDidOpenTextDocument(d => this.baselines.set(d.uri.toString(), d.getText())),
			vscode.workspace.onDidCloseTextDocument(d => {
				this.baselines.delete(d.uri.toString());
				this.diagnostics.delete(d.uri);
			}),
			vscode.workspace.onDidSaveTextDocument(d => this.schedule(d)),
		);
	}

	get active(): boolean {
		return !this.sessionOff && vscode.workspace.getConfiguration('myEditor').get<boolean>('navigator.enabled', true);
	}

	toggleSession(): void {
		this.sessionOff = !this.sessionOff;
		if (this.sessionOff) {
			this.diagnostics.clear();
		}
		void vscode.window.showInformationMessage(this.sessionOff ? 'Navigator paused for this session.' : 'Navigator is watching again.');
	}

	toggleFile(uri: vscode.Uri | undefined): void {
		if (!uri) {
			return;
		}
		const key = uri.toString();
		if (this.muted.delete(key)) {
			void vscode.window.showInformationMessage(`Navigator on for ${vscode.workspace.asRelativePath(uri)}.`);
		} else {
			this.muted.add(key);
			this.diagnostics.delete(uri);
			void vscode.window.showInformationMessage(`Navigator muted for ${vscode.workspace.asRelativePath(uri)}.`);
		}
	}

	clear(): void {
		this.diagnostics.clear();
	}

	private schedule(document: vscode.TextDocument): void {
		const key = document.uri.toString();
		clearTimeout(this.timers.get(key));
		this.timers.set(key, setTimeout(() => void this.review(document), DEBOUNCE_MS));
	}

	private async review(document: vscode.TextDocument): Promise<void> {
		const key = document.uri.toString();
		const text = document.getText();
		const before = this.baselines.get(key);
		this.baselines.set(key, text);
		if (!this.active || this.muted.has(key) || before === undefined || document.uri.scheme !== 'file'
			|| SKIPPED_LANGUAGES.has(document.languageId) || document.uri.path.includes('/.my_editor/')
			|| isSensitiveFile(document.uri.path, document.languageId)
			|| document.lineCount > MAX_LINES) {
			return;
		}
		const hunks = changedHunks(before, text);
		if (!hunks.length) {
			return;
		}
		const model = await this.pickModel();
		if (!model) {
			return;
		}
		this.busy.fire(true);
		const cancel = new vscode.CancellationTokenSource();
		const timer = setTimeout(() => cancel.cancel(), TIMEOUT_MS);
		try {
			const path = vscode.workspace.asRelativePath(document.uri, false);
			const [conventions, neighbours] = await Promise.all([readProjectNote('conventions.md', 4_000), neighbourSummary(path, 8)]);
			const prompt = [
				`File: ${path} (${document.languageId})`,
				conventions ? `Project conventions:\n${conventions}` : '',
				neighbours,
				// Secrets in ordinary code (a pasted key, a token in a config) are masked before anything is sent.
				`Changed lines (with a little context; "+" marks changed lines):\n${redact(excerpt(text, hunks))}`,
			].filter(Boolean).join('\n\n');
			let reply = '';
			await streamModel(model, this.keys, {
				system: SYSTEM,
				turns: [{ role: 'user', text: prompt }],
				token: cancel.token,
				onText: chunk => (reply += chunk),
			});
			if (document.getText() !== text) {
				return; // The file moved on while we were thinking; the next save will review again.
			}
			const findings = parseFindings(reply, document.lineCount);
			this.diagnostics.set(document.uri, findings.map(f => {
				const line = document.lineAt(f.line - 1);
				const diagnostic = new vscode.Diagnostic(
					new vscode.Range(f.line - 1, line.firstNonWhitespaceCharacterIndex, f.line - 1, line.text.length),
					f.message,
					f.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
				diagnostic.source = 'navigator';
				return diagnostic;
			}));
			this.log.info(`navigator: ${path}: ${findings.length} finding(s) from ${model.label}`);
		} catch (err) {
			this.log.warn(`navigator: review failed: ${String(err)}`);
		} finally {
			clearTimeout(timer);
			cancel.dispose();
			this.busy.fire(false);
		}
	}

	/** The navigator's model (D9): its own setting, else a local model, else Claude Haiku (API, then subscription), else the default. */
	private async pickModel(): Promise<ModelEntry | undefined> {
		const entries = await loadCatalog(this.keys);
		const wanted = vscode.workspace.getConfiguration('myEditor').get<string>('navigator.model');
		return entries.find(e => e.key === wanted)
			?? entries.find(e => e.detail.endsWith('local'))
			?? entries.find(e => e.key === 'anthropic:claude-haiku-4-5')
			?? entries.find(e => e.key === 'claude-cli:haiku')
			?? pickDefault(entries);
	}

	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		vscode.Disposable.from(...this.disposables).dispose();
	}
}

/** The changed lines with a few lines of context, numbered as in the file; "+" marks changed lines. */
function excerpt(text: string, hunks: Hunk[]): string {
	const lines = text.split('\n');
	const show = new Set<number>();
	const changed = new Set<number>();
	for (const hunk of hunks) {
		for (let n = hunk.start; n <= hunk.end; n++) {
			changed.add(n);
		}
		for (let n = Math.max(1, hunk.start - CONTEXT_LINES); n <= Math.min(lines.length, hunk.end + CONTEXT_LINES); n++) {
			show.add(n);
		}
	}
	const out: string[] = [];
	let last = 0;
	for (const n of [...show].sort((a, b) => a - b)) {
		if (last && n > last + 1) {
			out.push('     …');
		}
		out.push(`${changed.has(n) ? '+' : ' '}${String(n).padStart(4)}| ${lines[n - 1]}`);
		last = n;
	}
	return out.join('\n');
}
