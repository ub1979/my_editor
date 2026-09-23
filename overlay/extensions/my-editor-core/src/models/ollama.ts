import { readLines } from './openaiCompatible';
import { ModelEntry, ProviderError, StreamRequest } from './types';

interface OllamaTag { readonly name: string; readonly remote_host?: string }

/** Lists installed Ollama models; empty when Ollama is not running. */
export async function listOllamaModels(baseUrl: string): Promise<ModelEntry[]> {
	try {
		const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
		if (!response.ok) {
			return [];
		}
		const { models } = await response.json() as { models: OllamaTag[] };
		return models.map(tag => {
			const cloud = tag.name.endsWith(':cloud') || tag.name.endsWith('-cloud') || !!tag.remote_host;
			return {
				key: `ollama:${tag.name}`,
				provider: 'ollama',
				model: tag.name,
				label: tag.name,
				detail: cloud ? 'Ollama cloud' : 'Ollama · local',
				maxInputTokens: 32_000,
				maxOutputTokens: 8_000,
			} satisfies ModelEntry;
		});
	} catch {
		return [];
	}
}

/** Streams one reply from Ollama's native `/api/chat` (NDJSON), with thinking off for a snappy pair. */
export async function streamOllama(baseUrl: string, think: boolean, request: StreamRequest): Promise<void> {
	const abort = new AbortController();
	const listener = request.token.onCancellationRequested(() => abort.abort());
	try {
		const response = await fetch(`${baseUrl}/api/chat`, {
			method: 'POST',
			signal: abort.signal,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				model: request.entry.model,
				stream: true,
				think,
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
			const text = chunk.message?.content;
			if (typeof text === 'string' && text) {
				request.onText(text);
			}
		});
	} catch (err) {
		if (request.token.isCancellationRequested) {
			return;
		}
		throw err instanceof ProviderError ? err : new ProviderError('ollama', String(err));
	} finally {
		listener.dispose();
	}
}
