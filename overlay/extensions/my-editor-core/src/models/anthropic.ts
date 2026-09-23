import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, StreamRequest } from './types';

/** Models that get server-side refusal fallbacks by default (see decision 0002). */
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1']);

/** Streams one reply from the Anthropic Messages API through the official SDK. */
export async function streamAnthropic(apiKey: string, request: StreamRequest): Promise<void> {
	const client = new Anthropic({ apiKey });
	const abort = new AbortController();
	const listener = request.token.onCancellationRequested(() => abort.abort());
	try {
		const params = {
			model: request.entry.model,
			max_tokens: request.entry.maxOutputTokens,
			...(request.system ? { system: request.system } : {}),
			messages: request.turns.map(turn => ({ role: turn.role, content: turn.text })),
		};
		const stream = FALLBACK_MODELS.has(request.entry.model)
			? client.beta.messages.stream(
				{ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
				{ signal: abort.signal })
			: client.messages.stream(params, { signal: abort.signal });

		for await (const event of stream) {
			if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
				request.onText(event.delta.text);
			}
		}
		const final = await stream.finalMessage();
		if (final.stop_reason === 'refusal') {
			request.onText('\n\n_The model declined this request._');
		} else if (final.stop_reason === 'max_tokens') {
			request.onText('\n\n_Reply cut off at the output limit._');
		}
	} catch (err) {
		if (request.token.isCancellationRequested) {
			return;
		}
		if (err instanceof Anthropic.AuthenticationError) {
			throw new ProviderError('anthropic', 'the API key was rejected. Run "my_editor: Set API Key".');
		}
		if (err instanceof Anthropic.RateLimitError) {
			throw new ProviderError('anthropic', 'rate limited — try again shortly.');
		}
		if (err instanceof Anthropic.APIError) {
			throw new ProviderError('anthropic', `${err.status ?? ''} ${err.message}`.trim());
		}
		throw err;
	} finally {
		listener.dispose();
	}
}
