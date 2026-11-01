import { spawn } from 'child_process';
import { claudeEnvironment, scratchDir } from './cli';
import type { ModelEntry } from './types';

export interface ClaudeModel {
	readonly value: string;
	readonly resolvedModel?: string;
	readonly displayName: string;
	readonly description: string;
}

/** Accept only model metadata from Claude's initialize response, never account information. */
export function parseClaudeModels(value: unknown): ClaudeModel[] {
	if (!Array.isArray(value)) { return []; }
	return value.flatMap(item => {
		if (!item || typeof item !== 'object' || typeof item.value !== 'string' || !item.value.trim()) { return []; }
		return [{ value: item.value, resolvedModel: typeof item.resolvedModel === 'string' ? item.resolvedModel : undefined,
			displayName: typeof item.displayName === 'string' ? item.displayName : item.value,
			description: typeof item.description === 'string' ? item.description : '' }];
	});
}

/** Format explicit versions without depending on a hard-coded release catalog. */
function modelLabel(model: string): string {
	const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-(\d{8}))?(\[1m\])?$/.exec(model);
	if (!match) { return model === 'default' ? 'Default' : model[0].toUpperCase() + model.slice(1); }
	return `${match[1][0].toUpperCase() + match[1].slice(1)} ${match[2]}${match[3] ? `.${match[3]}` : ''}`
		+ `${match[4] ? ` (${match[4]})` : ''}${match[5] ? ' (1M context)' : ''}`;
}

/** Keep saved aliases working, show their current versions, and also offer pinned version IDs. */
export function claudeModelEntries(configured: readonly string[], discovered: readonly ClaudeModel[]): ModelEntry[] {
	const known = new Map(discovered.map(model => [model.value, model]));
	const ids = new Set([...configured, ...discovered.map(model => model.value),
		...discovered.flatMap(model => model.resolvedModel ? [model.resolvedModel] : [])]);
	return [...ids].filter(id => id.trim()).map(model => {
		const info = known.get(model);
		const resolved = info?.resolvedModel;
		const alias = !!resolved && model !== resolved && !model.startsWith('claude-');
		const label = resolved ? modelLabel(resolved) + (model.endsWith('[1m]') ? ' (1M context)' : '')
			: modelLabel(model);
		return { key: `claude-cli:${model}`, provider: 'claude-cli', model,
			label: `Claude ${label}${alias ? ` (${model === 'default' ? 'default' : `${model} alias`})` : ''}`,
			detail: `Claude subscription · ${model}${!resolved && !model.startsWith('claude-') ? ' · version unavailable' : ''}`,
			maxInputTokens: 200_000, maxOutputTokens: 32_000 };
	});
}

const cache = new Map<string, { until: number; result: Promise<ClaudeModel[]> }>();

/** Query CLI metadata without sending a user prompt or running a model turn. */
export function listClaudeModels(command: string): Promise<ClaudeModel[]> {
	const cached = cache.get(command);
	if (cached && cached.until > Date.now()) { return cached.result; }
	const result = queryModels(command);
	const record = { until: Date.now() + 30_000, result };
	cache.set(command, record);
	void result.then(models => { record.until = Date.now() + (models.length ? 300_000 : 30_000); });
	return result;
}

function queryModels(command: string): Promise<ClaudeModel[]> {
	return new Promise(resolve => {
		const child = spawn(command, ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json',
			'--verbose', '--no-session-persistence', '--safe-mode', '--permission-mode', 'dontAsk', '--tools', '',
			'--strict-mcp-config', '--setting-sources='],
		{ cwd: scratchDir(), env: claudeEnvironment(), stdio: ['pipe', 'pipe', 'ignore'] });
		let settled = false;
		let buffer = '';
		const finish = (models: ClaudeModel[]) => {
			if (settled) { return; }
			settled = true;
			clearTimeout(timer);
			child.stdin.end();
			child.kill('SIGTERM');
			const kill = setTimeout(() => child.kill('SIGKILL'), 1_000);
			kill.unref();
			child.once('close', () => clearTimeout(kill));
			resolve(models);
		};
		const timer = setTimeout(() => finish([]), 15_000);
		child.on('error', () => finish([]));
		child.on('close', () => finish([]));
		child.stdin.on('error', () => finish([]));
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			buffer += chunk;
			if (buffer.length > 1_000_000) { finish([]); return; }
			let newline: number;
			while ((newline = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				try {
					const event = JSON.parse(line);
					if (event.type === 'control_response' && event.response?.request_id === 'my-editor-models') {
						finish(parseClaudeModels(event.response.subtype === 'success' ? event.response.response?.models : undefined));
					}
				} catch { /* Ignore diagnostics outside the metadata response. */ }
			}
		});
		child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'my-editor-models',
			request: { subtype: 'initialize' } }) + '\n');
	});
}
