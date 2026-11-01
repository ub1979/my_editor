import * as vscode from 'vscode';
import { effortSetting } from '../models/effort';
import { isReasoningEffort, isWebLink } from './chatGuards';
import type { Proposals } from './proposals';

/** A message from the chat webview (media/chat.js). */
export interface WebviewMessage {
	readonly type: string;
	readonly text?: string;
	readonly id?: string;
	readonly key?: string;
	readonly index?: number;
	readonly href?: string;
}

/** The chat actions a webview message can start. */
export interface ChatHandlers {
	readonly proposals: Proposals;
	/** A webview loaded: send it the state, then run any request that waited for it. */
	ready(sender?: vscode.Webview): Promise<void>;
	send(text: string): Promise<void>;
	openLounge(): Promise<void>;
	openSidebar(): Promise<void>;
	chooseCharacter(id: string | undefined): void;
	autoCharacter(): Promise<void>;
	setChatLayout(layout: string | undefined): void;
	pickSkill(id: string): Promise<void>;
	clearMode(): void;
	analyse(aiReady?: boolean): Promise<void>;
	declineAnalysis(): Promise<void>;
	newChat(): Promise<void>;
	stop(): void;
	runAction(messageId: string, index: number): Promise<void>;
	chooseAnswer(messageId: string, index: number): Promise<void>;
}

/** Routes one webview message; unknown types are ignored. */
export async function handleChatMessage(message: WebviewMessage, sender: vscode.Webview | undefined, chat: ChatHandlers): Promise<void> {
	switch (message.type) {
		case 'ready': return chat.ready(sender);
		case 'send': return chat.send(message.text ?? '');
		case 'openLounge': return chat.openLounge();
		case 'openSidebar': return chat.openSidebar();
		case 'character': return chat.chooseCharacter(message.id);
		case 'chatLayout': return chat.setChatLayout(message.id);
		case 'autoCharacter': return chat.autoCharacter();
		case 'skill': return chat.pickSkill(message.id ?? '');
		case 'clearMode': return chat.clearMode();
		case 'analyse': return chat.analyse();
		case 'aiReady': return chat.analyse(true);
		case 'notNow': return chat.declineAnalysis();
		case 'newChat': return chat.newChat();
		case 'stop': return chat.stop();
		case 'model':
			await setting('models.default', message.key);
			return;
		case 'reasoning':
			if (isReasoningEffort(message.key)) {
				const provider = message.id?.split(':')[0];
				const key = effortSetting(provider);
				if (key && (provider !== 'codex-cli' || message.key !== 'max')) { await setting(key, message.key); }
			}
			return;
		case 'chooseModel':
			await vscode.commands.executeCommand('myEditor.chooseModel');
			return;
		case 'review': return chat.proposals.show(message.id ?? '');
		case 'keep':
			await chat.proposals.keep(message.id ?? '');
			return;
		case 'undo': return chat.proposals.undo(message.id ?? '');
		case 'action': return chat.runAction(message.id ?? '', message.index ?? -1);
		case 'answer': return chat.chooseAnswer(message.id ?? '', message.index ?? -1);
		case 'link':
			if (isWebLink(message.href)) {
				await vscode.env.openExternal(vscode.Uri.parse(message.href));
			}
			return;
	}
}

async function setting(key: string, value: string | undefined): Promise<void> {
	await vscode.workspace.getConfiguration('myEditor').update(key, value, vscode.ConfigurationTarget.Global);
}
