import { readFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export interface CodexModel {
	readonly slug: string;
	readonly displayName: string;
	readonly description?: string;
}

interface CachedModel {
	readonly slug?: unknown;
	readonly display_name?: unknown;
	readonly description?: unknown;
	readonly visibility?: unknown;
	readonly priority?: unknown;
}

function visibleModel(value: unknown): value is CachedModel & { slug: string } {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const item = value as CachedModel;
	return item.visibility === 'list' && typeof item.slug === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(item.slug);
}

function priority(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 999;
}

/** The Codex CLI's local catalog reflects the models offered to this login. */
export function parseCodexModels(value: unknown): CodexModel[] {
	if (!value || typeof value !== 'object' || !('models' in value) || !Array.isArray(value.models)) {
		return [];
	}
	return value.models
		.filter(visibleModel)
		.sort((a, b) => priority(a.priority) - priority(b.priority))
		.map(item => ({
			slug: item.slug,
			displayName: typeof item.display_name === 'string' && item.display_name.trim() ? item.display_name.trim() : item.slug,
			...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim() } : {}),
		}));
}

export async function listCodexModels(): Promise<CodexModel[]> {
	const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
	try {
		return parseCodexModels(JSON.parse(await readFile(path.join(home, 'models_cache.json'), 'utf8')));
	} catch {
		return [];
	}
}
