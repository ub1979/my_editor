import type { ChatTurn } from '../models/types';
import { looksLikeAgentProtocol } from './agentProtocol';

const MAX_CHAT_CHARS = 6_000;
const INDEX_MESSAGES = 16;

/** List recent stored turns without spending the model's context on long pasted logs. */
export function chatArchiveIndex(messages: readonly ChatTurn[]): string {
	if (!messages.length) { return 'No earlier chat messages are stored.'; }
	const entries = messages.slice(-INDEX_MESSAGES).reverse().map((message, index) => {
		const preview = message.role === 'assistant' && looksLikeAgentProtocol(message.text)
			? '[earlier internal tool request; not a finding]'
			: message.text.replace(/\s+/g, ' ').slice(0, 100);
		return `${index + 1} turn${index ? 's' : ''} ago: ${message.role}, ${message.text.length} characters${preview ? `, starts: ${preview}` : ''}`;
	});
	return `Recent stored chat messages (read_chat can retrieve any of the last ${messages.length}):\n${entries.join('\n')}`;
}

/** Find evidence in older user pastes without loading the full conversation into every prompt. */
export function searchChatMessages(messages: readonly ChatTurn[], query: unknown): string {
	if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120) {
		return 'Search needs a text query of 2–120 characters.';
	}
	const needle = query.toLowerCase();
	const found: string[] = [];
	for (let index = messages.length - 1; index >= 0 && found.length < 20; index--) {
		const message = messages[index];
		if (message.role !== 'user') { continue; }
		const at = message.text.toLowerCase().indexOf(needle);
		if (at < 0) { continue; }
		const excerpt = message.text.slice(Math.max(0, at - 60), Math.min(message.text.length, at + query.length + 100)).replace(/\s+/g, ' ');
		found.push(`${messages.length - index} turns ago (user), character ${at}: ${excerpt}`);
	}
	return found.length ? `Earlier user messages matching ${query}:\n${found.join('\n')}` : `No stored user message matches ${query}.`;
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
	return `Stored chat message ${turnsAgo} turn${turnsAgo === 1 ? '' : 's'} ago (${message.role}, characters ${from}–${to} of ${message.text.length}):\n${message.text.slice(from, to)}${to < message.text.length ? `\n[More available: read_chat with turnsAgo=${turnsAgo}, start=${to}]` : ''}`;
}

/** Keep a short preview in the live prompt and identify the exact stored message for further reading. */
export function previewChatTurn(turn: ChatTurn, turnsAgo: number, limit = turn.role === 'user' ? 2_500 : 1_500): ChatTurn {
	return turn.text.length <= limit ? turn : {
		role: turn.role,
		text: `${turn.text.slice(0, limit)}\n[Earlier message shortened from ${turn.text.length} characters. Use read_chat with turnsAgo=${turnsAgo} to inspect the rest.]`,
	};
}

/** Spend the history budget on the newest turns first, retaining recent user pastes when they fit. */
export function modelHistoryTurns(messages: readonly ChatTurn[], maxInputTokens: number): ChatTurn[] {
	let remaining = Math.max(3_000, Math.min(60_000, Math.floor(maxInputTokens * 0.35)));
	const selected: ChatTurn[] = [];
	for (let index = messages.length - 1; index >= 0 && remaining >= 500; index--) {
		const message = messages[index];
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
