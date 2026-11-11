import * as vscode from 'vscode';
import { ApiKeys } from '../models/secrets';
import type { ActiveFile } from './activeFile';
import { ANALYSE_ANSWERED } from './analysisOffer';
import { chatInit } from './chatInit';
import { MAX_VISIBLE_MESSAGES } from './chatState';
import { ChatConversations } from './chatConversations';
import { labelFor, Message, render } from './presentation';
import { editorContextMessage, modelListMessage } from './viewUpdates';
import type { PlanningDocuments } from '../project/planning';
import { agentStartAction } from './agentStart';

/** What the broadcaster reads; the chat view owns all of it. */
export interface BroadcastSource {
	readonly context: vscode.ExtensionContext;
	readonly keys: ApiKeys;
	readonly conversations: ChatConversations;
	/** The open chat webviews: the sidebar, the centered tab, or both. */
	readonly webviews: () => vscode.Webview[];
	readonly activeFile: () => ActiveFile | undefined;
	readonly running: () => boolean;
}

/** Sends the chat's state to every open webview, so the sidebar and the centered tab stay in step. */
export class ChatBroadcast {
	private planning: PlanningDocuments = {};
	constructor(private readonly source: BroadcastSource) {}
	planningDocuments(docs: PlanningDocuments): void { this.planning = docs; this.mode(); }
	private agentAction() {
		const state = this.source.conversations.state;
		const action = agentStartAction(state.characterId, this.planning);
		return { label: action.label, description: action.description,
			used: this.source.conversations.agentActionWasUsed(action.label),
			disabled: this.source.running() || state.messages.some(message => message.proposals.some(proposal => proposal.state === 'open')) };
	}

	/** True when at least one chat webview is open. */
	get open(): boolean {
		return this.source.webviews().length > 0;
	}

	post(message: unknown): void {
		for (const webview of this.source.webviews()) {
			void webview.postMessage(message);
		}
	}

	/** The full starting state: to the webview that just loaded, or to all of them. */
	async init(target?: vscode.Webview): Promise<void> {
		if (!this.open) {
			return;
		}
		const { context, conversations } = this.source;
		const state = conversations.state;
		const message = await chatInit(context, state.messages, state.characterId, state.pinned, ANALYSE_ANSWERED, MAX_VISIBLE_MESSAGES);
		if (state !== conversations.state) { await this.init(target); return; }
		this.postTo(target, { ...message, messages: state.visibleMessages().map(render), characterId: state.characterId, pinned: state.pinned, conversationId: conversations.id, chatLayout: conversations.layout,
			mode: state.mode, label: state.mode ? labelFor(state.mode) : undefined, placeholder: state.pendingPlaceholder, agentAction: this.agentAction() });
		this.mode();
		this.editorContext();
		await this.models();
		if (state.pendingPlaceholder) {
			this.postTo(target, { type: 'focusComposer', placeholder: state.pendingPlaceholder });
		}
	}

	/** Switch transcript and identity together so a new agent never appears above the previous agent's messages. */
	conversation(): void {
		const { conversations } = this.source;
		const state = conversations.state;
		this.post({ type: 'conversation', conversationId: conversations.id, chatLayout: conversations.layout,
			characterId: state.characterId, pinned: state.pinned, messages: state.visibleMessages().map(render),
			mode: state.mode, label: state.mode ? labelFor(state.mode) : undefined, placeholder: state.pendingPlaceholder, agentAction: this.agentAction() });
		this.mode();
	}

	messages(): void {
		this.post({ type: 'messages', messages: this.source.conversations.state.visibleMessages().map(render) });
	}

	message(message: Message): void {
		this.post({ type: 'message', message: render(message), running: this.source.running() });
	}

	mode(): void {
		const { mode } = this.source.conversations.state;
		this.post({ type: 'mode', mode, label: mode ? labelFor(mode) : undefined, running: this.source.running(), agentAction: this.agentAction() });
	}

	editorContext(): void {
		this.post(editorContextMessage(this.source.activeFile()));
	}

	async models(): Promise<void> {
		if (this.open) {
			this.post(await modelListMessage(this.source.keys));
		}
	}

	character(pinned: boolean, reason: string | undefined): void {
		this.post({ type: 'character', characterId: this.source.conversations.state.characterId, pinned, reason });
	}

	private postTo(target: vscode.Webview | undefined, message: unknown): void {
		if (target) {
			void target.postMessage(message);
		} else {
			this.post(message);
		}
	}
}
