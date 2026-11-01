import type { ModelEntry, ReasoningEffort } from './types';

const LEVELS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Keep only effort values understood by the CLI adapters. */
export function parseEffortLevels(value: unknown): ReasoningEffort[] {
	return Array.isArray(value) ? LEVELS.filter(level => value.includes(level)) : [];
}

/** Each subscription keeps its own preference when switching model providers. */
export function effortSetting(provider: string | undefined): string | undefined {
	return provider === 'claude-cli' ? 'claudeCli.reasoningEffort' : provider === 'codex-cli' ? 'codexCli.reasoningEffort' : undefined;
}

export function effortLevels(entry: ModelEntry): readonly ReasoningEffort[] {
	if (entry.provider === 'claude-cli') { return entry.supportedEffortLevels ?? []; }
	if (entry.provider === 'codex-cli') { return entry.supportedEffortLevels ?? ['low', 'medium', 'high', 'xhigh']; }
	return [];
}

/** An unsupported saved preference falls back to the model default rather than failing the request. */
export function supportedEffort(entry: ModelEntry, value: unknown): ReasoningEffort | undefined {
	return effortLevels(entry).find(level => level === value);
}

export function claudeEffortArgs(entry: ModelEntry, value: unknown): string[] {
	const level = supportedEffort(entry, value);
	return level ? ['--effort', level] : [];
}
