import * as vscode from 'vscode';
import { findDefinitions, needsComment, supportsAutoComments } from './detect';

const QUIET_MS = 800;
const MAX_NOTES = 3;
const COMMENTABLE = new Set([
	vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Class, vscode.SymbolKind.Interface,
	vscode.SymbolKind.Struct, vscode.SymbolKind.Enum, vscode.SymbolKind.Constructor,
]);

interface Found { readonly name: string; readonly line: number }

/** Suggests useful comments for new code. The user chooses whether to ask Pair for a reviewed proposal. */
export class AutoComments implements vscode.Disposable {
	private readonly openedText = new Map<string, string>();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private readonly diagnostics = vscode.languages.createDiagnosticCollection('my_editor comments');
	private readonly disposables: vscode.Disposable[];

	constructor() {
		for (const document of vscode.workspace.textDocuments) {
			this.openedText.set(document.uri.toString(), document.getText());
		}
		this.disposables = [
			this.diagnostics,
			vscode.workspace.onDidOpenTextDocument(document => this.openedText.set(document.uri.toString(), document.getText())),
			vscode.workspace.onDidCloseTextDocument(document => {
				this.openedText.delete(document.uri.toString());
				this.diagnostics.delete(document.uri);
			}),
			vscode.workspace.onDidSaveTextDocument(document => this.schedule(document)),
		];
	}

	static get enabled(): boolean {
		return vscode.workspace.getConfiguration('myEditor').get<boolean>('autoComments.enabled', true);
	}

	static async setEnabled(on: boolean): Promise<void> {
		await vscode.workspace.getConfiguration('myEditor').update('autoComments.enabled', on, vscode.ConfigurationTarget.Global);
		vscode.window.setStatusBarMessage(on ? 'Comment guidance on' : 'Comment guidance off', 3000);
	}

	private schedule(document: vscode.TextDocument): void {
		const key = document.uri.toString();
		clearTimeout(this.timers.get(key));
		this.timers.set(key, setTimeout(() => void this.review(document), QUIET_MS));
	}

	private async review(document: vscode.TextDocument): Promise<void> {
		if (!AutoComments.enabled || document.uri.scheme !== 'file' || !supportsAutoComments(document.languageId)
			|| document.uri.path.includes('/.my_editor/') || document.lineCount > 5_000) {
			this.diagnostics.delete(document.uri);
			return;
		}
		const baseline = this.openedText.get(document.uri.toString()) ?? '';
		const text = document.getText();
		const lines = text.split('\n');
		const fromProvider = flatten(await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
			'vscode.executeDocumentSymbolProvider', document.uri) ?? []);
		if (document.getText() !== text) { return; }
		const symbols = fromProvider.length ? fromProvider : findDefinitions(lines, document.languageId);
		const findings = symbols
			.filter(symbol => !new RegExp(`\\b${escape(symbol.name)}\\b`).test(baseline))
			.filter(symbol => needsComment(lines, symbol.line, document.languageId))
			.slice(0, MAX_NOTES)
			.map(symbol => {
				const finding = new vscode.Diagnostic(document.lineAt(symbol.line).range,
					`Consider a short comment explaining ${symbol.name}'s purpose or non-obvious behavior. Ask Pair for a reviewed suggestion.`,
					vscode.DiagnosticSeverity.Information);
				finding.source = 'my_editor comments';
				return finding;
			});
		this.diagnostics.set(document.uri, findings);
		this.openedText.set(document.uri.toString(), text);
	}

	dispose(): void {
		for (const timer of this.timers.values()) { clearTimeout(timer); }
		vscode.Disposable.from(...this.disposables).dispose();
	}
}

function flatten(symbols: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[], out: Found[] = []): Found[] {
	for (const symbol of symbols) {
		if (COMMENTABLE.has(symbol.kind)) {
			out.push({
				name: symbol.name.replace(/\(.*$/, ''),
				line: 'selectionRange' in symbol ? symbol.selectionRange.start.line : symbol.location.range.start.line,
			});
		}
		if ('children' in symbol && symbol.children) { flatten(symbol.children, out); }
	}
	return out;
}

function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
