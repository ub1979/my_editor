import * as vscode from 'vscode';
import { streamAnthropic } from './anthropic';
import { findCli, streamClaudeCli, streamCodexCli } from './cli';
import { loadCatalog, pickDefault } from './catalog';
import { streamOllama } from './ollama';
import { streamOpenAICompatible } from './openaiCompatible';
import { ApiKeys } from './secrets';
import { ChatTurn, ModelEntry, ProviderError, StreamRequest } from './types';

interface Info extends vscode.LanguageModelChatInformation {
	readonly entry: ModelEntry;
}

/**
 * Puts every configured model into the core chat's model picker under the `my-editor` vendor.
 * The system prompt travels in `modelOptions.system`, set by our chat participant.
 */
export class ModelProvider implements vscode.LanguageModelChatProvider<Info> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.changed.event;

	constructor(private readonly keys: ApiKeys) {
		keys.onDidChange(() => this.changed.fire());
		vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('myEditor') && this.changed.fire());
	}

	refresh(): void {
		this.changed.fire();
	}

	async provideLanguageModelChatInformation(): Promise<Info[]> {
		const entries = await loadCatalog(this.keys);
		const preferred = pickDefault(entries);
		return entries.map(entry => ({
			id: entry.key,
			name: entry.label,
			family: entry.provider,
			detail: entry.detail,
			tooltip: `${entry.label} · ${entry.detail}`,
			version: '1',
			maxInputTokens: entry.maxInputTokens,
			maxOutputTokens: entry.maxOutputTokens,
			capabilities: {},
			isDefault: entry === preferred,
			isUserSelectable: true,
			entry,
		}));
	}

	async provideLanguageModelChatResponse(
		model: Info,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const system = typeof options.modelOptions?.system === 'string' ? options.modelOptions.system : undefined;
		const request: StreamRequest = {
			entry: model.entry,
			system,
			turns: toTurns(messages),
			token,
			onText: text => progress.report(new vscode.LanguageModelTextPart(text)),
		};
		const settings = vscode.workspace.getConfiguration('myEditor');
		switch (model.entry.provider) {
			case 'anthropic':
				return streamAnthropic(await this.requireKey('anthropic'), request);
			case 'openai':
				return streamOpenAICompatible('openai', settings.get('openai.baseUrl', 'https://api.openai.com/v1'), await this.requireKey('openai'), request);
			case 'openrouter':
				return streamOpenAICompatible('openrouter', 'https://openrouter.ai/api/v1', await this.requireKey('openrouter'), request);
			case 'custom':
				return streamOpenAICompatible('custom', settings.get('custom.baseUrl', ''), await this.keys.get('custom'), request);
			case 'ollama':
				return streamOllama(settings.get('ollama.baseUrl', 'http://localhost:11434'), settings.get('ollama.think', false), request);
			case 'lmstudio':
				return streamOpenAICompatible('lmstudio', settings.get('lmstudio.baseUrl', 'http://localhost:1234/v1'), undefined, request);
			case 'claude-cli': {
				const command = findCli('claude', settings.get('claudeCli.path', ''));
				if (!command) {
					throw new ProviderError('claude-cli', 'the claude command was not found. Install Claude Code and run `claude auth login`, or set myEditor.claudeCli.path.');
				}
				return streamClaudeCli(command, request);
			}
			case 'codex-cli': {
				const command = findCli('codex', settings.get('codexCli.path', ''));
				if (!command) {
					throw new ProviderError('codex-cli', 'the codex command was not found. Install the Codex CLI and run `codex login`, or set myEditor.codexCli.path.');
				}
				return streamCodexCli(command, request);
			}
		}
	}

	async provideTokenCount(_model: Info, text: string | vscode.LanguageModelChatRequestMessage): Promise<number> {
		const raw = typeof text === 'string' ? text : partsToText(text.content);
		return Math.ceil(raw.length / 4);
	}

	private async requireKey(provider: 'anthropic' | 'openai' | 'openrouter'): Promise<string> {
		const key = await this.keys.get(provider);
		if (!key) {
			throw new ProviderError(provider, 'no API key. Run "my_editor: Set API Key".');
		}
		return key;
	}

	dispose(): void {
		this.changed.dispose();
	}
}

function partsToText(parts: readonly unknown[]): string {
	return parts.map(part => (part instanceof vscode.LanguageModelTextPart ? part.value : '')).join('');
}

/** Merges consecutive same-role messages; providers expect alternating turns starting with the user. */
function toTurns(messages: readonly vscode.LanguageModelChatRequestMessage[]): ChatTurn[] {
	const turns: ChatTurn[] = [];
	for (const message of messages) {
		const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
		const text = partsToText(message.content);
		if (!text) {
			continue;
		}
		const last = turns[turns.length - 1];
		if (last && last.role === role) {
			turns[turns.length - 1] = { role, text: `${last.text}\n\n${text}` };
		} else {
			turns.push({ role, text });
		}
	}
	if (turns[0]?.role === 'assistant') {
		turns.unshift({ role: 'user', text: '(continuing)' });
	}
	return turns;
}
