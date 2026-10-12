import * as vscode from 'vscode';
import { loadCoverage } from './coverRecord';
import { findCandidates } from './fixCandidates';
import { countLeft, type FixLeft, isFixLeft } from './fixCount';
import { loadSettled, remembered } from './fixSettled';
import { loadChecks } from './fixUnverifiable';
import { adapterFor } from './languages';
import { loadRefused } from './refusedRecord';
import { git, FIX_BRANCH } from './worktree';

export type { FixLeft };

const key = (root: string) => `myEditor.fixLeft:${root}`;

/** The cached count for this project; undefined when never computed or saved by an older version in another shape (then it is counted again). */
export function cachedLeft(context: vscode.ExtensionContext, root: string): FixLeft | undefined {
	const saved = context.workspaceState.get<unknown>(key(root));
	return isFixLeft(saved) ? saved : undefined;
}

/** Whether the `ai_fix` branch exists. */
export async function fixBranchExists(root: string): Promise<boolean> {
	try { await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${FIX_BRANCH}`]); return true; } catch { return false; }
}

/**
 * Counts, on the `ai_fix` tip (or HEAD), the splits and refactors a run would tick and the long files none can help,
 * the way the picker sees them, and caches the count. Never asks the user anything: when the language cannot be set up quietly,
 * the count stays unknown.
 */
export async function refreshLeft(context: vscode.ExtensionContext, root: string): Promise<FixLeft | undefined> {
	try {
		const storage = context.globalStorageUri.fsPath;
		const version = String(context.extension.packageJSON.version ?? 'dev');
		const language = await adapterFor(root, { extensionPath: context.extensionUri.fsPath, storageDir: storage, version, appRoot: vscode.env.appRoot });
		if (typeof language === 'string') { return undefined; }
		const found = await findCandidates(root, language, () => false, remembered(loadSettled(storage, root)));
		if (!found) { return undefined; }
		const count = countLeft(found, { checks: loadChecks(storage, root), coverage: loadCoverage(storage, root), refused: loadRefused(storage, root) });
		await context.workspaceState.update(key(root), count);
		return count;
	} catch {
		return undefined;
	}
}
