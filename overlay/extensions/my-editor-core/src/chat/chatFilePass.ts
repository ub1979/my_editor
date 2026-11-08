import * as vscode from 'vscode';
import { filePassChanges } from '../project/filePassEvents';
import type { ProjectBuildState } from '../project/projectBuild';
import { passScope } from '../project/filePassScope';
import type { ActiveFile } from './activeFile';
import { passSource } from '../project/filePassSource';
import { RunPreview } from './runPreview';

interface Source {
	character(): string;
	file(): ActiveFile | undefined;
	busy(): boolean;
	post(message: unknown): void;
	sidebar(): Promise<void>;
	columns(): boolean;
}

/** Build and QA chats control the same durable queue as the project guide. */
export class ChatFilePass implements vscode.Disposable {
	private request = 0;
	private counts = new Map<string, string>();
	private following?: { root: string; agent: string; path?: string };
	private readonly preview = new RunPreview();
	private readonly subscription: vscode.Disposable;
	constructor(private readonly source: Source) {
		this.subscription = filePassChanges.event(() => { void this.refresh(); });
	}
	async refresh() {
		const request = ++this.request, agent = this.source.character();
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (this.following && (this.following.root !== root?.toString() || this.following.agent !== agent)) {
			this.following = undefined; await this.preview.close();
		}
		if (!root || !['ada', 'poppy'].includes(agent)) {
			this.source.post({ type: 'filePass', agent, root: root?.toString() }); return;
		}
		const kind = agent === 'ada' ? 'Build' : 'QA';
		const state = await vscode.commands.executeCommand<ProjectBuildState>('myEditor.projectBuild.status');
		let counts = '', problem = '';
		try {
			const key = root.toString() + kind;
			counts = this.counts.get(key) ?? '';
			if (!counts) {
				const { groups } = await passScope(root, kind);
				counts = `${groups.length} modules · ${groups.flatMap(group => group.files).length} files`;
				this.counts.set(key, counts);
			}
		} catch (error) { problem = error instanceof Error ? error.message : String(error); }
		if (request !== this.request || agent !== this.source.character() || root.toString() !== vscode.workspace.workspaceFolders?.[0]?.uri.toString()) { return; }
		this.source.post({ type: 'filePass', agent, root: root.toString(), counts, problem,
			run: state, file: this.source.file()?.uri.fsPath, following: !!this.following });
		const current = state?.currentFile?.path;
		const finished = current && state?.results?.some(result => result.path === current) && !state.repairQueue?.some(item => item.path === current);
		if (finished || state?.status === 'complete') { await this.preview.close(); }
		if (request !== this.request) { return; }
		if (this.following && this.source.columns() && current && !finished && current !== this.following.path && state!.status === 'running') {
			this.following.path = current;
			// Advance only a preview tab. Never switch away from an unsaved edit.
			if (vscode.window.activeTextEditor?.document.isDirty) { this.following = undefined; await this.refresh(); return; }
			await this.openFile(current, true);
		}
	}
	async action(action: string, agent?: string, root?: string, path?: string) {
		if (agent !== this.source.character() || root !== vscode.workspace.workspaceFolders?.[0]?.uri.toString()) { return; }
		const kind = agent === 'ada' ? 'Build' : agent === 'poppy' ? 'QA' : undefined;
		if (!kind) { return; }
		if (action === 'follow') {
			this.following = this.following ? undefined : { root: root!, agent: agent! };
			if (this.following) { await this.source.sidebar(); }
			else { await this.preview.close(); }
		} else if (action === 'open') {
			this.following = undefined;
			await this.source.sidebar(); await this.openFile(path);
		} else if (action === 'start' || action === 'file') {
			if (this.source.busy()) { return; }
			const uri = this.source.file()?.uri;
			if (action === 'file' && !uri) { return; }
			await vscode.commands.executeCommand(`myEditor.project${kind}.${action === 'file' ? 'file' : 'start'}`, ...(action === 'file' ? [uri] : []));
		} else {
			const commands: Record<string, string> = { pause: 'pause', resume: 'resume', keep: 'keep', review: 'review',
				test: 'test', report: 'report', answer: 'answer', model: 'model', saving: 'saving', speed: 'speed', buildFirst: 'buildFirst' };
			if (commands[action]) { await vscode.commands.executeCommand('myEditor.projectBuild.' + commands[action]); }
		}
		await this.refresh();
	}
	/** Only expose a path belonging to this run; a webview cannot request arbitrary files. */
	async openFile(path?: string, quiet = false): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root) { return; }
		const run = await vscode.commands.executeCommand<ProjectBuildState>('myEditor.projectBuild.status');
		const current = run?.currentFile?.path ?? run?.modules?.flatMap(group => group.files)[run.results?.length ?? 0];
		const target = path ?? current;
		if (!target || !run || run.root !== root.toString()
			|| !(target === current || run.results?.some(result => result.path === target) || run.pending.some(item => item.path === target))) { return; }
		try {
			const source = await passSource(root, target);
			if (root.toString() !== vscode.workspace.workspaceFolders?.[0]?.uri.toString()
				|| quiet && (!this.following || !this.source.columns())) { return; }
			if (source.source === undefined) {
				if (quiet && this.following) { this.following.path = undefined; }
				else { void vscode.window.showInformationMessage(`${target} has not been saved yet. Prepared code appears in the Build chat before saving.`); }
				return;
			}
			const uri = vscode.Uri.joinPath(root, target);
			if (quiet || target === current && (!run.results?.some(result => result.path === target) || run.repairQueue?.some(item => item.path === target))) {
				await this.preview.show(uri, () => root.toString() === vscode.workspace.workspaceFolders?.[0]?.uri.toString()
					&& (!quiet || !!this.following && this.following.path === target && this.source.columns()));
			} else {
				await this.preview.close();
				await vscode.window.showTextDocument(uri, { preview: true, preserveFocus: true, viewColumn: vscode.ViewColumn.Active });
			}
		} catch (error) { void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error)); }
	}
	dispose() { this.subscription.dispose(); this.preview.dispose(); }
}
