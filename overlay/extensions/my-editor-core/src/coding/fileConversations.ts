import { ChatTurn } from '../models/types';
import { redact } from '../records/redact';

export interface FileConversation { messages: ChatTurn[]; draft: string }
export type SavedFileConversations = Record<string, FileConversation>;

/** File identity, never the active agent or basename, owns the conversation. */
export class FileConversations {
	private readonly chats = new Map<string, FileConversation>();
	constructor(saved: SavedFileConversations = {}) {
		for (const [key, chat] of Object.entries(saved)) {
			this.chats.set(key, { messages: chat.messages.slice(-80), draft: chat.draft ?? '' });
		}
	}
	get(key: string): FileConversation {
		let chat = this.chats.get(key);
		if (!chat) { chat = { messages: [], draft: '' }; this.chats.set(key, chat); }
		return chat;
	}
	add(key: string, role: ChatTurn['role'], text: string): void {
		const chat = this.get(key);
		chat.messages.push({ role, text: redact(text) });
		chat.messages = chat.messages.slice(-80);
	}
	history(key: string): ChatTurn[] {
		const messages: ChatTurn[] = [];
		let size = 0;
		for (const message of [...this.get(key).messages].reverse()) {
			if (messages.length >= 20 || size + message.text.length > 24000) { break; }
			messages.unshift({ ...message }); size += message.text.length;
		}
		return messages;
	}
	reset(key: string): void { this.chats.set(key, { messages: [], draft: '' }); }
	rename(from: string, to: string): void {
		if (this.chats.has(from) && !this.chats.has(to)) {
			this.chats.set(to, this.chats.get(from)!); this.chats.delete(from);
		}
	}
	snapshot(): SavedFileConversations {
		return Object.fromEntries([...this.chats].map(([key, chat]) => [key,
			{ messages: chat.messages.map(message => ({ ...message })), draft: redact(chat.draft) }]));
	}
}
