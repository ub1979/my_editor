import * as vscode from 'vscode';
import { ApiKeys } from '../models/secrets';
import { ActiveFileTracker } from './activeFile';
import { analysisTask, closeAnalysisOffer } from './analysisOffer';
import { recordProposal } from './proposalRecord';
import { ChatBroadcast } from './chatBroadcast';
import { saveConversation } from './chatInit';
import { allowedAction } from './chatGuards';
import { ChatHandlers, handleChatMessage } from './chatMessages';
import { ChatPanels } from './chatPanels';
import { PendingRequest, pendingAnalysis, pendingStart } from './chatPending';
import { agentMode, ChatConversations, SavedConversations } from './chatConversations';
import { ChatNavigation } from './chatNavigation';
import { CONVERSATIONAL, PairEngine, Sink } from './engine';
import { Message } from './presentation';
import { Proposal, Proposals } from './proposals';
import { runChatTurn } from './replyRun';
import { runReplyJob } from './replyJob';
import { ReplySession } from './replySession';
import { newChatId } from './viewUpdates';
import { answerReplyChoice } from './replyChoices';
import { replyActions } from './replyActions';

const STATE_KEY = 'myEditor.chat.state';

type ReplyJob = (sink: Sink, token: vscode.CancellationToken) => Promise<void>;

/** Agent conversations presented in the sidebar or centered editor tab. */
export class ChatView implements vscode.WebviewViewProvider, ChatHandlers {
	static readonly id = 'myEditor.chat';
	private readonly panels: ChatPanels;
	private readonly conversations: ChatConversations;
	private readonly navigation: ChatNavigation;
	private get state() { return this.conversations.state; }
	private readonly broadcast: ChatBroadcast;
	private readonly activeFile = new ActiveFileTracker();
	private readonly replies = new ReplySession(runReplyJob);
	private pending: PendingRequest | undefined;
	private saveQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly engine: PairEngine,
		readonly proposals: Proposals,
		private readonly keys: ApiKeys,
	) {
		this.panels = new ChatPanels(context.extensionUri, (message, sender) => void handleChatMessage(message, sender, this));
		this.conversations = new ChatConversations(context.workspaceState.get<SavedConversations>(STATE_KEY));
		this.broadcast = new ChatBroadcast({
			context, keys, conversations: this.conversations,
			webviews: () => this.panels.webviews(),
			activeFile: () => this.activeFile.current,
			running: () => this.replies.running,
		});
		this.navigation = new ChatNavigation({ context, conversations: this.conversations, broadcast: this.broadcast,
			running: () => this.replies.running, save: () => this.save(), send: (text, kickoff) => this.send(text, kickoff), analyse: () => this.analyse() });
		context.subscriptions.push(
			this.activeFile,
			proposals.onDidChange(proposal => this.onProposalChanged(proposal)),
			this.activeFile.onDidChange(() => this.broadcast.editorContext()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.navigation.selectForProject()),
			vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('myEditor') && this.broadcast.models()),
			context.secrets.onDidChange(() => this.broadcast.models()),
		);
		void this.navigation.selectForProject();
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.panels.resolveSidebar(view);
	}

	/** Shows the chat as a centered editor tab and closes the sidebar. */
	openLounge(): Promise<void> { return this.panels.openLounge(); }

	openSidebar(): Promise<void> { return this.panels.openSidebar(); }

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
		if (this.replies.running) {
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
		if (this.replies.running) {
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
		this.replies.reset();
		this.state.reset();
		if (this.conversations.layout === 'agents') { this.state.mode = agentMode(this.state.characterId); }
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

	chooseCharacter(id: string | undefined): void { this.navigation.chooseCharacter(id); }

	setChatLayout(layout: string | undefined): void { this.navigation.setLayout(layout); }

	autoCharacter(): Promise<void> { return this.navigation.autoCharacter(); }

	clearMode(): void {
		this.state.clearMode();
		this.save();
		this.broadcast.mode();
	}

	stop(): void {
		this.replies.stop();
	}

	pickSkill(id: string): Promise<void> { return this.navigation.pickSkill(id); }

	async send(text: string, kickoff = false): Promise<void> {
		if (this.replies.running) {
			return;
		}
		const route = this.navigation.prepare(text);
		const state = this.state;
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
		this.broadcast.messages();
		const turn = { text, mode, kickoff, reply, locateOnly: route.locateOnly, history };
		const context = {
			state, engine: this.engine, activeFile: () => this.activeFile.current, conversational: CONVERSATIONAL, save: () => this.save(),
		};
		await this.runReply(reply, async (sink, token) => {
			try { await this.saveQueue; }
			catch { void vscode.window.showWarningMessage('Pair could not save this chat yet. Keep the editor open until storage is available.'); }
			await runChatTurn(turn, context, sink, token);
		});
	}
	async chooseAnswer(messageId: string, index: number): Promise<void> {
		await answerReplyChoice(this.state, messageId, index, this.replies.running, text => this.send(text));
	}
	async runAction(messageId: string, index: number): Promise<void> {
		const action = replyActions(this.state.messages.find(m => m.id === messageId))[index];
		if (action && allowedAction(action.command)) {
			await vscode.commands.executeCommand(action.command, ...action.args);
		}
	}

	/** Runs one job that writes into a reply: streamed text, progress, proposal cards, buttons and a Stop button. */
	private async runReply(reply: Message, job: ReplyJob): Promise<void> {
		await this.replies.run(reply, job, {
			running: () => this.broadcast.mode(),
			update: () => this.broadcast.message(reply),
			save: () => this.save(),
			proposal: proposal => recordProposal(reply.id, proposal, 'proposed'),
		});
	}

	private onProposalChanged(proposal: Proposal): void {
		const recorded = new Set<string>();
		for (const message of this.conversations.applyProposal(proposal)) {
			if (this.state.messages.includes(message)) { this.broadcast.message(message); }
			if (proposal.state !== 'open' && !recorded.has(message.id)) {
				recorded.add(message.id);
				recordProposal(message.id, proposal, proposal.state);
			}
		}
		this.save();
	}

	private save(): void {
		const snapshot = this.conversations.snapshot();
		this.saveQueue = this.saveQueue.catch(() => undefined).then(() => saveConversation(this.context, STATE_KEY, snapshot));
	}
}
