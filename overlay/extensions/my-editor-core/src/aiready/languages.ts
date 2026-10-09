import { existsSync } from 'fs';
import * as path from 'path';
import { createGoAdapter, goTools } from './goAdapter';
import type { LanguageAdapter } from './language';

/** Creates a language adapter for a root (the user's folder or the worktree) and its tracked files. */
export type AdapterFactory = (root: string, tracked: readonly string[]) => LanguageAdapter;

/** Where the extension keeps its files, for adapters that ship or build helpers. */
export interface AdapterHost {
	readonly extensionPath: string;
	readonly storageDir: string;
	readonly version: string;
}

/**
 * The adapter for the project's language, or a plain message. Go is the first adapter; TS/JS, Python, C#, Rust and
 * C/C++ follow, each in its own `<language>Adapter.ts` registered here.
 */
export async function adapterFor(root: string, host: AdapterHost): Promise<AdapterFactory | string> {
	if (existsSync(path.join(root, 'go.mod'))) {
		const tools = await goTools(path.join(host.extensionPath, 'resources', 'goast', 'main.go'), host.storageDir, host.version);
		return typeof tools === 'string' ? tools : (dir, tracked) => createGoAdapter(dir, tools, tracked);
	}
	return 'Fixing on a branch works for Go projects first (a `go.mod` in the top folder). TypeScript, JavaScript, Python, C#, Rust and C/C++ come next.';
}
