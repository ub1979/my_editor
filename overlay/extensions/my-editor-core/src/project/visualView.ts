import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { projectVisuals, ProjectVisuals } from './visualPlan';

type Tab = 'architecture' | 'tree';

/** A visual, read-only view of the saved architecture and file tree. */
export class ProjectVisualView implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private visuals: ProjectVisuals | undefined;
	private tab: Tab = 'architecture';
	private readonly watcher: vscode.FileSystemWatcher;
	private readonly subscriptions: vscode.Disposable[] = [];

	constructor(private readonly context: vscode.ExtensionContext) {
		this.watcher = vscode.workspace.createFileSystemWatcher('**/.my_editor/**');
		this.subscriptions.push(
			this.watcher,
			this.watcher.onDidCreate(() => void this.refresh()),
			this.watcher.onDidChange(() => void this.refresh()),
			this.watcher.onDidDelete(() => void this.refresh()),
			vscode.workspace.onDidSaveTextDocument(() => void this.refresh()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
		);
	}

	async show(tab: Tab = 'architecture'): Promise<void> {
		if (!vscode.workspace.workspaceFolders?.length) {
			void vscode.window.showInformationMessage('Open a project folder to view its maps.');
			return;
		}
		this.tab = tab;
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One);
			void this.panel.webview.postMessage({ type: 'tab', tab });
			await this.refresh();
			return;
		}
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		const panel = vscode.window.createWebviewPanel('myEditor.projectVisuals', 'Project map', vscode.ViewColumn.One, {
			enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media],
		});
		this.panel = panel;
		const nonce = randomBytes(16).toString('base64');
		const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'map.css'));
		const js = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'map.js'));
		panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
		<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
		<link rel="stylesheet" href="${css}"></head><body><main id="root"></main>
		<script nonce="${nonce}" src="${js}"></script></body></html>`;
		panel.onDidDispose(() => { this.panel = undefined; this.visuals = undefined; });
		panel.webview.onDidReceiveMessage(message => void this.onMessage(message));
		await this.refresh(tab);
	}

	private async read(root: vscode.Uri, path: string): Promise<string> {
		try {
			return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, path)));
		} catch {
			return '';
		}
	}

	private async refresh(tab?: Tab): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!this.panel || !root) {
			return;
		}
		const [architecture, tree, brain] = await Promise.all([
			this.read(root, '.my_editor/specs/architecture.md'),
			this.read(root, '.my_editor/specs/tree.json'),
			this.read(root, '.my_editor/brain/map.json'),
		]);
		this.visuals = projectVisuals(architecture, tree, brain);
		void this.panel.webview.postMessage({
			type: 'state', tab: tab ?? this.tab, project: vscode.workspace.workspaceFolders?.[0]?.name,
			hasArchitecture: !!architecture, hasTree: !!tree, visuals: this.visuals,
		});
	}

	private async onMessage(message: { type?: string; path?: string }): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root) {
			return;
		}
		if (message.type === 'ready') {
			await this.refresh();
			return;
		}
		const source = message.type === 'architectureSource' ? '.my_editor/specs/architecture.md'
			: message.type === 'treeSource' ? '.my_editor/specs/tree.json' : undefined;
		if (source) {
			try {
				await vscode.window.showTextDocument(vscode.Uri.joinPath(root, source));
			} catch {
				void vscode.window.showInformationMessage('That project document has not been written yet.');
			}
			return;
		}
		const file = message.path;
		if (message.type === 'openFile' && file && this.visuals?.files.some(f => f.path === file)
			&& !file.startsWith('/') && !file.split('/').includes('..')) {
			await vscode.window.showTextDocument(vscode.Uri.joinPath(root, file));
		}
	}

	dispose(): void {
		this.panel?.dispose();
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
	}
}
