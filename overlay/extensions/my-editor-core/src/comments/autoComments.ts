import * as vscode from 'vscode';
import { loadCatalog, pickQuickModel } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { streamModel } from '../models/stream';
import { readProjectNote } from '../pair/context';
import { isSensitiveFile } from '../records/sensitive';
import { commentText, findDefinitions, formatComment, insertion, needsComment, supportsAutoComments } from './detect';

const QUIET_MS = 8_000;
const MAX_PER_PASS = 3;
const MAX_CODE_LINES = 60;
const COMMENTABLE = new Set([
	vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Class, vscode.SymbolKind.Interface,
	vscode.SymbolKind.Struct, vscode.SymbolKind.Enum, vscode.SymbolKind.Constructor,
]);

interface Found {
	readonly name: string;
	readonly line: number;
	readonly endLine: number;
}

/**
 * When the user adds a function or class without a comment, the Pair writes a short one for it. Only code
 * added since the file was opened; one normal edit each, so Cmd+Z removes it. Switched from the editor toolbar.
 */
export class AutoComments implements vscode.Disposable {
	/** The file's text when it was opened: anything named there is the user's existing code, left alone. */
	private readonly openedText = new Map<string, string>();
	private readonly handled = new Map<string, Set<string>>();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly keys: ApiKeys, private readonly log: vscode.LogOutputChannel) {
		for (const document of vscode.workspace.textDocuments) {
			this.openedText.set(document.uri.toString(), document.getText());
		}
		this.disposables.push(
			vscode.workspace.onDidOpenTextDocument(d => this.openedText.set(d.uri.toString(), d.getText())),
			vscode.workspace.onDidCloseTextDocument(d => {
				this.openedText.delete(d.uri.toString());
				this.handled.delete(d.uri.toString());
			}),
			vscode.workspace.onDidSaveTextDocument(d => this.schedule(d)),
		);
	}

	static get enabled(): boolean {
		return vscode.workspace.getConfiguration('myEditor').get<boolean>('autoComments.enabled', true);
	}

	static async setEnabled(on: boolean): Promise<void> {
		await vscode.workspace.getConfiguration('myEditor').update('autoComments.enabled', on, vscode.ConfigurationTarget.Global);
		vscode.window.setStatusBarMessage(on ? '$(comment-discussion) Auto comments on' : '$(comment) Auto comments off', 3000);
	}

	private schedule(document: vscode.TextDocument): void {
		const key = document.uri.toString();
		clearTimeout(this.timers.get(key));
		this.timers.set(key, setTimeout(() => this.run(document).catch(err => this.log.warn(`auto comments failed: ${String(err)}`)), QUIET_MS));
	}

	private async run(document: vscode.TextDocument): Promise<void> {
		const key = document.uri.toString();
		if (!AutoComments.enabled || document.uri.scheme !== 'file' || !supportsAutoComments(document.languageId)
			|| document.uri.path.includes('/.my_editor/') || isSensitiveFile(document.uri.path, document.languageId) || document.lineCount > 5_000) {
			return;
		}
		const opened = this.openedText.get(key) ?? '';
		const handled = this.handled.get(key) ?? new Set<string>();
		this.handled.set(key, handled);
		const lines = document.getText().split('\n');
		const fromServer = flatten(await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>('vscode.executeDocumentSymbolProvider', document.uri) ?? []);
		// The language server may still be starting; the text alone is enough to find new definitions.
		const symbols = fromServer.length ? fromServer : findDefinitions(lines, document.languageId);
		const wanted = symbols
			.filter(s => !handled.has(s.name) && !new RegExp(`\\b${escape(s.name)}\\b`).test(opened))
			.filter(s => needsComment(lines, s.line, document.languageId))
			.slice(0, MAX_PER_PASS);
		this.log.info(`auto comments: ${document.uri.path.split('/').pop()}: ${symbols.length} symbols, ${wanted.length} new without a comment`);
		if (!wanted.length) {
			return;
		}
		const model = pickQuickModel(await loadCatalog(this.keys), vscode.workspace.getConfiguration('myEditor').get<string>('navigator.model'));
		if (!model) {
			return;
		}
		const conventions = await readProjectNote('conventions.md', 2_000);
		// Bottom-up, so inserting one comment does not move the lines of the next.
		for (const symbol of wanted.sort((a, b) => b.line - a.line)) {
			const before = document.version;
			const code = lines.slice(symbol.line, Math.min(symbol.endLine + 1, symbol.line + MAX_CODE_LINES)).join('\n');
			let reply = '';
			const cancel = new vscode.CancellationTokenSource();
			const timer = setTimeout(() => cancel.cancel(), 60_000);
			try {
				await streamModel(model, this.keys, {
					system: `You write short code comments. Reply with ONLY the comment's text for the code given: one or two plain sentences on what it does and, if clear, why. No comment markers, no quotes, no code, no markdown.${document.languageId === 'go' ? ` Start with the name ${symbol.name}.` : ''}${conventions ? `\n\nProject conventions:\n${conventions}` : ''}`,
					turns: [{ role: 'user', text: `${document.languageId} code:\n${code}` }],
					token: cancel.token,
					onText: chunk => (reply += chunk),
				});
			} catch (err) {
				this.log.warn(`auto comments: ${String(err)}`);
				return;
			} finally {
				clearTimeout(timer);
				cancel.dispose();
			}
			if (document.version !== before) {
				return; // The user kept typing; try again after the next save.
			}
			const text = commentText(reply);
			handled.add(symbol.name);
			const comment = text ? formatComment(text, document.languageId, symbol.name) : undefined;
			if (!comment) {
				this.log.info(`auto comments: no usable comment for ${symbol.name}: ${JSON.stringify(reply.slice(0, 200))}`);
				continue;
			}
			const place = insertion(lines, symbol.line, comment, document.languageId);
			const edit = new vscode.WorkspaceEdit();
			edit.insert(document.uri, new vscode.Position(place.line, 0), place.text);
			await vscode.workspace.applyEdit(edit);
			vscode.window.setStatusBarMessage(`$(comment-discussion) Pair commented ${symbol.name}  ·  ⌘Z to undo`, 5000);
		}
	}

	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		vscode.Disposable.from(...this.disposables).dispose();
	}
}

/** Accepts both shapes providers return: nested DocumentSymbols or flat SymbolInformation. */
function flatten(symbols: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[], out: Found[] = []): Found[] {
	for (const symbol of symbols) {
		if (COMMENTABLE.has(symbol.kind)) {
			const nameLine = 'selectionRange' in symbol ? symbol.selectionRange.start.line : symbol.location.range.start.line;
			const endLine = 'range' in symbol ? symbol.range.end.line : symbol.location.range.end.line;
			out.push({ name: symbol.name.replace(/\(.*$/, ''), line: nameLine, endLine });
		}
		if ('children' in symbol && symbol.children) {
			flatten(symbol.children, out);
		}
	}
	return out;
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
