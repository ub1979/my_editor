import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { analyseProject } from '../brain/analyse';
import { readProjectState } from '../project/state';
import { ApiKeys } from '../models/secrets';
import { CONVERSATIONAL, PairEngine, Sink } from './engine';
import { fallbackBrief, liveTurns, memoryBatch, MemoryState } from './memory';
import { Proposal, Proposals } from './proposals';
import { labelFor, Message, render } from './presentation';
import { runReplyJob } from './replyJob';
import { saveProposalEvent } from './changeJournal';
import { skillCards } from './skillCards';
import { character, CharacterId } from './characters';
import { chatWebviewHtml } from './webviewHtml';
import { editorContextMessage, modelListMessage, newChatId } from './viewUpdates';
import { ActiveFileTracker } from './activeFile';
import { analysisOffer } from './analysisOffer';
import { projectCharacter, routeCharacter } from './characterRouting';
import { chatInit } from './chatInit';

const STATE_KEY = 'myEditor.chat.state';
/** Set once the user answered the "Analyse this project?" offer, either way. */
const ANALYSE_ANSWERED = 'myEditor.analyse.answered';
const MAX_KEPT_MESSAGES = 200;
const MAX_VISIBLE_MESSAGES = 60;
/** Buttons a reply may offer; anything else is ignored. */
const ALLOWED_ACTIONS = new Set(['myEditor.saveDecision', 'myEditor.adaptFile', 'myEditor.analyseProject']);

interface Saved {
	messages: Message[];
	mode?: string;
	memory?: MemoryState;
	characterId?: CharacterId;
	pinned?: boolean;
}
/** The Pair conversation shared by the sidebar and centered editor tab. */
export class ChatView implements vscode.WebviewViewProvider {
	static readonly id = 'myEditor.chat';
	private view: vscode.WebviewView | undefined;
	private lounge: vscode.WebviewPanel | undefined;
	private messages: Message[] = [];
	private characterId: CharacterId = 'bamboo';
	private pinned = false;
	private projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
	private readonly activeFile = new ActiveFileTracker();
	private pendingPlaceholder: string | undefined;
	private mode: string | undefined;
	private memory: MemoryState = { brief: '' };
	private running: vscode.CancellationTokenSource | undefined;
	private pending: { text: string; mode?: string; kickoff?: boolean } | undefined;
	private saveQueue: Promise<void> = Promise.resolve();
	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly engine: PairEngine,
		private readonly proposals: Proposals,
		private readonly keys: ApiKeys,
	) {
		const saved = context.workspaceState.get<Saved>(STATE_KEY);
		this.messages = saved?.messages.map(m => ({
			...m, done: true, progress: undefined,
			// Proposal contents live in memory. After restart, an unkept diff is no longer reviewable.
			proposals: m.proposals.map(proposal => proposal.state === 'open' ? { ...proposal, state: 'expired' as const } : proposal),
		})) ?? [];
		this.mode = saved?.mode;
		this.characterId = character(saved?.characterId).id;
		this.pinned = saved?.pinned ?? false;
		this.memory = saved?.memory ?? { brief: '' };
		context.subscriptions.push(
			this.activeFile,
			proposals.onDidChange(proposal => this.onProposalChanged(proposal)),
			this.activeFile.onDidChange(() => this.postContext()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.selectForProject()),
			vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('myEditor') && this.postModels()),
			context.secrets.onDidChange(() => this.postModels()),
		);
		void this.selectForProject();
	}
	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		view.webview.options = { enableScripts: true, localResourceRoots: [media] };
		const nonce = randomBytes(16).toString('base64');
		view.webview.html = chatWebviewHtml(view.webview, media, 'sidebar', nonce);
		view.webview.onDidReceiveMessage(message => void this.onMessage(message, view.webview));
		view.onDidChangeVisibility(() => { if (view.visible) { this.lounge?.dispose(); } });
	}
	async openLounge(): Promise<void> {
		if (this.lounge) { this.lounge.reveal(vscode.ViewColumn.Active); await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar'); return; }
		const panel = vscode.window.createWebviewPanel('myEditor.chatLounge', 'Pair', vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] });
		this.lounge = panel;
		panel.webview.onDidReceiveMessage(message => void this.onMessage(message, panel.webview));
		panel.onDidDispose(() => { this.lounge = undefined; });
		panel.webview.html = chatWebviewHtml(panel.webview, vscode.Uri.joinPath(this.context.extensionUri, 'media'), 'lounge', randomBytes(16).toString('base64'));
		await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
	}
	private webviews(): vscode.Webview[] { return [this.view?.webview, this.lounge?.webview].filter((view): view is vscode.Webview => !!view); }
	private broadcast(message: unknown): void { for (const webview of this.webviews()) { void webview.postMessage(message); } }
	/** Opens the chat on a skill, e.g. from the Project view or after creating a project. */
	async startSkill(id: string): Promise<void> {
		await this.openLounge();
		if (this.webviews().length) {
			await this.pickSkill(id);
		} else {
			this.pending = { text: '', mode: id, kickoff: true };
		}
	}

	/** Sends a request as if the user typed it (Adapt buttons, fit check). */
	async ask(text: string): Promise<void> {
		await this.openLounge();
		if (this.webviews().length) {
			await this.send(text);
		} else {
			this.pending = { text };
		}
	}

	/** Reads the whole project into the brain and drafts its architecture ("Analyse this project"). */
	async analyse(): Promise<void> {
		await this.openLounge();
		if (!this.webviews().length) {
			this.pending = { text: '', mode: ANALYSE };
			return;
		}
		if (this.running) {
			return;
		}
		await this.context.workspaceState.update(ANALYSE_ANSWERED, true);
		this.broadcast({ type: 'offer', offer: undefined });
		this.messages.push({ id: newChatId(), role: 'user', markdown: 'Analyse this project', proposals: [], actions: [], done: true });
		const reply: Message = { id: newChatId(), role: 'assistant', characterId: this.characterId, markdown: '', proposals: [], actions: [], done: false };
		this.messages.push(reply);
		this.postMessages();
		await this.runReply(reply, (sink, token) => analyseProject(this.keys, this.proposals, sink, token));
	}

	/** Count code files for the one-time project analysis offer. */
	async analyseOffer(): Promise<number | undefined> {
		return analysisOffer(this.context, ANALYSE_ANSWERED);
	}

	private async selectForProject(): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
		if (root !== this.projectRoot) { this.projectRoot = root; this.pinned = false; }
		if (this.pinned) { return; }
		const id = projectCharacter(await readProjectState());
		if (root !== vscode.workspace.workspaceFolders?.[0]?.uri.toString() || this.pinned) { return; }
		this.characterId = id;
		this.save();
		this.broadcast({ type: 'character', characterId: id, pinned: false, reason: 'Project stage' });
	}

	toggleSkills(): void {
		this.broadcast({ type: 'toggleSkills' });
	}
	async newChat(): Promise<void> {
		this.running?.cancel();
		this.messages = [];
		this.mode = undefined;
		this.pendingPlaceholder = undefined;
		this.memory = { brief: '' };
		this.save();
		await this.postInit();
	}

	private async onMessage(message: { type: string; text?: string; id?: string; key?: string; index?: number; href?: string }, sender?: vscode.Webview): Promise<void> {
		switch (message.type) {
			case 'ready':
				await this.postInit(sender);
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
			case 'openLounge':
				return this.openLounge();
			case 'openSidebar':
				await vscode.commands.executeCommand('myEditor.chat.focus');
				this.lounge?.dispose();
				return;
			case 'character':
				if (this.running) { return; }
				this.characterId = character(message.id).id;
				this.pinned = true;
				this.save();
				this.broadcast({ type: 'character', characterId: this.characterId, pinned: true, reason: 'Chosen by you' });
				return;
			case 'autoCharacter':
				this.pinned = false;
				await this.selectForProject();
				return;
			case 'skill':
				return this.pickSkill(message.id ?? '');
			case 'clearMode':
				this.mode = undefined;
				this.pendingPlaceholder = undefined;
				this.save();
				return this.postMode();
			case 'analyse':
				return this.analyse();
			case 'notNow':
				await this.context.workspaceState.update(ANALYSE_ANSWERED, true);
				this.broadcast({ type: 'offer', offer: undefined });
				return;
			case 'newChat':
				return this.newChat();
			case 'stop':
				this.running?.cancel();
				return;
			case 'model':
				await vscode.workspace.getConfiguration('myEditor').update('models.default', message.key, vscode.ConfigurationTarget.Global);
				return;
			case 'reasoning':
				if (['default', 'low', 'medium', 'high', 'xhigh'].includes(message.key ?? '')) {
					await vscode.workspace.getConfiguration('myEditor').update('codexCli.reasoningEffort', message.key, vscode.ConfigurationTarget.Global);
				}
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
		this.pendingPlaceholder = card.start === 'compose' ? card.placeholder : undefined;
		this.save();
		this.postMode();
		if (card.start === 'kickoff') {
			await this.send('', true);
		} else if (card.start === 'run') {
			await this.send('');
		} else {
			this.broadcast({ type: 'focusComposer', placeholder: this.pendingPlaceholder });
		}
	}

	private async send(text: string, kickoff = false): Promise<void> {
		if (this.running) {
			return;
		}
		const route = routeCharacter(text, this.mode, this.characterId, this.pinned);
		if (route.id !== this.characterId) {
			this.characterId = route.id;
			this.save();
			this.broadcast({ type: 'character', characterId: route.id, pinned: false, reason: route.reason });
		}
		this.pendingPlaceholder = undefined;
		const mode = this.mode;
		if (!kickoff) {
			if (!text.trim() && !mode) {
				return;
			}
			this.messages.push({ id: newChatId(), role: 'user', markdown: text.trim() || labelFor(mode), mode, proposals: [], actions: [], done: true });
		}
		const reply: Message = { id: newChatId(), role: 'assistant', characterId: this.characterId, markdown: '', mode, proposals: [], actions: [], done: false };
		const prior = this.messages.filter(m => m.done && m.markdown).slice(0, kickoff ? undefined : -1);
		const memoryMessages = prior.map(m => ({ id: m.id, role: m.role, text: m.markdown }));
		this.messages.push(reply);
		// Save the user's full paste before asking a model, so a stopped or crashed run cannot lose it.
		this.save();
		try { await this.saveQueue; }
		catch { void vscode.window.showWarningMessage('Pair could not save this chat yet. Keep the editor open until storage is available.'); }
		this.postMessages();

		await this.runReply(reply, async (sink, token) => {
			const deterministic = mode === 'changes' || mode === 'impact' || /^\/(changes|impact)\b/.test(text.trim());
			let batch = deterministic ? [] : memoryBatch(memoryMessages, this.memory);
			while (batch.length) {
				sink.progress('Keeping track of earlier conversation…');
				let brief: string;
				try {
					brief = await this.engine.compactHistory(this.memory.brief, batch, token);
				} catch {
					brief = fallbackBrief(this.memory.brief, batch);
				}
				if (token.isCancellationRequested) { return; }
				this.memory = { brief, throughId: batch[batch.length - 1].id };
				this.save();
				batch = memoryBatch(memoryMessages, this.memory);
			}
			sink.progress('');
			const live = liveTurns(memoryMessages, this.memory).map(turn => ({ role: turn.role, text: turn.text }));
			const proposalState = this.messages.flatMap(message => message.proposals.map(proposal => `${proposal.file}: ${proposal.state}`)).slice(-12).join('\n');
			const result = await this.engine.run({ text, mode, kickoff, characterId: reply.characterId, locateOnly: route.locateOnly, activeFile: this.activeFile.current, memory: this.memory.brief, proposalState, requestId: reply.id,
				chatArchive: memoryMessages.map(message => ({ role: message.role, text: message.text })) }, live, sink, token);
			// Conversations keep their skill; code-writing requests run once, then chat is plain again.
			if (!CONVERSATIONAL.has(result.mode) && this.mode === mode && mode !== undefined && !mode.startsWith('skill:')) {
				this.mode = undefined;
			}
		});
	}

	/** Runs one job that writes into a reply: streamed text, progress, proposal cards, buttons and a Stop button. */
	private async runReply(reply: Message, job: (sink: Sink, token: vscode.CancellationToken) => Promise<void>): Promise<void> {
		await runReplyJob(reply, job, {
			running: source => { this.running = source; this.postMode(); },
			update: () => this.postMessage(reply),
			save: () => this.save(),
			proposal: proposal => { void saveProposalEvent(reply.id, proposal, 'proposed').catch(error =>
				vscode.window.showWarningMessage(`Could not save the change record: ${error instanceof Error ? error.message : String(error)}`)); },
		});
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
				if (proposal.state !== 'open') {
					void saveProposalEvent(message.id, proposal, proposal.state).catch(error =>
						vscode.window.showWarningMessage(`Could not save the change record: ${error instanceof Error ? error.message : String(error)}`));
				}
			}
		}
		this.save();
	}

	private save(): void {
		this.messages = this.messages.slice(-MAX_KEPT_MESSAGES);
		const snapshot = {
			messages: this.messages.map(message => ({ ...message, proposals: [...message.proposals], actions: [...message.actions] })),
			mode: this.mode, memory: this.memory, characterId: this.characterId, pinned: this.pinned,
		} satisfies Saved;
		this.saveQueue = this.saveQueue.catch(() => undefined).then(() => this.context.workspaceState.update(STATE_KEY, snapshot));
	}

	private async postInit(target?: vscode.Webview): Promise<void> {
		if (!this.webviews().length) { return; }
		const message = await chatInit(this.context, this.messages, this.characterId, this.pinned, ANALYSE_ANSWERED, MAX_VISIBLE_MESSAGES);
		if (target) { void target.postMessage(message); }
		else { this.broadcast(message); }
		this.postMode();
		this.postContext();
		await this.postModels();
		if (this.pendingPlaceholder) {
			const focus = { type: 'focusComposer', placeholder: this.pendingPlaceholder };
			if (target) { void target.postMessage(focus); }
			else { this.broadcast(focus); }
		}
	}

	private postMessages(): void { this.broadcast({ type: 'messages', messages: this.messages.slice(-MAX_VISIBLE_MESSAGES).map(render) }); }

	private postMessage(message: Message): void { this.broadcast({ type: 'message', message: render(message), running: !!this.running }); }

	private postMode(): void { this.broadcast({ type: 'mode', mode: this.mode, label: this.mode ? labelFor(this.mode) : undefined, running: !!this.running }); }

	private postContext(): void { this.broadcast(editorContextMessage(this.activeFile.current)); }

	private async postModels(): Promise<void> {
		if (this.webviews().length) { this.broadcast(await modelListMessage(this.keys)); }
	}
}

/** Stands in for a skill id while the analysis waits for the chat to open. */
const ANALYSE = '#analyse';
