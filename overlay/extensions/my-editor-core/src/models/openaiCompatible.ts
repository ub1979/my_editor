import { ProviderError, ProviderId, StreamRequest } from './types';

/** Streams one reply from an OpenAI-compatible `/chat/completions` endpoint (OpenAI, OpenRouter, custom). */
export async function streamOpenAICompatible(
	provider: ProviderId, baseUrl: string, apiKey: string | undefined, request: StreamRequest,
): Promise<void> {
	const abort = new AbortController();
	const listener = request.token.onCancellationRequested(() => abort.abort());
	try {
		const messages = [
			...(request.system ? [{ role: 'system', content: request.system }] : []),
			...request.turns.map(turn => ({ role: turn.role, content: turn.text })),
		];
		const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
			method: 'POST',
			signal: abort.signal,
			headers: {
				'content-type': 'application/json',
				...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
			},
			body: JSON.stringify({
				model: request.entry.model,
				messages,
				stream: true,
				max_tokens: request.entry.maxOutputTokens,
			}),
		});
		if (!response.ok || !response.body) {
			throw new ProviderError(provider, `HTTP ${response.status} ${await response.text().catch(() => '')}`.trim());
		}
		await readLines(response.body, line => {
			if (!line.startsWith('data:')) {
				return;
			}
			const data = line.slice(5).trim();
			if (!data || data === '[DONE]') {
				return;
			}
			const text = JSON.parse(data)?.choices?.[0]?.delta?.content;
			if (typeof text === 'string' && text) {
				request.onText(text);
			}
		});
	} catch (err) {
		if (request.token.isCancellationRequested) {
			return;
		}
		throw err instanceof ProviderError ? err : new ProviderError(provider, String(err));
	} finally {
		listener.dispose();
	}
}

/** Calls `onLine` for each newline-terminated line of a streamed response body. */
export async function readLines(body: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = '';
	for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
		buffer += decoder.decode(chunk, { stream: true });
		let newline = buffer.indexOf('\n');
		while (newline >= 0) {
			onLine(buffer.slice(0, newline).replace(/\r$/, ''));
			buffer = buffer.slice(newline + 1);
			newline = buffer.indexOf('\n');
		}
	}
	if (buffer.trim()) {
		onLine(buffer);
	}
}
