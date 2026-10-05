import type { ChatTurn } from './types';

/**
 * CLIs take one prompt, not a message list: earlier turns are written out as a transcript and the last
 * user turn becomes the request.
 */
export function transcript(turns: readonly ChatTurn[]): string {
	const last = turns[turns.length - 1];
	const earlier = turns.slice(0, -1);
	const history = earlier.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n\n');
	return history ? `Conversation so far:\n\n${history}\n\nUser: ${last?.text ?? ''}` : last?.text ?? '';
}

export interface CliEvent {
	readonly text?: string;
	readonly error?: string;
	/** A new message part starts; separate it from text already written. */
	readonly newBlock?: boolean;
	/** A web search or page read the model process started. */
	readonly activity?: string;
}

function webActivity(name: unknown, input: any): string | undefined {
	if (name === 'WebSearch') {
		const query = typeof input?.query === 'string' ? input.query.slice(0, 80) : '';
		return query ? `Searching the web: ${query}` : 'Searching the web…';
	}
	if (name === 'WebFetch') {
		try { return `Reading ${new URL(String(input?.url)).host}`; } catch { return 'Reading a web page…'; }
	}
	return undefined;
}

/** One line of `claude --print --output-format stream-json --include-partial-messages`. */
export function parseClaudeLine(line: string): CliEvent {
	let event: any;
	try {
		event = JSON.parse(line);
	} catch {
		return {};
	}
	if (event?.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
		return { text: String(event.event.delta.text ?? '') };
	}
	if (event?.type === 'stream_event' && event.event?.type === 'content_block_start' && event.event.content_block?.type === 'text') {
		return { newBlock: true };
	}
	if (event?.type === 'assistant' && Array.isArray(event.message?.content)) {
		const use = event.message.content.find((block: any) => block?.type === 'tool_use');
		const activity = use ? webActivity(use.name, use.input) : undefined;
		return activity ? { activity } : {};
	}
	if (event?.type === 'result' && (event.is_error || event.subtype !== 'success')) {
		return { error: String(event.result || event.error || event.subtype || 'Claude CLI failed') };
	}
	return {};
}

/** One line of `codex exec --json`: the agent's messages arrive whole; failures as turn.failed / error. */
export function parseCodexLine(line: string): CliEvent {
	let event: any;
	try {
		event = JSON.parse(line);
	} catch {
		return {};
	}
	if (event?.type === 'item.completed' && event.item?.type === 'agent_message') {
		return { text: String(event.item.text ?? ''), newBlock: true };
	}
	if (event?.type === 'item.started' && event.item?.type === 'web_search') {
		return { activity: 'Searching the web…' };
	}
	if (event?.type === 'turn.failed') {
		return { error: String(event.error?.message ?? 'Codex turn failed') };
	}
	if (event?.type === 'error') {
		return { error: String(event.message ?? 'Codex failed') };
	}
	return {};
}
