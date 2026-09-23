import { randomBytes } from 'crypto';
import MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import { analyseProject } from '../brain/analyse';
import { EXCLUDE_GLOB, SOURCE_GLOB } from '../brain/brain';
import { loadCatalog, pickDefault } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { CONVERSATIONAL, PairEngine, Sink, Turn } from './engine';
import { Proposal, Proposals } from './proposals';
import { skillCards } from './skillCards';

const STATE_KEY = 'myEditor.chat.state';
/** Set once the user answered the "Analyse this project?" offer, either way. */
const ANALYSE_ANSWERED = 'myEditor.analyse.answered';
const MAX_KEPT_MESSAGES = 60;
/** Buttons a reply may offer; anything else is ignored. */
const ALLOWED_ACTIONS = new Set(['myEditor.saveDecision', 'myEditor.adaptFile', 'myEditor.analyseProject']);

interface ProposalCard {
	readonly id: string;
	readonly file: string;
	readonly added: number;
	readonly removed: number;
	readonly isNewFile: boolean;
	state: Proposal['state'];
}

interface Message {
	readonly id: string;
	readonly role: 'user' | 'assistant';
	markdown: string;
	mode?: string;
	progress?: string;
	error?: string;
	proposals: ProposalCard[];
	actions: { label: string; command: string; args: unknown[] }[];
	done: boolean;
}

interface Saved {
	messages: Message[];
	mode?: string;
}

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });

/**
 * The Pair chat: a panel of our own in the right sidebar. It keeps the conversation, runs the engine,
 * and shows each code change as a card with Review / Keep / Undo.
 */
export class ChatView implements vscode.WebviewViewProvider {
	static readonly id = 'myEditor.chat';
	private view: vscode.WebviewView | undefined;
	private messages: Message[] = [];
	private mode: string | undefined;
	private running: vscode.CancellationTokenSource | undefined;
	private pending: { text: string; mode?: string; kickoff?: boolean } | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly engine: PairEngine,
		private readonly proposals: Proposals,
		private readonly keys: ApiKeys,
	) {
		const saved = context.workspaceState.get<Saved>(STATE_KEY);
		this.messages = saved?.messages.map(m => ({ ...m, done: true, progress: undefined })) ?? [];
		this.mode = saved?.mode;
		context.subscriptions.push(
			proposals.onDidChange(proposal => this.onProposalChanged(proposal)),
			vscode.window.onDidChangeActiveTextEditor(() => this.postContext()),
			vscode.window.onDidChangeTextEditorSelection(() => this.postContext()),
			vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('myEditor') && this.postModels()),
			context.secrets.onDidChange(() => this.postModels()),
		);
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		view.webview.options = { enableScripts: true, localResourceRoots: [media] };
		const nonce = randomBytes(16).toString('base64');
		view.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource} data:; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'chat.css'))}"></head>
<body><div id="app"></div><script nonce="${nonce}" src="${view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'chat.js'))}"></script></body></html>`;
		view.webview.onDidReceiveMessage(message => void this.onMessage(message));
	}

	/** Opens the chat on a skill, e.g. from the Project view or after creating a project. */
	async startSkill(id: string): Promise<void> {
		await vscode.commands.executeCommand('myEditor.chat.focus');
		if (this.view) {
			await this.pickSkill(id);
		} else {
			this.pending = { text: '', mode: id, kickoff: true };
		}
	}

	/** Sends a request as if the user typed it (Adapt buttons, fit check). */
	async ask(text: string): Promise<void> {
		await vscode.commands.executeCommand('myEditor.chat.focus');
		if (this.view) {
			await this.send(text);
		} else {
			this.pending = { text };
		}
	}

	/** Reads the whole project into the brain and drafts its architecture ("Analyse this project"). */
	async analyse(): Promise<void> {
		await vscode.commands.executeCommand('myEditor.chat.focus');
		if (!this.view) {
			this.pending = { text: '', mode: ANALYSE };
			return;
		}
		if (this.running) {
			return;
		}
		await this.context.workspaceState.update(ANALYSE_ANSWERED, true);
		void this.view.webview.postMessage({ type: 'offer', offer: undefined });
		this.messages.push({ id: newId(), role: 'user', markdown: 'Analyse this project', proposals: [], actions: [], done: true });
		const reply: Message = { id: newId(), role: 'assistant', markdown: '', proposals: [], actions: [], done: false };
		this.messages.push(reply);
		this.postMessages();
		await this.runReply(reply, (sink, token) => analyseProject(this.keys, this.proposals, sink, token));
	}

	/**
	 * Whether to offer the analysis: a project with code but no brain yet, where the user has not answered.
	 * Returns how many code files there are, so the offer can say what it will read.
	 */
	async analyseOffer(): Promise<number | undefined> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root || this.context.workspaceState.get(ANALYSE_ANSWERED)) {
			return undefined;
		}
		try {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, '.my_editor', 'brain', 'map.json'));
			return undefined;
		} catch {
			// No brain yet.
		}
		const files = await vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB, 5_000);
		return files.length || undefined;
	}

	toggleSkills(): void {
		void this.view?.webview.postMessage({ type: 'toggleSkills' });
	}

	async newChat(): Promise<void> {
		this.running?.cancel();
		this.messages = [];
		this.mode = undefined;
		this.save();
		await this.postInit();
	}

	private async onMessage(message: { type: string; text?: string; id?: string; key?: string; index?: number; href?: string }): Promise<void> {
		switch (message.type) {
			case 'ready':
				await this.postInit();
				if (this.pending) {
					const pending = this.pending;
					this.pending = undefined;
					if (pending.mode === ANALYSE) {
						await this.analyse();
					} else if (pending.kickoff && pending.mode) {
						await this.pickSkill(pending.mode);
					} else {
						await this.send(pending.text);
					}
				}
				return;
			case 'send':
				return this.send(message.text ?? '');
			case 'skill':
				return this.pickSkill(message.id ?? '');
			case 'clearMode':
				this.mode = undefined;
				this.save();
				return this.postMode();
			case 'analyse':
				return this.analyse();
			case 'notNow':
				await this.context.workspaceState.update(ANALYSE_ANSWERED, true);
				void this.view?.webview.postMessage({ type: 'offer', offer: undefined });
				return;
			case 'newChat':
				return this.newChat();
			case 'stop':
				this.running?.cancel();
				return;
			case 'model':
				await vscode.workspace.getConfiguration('myEditor').update('models.default', message.key, vscode.ConfigurationTarget.Global);
				return;
			case 'chooseModel':
				await vscode.commands.executeCommand('myEditor.chooseModel');
				return;
			case 'review':
				return this.proposals.show(message.id ?? '');
			case 'keep':
				await this.proposals.keep(message.id ?? '');
				return;
			case 'undo':
				return this.proposals.undo(message.id ?? '');
			case 'action':
				return this.runAction(message.id ?? '', message.index ?? -1);
			case 'link':
				if (message.href && /^https?:\/\//.test(message.href)) {
					await vscode.env.openExternal(vscode.Uri.parse(message.href));
				}
				return;
		}
	}

	private async pickSkill(id: string): Promise<void> {
		const card = (await skillCards(this.context.extensionUri)).find(c => c.id === id);
		if (!card) {
			return;
		}
		if (id === 'analyse') {
			this.mode = undefined;
			this.save();
			this.postMode();
			await this.analyse();
			return;
		}
		this.mode = card.id;
		this.save();
		this.postMode();
		if (card.start === 'kickoff') {
			await this.send('', true);
		} else if (card.start === 'run') {
			await this.send('');
		} else {
			void this.view?.webview.postMessage({ type: 'focusComposer', placeholder: card.placeholder });
		}
	}

	private async send(text: string, kickoff = false): Promise<void> {
		if (this.running) {
			return;
		}
		const mode = this.mode;
		if (!kickoff) {
			if (!text.trim() && !mode) {
				return;
			}
			this.messages.push({ id: newId(), role: 'user', markdown: text.trim() || labelFor(mode), mode, proposals: [], actions: [], done: true });
		}
		const reply: Message = { id: newId(), role: 'assistant', markdown: '', mode, proposals: [], actions: [], done: false };
		const history: Turn[] = this.messages.filter(m => m.done && m.markdown).slice(0, kickoff ? undefined : -1).map(m => ({ role: m.role, text: m.markdown }));
		this.messages.push(reply);
		this.postMessages();

		await this.runReply(reply, async (sink, token) => {
			const result = await this.engine.run({ text, mode, kickoff }, history, sink, token);
			// Conversations keep their skill; code-writing requests run once, then chat is plain again.
			if (!CONVERSATIONAL.has(result.mode) && this.mode === mode && mode !== undefined && !mode.startsWith('skill:')) {
				this.mode = undefined;
			}
		});
	}

	/** Runs one job that writes into a reply: streamed text, progress, proposal cards, buttons and a Stop button. */
	private async runReply(reply: Message, job: (sink: Sink, token: vscode.CancellationToken) => Promise<void>): Promise<void> {
		const source = new vscode.CancellationTokenSource();
		this.running = source;
		this.postMode();
		let flush: NodeJS.Timeout | undefined;
		const sink: Sink = {
			text: chunk => {
				reply.markdown += chunk;
				flush ??= setTimeout(() => {
					flush = undefined;
					this.postMessage(reply);
				}, 50);
			},
			progress: message => {
				reply.progress = message;
				this.postMessage(reply);
			},
			proposal: proposal => {
				reply.proposals.push({ id: proposal.id, file: proposal.relativePath, added: proposal.added, removed: proposal.removed, isNewFile: proposal.isNewFile, state: proposal.state });
				this.postMessage(reply);
			},
			action: (label, command, args) => {
				reply.actions.push({ label, command, args });
			},
			error: message => {
				reply.error = message;
			},
		};
		try {
			await job(sink, source.token);
		} catch (err) {
			reply.error = err instanceof Error ? err.message : String(err);
		} finally {
			clearTimeout(flush);
			this.running = undefined;
			source.dispose();
			reply.done = true;
			reply.progress = undefined;
			if (!reply.markdown && !reply.error && !reply.proposals.length && !reply.actions.length) {
				reply.markdown = source.token.isCancellationRequested ? '_Stopped._' : '';
			}
			this.save();
			this.postMessage(reply);
			this.postMode();
		}
	}

	private async runAction(messageId: string, index: number): Promise<void> {
		const action = this.messages.find(m => m.id === messageId)?.actions[index];
		if (action && ALLOWED_ACTIONS.has(action.command)) {
			await vscode.commands.executeCommand(action.command, ...action.args);
		}
	}

	private onProposalChanged(proposal: Proposal): void {
		for (const message of this.messages) {
			const card = message.proposals.find(p => p.id === proposal.id);
			if (card) {
				card.state = proposal.state;
				this.postMessage(message);
			}
		}
		this.save();
	}

	private save(): void {
		void this.context.workspaceState.update(STATE_KEY, { messages: this.messages.slice(-MAX_KEPT_MESSAGES), mode: this.mode } satisfies Saved);
	}

	private async postInit(): Promise<void> {
		if (!this.view) {
			return;
		}
		void this.view.webview.postMessage({
			type: 'init',
			project: vscode.workspace.workspaceFolders?.[0]?.name,
			skills: await skillCards(this.context.extensionUri),
			messages: this.messages.map(render),
			offer: await this.analyseOffer(),
		});
		this.postMode();
		this.postContext();
		await this.postModels();
	}

	private postMessages(): void {
		void this.view?.webview.postMessage({ type: 'messages', messages: this.messages.map(render) });
	}

	private postMessage(message: Message): void {
		void this.view?.webview.postMessage({ type: 'message', message: render(message), running: !!this.running });
	}

	private postMode(): void {
		void this.view?.webview.postMessage({ type: 'mode', mode: this.mode, label: this.mode ? labelFor(this.mode) : undefined, running: !!this.running });
	}

	private postContext(): void {
		const editor = vscode.window.activeTextEditor;
		const file = editor && editor.document.uri.scheme === 'file' ? vscode.workspace.asRelativePath(editor.document.uri, false) : undefined;
		const selection = editor && !editor.selection.isEmpty ? `${editor.selection.start.line + 1}–${editor.selection.end.line + 1}` : undefined;
		void this.view?.webview.postMessage({ type: 'context', file, selection });
	}

	private async postModels(): Promise<void> {
		if (!this.view) {
			return;
		}
		const entries = await loadCatalog(this.keys);
		const current = pickDefault(entries);
		void this.view.webview.postMessage({
			type: 'models',
			current: current?.key,
			models: entries.map(e => ({ key: e.key, label: e.label, detail: e.detail })),
		});
	}
}

/** Stands in for a skill id while the analysis waits for the chat to open. */
const ANALYSE = '#analyse';

function newId(): string {
	return randomBytes(6).toString('hex');
}

const LABELS: Record<string, string> = {
	requirements: 'Requirements', architecture: 'Architecture', tree: 'Plan the files', brainstorm: 'Brainstorm',
	next: 'Next step', feature: 'Add a feature', change: 'Change selection', explain: 'Explain', why: 'Why is it like this?',
	review: 'Review', qa: 'Fit check', file: 'Write the file', impact: 'Impact',
};

function labelFor(mode: string | undefined): string {
	if (!mode) {
		return '';
	}
	if (mode.startsWith('skill:')) {
		const name = mode.slice(6);
		return name[0].toUpperCase() + name.slice(1);
	}
	return LABELS[mode] ?? mode;
}

/** What the webview draws: markdown rendered here with raw HTML disabled, so replies cannot inject markup. */
function render(message: Message) {
	return {
		id: message.id,
		role: message.role,
		html: message.markdown ? markdown.render(message.markdown) : '',
		label: message.role === 'user' && message.mode ? labelFor(message.mode) : undefined,
		progress: message.progress,
		error: message.error,
		proposals: message.proposals,
		actions: message.actions.map(a => a.label),
		done: message.done,
	};
}
