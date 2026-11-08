import { readLines } from './openaiCompatible';
import { ModelEntry, ProviderError, StreamRequest } from './types';
import { cloudContextTokens } from './ollamaMetadata';

interface OllamaTag { readonly name: string; readonly remote_host?: string }

/** Lists installed Ollama models; empty when Ollama is not running. */
export async function listOllamaModels(baseUrl: string): Promise<ModelEntry[]> {
	try {
		const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
		if (!response.ok) {
			return [];
		}
		const { models } = await response.json() as { models: OllamaTag[] };
		return Promise.all(models.map(async tag => {
			const cloud = tag.name.endsWith(':cloud') || tag.name.endsWith('-cloud') || !!tag.remote_host;
			return {
				key: `ollama:${tag.name}`,
				provider: 'ollama',
				model: tag.name,
				label: tag.name,
				detail: cloud ? 'Ollama cloud' : 'Ollama · local',
				maxInputTokens: cloud ? await cloudContextTokens(baseUrl, tag.name) : 32_000,
				maxOutputTokens: 8_000,
			} satisfies ModelEntry;
		}));
	} catch {
		return [];
	}
}

/** Streams native Ollama replies, consuming answer content separately from model reasoning. */
export async function streamOllama(baseUrl: string, think: boolean, request: StreamRequest, timeoutMs = 180_000): Promise<void> {
	const abort = new AbortController();
	const listener = request.token.onCancellationRequested(() => abort.abort());
	try {
		const response = await fetch(`${baseUrl}/api/chat`, {
			method: 'POST',
			signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]),
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				model: request.entry.model,
				stream: true,
				// GLM 5 cloud templates leak reasoning into content with think=false. Enabling it
				// restores message.thinking separation; only message.content reaches the editor.
				think: /^glm-5(?:[.:-]|$)/i.test(request.entry.model) ? true : think,
				messages: [
					...(request.system ? [{ role: 'system', content: request.system }] : []),
					...request.turns.map(turn => ({ role: turn.role, content: turn.text })),
				],
			}),
		});
		if (!response.ok || !response.body) {
			throw new ProviderError('ollama', `HTTP ${response.status} ${await response.text().catch(() => '')}`.trim());
		}
		await readLines(response.body, line => {
			if (!line.trim()) {
				return;
			}
			const chunk = JSON.parse(line);
			if (chunk.error) {
				throw new ProviderError('ollama', chunk.error);
			}
			if (chunk.done_reason === 'length') { throw new ProviderError('ollama', 'Reply cut off at the output limit. Ask for a smaller change.'); }
			const calls = chunk.message?.tool_calls;
			if (Array.isArray(calls) && calls.length) {
				if (!request.onToolCalls) { throw new ProviderError('ollama', 'The model requested a tool in a turn without project tools. Retry this request in agent chat.'); }
				request.onToolCalls(calls.map(call => {
					const fn = call?.function;
					let args: unknown = typeof fn?.arguments === 'string' ? JSON.parse(fn.arguments) : fn?.arguments;
					// Some cloud templates wrap our JSON protocol's arguments inside native arguments.
					if (args && typeof args === 'object' && Object.keys(args).length === 1 && 'arguments' in args) {
						args = args.arguments;
					}
					if (typeof fn?.name !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) {
						throw new ProviderError('ollama', 'The model returned malformed native tool arguments. Retry the request.');
					}
					return { name: fn.name, arguments: args as Record<string, unknown> };
				}));
			}
			const text = chunk.message?.content;
			if (typeof text === 'string' && text) {
				request.onText(text);
			}
		});
	} catch (err) {
		if (request.token.isCancellationRequested) {
			return;
		}
		throw err instanceof ProviderError ? err : new ProviderError('ollama',
			err instanceof Error && err.name === 'TimeoutError' ? 'The model request timed out. Retry, choose another model, or increase Ollama request timeout in settings.' : String(err));
	} finally {
		listener.dispose();
	}
}
