import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { loadCatalog, pickDefault } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { GitSyncState, inspectGitSync, updateGitProject } from './gitSync';
import { readProjectState } from './state';
import { ProjectVisualView } from './visualView';
import { currentProjectStatus } from './contextStatus';

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
	private sync: GitSyncState | undefined;
	private checking: Promise<void> | undefined;
	private updating = false;

	constructor(private readonly context: vscode.ExtensionContext, private readonly keys: ApiKeys, private readonly visuals: ProjectVisualView) {
		const watcher = vscode.workspace.createFileSystemWatcher('**/.my_editor/**');
		const startup = setTimeout(() => void this.checkRemote(), 3_000);
		const periodic = setInterval(() => void this.checkRemote(), 10 * 60_000);
		context.subscriptions.push(
			{ dispose: () => { clearTimeout(startup); clearInterval(periodic); } },
			watcher,
			watcher.onDidCreate(() => this.refresh()),
			watcher.onDidChange(() => this.refresh()),
			watcher.onDidDelete(() => this.refresh()),
			vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('myEditor') && this.refresh()),
			context.secrets.onDidChange(() => this.refresh()),
		);
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		view.webview.options = { enableScripts: true, localResourceRoots: [media] };
		const nonce = randomBytes(16).toString('base64');
		const css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'project.css'));
		const js = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'project.js'));
		view.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}"></head>
<body><main id="root" aria-live="polite"></main><script nonce="${nonce}" src="${js}"></script></body></html>`;
		view.webview.onDidReceiveMessage(message => this.onMessage(message));
		view.onDidChangeVisibility(() => view.visible && this.checkRemote()),
		void this.refresh();
	}

	async refresh(): Promise<void> {
		if (!this.view) {
			return;
		}
		const [state, entries, project] = await Promise.all([readProjectState(), loadCatalog(this.keys), currentProjectStatus()]);
		void this.view.webview.postMessage({ type: 'state', state, model: pickDefault(entries)?.label, sync: this.sync, project });
	}

	private checkRemote(): Promise<void> {
		if (this.updating) { return Promise.resolve(); }
		if (this.checking) { return this.checking; }
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!cwd) { return Promise.resolve(); }
		this.checking = (async () => {
			try {
				this.sync = await inspectGitSync(cwd, true);
			} catch (error) {
				this.sync = { kind: 'not-git', fetchError: error instanceof Error ? error.message : String(error) };
			}
			await this.refresh();
			const sync = this.sync;
			if (sync?.kind === 'tracked' && !sync.fetchError && sync.behind && sync.remoteHead) {
				const key = `myEditor.git.notified.${sync.branch}`;
				if (this.context.workspaceState.get<string>(key) !== sync.remoteHead) {
					await this.context.workspaceState.update(key, sync.remoteHead);
					void vscode.window.showInformationMessage(
						`${sync.behind} new commit${sync.behind === 1 ? '' : 's'} available for ${sync.branch}.`,
						'Update project', 'Later',
					).then(choice => { if (choice === 'Update project') { void this.updateProject(); } });
				}
			}
		})().finally(() => { this.checking = undefined; });
		return this.checking;
	}

	private async updateProject(): Promise<void> {
		if (this.updating) { return; }
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!cwd) { return; }
		this.updating = true;
		try {
			if (this.checking) { await this.checking; }
			const result = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification, title: 'Updating project from Git',
			}, () => updateGitProject(cwd));
			this.sync = result.state;
			await this.refresh();
			if (result.updated) {
				const choice = await vscode.window.showInformationMessage('Project updated. Refresh the project brain to map the new code.', 'Analyse project');
				if (choice === 'Analyse project') { await vscode.commands.executeCommand('myEditor.analyseProject'); }
			} else {
				void vscode.window.showWarningMessage(result.reason ?? 'The project could not be updated.');
			}
		} catch (error) {
			void vscode.window.showErrorMessage(`Git update failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.updating = false;
		}
	}

	private async onMessage(message: { type: string; stage?: string; path?: string; tab?: 'architecture' | 'tree' }): Promise<void> {
		switch (message.type) {
			case 'ready':
				return this.checkRemote();
			case 'checkGit':
				return this.checkRemote();
			case 'updateGit':
				return this.updateProject();
			case 'open':
				return this.openOrStart(message.stage ?? '', message.path);
			case 'conventions':
				return this.openConventions();
			case 'folder':
				return this.openFolder(message.path ?? '');
			case 'models':
				await vscode.commands.executeCommand('myEditor.chooseModel');
				return;
			case 'observations':
				await vscode.commands.executeCommand('myEditor.configureObservations');
				return;
			case 'brain':
				await vscode.commands.executeCommand('myEditor.analyseProject');
				return;
			case 'visual':
				await this.visuals.show(message.tab);
				return;
			case 'home':
				await vscode.commands.executeCommand('myEditor.home');
				return;
			case 'chat':
				await vscode.commands.executeCommand('myEditor.chat.openLounge');
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
		if (stage === 'build') {
			await vscode.commands.executeCommand('myEditor.nextFile');
			return;
		}
		if (stage === 'qa') {
			await vscode.commands.executeCommand('myEditor.checkFit', root);
			return;
		}
		await vscode.commands.executeCommand('myEditor.chat.start', stage);
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
		const allowed = new Set(['.my_editor/chats', '.my_editor/decisions', '.my_editor/investigations', '.my_editor/changes']);
		if (root && allowed.has(path)) {
			const folder = vscode.Uri.joinPath(root, path);
			await vscode.workspace.fs.createDirectory(folder);
			await vscode.commands.executeCommand('revealInExplorer', folder);
		}
	}
}
