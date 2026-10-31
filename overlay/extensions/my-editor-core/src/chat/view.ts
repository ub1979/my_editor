import * as vscode from 'vscode';
import { readProjectState } from '../project/state';
import { ApiKeys } from '../models/secrets';
import { ActiveFileTracker } from './activeFile';
import { analysisTask, closeAnalysisOffer } from './analysisOffer';
import { ProposalEvent, saveProposalEvent } from './changeJournal';
import { character } from './characters';
import { projectCharacter, routeCharacter } from './characterRouting';
import { ChatBroadcast } from './chatBroadcast';
import { saveConversation } from './chatInit';
import { allowedAction } from './chatGuards';
import { ChatHandlers, handleChatMessage } from './chatMessages';
import { ChatPanels } from './chatPanels';
import { PendingRequest, pendingAnalysis, pendingStart } from './chatPending';
import { ChatState, SavedChat } from './chatState';
import { CONVERSATIONAL, PairEngine, Sink } from './engine';
import { Message } from './presentation';
import { Proposal, Proposals } from './proposals';
import { runChatTurn } from './replyRun';
import { runReplyJob } from './replyJob';
import { skillCards } from './skillCards';
import { newChatId } from './viewUpdates';

const STATE_KEY = 'myEditor.chat.state';

type ReplyJob = (sink: Sink, token: vscode.CancellationToken) => Promise<void>;

/** The Pair conversation shared by the sidebar and centered editor tab. */
export class ChatView implements vscode.WebviewViewProvider, ChatHandlers {
	static readonly id = 'myEditor.chat';
	private readonly panels: ChatPanels;
	private readonly state: ChatState;
	private readonly broadcast: ChatBroadcast;
	private projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
	private readonly activeFile = new ActiveFileTracker();
	private running: vscode.CancellationTokenSource | undefined;
	private pending: PendingRequest | undefined;
	private saveQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly engine: PairEngine,
		readonly proposals: Proposals,
		private readonly keys: ApiKeys,
	) {
		this.panels = new ChatPanels(context.extensionUri, (message, sender) => void handleChatMessage(message, sender, this));
		this.state = new ChatState(context.workspaceState.get<SavedChat>(STATE_KEY));
		this.broadcast = new ChatBroadcast({
			context, keys, state: this.state,
			webviews: () => this.panels.webviews(),
			activeFile: () => this.activeFile.current,
			running: () => !!this.running,
		});
		context.subscriptions.push(
			this.activeFile,
			proposals.onDidChange(proposal => this.onProposalChanged(proposal)),
			this.activeFile.onDidChange(() => this.broadcast.editorContext()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.selectForProject()),
			vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('myEditor') && this.broadcast.models()),
			context.secrets.onDidChange(() => this.broadcast.models()),
		);
		void this.selectForProject();
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.panels.resolveSidebar(view);
	}

	/** Shows the chat as a centered editor tab and closes the sidebar. */
	openLounge(): Promise<void> {
		return this.panels.openLounge();
	}

	openSidebar(): Promise<void> {
		return this.panels.openSidebar();
	}

	/** Opens the chat on a skill, e.g. from the Project view or after creating a project. */
	async startSkill(id: string): Promise<void> {
		await this.openLounge();
		if (this.broadcast.open) {
			await this.pickSkill(id);
		} else {
			this.pending = { text: '', mode: id, kickoff: true };
		}
	}

	/** Sends a request as if the user typed it (Adapt buttons, fit check). */
	async ask(text: string): Promise<void> {
		await this.openLounge();
		if (this.broadcast.open) {
			await this.send(text);
		} else {
			this.pending = { text };
		}
	}

	/** Reads the project into the brain and drafts its architecture; with aiReady, also writes the health report. */
	async analyse(aiReady = false): Promise<void> {
		await this.openLounge();
		if (!this.broadcast.open) {
			this.pending = pendingAnalysis(aiReady);
			return;
		}
		if (this.running) {
			return;
		}
		await closeAnalysisOffer(this.context, this.broadcast);
		const task = analysisTask(aiReady, this.keys, this.proposals);
		await this.runTask(task.label, task.job);
	}

	async declineAnalysis(): Promise<void> {
		await closeAnalysisOffer(this.context, this.broadcast);
	}

	/** Runs a host job as a Pair reply under a short request line, with progress, buttons and Stop (e.g. fixing on a branch). */
	async runTask(label: string, job: ReplyJob): Promise<void> {
		await this.openLounge();
		if (this.running) {
			return;
		}
		this.state.messages.push({ id: newChatId(), role: 'user', markdown: label, proposals: [], actions: [], done: true });
		const reply = this.state.addReply(newChatId());
		this.broadcast.messages();
		await this.runReply(reply, job);
	}

	toggleSkills(): void {
		this.broadcast.post({ type: 'toggleSkills' });
	}

	async newChat(): Promise<void> {
		this.running?.cancel();
		this.state.reset();
		this.save();
		await this.broadcast.init();
	}

	async ready(sender?: vscode.Webview): Promise<void> {
		await this.broadcast.init(sender);
		const pending = this.pending;
		if (!pending) {
			return;
		}
		this.pending = undefined;
		const start = pendingStart(pending);
		if (start.kind === 'analyse') {
			await this.analyse(start.aiReady);
		} else if (start.kind === 'skill') {
			await this.pickSkill(start.id);
		} else {
			await this.send(start.text);
		}
	}

	chooseCharacter(id: string | undefined): void {
		if (this.running) {
			return;
		}
		this.state.characterId = character(id).id;
		this.state.pinned = true;
		this.save();
		this.broadcast.character(true, 'Chosen by you');
	}

	async autoCharacter(): Promise<void> {
		this.state.pinned = false;
		await this.selectForProject();
	}

	clearMode(): void {
		this.state.clearMode();
		this.save();
		this.broadcast.mode();
	}

	stop(): void {
		this.running?.cancel();
	}

	async pickSkill(id: string): Promise<void> {
		const card = (await skillCards(this.context.extensionUri)).find(c => c.id === id);
		if (!card) {
			return;
		}
		if (id === 'analyse') {
			this.state.mode = undefined;
			this.save();
			this.broadcast.mode();
			await this.analyse();
			return;
		}
		this.state.mode = card.id;
		const route = routeCharacter('', card.id, this.state.characterId, false);
		if (route.reason) {
			this.state.characterId = route.id; this.state.pinned = false;
			this.broadcast.character(false, route.reason);
		}
		this.state.pendingPlaceholder = card.start === 'compose' ? card.placeholder : undefined;
		this.save();
		this.broadcast.mode();
		if (card.start === 'kickoff') {
			await this.send('', true);
		} else if (card.start === 'run') {
			await this.send('');
		} else {
			this.broadcast.post({ type: 'focusComposer', placeholder: this.state.pendingPlaceholder });
		}
	}

	async send(text: string, kickoff = false): Promise<void> {
		if (this.running) {
			return;
		}
		const state = this.state;
		const route = routeCharacter(text, state.mode, state.characterId, state.pinned);
		if (route.id !== state.characterId) {
			state.characterId = route.id;
			this.save();
			this.broadcast.character(false, route.reason);
		}
		state.pendingPlaceholder = undefined;
		const mode = state.mode;
		if (!kickoff) {
			if (!text.trim() && !mode) {
				return;
			}
			state.addUserMessage(newChatId(), text, mode);
		}
		const history = state.history(!kickoff);
		const reply = state.addReply(newChatId(), mode);
		// Save the user's full paste before asking a model, so a stopped or crashed run cannot lose it.
		this.save();
		try {
			await this.saveQueue;
		} catch {
			void vscode.window.showWarningMessage('Pair could not save this chat yet. Keep the editor open until storage is available.');
		}
		this.broadcast.messages();
		const turn = { text, mode, kickoff, reply, locateOnly: route.locateOnly, history };
		const context = {
			state, engine: this.engine, activeFile: () => this.activeFile.current, conversational: CONVERSATIONAL, save: () => this.save(),
		};
		await this.runReply(reply, (sink, token) => runChatTurn(turn, context, sink, token));
	}

	async runAction(messageId: string, index: number): Promise<void> {
		const action = this.state.messages.find(m => m.id === messageId)?.actions[index];
		if (action && allowedAction(action.command)) {
			await vscode.commands.executeCommand(action.command, ...action.args);
		}
	}

	/** The project's stage picks the character, unless the user pinned one. */
	private async selectForProject(): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
		if (root !== this.projectRoot) {
			this.projectRoot = root;
			this.state.pinned = false;
		}
		if (this.state.pinned) {
			return;
		}
		const id = projectCharacter(await readProjectState());
		// The folder may have changed, or the user pinned a character, while the state was read.
		if (root !== vscode.workspace.workspaceFolders?.[0]?.uri.toString() || this.state.pinned) {
			return;
		}
		this.state.characterId = id;
		this.save();
		this.broadcast.character(false, 'Project stage');
	}

	/** Runs one job that writes into a reply: streamed text, progress, proposal cards, buttons and a Stop button. */
	private async runReply(reply: Message, job: ReplyJob): Promise<void> {
		await runReplyJob(reply, job, {
			running: source => {
				this.running = source;
				this.broadcast.mode();
			},
			update: () => this.broadcast.message(reply),
			save: () => this.save(),
			proposal: proposal => recordProposal(reply.id, proposal, 'proposed'),
		});
	}

	private onProposalChanged(proposal: Proposal): void {
		for (const message of this.state.applyProposal(proposal)) {
			this.broadcast.message(message);
			if (proposal.state !== 'open') {
				recordProposal(message.id, proposal, proposal.state);
			}
		}
		this.save();
	}

	private save(): void {
		const snapshot = this.state.snapshot();
		this.saveQueue = this.saveQueue.catch(() => undefined).then(() => saveConversation(this.context, STATE_KEY, snapshot));
	}
}

/** Writes a proposal's event to the change journal; a failure only warns. */
function recordProposal(requestId: string, proposal: Proposal, event: ProposalEvent): void {
	void saveProposalEvent(requestId, proposal, event).catch(error =>
		vscode.window.showWarningMessage(`Could not save the change record: ${error instanceof Error ? error.message : String(error)}`));
}
