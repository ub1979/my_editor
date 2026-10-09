import * as vscode from 'vscode';
import { ApiKeys } from '../models/secrets';
import type { ActiveFile } from './activeFile';
import { ANALYSE_ANSWERED } from './analysisOffer';
import { chatInit } from './chatInit';
import { ChatState, MAX_VISIBLE_MESSAGES } from './chatState';
import { labelFor, Message, render } from './presentation';
import { editorContextMessage, modelListMessage } from './viewUpdates';

/** What the broadcaster reads; the chat view owns all of it. */
export interface BroadcastSource {
	readonly context: vscode.ExtensionContext;
	readonly keys: ApiKeys;
	readonly state: ChatState;
	/** The open chat webviews: the sidebar, the centered tab, or both. */
	readonly webviews: () => vscode.Webview[];
	readonly activeFile: () => ActiveFile | undefined;
	readonly running: () => boolean;
}

/** Sends the chat's state to every open webview, so the sidebar and the centered tab stay in step. */
export class ChatBroadcast {
	constructor(private readonly source: BroadcastSource) {}

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
		const { context, state } = this.source;
		const message = await chatInit(context, state.messages, state.characterId, state.pinned, ANALYSE_ANSWERED, MAX_VISIBLE_MESSAGES);
		this.postTo(target, message);
		this.mode();
		this.editorContext();
		await this.models();
		if (state.pendingPlaceholder) {
			this.postTo(target, { type: 'focusComposer', placeholder: state.pendingPlaceholder });
		}
	}

	messages(): void {
		this.post({ type: 'messages', messages: this.source.state.visibleMessages().map(render) });
	}

	message(message: Message): void {
		this.post({ type: 'message', message: render(message), running: this.source.running() });
	}

	mode(): void {
		const { mode } = this.source.state;
		this.post({ type: 'mode', mode, label: mode ? labelFor(mode) : undefined, running: this.source.running() });
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
		this.post({ type: 'character', characterId: this.source.state.characterId, pinned, reason });
	}

	private postTo(target: vscode.Webview | undefined, message: unknown): void {
		if (target) {
			void target.postMessage(message);
		} else {
			this.post(message);
		}
	}
}
