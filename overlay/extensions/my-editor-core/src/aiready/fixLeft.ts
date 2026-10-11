import * as vscode from 'vscode';
import { findCandidates } from './fixCandidates';
import { loadSettled, remembered } from './fixSettled';
import { loadRefused, refusedBefore } from './refusedRecord';
import { blockedFiles, loadChecks } from './fixUnverifiable';
import { adapterFor } from './languages';
import { git, FIX_BRANCH } from './worktree';

const key = (root: string) => `myEditor.fixLeft:${root}`;

/** What a click on the fix button would do, from the last count. */
export interface FixLeft {
	/** Splits a run would start with ticked. */
	readonly left: number;
	/** Long functions a run would offer to refactor: not refused for their content, in packages that build here. */
	readonly offers?: number;
	/** Files still over the limit a split can't help and no refactor is offered for (or one was refused for their content). */
	readonly refactor: number;
	/** Files over the limit in packages whose build already failed here. */
	readonly unbuildable: number;
}

/** The cached count for this project; undefined when never computed (or saved by an older version in another shape). */
export function cachedLeft(context: vscode.ExtensionContext, root: string): FixLeft | undefined {
	const saved = context.workspaceState.get<unknown>(key(root));
	const count = saved as FixLeft | undefined;
	return count && typeof count === 'object' && typeof count.left === 'number' && typeof count.unbuildable === 'number' ? count : undefined;
}

/** Whether the `ai_fix` branch exists. */
export async function fixBranchExists(root: string): Promise<boolean> {
	try { await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${FIX_BRANCH}`]); return true; } catch { return false; }
}

/**
 * Counts, on the `ai_fix` tip (or HEAD), the splits a run would tick and the long files none can help, the way the
 * picker sees them, and caches the count. Never asks the user anything: when the language cannot be set up quietly,
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
		const splits = found.choices.filter(choice => choice.kind === 'split');
		const blocked = blockedFiles(splits, file => found.local.checks(file), loadChecks(storage, root), found.tip);
		const refused = loadRefused(storage, root);
		const offered = found.choices.filter(choice => choice.kind === 'refactor');
		const stuck = blockedFiles(offered, file => found.local.checks(file), loadChecks(storage, root), found.tip);
		const open = offered.filter(o => !stuck.has(o.file) && refusedBefore(refused, o.file, found.blobs.get(o.file)) === undefined);
		const count: FixLeft = {
			left: splits.length - blocked.size, offers: open.length, unbuildable: blocked.size + stuck.size,
			refactor: found.unsplittable.filter(fix => !offered.some(o => o.file === fix.file)).length + offered.length - open.length - stuck.size,
		};
		await context.workspaceState.update(key(root), count);
		return count;
	} catch {
		return undefined;
	}
}
