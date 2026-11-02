import * as vscode from 'vscode';
import { Proposals } from '../chat/proposals';
import { loadCatalog, pickDefault } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { streamModel } from '../models/stream';
import { redact } from '../records/redact';
import { isSensitiveFile } from '../records/sensitive';
import { aiMarker, AiMarker } from './inlineCode';
import { filePlan } from './fileContext';
import { requestSnippet, SNIPPET_SYSTEM } from './snippetRequest';

/** Explicit CodeLens/keyboard generation, plus generation on Enter after a directive in automatic mode. */
export class InlineAi implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly busy = new Set<string>();
	private readonly output = vscode.window.createOutputChannel('AI snippets');
	private readonly disposables: vscode.Disposable[];

	constructor(private readonly keys: ApiKeys, private readonly proposals: Proposals) {
		this.disposables = [vscode.workspace.onDidChangeTextDocument(event => {
			if (vscode.workspace.getConfiguration('myEditor').get('assistance.mode', 'auto') !== 'auto') { return; }
			for (const change of event.contentChanges) {
				if (!/^\r?\n\s*$/.test(change.text)) { continue; }
				const line = change.range.start.line;
				if (line + 1 < event.document.lineCount && event.document.lineAt(line + 1).text.trim()) { continue; }
				if (aiMarker(event.document.lineAt(line).text, line)) { void this.generate(event.document.uri, line); }
			}
		})];
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (document.uri.scheme !== 'file') { return []; }
		return document.getText().split(/\r?\n/).flatMap((line, index) => aiMarker(line, index)
			? [new vscode.CodeLens(new vscode.Range(index, 0, index, line.length),
				{ title: 'AI: generate below', command: 'myEditor.inlineAi.generate', arguments: [document.uri, index] })] : []);
	}

	async generate(uri?: vscode.Uri, line?: number): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		const document = uri ? await vscode.workspace.openTextDocument(uri) : editor?.document;
		if (!document || document.uri.scheme !== 'file' || isSensitiveFile(document.uri.path, document.languageId)) { return; }
		const at = line ?? editor?.selection.active.line ?? 0;
		const marker = aiMarker(document.lineAt(at).text, at);
		if (!marker) { void vscode.window.showInformationMessage('Write #Ai <instruction> on its own line, then run this command.'); return; }
		const key = document.uri.toString();
		if (this.busy.has(key)) { return; }
		this.busy.add(key);
		try { await this.propose(document, marker); }
		catch (error) {
			const reason = redact(error instanceof Error ? error.message : String(error));
			this.output.appendLine(`Failed: ${reason}`);
			void vscode.window.showWarningMessage(`AI snippet: ${reason}`, 'View response')
				.then(choice => { if (choice) { this.output.show(true); } });
		}
		finally { this.busy.delete(key); }
	}

	private async propose(document: vscode.TextDocument, marker: AiMarker): Promise<void> {
		const text = document.getText();
		if (text.length > 60_000) { throw new Error('This file is too large for a focused snippet. Split it first.'); }
		const version = document.version;
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Writing the requested snippet', cancellable: true },
			async (progress, token) => {
				const [catalog, plan] = await Promise.all([loadCatalog(this.keys), filePlan(document.uri)]);
				if (token.isCancellationRequested) { return; }
				const entry = pickDefault(catalog);
				if (!entry) { throw new Error('Choose a model first.'); }
				try {
					const proposed = await requestSnippet({ source: text, marker, filePath: document.uri.fsPath,
						language: document.languageId, plan, checkCurrent: () => {
							if (token.isCancellationRequested) { throw new vscode.CancellationError(); }
							if (document.version !== version) { throw new Error('The file changed during generation. Run the directive again.'); }
						}, generate: async (turns, correcting) => {
							if (correcting) { progress.report({ message: 'Correcting the returned snippet…' }); }
							this.output.appendLine(`\n${document.uri.fsPath} · ${entry.key} · ${correcting ? 'correction' : 'generation'}`);
							let reply = '';
							try {
								await streamModel(entry, this.keys, { system: SNIPPET_SYSTEM, turns, token, webAccess: false,
									onText: chunk => { reply += chunk; } });
							} finally { this.output.appendLine(redact(reply)); }
							return reply;
						} });
					await this.proposals.propose(document.uri, proposed);
				} catch (error) { if (!token.isCancellationRequested) { throw error; } }
			});
	}

	dispose(): void { this.output.dispose(); vscode.Disposable.from(...this.disposables).dispose(); }
}
