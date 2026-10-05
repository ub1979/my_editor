import type * as vscode from 'vscode';

export type ProviderId = 'anthropic' | 'claude-cli' | 'codex-cli' | 'openai' | 'openrouter' | 'ollama' | 'lmstudio' | 'custom';

/** One model offered in the chat model picker. */
export interface ModelEntry {
	/** Unique across providers: `<provider>:<model>`. */
	readonly key: string;
	readonly provider: ProviderId;
	/** The provider's own model id. */
	readonly model: string;
	readonly label: string;
	readonly detail: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
}

/** A chat turn in the shape every adapter accepts. */
export interface ChatTurn {
	readonly role: 'user' | 'assistant';
	readonly text: string;
}

export interface StreamRequest {
	readonly entry: ModelEntry;
	readonly system: string | undefined;
	readonly turns: readonly ChatTurn[];
	readonly token: vscode.CancellationToken;
	readonly onText: (text: string) => void;
	readonly reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
	/** Lets a subscription CLI use its own web search and page reading. Other providers ignore it. */
	readonly webAccess?: boolean;
	/** What the model process is doing between replies, such as a web search; empty when it writes again. */
	readonly onActivity?: (label: string) => void;
}

export class ProviderError extends Error {
	constructor(readonly provider: ProviderId, message: string) {
		super(`${provider}: ${message}`);
	}
}
