import * as vscode from 'vscode';
import { findCandidates } from './fixCandidates';
import { adapterFor } from './languages';
import { git, FIX_BRANCH } from './worktree';

const key = (root: string) => `myEditor.fixLeft:${root}`;

/** The cached count of files over the limit for this project; undefined when never computed. */
export function cachedLeft(context: vscode.ExtensionContext, root: string): number | undefined {
	return context.workspaceState.get<number>(key(root));
}

/** Whether the `ai_fix` branch exists. */
export async function fixBranchExists(root: string): Promise<boolean> {
	try { await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${FIX_BRANCH}`]); return true; } catch { return false; }
}

/**
 * Counts the split candidates on the `ai_fix` tip (or HEAD) that need no real refactor, and caches the count.
 * Never asks the user anything: when the language cannot be set up quietly, the count stays unknown.
 */
export async function refreshLeft(context: vscode.ExtensionContext, root: string): Promise<number | undefined> {
	try {
		const language = await adapterFor(root, {
			extensionPath: context.extensionUri.fsPath, storageDir: context.globalStorageUri.fsPath,
			version: String(context.extension.packageJSON.version ?? 'dev'), appRoot: vscode.env.appRoot,
		});
		if (typeof language === 'string') { return undefined; }
		const found = await findCandidates(root, language, () => false);
		const left = found?.choices.filter(choice => choice.kind === 'split').length;
		await context.workspaceState.update(key(root), left);
		return left;
	} catch {
		return undefined;
	}
}
