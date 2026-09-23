import * as vscode from 'vscode';
import { readProjectState } from './state';

const CONVENTIONS_TEMPLATE = `# Conventions

These rules go into every request the pair makes. Keep them short and specific.

## Code style
- 

## Naming
- 

## Patterns we use
- 

## Things to avoid
- 
`;

/** The project's table of contents: stages with live status, memory, and the active model. */
export class ProjectView implements vscode.WebviewViewProvider {
	static readonly id = 'myEditor.project';
	private view: vscode.WebviewView | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {
		const watcher = vscode.workspace.createFileSystemWatcher('**/.my_editor/**');
		context.subscriptions.push(
			watcher,
			watcher.onDidCreate(() => this.refresh()),
			watcher.onDidChange(() => this.refresh()),
			watcher.onDidDelete(() => this.refresh()),
			vscode.lm.onDidChangeChatModels(() => this.refresh()),
		);
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		view.webview.options = { enableScripts: true, localResourceRoots: [media] };
		const nonce = Math.random().toString(36).slice(2);
		const css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'project.css'));
		const js = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'project.js'));
		view.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}"></head>
<body><main id="root" aria-live="polite"></main><script nonce="${nonce}" src="${js}"></script></body></html>`;
		view.webview.onDidReceiveMessage(message => this.onMessage(message));
		view.onDidChangeVisibility(() => view.visible && this.refresh());
		void this.refresh();
	}

	async refresh(): Promise<void> {
		if (!this.view) {
			return;
		}
		const [state, models] = await Promise.all([readProjectState(), vscode.lm.selectChatModels({ vendor: 'my-editor' })]);
		void this.view.webview.postMessage({ type: 'state', state, model: models[0]?.name });
	}

	private async onMessage(message: { type: string; stage?: string; path?: string }): Promise<void> {
		switch (message.type) {
			case 'ready':
				return this.refresh();
			case 'open':
				return this.openOrStart(message.stage ?? '', message.path);
			case 'conventions':
				return this.openConventions();
			case 'folder':
				return this.openFolder(message.path ?? '');
			case 'models':
				await vscode.commands.executeCommand('myEditor.setApiKey');
				return;
			case 'brain':
				await vscode.commands.executeCommand('myEditor.buildBrain');
				return;
			case 'chat':
				await vscode.commands.executeCommand('workbench.action.chat.open');
				return;
		}
	}

	/** A stage with a document opens it; otherwise the matching conversation starts in chat. */
	private async openOrStart(stage: string, path: string | undefined): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (root && path) {
			const uri = vscode.Uri.joinPath(root, path);
			try {
				await vscode.workspace.fs.stat(uri);
				await vscode.window.showTextDocument(uri);
				return;
			} catch {
				// Not written yet: start the conversation instead.
			}
		}
		const starters: Record<string, string> = {
			requirements: '/requirements ',
			architecture: '/architecture ',
			tree: '/tree ',
			build: '/next ',
			qa: '/review ',
		};
		await vscode.commands.executeCommand('workbench.action.chat.open', { query: starters[stage] ?? '', isPartialQuery: true });
	}

	private async openConventions(): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root) {
			return;
		}
		const uri = vscode.Uri.joinPath(root, '.my_editor', 'conventions.md');
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(CONVENTIONS_TEMPLATE));
		}
		await vscode.window.showTextDocument(uri);
	}

	private async openFolder(path: string): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (root) {
			await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.joinPath(root, path));
		}
	}
}
