import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import * as path from 'path';
import { runDir, type StepRecord } from './fixState';
import { git } from './worktree';

/**
 * A split a run settled from the file's own content, kept by the file's blob id. The picker can only parse files that
 * are the same in the user's folder; a file the user's branch changed after `ai_fix` parted would otherwise be ticked
 * again on every run, only to be settled the same way.
 */
export interface SettledSplit {
	readonly blob: string;
	/** Why it is never split or tested; unset when a split can't help it (a real refactor, nothing may move). */
	readonly skip?: string;
}

/** What earlier runs settled, for one my_editor version (a newer one may split files an older one would not). */
export interface SettledCache {
	readonly version: string;
	readonly files: Readonly<Record<string, SettledSplit>>;
}

/** Looks up what is known about one file as it is now; undefined when unknown or its content changed. */
export type Remembered = (file: string, blob: string | undefined) => SettledSplit | undefined;

const FILE = 'settled.json';

/** The cache after a run: its lasting split outcomes over the earlier record (kept only when it is for this version). */
export function settledCache(version: string, steps: readonly StepRecord[], blobs: ReadonlyMap<string, string>,
	previous?: SettledCache): SettledCache {
	const files: Record<string, SettledSplit> = { ...(previous?.version === version ? previous.files : {}) };
	for (const step of steps) {
		const blob = blobs.get(step.file);
		if (step.kind !== 'split' || !step.lasting || !blob) { continue; }
		files[step.file] = step.lasting.skip ? { blob, skip: step.lasting.skip } : { blob };
	}
	return { version, files };
}

/** The lookup for the picker: a hit only for the same version and the same file content. */
export function remembered(cache: SettledCache | undefined, version: string): Remembered {
	return (file, blob) => {
		const known = cache?.version === version ? cache.files[file] : undefined;
		return known && blob && known.blob === blob ? known : undefined;
	};
}

export function saveSettled(storageDir: string, root: string, cache: SettledCache): void {
	const dir = runDir(storageDir, root);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, `${FILE}.tmp`), JSON.stringify(cache));
	renameSync(path.join(dir, `${FILE}.tmp`), path.join(dir, FILE));
}

export function loadSettled(storageDir: string, root: string): SettledCache | undefined {
	try {
		const cache = JSON.parse(readFileSync(path.join(runDir(storageDir, root), FILE), 'utf8')) as SettledCache;
		return typeof cache.version === 'string' && cache.files && typeof cache.files === 'object' ? cache : undefined;
	} catch {
		return undefined;
	}
}

/** When a run closes: records its lasting split outcomes, with blob ids read in its worktree. Never fails the close. */
export async function rememberSettled(storageDir: string, root: string, worktree: string, version: string,
	steps: readonly StepRecord[]): Promise<void> {
	try {
		const blobs = new Map<string, string>();
		for (const file of new Set(steps.filter(step => step.kind === 'split' && step.lasting).map(step => step.file))) {
			try { blobs.set(file, (await git(worktree, ['rev-parse', `HEAD:${file}`])).trim()); } catch { /* Not on the branch. */ }
		}
		saveSettled(storageDir, root, settledCache(version, steps, blobs, loadSettled(storageDir, root)));
	} catch { /* Only a hint for the next picker. */ }
}
