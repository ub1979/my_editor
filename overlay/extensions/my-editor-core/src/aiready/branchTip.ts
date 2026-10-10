import { readFileSync } from 'fs';
import * as path from 'path';
import { FIX_BRANCH, git, OLD_BRANCH, trackedFiles } from './worktree';

/**
 * The commit a new run builds on: `ai_fix`, else the old `my_editor/ai-ready` it would start from; undefined when
 * neither exists (the run starts at HEAD).
 */
export async function fixTip(root: string): Promise<string | undefined> {
	for (const branch of [FIX_BRANCH, OLD_BRANCH]) {
		try { return (await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).trim(); } catch { /* Not there. */ }
	}
	return undefined;
}

/** The files a run would start from, so the picker sizes what is on the branch, not what is in the user's folder. */
export interface TreeSource {
	readonly tip?: string;
	/** Tracked paths at the tip. */
	readonly tracked: readonly string[];
	/** Paths whose content at the tip differs from HEAD's, or that HEAD lacks: the user's folder can't parse them. */
	readonly changed: ReadonlySet<string>;
	text(file: string): Promise<string>;
	/** The file's blob id as a run would start from it; undefined when it can't be read. */
	blob(file: string): Promise<string | undefined>;
}

/** Blob ids by path in a commit's tree, from `git ls-tree -r -z` (submodules left out). */
async function blobs(root: string, commit: string): Promise<Map<string, string>> {
	const entries = (await git(root, ['ls-tree', '-r', '-z', '--full-tree', commit])).split('\0').filter(Boolean);
	const found = new Map<string, string>();
	for (const entry of entries) {
		const tab = entry.indexOf('\t');
		const [, type, id] = entry.slice(0, tab).split(' ');
		if (type === 'blob') { found.set(entry.slice(tab + 1), id); }
	}
	return found;
}

/**
 * The tip's files, read with read-only git (no checkout, no remote). A file the same as at HEAD is read from the
 * user's folder, which has no uncommitted edits to tracked files once prerequisites pass; any other with `cat-file`.
 * Without a tip, the user's folder as it is.
 */
export async function treeSource(root: string): Promise<TreeSource> {
	const fromFolder = async (file: string) => readFileSync(path.join(root, file), 'utf8');
	const tip = await fixTip(root);
	if (!tip) {
		const hashed = async (file: string) => { try { return (await git(root, ['hash-object', '--', file])).trim(); } catch { return undefined; } };
		return { tracked: await trackedFiles(root), changed: new Set(), text: fromFolder, blob: hashed };
	}
	const [atTip, atHead] = await Promise.all([blobs(root, tip), blobs(root, 'HEAD')]);
	const changed = new Set([...atTip].filter(([file, id]) => atHead.get(file) !== id).map(([file]) => file));
	return {
		tip, tracked: [...atTip.keys()], changed,
		text: file => (changed.has(file) ? git(root, ['cat-file', 'blob', atTip.get(file)!]) : fromFolder(file)),
		blob: async file => atTip.get(file),
	};
}
