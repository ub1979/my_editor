import * as vscode from 'vscode';
import { listOllamaModels } from './ollama';
import { ApiKeys } from './secrets';
import { ModelEntry, ProviderId } from './types';

const ANTHROPIC_DETAILS: Record<string, { label: string; detail: string; maxInput: number; maxOutput: number }> = {
	'claude-opus-5': { label: 'Claude Opus 5', detail: 'Anthropic', maxInput: 1_000_000, maxOutput: 64_000 },
	'claude-sonnet-5': { label: 'Claude Sonnet 5', detail: 'Anthropic', maxInput: 1_000_000, maxOutput: 64_000 },
	'claude-haiku-4-5': { label: 'Claude Haiku 4.5', detail: 'Anthropic · fast', maxInput: 200_000, maxOutput: 32_000 },
	'claude-fable-5-1': { label: 'Claude Fable 5.1', detail: 'Anthropic · most capable', maxInput: 1_000_000, maxOutput: 64_000 },
};

function config(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration('myEditor');
}

function listed(provider: ProviderId, ids: string[], detail: string): ModelEntry[] {
	return ids.map(model => ({
		key: `${provider}:${model}`, provider, model, label: model, detail,
		maxInputTokens: 128_000, maxOutputTokens: 16_000,
	}));
}

/** Every model the user can pick right now, given their keys, settings and a running Ollama. */
export async function loadCatalog(keys: ApiKeys): Promise<ModelEntry[]> {
	const entries: ModelEntry[] = [];
	if (await keys.get('anthropic')) {
		for (const model of config().get<string[]>('anthropic.models', [])) {
			const known = ANTHROPIC_DETAILS[model];
			entries.push({
				key: `anthropic:${model}`, provider: 'anthropic', model,
				label: known?.label ?? model, detail: known?.detail ?? 'Anthropic',
				maxInputTokens: known?.maxInput ?? 200_000, maxOutputTokens: known?.maxOutput ?? 32_000,
			});
		}
	}
	if (await keys.get('openai')) {
		entries.push(...listed('openai', config().get<string[]>('openai.models', []), 'OpenAI'));
	}
	if (await keys.get('openrouter')) {
		entries.push(...listed('openrouter', config().get<string[]>('openrouter.models', []), 'OpenRouter'));
	}
	if (config().get<string>('custom.baseUrl')) {
		entries.push(...listed('custom', config().get<string[]>('custom.models', []), 'Custom endpoint'));
	}
	if (config().get<boolean>('ollama.enabled', true)) {
		entries.push(...await listOllamaModels(config().get<string>('ollama.baseUrl', 'http://localhost:11434')));
	}
	return entries;
}

/**
 * The model chat uses unless the user picks another: the `myEditor.models.default` setting, else the
 * first Anthropic model, else the first local Ollama model, else anything.
 */
export function pickDefault(entries: readonly ModelEntry[]): ModelEntry | undefined {
	const wanted = config().get<string>('models.default');
	return entries.find(e => e.key === wanted)
		?? entries.find(e => e.provider === 'anthropic')
		?? entries.find(e => e.provider === 'ollama' && e.detail.endsWith('local'))
		?? entries[0];
}
