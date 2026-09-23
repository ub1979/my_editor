import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { readMap } from '../brain/brain';

interface SymbolRow {
	readonly name: string;
	readonly kind: string;
	readonly depth: number;
	readonly line: number;
	readonly endLine: number;
}

interface CommitRow {
	readonly hash: string;
	readonly subject: string;
	readonly when: string;
}

const KIND: Partial<Record<vscode.SymbolKind, string>> = {
	[vscode.SymbolKind.Class]: 'class', [vscode.SymbolKind.Interface]: 'interface', [vscode.SymbolKind.Struct]: 'class',
	[vscode.SymbolKind.Enum]: 'enum', [vscode.SymbolKind.Function]: 'function', [vscode.SymbolKind.Method]: 'function',
	[vscode.SymbolKind.Constructor]: 'function', [vscode.SymbolKind.Property]: 'field', [vscode.SymbolKind.Field]: 'field',
	[vscode.SymbolKind.Variable]: 'value', [vscode.SymbolKind.Constant]: 'value', [vscode.SymbolKind.Module]: 'module',
	[vscode.SymbolKind.Namespace]: 'module', [vscode.SymbolKind.TypeParameter]: 'interface',
};

/** "This file": its role, its symbols, the navigator's notes and its git history, in my_editor's style. */
export class ThisFileView implements vscode.WebviewViewProvider {
	static readonly id = 'myEditor.thisFile';
	private view: vscode.WebviewView | undefined;
	private timer: NodeJS.Timeout | undefined;
	private symbols: SymbolRow[] = [];

	constructor(private readonly context: vscode.ExtensionContext) {
		context.subscriptions.push(
			vscode.window.onDidChangeActiveTextEditor(() => this.schedule(true)),
			vscode.workspace.onDidSaveTextDocument(() => this.schedule(true)),
			vscode.languages.onDidChangeDiagnostics(() => this.schedule(false)),
			vscode.window.onDidChangeTextEditorSelection(() => this.postCursor()),
		);
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		view.webview.options = { enableScripts: true, localResourceRoots: [media] };
		const nonce = randomBytes(16).toString('base64');
		view.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'thisfile.css'))}"></head>
<body><main id="root"></main><script nonce="${nonce}" src="${view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'thisfile.js'))}"></script></body></html>`;
		view.webview.onDidReceiveMessage(message => void this.onMessage(message));
		view.onDidChangeVisibility(() => view.visible && this.schedule(true));
	}

	private schedule(full: boolean): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.refresh(full), 250);
	}

	private editor(): vscode.TextEditor | undefined {
		const editor = vscode.window.activeTextEditor;
		return editor && editor.document.uri.scheme === 'file' ? editor : undefined;
	}

	private async refresh(full: boolean): Promise<void> {
		if (!this.view?.visible) {
			return;
		}
		const editor = this.editor();
		if (!editor) {
			void this.view.webview.postMessage({ type: 'file', file: undefined });
			return;
		}
		const document = editor.document;
		const path = vscode.workspace.asRelativePath(document.uri, false);
		if (full) {
			const found = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>('vscode.executeDocumentSymbolProvider', document.uri) ?? [];
			this.symbols = flatten(found);
		}
		const notes = vscode.languages.getDiagnostics(document.uri)
			.filter(d => d.source === 'navigator')
			.map(d => ({ line: d.range.start.line, message: d.message, warning: d.severity === vscode.DiagnosticSeverity.Warning }));
		const [role, history] = full ? await Promise.all([roleOf(path), gitHistory(document.uri)]) : [undefined, undefined];
		void this.view.webview.postMessage({
			type: 'file',
			file: { path, name: path.split('/').pop(), ...(full ? { role, history } : {}) },
			symbols: this.symbols,
			notes,
			cursor: editor.selection.active.line,
			full,
		});
	}

	private postCursor(): void {
		const editor = this.editor();
		if (editor && this.view?.visible) {
			void this.view.webview.postMessage({ type: 'cursor', line: editor.selection.active.line });
		}
	}

	private async onMessage(message: { type: string; line?: number; hash?: string; skill?: string }): Promise<void> {
		const editor = this.editor();
		switch (message.type) {
			case 'ready':
				return this.refresh(true);
			case 'reveal':
				if (editor && message.line !== undefined) {
					const position = new vscode.Position(message.line, 0);
					await vscode.window.showTextDocument(editor.document, { selection: new vscode.Selection(position, position), preview: false });
				}
				return;
			case 'commit':
				if (editor && message.hash && /^[0-9a-f]{4,40}$/.test(message.hash)) {
					const uri = editor.document.uri;
					const at = (ref: string) => uri.with({ scheme: 'git', query: JSON.stringify({ path: uri.fsPath, ref }) });
					await vscode.commands.executeCommand('vscode.diff', at(`${message.hash}~1`), at(message.hash),
						`${uri.path.split('/').pop()} (${message.hash.slice(0, 7)})`);
				}
				return;
			case 'skill':
				if (message.skill && ['explain', 'review', 'why'].includes(message.skill)) {
					await vscode.commands.executeCommand('myEditor.chat.start', message.skill);
				}
				return;
		}
	}
}

function flatten(items: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[], depth = 0, out: SymbolRow[] = []): SymbolRow[] {
	for (const item of items) {
		const range = 'range' in item ? item.range : item.location.range;
		const kind = KIND[item.kind];
		if (kind) {
			out.push({ name: item.name, kind, depth, line: range.start.line, endLine: range.end.line });
		}
		if ('children' in item && depth < 2) {
			flatten(item.children, depth + 1, out);
		}
	}
	return out.sort((a, b) => a.line - b.line);
}

async function roleOf(path: string): Promise<string | undefined> {
	const entry = (await readMap())?.files[path];
	return entry?.note ?? entry?.summary ?? entry?.role;
}

function gitHistory(uri: vscode.Uri): Promise<CommitRow[]> {
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	if (!folder) {
		return Promise.resolve([]);
	}
	return new Promise(resolve => execFile('git', ['log', '-n', '8', '--format=%h%x1f%s%x1f%cr', '--', uri.fsPath],
		{ cwd: folder.uri.fsPath, timeout: 4000 }, (err, out) => resolve(err ? [] : out.trim().split('\n').filter(Boolean).map(line => {
			const [hash, subject, when] = line.split('\x1f');
			return { hash, subject, when };
		}))));
}
