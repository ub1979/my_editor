import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import * as os from 'os';
import * as vscode from 'vscode';
import { shortPath } from './homePaths';
import { readProjectStateAt } from './state';

const PENDING_START = 'myEditor.home.pendingStart';
const LAST_PARENT = 'myEditor.home.lastParent';
const MAX_RECENT = 12;

interface RecentProject {
	readonly uri: string;
	readonly name: string;
	readonly path: string;
	readonly fullPath: string;
	readonly usesMyEditor: boolean;
	/** The five build stages, in order, with their state. Empty when the project does not use my_editor. */
	readonly stages: { title: string; state: 'empty' | 'started' | 'done' }[];
	/** The first stage not done yet, with its status line. */
	readonly next?: { title: string; status: string; index: number };
}

/** The start screen: recent projects with their progress, and new / open / clone. */
export class Home {
	private panel: vscode.WebviewPanel | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {}

	show(): void {
		if (this.panel) {
			this.panel.reveal();
			void this.refresh();
			return;
		}
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		this.panel = vscode.window.createWebviewPanel('myEditor.home', 'Home', vscode.ViewColumn.One,
			{ enableScripts: true, localResourceRoots: [media], retainContextWhenHidden: false });
		this.panel.iconPath = vscode.Uri.joinPath(media, 'project-icon.svg');
		const webview = this.panel.webview;
		const nonce = randomBytes(16).toString('base64');
		webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(media, 'home.css'))}"></head>
<body><main id="root"></main><script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(media, 'home.js'))}"></script></body></html>`;
		webview.onDidReceiveMessage(message => this.onMessage(message));
		this.panel.onDidDispose(() => (this.panel = undefined));
	}

	private async refresh(): Promise<void> {
		void this.panel?.webview.postMessage({ type: 'projects', projects: await recentProjects() });
	}

	private async onMessage(message: { type: string; uri?: string }): Promise<void> {
		switch (message.type) {
			case 'ready':
				return this.refresh();
			case 'new':
				return this.newProject();
			case 'open': {
				const [folder] = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Open project' }) ?? [];
				if (folder) {
					await vscode.commands.executeCommand('vscode.openFolder', folder);
				}
				return;
			}
			case 'clone':
				await vscode.commands.executeCommand('git.clone');
				return;
			case 'recent':
				if (message.uri) {
					await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.parse(message.uri));
				}
				return;
			case 'remove':
				// Only forgets the entry in the recent list; the folder on disk is untouched.
				if (message.uri) {
					await vscode.commands.executeCommand('vscode.removeFromRecentlyOpened', vscode.Uri.parse(message.uri));
					await this.refresh();
				}
				return;
		}
	}

	/** Name → location → folder with git and a starter `.my_editor/` → opened with /requirements ready. */
	private async newProject(): Promise<void> {
		const name = await vscode.window.showInputBox({
			title: 'New project', prompt: 'What is it called?', placeHolder: 'habit-tracker',
			validateInput: value => /^[\w .-]+$/.test(value.trim()) ? undefined : 'Use letters, numbers, spaces, dots, dashes or underscores.',
		});
		if (!name?.trim()) {
			return;
		}
		const lastParent = this.context.globalState.get<string>(LAST_PARENT);
		const [parent] = await vscode.window.showOpenDialog({
			canSelectFolders: true, canSelectFiles: false, openLabel: 'Create here',
			title: `Where should "${name.trim()}" live?`,
			defaultUri: vscode.Uri.file(lastParent ?? os.homedir()),
		}) ?? [];
		if (!parent) {
			return;
		}
		const folder = vscode.Uri.joinPath(parent, name.trim());
		try {
			await vscode.workspace.fs.stat(folder);
			void vscode.window.showErrorMessage(`${folder.fsPath} already exists. Pick another name or use Open project.`);
			return;
		} catch {
			// Does not exist yet: good.
		}
		const write = (path: string, text: string) => vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, path), new TextEncoder().encode(text));
		await write('README.md', `# ${name.trim()}\n`);
		await write('.my_editor/conventions.md', '# Conventions\n\nThese rules go into every request the pair makes. Keep them short and specific.\n');
		await new Promise<void>(resolve => execFile('git', ['init', '-q'], { cwd: folder.fsPath }, () => resolve()));
		await this.context.globalState.update(LAST_PARENT, parent.fsPath);
		await this.context.globalState.update(PENDING_START, folder.toString());
		await vscode.commands.executeCommand('vscode.openFolder', folder);
	}

	/** In a project just created from Home: the Requirements skill greets the user and starts the interview. */
	async continuePendingStart(): Promise<void> {
		const pending = this.context.globalState.get<string>(PENDING_START);
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
		if (!pending || pending !== root) {
			return;
		}
		await this.context.globalState.update(PENDING_START, undefined);
		await vscode.commands.executeCommand('myEditor.chat.start', 'requirements');
	}
}

/** Recently opened local folders, each with its my_editor progress. */
async function recentProjects(): Promise<RecentProject[]> {
	const recent = await vscode.commands.executeCommand<{ workspaces: { folderUri?: vscode.Uri; label?: string; remoteAuthority?: string }[] }>('_workbench.getRecentlyOpened');
	const folders = (recent?.workspaces ?? [])
		.filter(w => w.folderUri && w.folderUri.scheme === 'file' && !w.remoteAuthority)
		.slice(0, MAX_RECENT);
	const projects = await Promise.all(folders.map(async ({ folderUri }): Promise<RecentProject | undefined> => {
		const uri = vscode.Uri.from(folderUri!);
		const name = uri.path.split('/').pop() || uri.fsPath;
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			return undefined; // Moved or deleted.
		}
		let usesMyEditor = true;
		try {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(uri, '.my_editor'));
		} catch {
			usesMyEditor = false;
		}
		const path = shortPath(uri.fsPath, os.homedir());
		if (!usesMyEditor) {
			return { uri: uri.toString(), name, path, fullPath: uri.fsPath, usesMyEditor, stages: [] } satisfies RecentProject;
		}
		const state = await readProjectStateAt(uri, name);
		const index = state.stages.findIndex(s => s.state !== 'done');
		return {
			uri: uri.toString(), name, path, fullPath: uri.fsPath, usesMyEditor,
			stages: state.stages.map(s => ({ title: s.title, state: s.state })),
			next: index >= 0 ? { title: state.stages[index].title, status: state.stages[index].status, index } : undefined,
		} satisfies RecentProject;
	}));
	return projects.filter((p): p is RecentProject => p !== undefined);
}
