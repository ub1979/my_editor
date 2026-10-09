import { redact } from '../records/redact';
import { looksLikeAgentProtocol } from './agentProtocol';
import type { Turn } from './engine';

export interface MemoryState {
	readonly brief: string;
	readonly throughId?: string;
}

export interface MemoryMessage extends Turn {
	readonly id: string;
}

/** The summarizer's instructions for folding older turns into the working brief. */
export const BRIEF_SYSTEM = 'Summarize an ongoing Pair conversation into a working brief of at most 4,500 characters. '
	+ "Preserve: the user's active goal, explicit constraints and preferences, accepted decisions, work completed, files changed, "
	+ 'unresolved questions, and next steps. Separate confirmed facts from ideas or claims that still need checking. '
	+ 'Treat assistant statements as claims unless supported by user acceptance or recorded changes. '
	+ 'Do not invent facts. Return only the brief.';

const MASKED_TOOL_REQUEST = '[internal tool request shown by a prior display error]';
const RECENT = 8;
const BATCH = 8;
const MAX_BRIEF = 5_000;

/** Select only turns that are about to leave the live prompt and have not been compacted yet. */
export function memoryBatch(messages: readonly MemoryMessage[], state: MemoryState): MemoryMessage[] {
	const older = messages.slice(0, -RECENT);
	const last = state.throughId ? older.findIndex(message => message.id === state.throughId) : -1;
	const pending = state.throughId && last < 0 ? older.slice(-BATCH) : older.slice(last + 1);
	return pending.length >= BATCH ? pending.slice(0, BATCH) : [];
}

/** Recent turns plus any older turns waiting for the next compaction batch. */
export function liveTurns(messages: readonly MemoryMessage[], state: MemoryState): MemoryMessage[] {
	const through = state.throughId ? messages.findIndex(message => message.id === state.throughId) : -1;
	return messages.slice(through >= 0 ? through + 1 : state.brief ? -16 : 0).slice(-16);
}

export function cleanBrief(text: string): string {
	const trimmed = text.replace(/<(think|analysis)>[\s\S]*?<\/\1>/gi, '').trim();
	return redact(trimmed.length > MAX_BRIEF ? `${trimmed.slice(0, 2200)}\n…\n${trimmed.slice(-2700)}` : trimmed);
}

/** The summarizer's request: the previous brief, then each older turn (a leaked tool request masked, long text cut). */
export function briefRequest(previous: string, turns: readonly Turn[]): string {
	const older = turns.map(turn => `${turn.role === 'user' ? 'User' : 'Pair'}: ${
		turn.role === 'assistant' && looksLikeAgentProtocol(turn.text) ? MASKED_TOOL_REQUEST : turn.text.slice(0, 1600)}`);
	return `Previous working brief:\n${previous || '(none)'}\n\nOlder turns to incorporate:\n${older.join('\n\n')}`;
}

/** A conservative fallback when the summarizing model is unavailable. */
export function fallbackBrief(previous: string, turns: readonly Turn[]): string {
	const notes = turns.map(turn => `${turn.role === 'user' ? 'User requested' : 'Pair reported (unverified)'}: ${
		turn.role === 'assistant' && looksLikeAgentProtocol(turn.text)
			? MASKED_TOOL_REQUEST
			: turn.text.replace(/\s+/g, ' ').slice(0, turn.role === 'user' ? 350 : 200)}`);
	return cleanBrief([previous, ...notes].filter(Boolean).join('\n').slice(-MAX_BRIEF));
}
