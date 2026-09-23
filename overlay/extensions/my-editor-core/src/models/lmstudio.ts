import { ModelEntry } from './types';

/** Lists the chat models LM Studio's local server has; empty when the server is not running. */
export async function listLmStudioModels(baseUrl: string): Promise<ModelEntry[]> {
	try {
		const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(1500) });
		if (!response.ok) {
			return [];
		}
		const { data } = await response.json() as { data?: { id: string }[] };
		return (data ?? [])
			.filter(model => !/embed/i.test(model.id))
			.map(model => ({
				key: `lmstudio:${model.id}`,
				provider: 'lmstudio',
				model: model.id,
				label: model.id,
				detail: 'LM Studio · local',
				maxInputTokens: 32_000,
				maxOutputTokens: 8_000,
			} satisfies ModelEntry));
	} catch {
		return [];
	}
}
