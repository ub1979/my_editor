import * as vscode from 'vscode';
import { ChatFilePass } from './chatFilePass';
import { character } from './characters';
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
import { answerReplyChoice, selectedReplyChoice } from './replyChoices';
import { replyActions } from './replyActions';
import { readPlanningDocuments } from '../project/planningFiles';
import { agentStartAction } from './agentStart';

const STATE_KEY = 'myEditor.chat.state';

type ReplyJob = (sink: Sink, token: vscode.CancellationToken) => Promise<void>;

/** Agent conversations presented in the sidebar or centered editor tab. */
export class ChatView implements vscode.WebviewViewProvider, ChatHandlers {
	static readonly id = 'myEditor.chat';
	private readonly panels: ChatPanels;
	private readonly conversations: ChatConversations;
	private readonly filePass: ChatFilePass;
	private readonly navigation: ChatNavigation;
	private get state() { return this.conversations.state; }
	private readonly broadcast: ChatBroadcast;
	private readonly activeFile = new ActiveFileTracker();
	private readonly replies = new ReplySession(runReplyJob);
	private pending: PendingRequest | undefined;
	private saveQueue: Promise<void> = Promise.resolve();
	private planningRefresh = 0;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly engine: PairEngine,
		readonly proposals: Proposals,
		private readonly keys: ApiKeys,
	) {
		this.panels = new ChatPanels(context.extensionUri, (message, sender) => void handleChatMessage(message, sender, this),
			() => character(this.state.characterId).name);
		this.conversations = new ChatConversations(context.workspaceState.get<SavedConversations>(STATE_KEY));
		this.broadcast = new ChatBroadcast({
			context, keys, conversations: this.conversations,
			webviews: () => this.panels.webviews(),
			activeFile: () => this.activeFile.current,
			running: () => this.replies.running,
		});
		this.filePass = new ChatFilePass({ character: () => this.state.characterId, file: () => this.activeFile.current,
			busy: () => this.replies.running, post: message => this.broadcast.post(message), sidebar: () => this.panels.openSidebar(),
			columns: () => this.panels.sidebarVisible });
		this.navigation = new ChatNavigation({ context, conversations: this.conversations, broadcast: this.broadcast,
			running: () => this.replies.running, save: () => this.save(), send: (text, kickoff) => this.send(text, kickoff), analyse: () => this.analyse() });
		const plans = vscode.workspace.createFileSystemWatcher('**/.my_editor/specs/*');
		context.subscriptions.push(
			this.activeFile, this.filePass, plans,
			plans.onDidCreate(() => void this.refreshPlanningStatus()),
			plans.onDidChange(() => void this.refreshPlanningStatus()),
			plans.onDidDelete(() => void this.refreshPlanningStatus()),
			proposals.onDidChange(proposal => this.onProposalChanged(proposal)),
			this.activeFile.onDidChange(() => { this.broadcast.editorContext(); void this.filePass.refresh(); }),
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
	async openAgent(id: string): Promise<void> {
		this.chooseCharacter(id);
		if (this.panels.sidebarVisible) { await this.openSidebar(); } else { await this.openLounge(); }
	}

	async openSidebar(): Promise<void> {
		await this.panels.openSidebar();
		if (['ada', 'poppy'].includes(this.state.characterId)) { await this.filePass.openFile(); }
		else if (this.activeFile.current) { await vscode.window.showTextDocument(this.activeFile.current.uri, { preserveFocus: true }); }
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
	async ask(text: string, planningDraft?: string): Promise<void> {
		await this.openLounge();
		if (this.broadcast.open) {
			await this.send(text, false, planningDraft);
		} else {
			this.pending = { text, planningDraft };
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
		await this.refreshPlanningStatus();
		await this.broadcast.init(sender);
		await this.filePass.refresh();
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
			await this.send(start.text, false, start.planningDraft);
		}
	}

	chooseCharacter(id: string | undefined): void { this.navigation.chooseCharacter(id); void this.filePass.refresh(); }

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

	async pickSkill(id: string): Promise<void> { await this.navigation.pickSkill(id); await this.filePass.refresh(); }

	async startAgent(id?: string): Promise<void> {
		if (id !== this.state.characterId || this.replies.running) { return; }
		const state = this.state, root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root) { void vscode.window.showInformationMessage('Open a project before starting an agent.'); return; }
		const docs = await readPlanningDocuments(root);
		if (state !== this.state || id !== state.characterId || this.replies.running
			|| root.toString() !== vscode.workspace.workspaceFolders?.[0]?.uri.toString()) { return; }
		if (state.messages.some(message => message.proposals.some(proposal => proposal.state === 'open'))) {
			void vscode.window.showInformationMessage('Review the open proposals and choose Keep or Undo before starting another task.'); return;
		}
		const action = agentStartAction(state.characterId, docs);
		this.conversations.markAgentActionUsed(action.label);
		state.mode = agentMode(state.characterId);
		await this.send(action.text, action.kickoff);
	}

	async send(text: string, kickoff = false, planningDraft?: string): Promise<void> {
		if (this.replies.running) {
			return;
		}
		const route = this.navigation.prepare(text);
		void this.filePass.refresh();
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
		const turn = { text, planningDraft, mode, kickoff, reply, locateOnly: route.locateOnly, history };
		const context = {
			state, engine: this.engine, activeFile: () => this.activeFile.current, conversational: CONVERSATIONAL, save: () => this.save(),
		};
		await this.runReply(reply, async (sink, token) => {
			try { await this.saveQueue; }
			catch { void vscode.window.showWarningMessage('Pair could not save this chat yet. Keep the editor open until storage is available.'); }
			await runChatTurn(turn, context, sink, token);
		});
	}
	filePassAction(action: string, agent?: string, root?: string, path?: string): Promise<void> {
		return this.filePass.action(action, agent, root, path);
	}

	async chooseAnswer(messageId: string, index: number): Promise<void> {
		if (this.replies.running) { return; }
		const state = this.state;
		const selected = selectedReplyChoice(state.messages, messageId, index);
		if (!selected) { return; }
		await this.refreshPlanningStatus();
		// A changed saved prerequisite may replace the visible suggestion while this click waits.
		if (state !== this.state || selectedReplyChoice(state.messages, messageId, index)?.text !== selected.text) { return; }
		await answerReplyChoice(state, messageId, index, this.replies.running, text => this.send(text),
			mode => { this.navigation.prepare(`/${mode}`); });
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
		await this.refreshPlanningStatus();
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
		this.broadcast.mode();
		if (proposal.relativePath.startsWith('.my_editor/specs/')) { void this.refreshPlanningStatus(); }
	}

	private async refreshPlanningStatus(): Promise<void> {
		const request = ++this.planningRefresh;
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root) { return; }
		const docs = await readPlanningDocuments(root);
		if (request !== this.planningRefresh || root.toString() !== vscode.workspace.workspaceFolders?.[0]?.uri.toString()) { return; }
		const changed = this.conversations.refreshPlanningStatus(docs);
		this.broadcast.planningDocuments(docs);
		for (const message of changed) {
			if (this.state.messages.includes(message)) { this.broadcast.message(message); }
		}
		if (changed.length) { this.save(); }
	}

	private save(): void {
		const snapshot = this.conversations.snapshot();
		this.saveQueue = this.saveQueue.catch(() => undefined).then(() => saveConversation(this.context, STATE_KEY, snapshot));
	}
}
