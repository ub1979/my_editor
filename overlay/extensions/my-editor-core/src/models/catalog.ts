import * as vscode from 'vscode';
import { findCli } from './cli';
import { listLmStudioModels } from './lmstudio';
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
	if (config().get<boolean>('claudeCli.enabled', true) && findCli('claude', config().get<string>('claudeCli.path', ''))) {
		for (const model of config().get<string[]>('claudeCli.models', [])) {
			entries.push({
				key: `claude-cli:${model}`, provider: 'claude-cli', model,
				label: `Claude ${model === 'default' ? '' : model[0].toUpperCase() + model.slice(1)}`.trim(),
				detail: 'Claude subscription · CLI', maxInputTokens: 200_000, maxOutputTokens: 32_000,
			});
		}
	}
	if (config().get<boolean>('codexCli.enabled', true) && findCli('codex', config().get<string>('codexCli.path', ''))) {
		for (const model of config().get<string[]>('codexCli.models', [])) {
			entries.push({
				key: `codex-cli:${model}`, provider: 'codex-cli', model,
				label: model === 'default' ? 'Codex' : `Codex ${model}`,
				detail: 'ChatGPT subscription · Codex CLI', maxInputTokens: 200_000, maxOutputTokens: 32_000,
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
	if (config().get<boolean>('lmstudio.enabled', true)) {
		entries.push(...await listLmStudioModels(config().get<string>('lmstudio.baseUrl', 'http://localhost:1234/v1')));
	}
	return entries;
}

/**
 * The model chat uses unless the user picks another: the `myEditor.models.default` setting, else an
 * Anthropic API model, else the Claude subscription, else Codex, else a local model, else anything.
 */
export function pickDefault(entries: readonly ModelEntry[]): ModelEntry | undefined {
	const wanted = config().get<string>('models.default');
	return entries.find(e => e.key === wanted)
		?? entries.find(e => e.provider === 'anthropic')
		?? entries.find(e => e.provider === 'claude-cli')
		?? entries.find(e => e.provider === 'codex-cli')
		?? entries.find(e => e.detail.endsWith('local'))
		?? entries[0];
}

/** Command: pick the default chat model from everything available; saved as `myEditor.models.default`. */
export async function chooseDefaultModel(keys: ApiKeys): Promise<void> {
	const entries = await loadCatalog(keys);
	const current = pickDefault(entries);
	const items: (vscode.QuickPickItem & { key?: string; action?: 'keys' })[] = [
		...entries.map(entry => ({
			label: entry.label,
			description: entry.detail,
			detail: entry === current ? 'Current default' : undefined,
			key: entry.key,
		})),
		{ label: '', kind: vscode.QuickPickItemKind.Separator },
		{ label: '$(key) Add an API key…', description: 'Anthropic, OpenAI, OpenRouter, custom endpoint', action: 'keys' as const },
	];
	const picked = await vscode.window.showQuickPick(items, {
		title: 'Default model',
		placeHolder: entries.length ? 'Used by chat unless you pick another there' : 'No models found yet — add a key, log in to a CLI, or start Ollama / LM Studio',
		matchOnDescription: true,
	});
	if (picked?.action === 'keys') {
		await keys.promptAndStore();
	} else if (picked?.key) {
		await vscode.workspace.getConfiguration('myEditor').update('models.default', picked.key, vscode.ConfigurationTarget.Global);
	}
}

/** A model for small, frequent jobs (navigator, auto comments): local first, then Haiku, then the default. */
export function pickQuickModel(entries: readonly ModelEntry[], wanted?: string): ModelEntry | undefined {
	return entries.find(e => e.key === wanted)
		?? entries.find(e => e.detail.endsWith('local'))
		?? entries.find(e => e.key === 'anthropic:claude-haiku-4-5')
		?? entries.find(e => e.key === 'claude-cli:haiku')
		?? pickDefault(entries);
}
