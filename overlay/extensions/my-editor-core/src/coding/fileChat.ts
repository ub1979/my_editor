import * as vscode from 'vscode';
import { agentChatVisible } from '../chat/chatVisibility';
import { ApiKeys } from '../models/secrets';
import { loadCatalog, pickDefault } from '../models/catalog';
import { streamModel } from '../models/stream';
import { logExchange } from '../records/chatLog';
import { redact } from '../records/redact';
import { FileConversations, SavedFileConversations } from './fileConversations';
import { chatFile, FILE_CHAT_SYSTEM, filePlan, plannedFile, sourceContext } from './fileContext';
import { fileChatHtml } from './fileChatHtml';
import { Proposals } from '../chat/proposals';
import { readBuildGuide } from '../project/buildStore';
import { buildFileBrief, BuildFileBrief } from '../project/buildBrief';
import { preparePlannedFile } from './plannedFileEdit';

const STORAGE = 'myEditor.fileChats.v1';
const PROMPTS: Record<string, string> = {
	start: 'Help me start implementing this file. Use the saved role, build tasks and checks. Explain why this file comes now, then give me the first concrete change to make and how to check it. At most 3 short bullets; focus only on this file.',
	implement: 'Prepare this file from the saved plan for a Keep/Undo review.',
	why: 'Why did we plan this file? Explain its purpose and how it fits in the saved design, briefly.',
	explain: 'Explain the selected code, or this file if nothing is selected. Why is it written this way?',
	review: 'Review the selected code, or this file if nothing is selected. What is missing or worth improving? Mention a better algorithm only if useful.',
};

/** A lightweight companion that follows the source editor, with one persisted conversation per URI. */
export class FileChat implements vscode.WebviewViewProvider, vscode.CodeLensProvider, vscode.Disposable {
	static readonly id = 'myEditor.fileChat';
	private readonly chats: FileConversations;
	private readonly running = new Map<string, vscode.CancellationTokenSource>();
	private readonly partial = new Map<string, string>();
	private readonly errors = new Map<string, string>();
	private readonly disposables: vscode.Disposable[] = [];
	private view?: vscode.WebviewView;
	private editor?: vscode.TextEditor;
	private saving: Promise<void> = Promise.resolve();
	private build?: BuildFileBrief;
	private buildRequest = 0;

	constructor(private readonly context: vscode.ExtensionContext, private readonly keys: ApiKeys, private readonly proposals: Proposals) {
		this.chats = new FileConversations(context.workspaceState.get<SavedFileConversations>(STORAGE));
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor(editor => this.follow(editor)),
			vscode.workspace.onDidRenameFiles(event => {
				for (const item of event.files) {
					const from = item.oldUri.toString(), to = item.newUri.toString();
					this.running.get(from)?.cancel();
					this.chats.rename(from, to);
				}
				void this.save(); this.post();
			}),
			vscode.workspace.onDidCloseTextDocument(document => {
				if (document === this.editor?.document) { this.editor = undefined; this.post(); }
			}),
			vscode.workspace.onDidSaveTextDocument(() => { void this.refreshBuild(); }),
			vscode.window.onDidChangeTextEditorSelection(event => {
				if (event.textEditor === this.editor) { this.post(); }
			}),
			vscode.window.registerWebviewViewProvider(FileChat.id, this, { webviewOptions: { retainContextWhenHidden: true } }),
			vscode.languages.registerCodeLensProvider({ scheme: 'file' }, this),
			vscode.commands.registerCommand('myEditor.fileChat.open', (uri?: vscode.Uri) => this.open(uri)),
			vscode.commands.registerCommand('myEditor.fileChat.ask', (text: string) => this.ask(text)),
			vscode.commands.registerCommand('myEditor.fileChat.action', (action: string, uri?: vscode.Uri) => this.action(action, uri)),
			vscode.commands.registerCommand('myEditor.fileChat.review', () => this.action('review')),
			vscode.commands.registerCommand('myEditor.fileChat.explain', () => this.action('explain')),
			vscode.commands.registerCommand('myEditor.fileChat.new', () => this.reset()),
		);
		// Restore file context without replacing the sidebar the user left open.
		this.follow(vscode.window.activeTextEditor, false);
	}

	private follow(editor?: vscode.TextEditor, reveal = true): void {
		// Focusing a webview or proposal should retain the source file and its selection.
		if (!editor || editor.document.uri.scheme !== 'file') { return; }
		const previous = this.editor?.document.uri.toString();
		this.editor = chatFile(editor.document) ? editor : undefined;
		if (previous !== this.editor?.document.uri.toString()) { this.build = undefined; void this.refreshBuild(); }
		this.post();
		if (reveal && this.editor && !agentChatVisible() && previous !== this.editor.document.uri.toString()
			&& vscode.workspace.getConfiguration('myEditor').get('fileChat.followEditor', true)) {
			void vscode.commands.executeCommand(`${FileChat.id}.focus`, { preserveFocus: true });
		}
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		view.webview.options = { enableScripts: true, localResourceRoots: [media] };
		view.webview.html = fileChatHtml(view.webview, media);
		view.webview.onDidReceiveMessage(message => {
			if (message?.type === 'ready') { this.post(); return; }
			const key = this.editor?.document.uri.toString();
			// A delayed click from an old file cannot run against the newly active editor.
			if (!key || message?.key !== key) { return; }
			if (message.type === 'draft' && typeof message.text === 'string') {
				this.chats.get(key).draft = message.text.slice(0, 12000); void this.save();
			} else if (message.type === 'send' && typeof message.text === 'string') { void this.ask(message.text); }
			else if (message.type === 'action' && PROMPTS[message.action]) { void this.action(message.action); }
			else if (message.type === 'stop') { this.running.get(key)?.cancel(); }
			else if (message.type === 'new') { this.reset(); }
			else if (message.type === 'model') { void vscode.commands.executeCommand('myEditor.chooseModel'); }
			else if (['buildFile', 'qaFile'].includes(message.type) && !this.running.has(key)) {
				void vscode.commands.executeCommand(message.type === 'buildFile' ? 'myEditor.projectBuild.file' : 'myEditor.projectQA.file', this.editor!.document.uri);
			}
			else if (message.type === 'buildNext' && !this.running.has(key)) { void vscode.commands.executeCommand('myEditor.buildGuide.following', this.editor!.document.uri); }
			else if (message.type === 'buildGuide') { void vscode.commands.executeCommand('myEditor.buildGuide.open'); }
			else if (message.type === 'buildProject' && !this.running.has(key)) { void vscode.commands.executeCommand('myEditor.projectBuild.start'); }
			else if (message.type === 'project') { void vscode.commands.executeCommand('myEditor.chat.openLounge'); }
		});
		this.post();
	}

	async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
		if (!chatFile(document)) { return []; }
		const planned = await plannedFile(document.uri);
		return [new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
			title: planned ? 'Why did we plan this file?' : 'Chat about this file', command: 'myEditor.fileChat.action',
			arguments: [planned ? 'why' : 'open', document.uri],
		})];
	}

	async open(uri?: vscode.Uri): Promise<void> {
		if (uri) { this.follow(await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: true })); }
		await this.refreshBuild();
		await vscode.commands.executeCommand(`${FileChat.id}.focus`);
		this.post();
		if (uri) { void this.view?.webview.postMessage({ type: 'buildFocus', key: uri.toString() }); }
	}

	async action(action: string, uri?: vscode.Uri): Promise<void> {
		if (uri) { this.follow(await vscode.window.showTextDocument(uri, { preserveFocus: true })); }
		if (PROMPTS[action]) { await this.ask(PROMPTS[action], action === 'implement'); }
		else { await this.open(); }
	}

	async ask(text: string, implement = false): Promise<void> {
		const editor = this.editor;
		if (!editor || !chatFile(editor.document) || !text?.trim()) { return; }
		const document = editor.document, key = document.uri.toString();
		if (this.running.has(key)) { return; }
		const prompt = text.trim().slice(0, 12000);
		const source = sourceContext(document, editor.selection);
		const version = document.version;
		const completeSource = document.getText();
		const history = this.chats.history(key);
		const cancellation = new vscode.CancellationTokenSource();
		this.running.set(key, cancellation); this.errors.delete(key);
		if (this.chats.get(key).draft.trim() === prompt) { this.chats.get(key).draft = ''; }
		this.chats.add(key, 'user', prompt);
		this.post();
		await this.open();
		try {
			await this.save();
			const [catalog, plan] = await Promise.all([loadCatalog(this.keys), filePlan(document.uri)]);
			if (cancellation.token.isCancellationRequested) { return; }
			const entry = pickDefault(catalog);
			if (!entry) { throw new Error('No model is available. Use Model to choose one.'); }
			let reply = '';
			if (implement) {
				const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
				const guide = root && await readBuildGuide(root);
				const brief = guide && buildFileBrief(guide, vscode.workspace.asRelativePath(document.uri, false));
				if (!brief || brief.blocked) { throw new Error('Choose a file in a ready build step first.'); }
				reply = await preparePlannedFile(document, completeSource, plan, entry, this.keys, this.proposals, cancellation.token);
			} else { await streamModel(entry, this.keys, { system: FILE_CHAT_SYSTEM, webAccess: false,
				turns: [...history, { role: 'user', text: `${source}\n\nSaved planning context:\n${plan}\n\nQuestion: ${redact(prompt)}` }],
				token: cancellation.token, onText: chunk => {
					reply += chunk; this.partial.set(key, redact(reply)); this.post();
				} }); }
			if (cancellation.token.isCancellationRequested) { return; }
			if (!reply.trim()) { throw new Error('The model returned no answer. Try again.'); }
			if (document.version !== version) { reply += '\n\nThis answer refers to the code before your latest edit.'; }
			this.chats.add(key, 'assistant', reply);
			await this.save();
			await logExchange({ mode: 'file', model: entry.key, file: vscode.workspace.asRelativePath(document.uri), prompt, reply });
		} catch (error) {
			if (!cancellation.token.isCancellationRequested) {
				this.errors.set(key, redact(error instanceof Error ? error.message : String(error)));
			}
		} finally {
			this.running.delete(key); this.partial.delete(key); cancellation.dispose(); this.post();
		}
	}

	private reset(): void {
		const key = this.editor?.document.uri.toString();
		if (!key || this.running.has(key)) { return; }
		this.chats.reset(key); this.errors.delete(key);
		void this.view?.webview.postMessage({ type: 'reset', key });
		void this.save(); this.post();
	}

	private post(): void {
		const editor = this.editor, key = editor?.document.uri.toString();
		void this.view?.webview.postMessage({ type: 'state', key,
			path: editor && vscode.workspace.asRelativePath(editor.document.uri),
			selection: editor && !editor.selection.isEmpty ? `Selected lines ${editor.selection.start.line + 1}–${editor.selection.end.line + 1}` : 'Whole file',
			chat: key ? this.chats.get(key) : undefined, build: this.build,
			busy: key ? this.running.has(key) : false, partial: key ? this.partial.get(key) : undefined,
			error: key ? this.errors.get(key) : undefined });
	}

	private async refreshBuild(): Promise<void> {
		const request = ++this.buildRequest, document = this.editor?.document;
		const root = document && vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
		const guide = root && await readBuildGuide(root);
		if (request !== this.buildRequest || document !== this.editor?.document) { return; }
		this.build = guide && document ? buildFileBrief(guide, vscode.workspace.asRelativePath(document.uri, false)) : undefined;
		this.post();
	}

	private save(): Promise<void> {
		const snapshot = this.chats.snapshot();
		this.saving = this.saving.catch(() => {}).then(() => this.context.workspaceState.update(STORAGE, snapshot));
		return this.saving;
	}

	dispose(): void {
		for (const token of this.running.values()) { token.cancel(); token.dispose(); }
		vscode.Disposable.from(...this.disposables).dispose();
	}
}
