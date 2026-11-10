import type { ChatTurn } from '../models/types';
import { looksLikeAgentProtocol } from './agentProtocol';
import { fencedBlocks } from '../pair/fencedBlocks';

const MAX_CHAT_CHARS = 6_000;
const INDEX_MESSAGES = 16;

/** List recent stored turns without spending the model's context on long pasted logs. */
export function chatArchiveIndex(messages: readonly ChatTurn[], supplied: readonly ChatTurn[] = []): string {
	if (!messages.length) { return 'No earlier chat messages are stored.'; }
	const entries = messages.slice(-INDEX_MESSAGES).reverse().flatMap((message, index) => {
		if (supplied.some(turn => turn.role === message.role && turn.text === message.text)) { return []; }
		const preview = message.role === 'assistant' && looksLikeAgentProtocol(message.text)
			? '[earlier internal tool request; not a finding]'
			: message.text.replace(/\s+/g, ' ').slice(0, 100);
		return `${index + 1} turn${index ? 's' : ''} ago: ${message.role}, ${message.text.length} characters${preview ? `, starts: ${preview}` : ''}`;
	});
	return entries.length ? `Recent stored chat messages (read_chat can retrieve any of the last ${messages.length}):\n${entries.join('\n')}` : '';
}

/** Find earlier user requests and assistant decisions without treating internal tool JSON as evidence. */
export function searchChatMessages(messages: readonly ChatTurn[], query: unknown): string {
	if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120) {
		return 'Search needs a text query of 2–120 characters.';
	}
	const needle = query.toLowerCase();
	const found: string[] = [];
	for (let index = messages.length - 1; index >= 0 && found.length < 20; index--) {
		const message = messages[index];
		if (message.role === 'assistant' && looksLikeAgentProtocol(message.text)) { continue; }
		const at = message.text.toLowerCase().indexOf(needle);
		if (at < 0) { continue; }
		const excerpt = message.text.slice(Math.max(0, at - 60), Math.min(message.text.length, at + query.length + 100)).replace(/\s+/g, ' ');
		found.push(`${messages.length - index} turns ago (${message.role}), character ${at}: ${excerpt}`);
	}
	return found.length ? `Earlier messages matching ${query}:\n${found.join('\n')}`
		: `No message in the current conversation matches ${query}. Use search_records to search saved project chats from earlier conversations.`;
}

/** Fetch one earlier chat message by its position before the current user request. */
export function readChatMessage(messages: readonly ChatTurn[], args: Record<string, unknown>): string {
	const turnsAgo = args.turnsAgo;
	const start = args.start ?? 0;
	const chars = args.chars ?? MAX_CHAT_CHARS;
	if (typeof turnsAgo !== 'number' || !Number.isInteger(turnsAgo) || turnsAgo < 1 || turnsAgo > messages.length
		|| typeof start !== 'number' || !Number.isInteger(start) || start < 0
		|| typeof chars !== 'number' || !Number.isInteger(chars) || chars < 1) {
		return `Choose turnsAgo from 1 to ${messages.length}, a nonnegative start, and a positive chars count.`;
	}
	const message = messages[messages.length - turnsAgo];
	const from = Math.min(start, message.text.length);
	const to = Math.min(message.text.length, from + Math.min(chars, MAX_CHAT_CHARS));
	const more = to < message.text.length ? `\n[More available: read_chat with turnsAgo=${turnsAgo}, start=${to}]` : '';
	const turns = `${turnsAgo} turn${turnsAgo === 1 ? '' : 's'}`;
	return `Stored chat message ${turns} ago (${message.role}, characters ${from}–${to} of ${message.text.length}):\n${message.text.slice(from, to)}${more}`;
}

/** Keep a short preview in the live prompt and identify the exact stored message for further reading. */
export function previewChatTurn(turn: ChatTurn, turnsAgo: number, limit = turn.role === 'user' ? 2_500 : 1_500): ChatTurn {
	return turn.text.length <= limit ? turn : {
		role: turn.role,
		text: `${turn.text.slice(0, limit)}\n[Earlier message shortened from ${turn.text.length} characters. `
			+ `Use read_chat with turnsAgo=${turnsAgo} to inspect the rest.]`,
	};
}

/** Spend the history budget on the newest turns first, retaining recent user pastes when they fit. */
export function modelHistoryTurns(messages: readonly ChatTurn[], maxInputTokens: number,
	suppliedDocuments: readonly { path: string; content: string }[] = []): ChatTurn[] {
	let remaining = Math.max(3_000, Math.min(60_000, Math.floor(maxInputTokens * 0.35)));
	const selected: ChatTurn[] = [];
	for (let index = messages.length - 1; index >= 0 && remaining >= 500; index--) {
		const stored = messages[index];
		let text = stored.text;
		// Only deduplicate exact saved content already supplied in this request. An unkept or
		// different draft remains evidence, and the full archived reply is still retrievable.
		if (stored.role === 'assistant') {
			for (const block of fencedBlocks(text).reverse()) {
				const match = block.closed && suppliedDocuments.find(doc => doc.content.trim() === block.text.trim());
				if (match) {
					text = text.slice(0, block.start) + `[Document matches ${match.path}, supplied in the current request.]` + text.slice(block.end);
				}
			}
		}
		const message = { ...stored, text };
		if (message.role === 'assistant' && looksLikeAgentProtocol(message.text)) {
			const note = '[An earlier assistant reply showed an internal tool request. It is not a verified finding.]';
			selected.unshift({ role: 'assistant', text: note });
			remaining -= note.length;
			continue;
		}
		const cap = message.role === 'user' ? 16_000 : 2_500;
		const turn = previewChatTurn(message, messages.length - index, Math.min(cap, remaining - 150));
		selected.unshift(turn);
		remaining -= turn.text.length;
	}
	return selected;
}
