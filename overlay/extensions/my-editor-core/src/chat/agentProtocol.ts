export interface AgentToolCall {
	readonly name: string;
	readonly arguments: Record<string, unknown>;
}

const READ_ONLY_TOOLS = new Set(['list_files', 'search', 'read_file', 'git_history', 'read_chat', 'search_chat', 'search_records']);
const TOOLS = new Set([...READ_ONLY_TOOLS, 'open_files', 'observe', 'run_tests', 'propose_file', 'propose_edit', 'propose_delete']);

export type AgentStep =
	| { action: 'final'; message: string }
	| ({ action: 'tool' } & AgentToolCall)
	| { action: 'tools'; calls: AgentToolCall[] };

/** Preserve literal source whitespace from providers that forget JSON string escaping.
 * Do not repair quotes, backslashes, missing delimiters or truncated objects: those are ambiguous.
 * The decoded request still passes the normal protocol and host scope/approval checks.
 */
function parseProtocolJson(body: string): unknown {
	let quoted = false;
	let escaped = false;
	let normalized = '';
	for (const char of body) {
		if (quoted && !escaped && (char === '\n' || char === '\r' || char === '\t')) {
			normalized += JSON.stringify(char).slice(1, -1);
			continue;
		}
		normalized += char;
		if (escaped) { escaped = false; }
		else if (quoted && char === '\\') { escaped = true; }
		else if (char === '"') { quoted = !quoted; }
	}
	return JSON.parse(normalized);
}

/** Some providers concatenate two complete replies. Read the first object instead of showing tool JSON to the user. */
function firstJsonObject(body: string): string | undefined {
	const start = body.search(/\{\s*"action"\s*:/);
	if (start < 0) { return undefined; }
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = start; index < body.length; index++) {
		const char = body[index];
		if (quoted) {
			if (escaped) { escaped = false; }
			else if (char === '\\') { escaped = true; }
			else if (char === '"') { quoted = false; }
			continue;
		}
		if (char === '"') { quoted = true; }
		else if (char === '{') { depth++; }
		else if (char === '}' && --depth === 0) { return body.slice(start, index + 1); }
	}
	return undefined;
}

/** Protocol-shaped output must be consumed internally, even if the model malformed it. */
export function looksLikeAgentProtocol(reply: string): boolean {
	return /\{\s*"action"\s*:|<tool_(?:call|result)\b/.test(reply);
}

/** A small, provider-independent protocol for the Pair's project tools. */
export function parseAgentStep(reply: string, fileReview = false, plainFinal = false): AgentStep | undefined {
	// Some local/cloud templates leak a thinking prelude into content instead of message.thinking.
	const trimmed = reply.replace(/^[\s\S]*?<\/think>/i, '').trim();
	// File passes explicitly request these markers. A provider may omit the outer final JSON;
	// this is still only a conclusion, never a tool action or permission to write.
	if (fileReview && /^(?:FILE_REVIEWED\s*\n\s*\S|BLOCKED\b\s+\S)/.test(trimmed)) {
		return { action: 'final', message: trimmed };
	}
	// DeepSeek cloud sometimes labels a read request as an XML tool_result. Normalize only a
	// complete, allowlisted read with JSON arguments; writes still require the normal protocol.
	const wrapped = /^<(tool_call|tool_result)\s+name="([a-z_]+)"\s*>([\s\S]*?)<\/\1>$/.exec(trimmed);
	if (wrapped) {
		if (!READ_ONLY_TOOLS.has(wrapped[2])) { return undefined; }
		try {
			const args: unknown = JSON.parse(wrapped[3]);
			return args && typeof args === 'object' && !Array.isArray(args)
				? { action: 'tool', name: wrapped[2], arguments: args as Record<string, unknown> } : undefined;
		} catch { return undefined; }
	}
	const body = trimmed.startsWith('```')
		? trimmed.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '')
		: trimmed;
	let value: unknown;
	try { value = parseProtocolJson(body); }
	catch {
		const first = firstJsonObject(body.trim());
		if (!first) {
			// Planning/review providers sometimes return their finished Markdown without the JSON
			// envelope. This grants no tool action; completion and proposal guards still run.
			return plainFinal && trimmed.length > 0 && !looksLikeAgentProtocol(trimmed)
				&& !/^(?:[\[{<]|```(?:json)?\s*[\[{])/i.test(trimmed)
				? { action: 'final', message: trimmed } : undefined;
		}
		try { value = parseProtocolJson(first); } catch { return undefined; }
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) { return undefined; }
	const record = value as Record<string, unknown>;
	// Small models sometimes use the tool name as the action. Accept only our explicit tool allowlist.
	if (typeof record.action === 'string' && TOOLS.has(record.action)) {
		if (record.arguments && typeof record.arguments === 'object' && !Array.isArray(record.arguments)) {
			return { action: 'tool', name: record.action, arguments: record.arguments as Record<string, unknown> };
		}
		// GLM also emits flat tool actions. The host still validates each tool's fields and paths.
		if (record.arguments === undefined) {
			const { action, ...args } = record;
			if (Object.keys(args).length) { return { action: 'tool', name: action as string, arguments: args }; }
		}
	}
	if (record.action === 'final' && typeof record.message === 'string') {
		return { action: 'final', message: record.message };
	}
	if (record.action === 'tool' && record.name !== 'tools' && typeof record.name === 'string'
		&& record.arguments !== null && typeof record.arguments === 'object' && !Array.isArray(record.arguments)) {
		return { action: 'tool', name: record.name, arguments: record.arguments as Record<string, unknown> };
	}
	const grouped = record.calls ?? (record.action === 'tool' && record.name === 'tools'
		&& record.arguments && typeof record.arguments === 'object' ? (record.arguments as Record<string, unknown>).calls : undefined);
	if ((record.action === 'tools' || record.action === 'tool' && record.name === 'tools')
		&& Array.isArray(grouped) && grouped.length >= 1 && grouped.length <= 60) {
		const calls: AgentToolCall[] = [];
		for (const value of grouped) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) { return undefined; }
			const call = value as Record<string, unknown>;
			if (typeof call.name !== 'string' || !READ_ONLY_TOOLS.has(call.name)
				|| !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) { return undefined; }
			calls.push({ name: call.name, arguments: call.arguments as Record<string, unknown> });
		}
		return { action: 'tools', calls };
	}
	return undefined;
}

/** Keep paths relative to the open workspace; the tool host also checks resolved symlinks. */
export function safeRelativePath(value: unknown): string | undefined {
	if (typeof value !== 'string' || !value || value.length > 300 || value.includes('\\') || /[\x00-\x1f]/.test(value)) { return undefined; }
	const parts = value.split('/');
	if (value.startsWith('/') || parts.some(part => !part || part === '.' || part === '..' || part === '.git' || part === 'node_modules')) { return undefined; }
	return value;
}

/** Only known test entry points, passed to spawn without a shell. */
export function testSpec(command: string): { bin: string; args: string[] } | undefined {
	if (command === 'npm test' || command === 'npm run test') { return { bin: 'npm', args: command === 'npm test' ? ['test'] : ['run', 'test'] }; }
	if (command === 'cargo test') { return { bin: 'cargo', args: ['test'] }; }
	if (command === 'pytest -q') { return { bin: 'pytest', args: ['-q'] }; }
	if (command === 'go test ./...') { return { bin: 'go', args: ['test', './...'] }; }
	if (/^go test \.\/[a-zA-Z0-9_/-]+(?:\/\.\.\.)?$/.test(command)) {
		return { bin: 'go', args: ['test', command.slice('go test '.length)] };
	}
	return undefined;
}

export { AGENT_INSTRUCTION } from './agentInstructions';
