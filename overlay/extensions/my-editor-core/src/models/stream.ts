import * as vscode from 'vscode';
import { streamAnthropic } from './anthropic';
import { findCli, streamClaudeCli, streamCodexCli } from './cli';
import { streamOllama } from './ollama';
import { streamOpenAICompatible } from './openaiCompatible';
import { ApiKeys } from './secrets';
import { ChatTurn, ModelEntry, ProviderError, StreamRequest } from './types';

export interface ModelCall {
	readonly system?: string;
	readonly turns: readonly ChatTurn[];
	readonly token: vscode.CancellationToken;
	readonly onText: (text: string) => void;
	readonly reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
}

/** Sends one conversation to a model from the catalog and streams the reply. Used by chat and navigator. */
export async function streamModel(entry: ModelEntry, keys: ApiKeys, call: ModelCall): Promise<void> {
	const request: StreamRequest = { entry, system: call.system, turns: call.turns, token: call.token, onText: call.onText, reasoningEffort: call.reasoningEffort };
	const settings = vscode.workspace.getConfiguration('myEditor');
	const requireKey = async (provider: 'anthropic' | 'openai' | 'openrouter') => {
		const key = await keys.get(provider);
		if (!key) {
			throw new ProviderError(provider, 'no API key. Run "my_editor: Set API Key".');
		}
		return key;
	};
	switch (entry.provider) {
		case 'anthropic':
			return streamAnthropic(await requireKey('anthropic'), request);
		case 'openai':
			return streamOpenAICompatible('openai', settings.get('openai.baseUrl', 'https://api.openai.com/v1'), await requireKey('openai'), request);
		case 'openrouter':
			return streamOpenAICompatible('openrouter', 'https://openrouter.ai/api/v1', await requireKey('openrouter'), request);
		case 'custom':
			return streamOpenAICompatible('custom', settings.get('custom.baseUrl', ''), await keys.get('custom'), request);
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
