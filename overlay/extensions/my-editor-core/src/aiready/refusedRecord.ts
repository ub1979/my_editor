import { runDir, type StepRecord } from './fixState';
import { loadJson, saveJson } from './jsonStore';
import { git } from './worktree';

/** A refactor a run refused, kept by the file's blob id so the picker can say why while the file is unchanged. */
export interface RefusedRefactor {
	readonly blob: string;
	readonly reason: string;
}

export interface RefusedCache {
	readonly files: Readonly<Record<string, RefusedRefactor>>;
}

const FILE = 'refactor-refused.json';

/** Refused refactors by blob over the earlier record; a committed refactor of a file drops its entry. */
export function refusedCache(steps: readonly StepRecord[], blobs: ReadonlyMap<string, string>, previous?: RefusedCache): RefusedCache {
	const files: Record<string, RefusedRefactor> = { ...previous?.files };
	for (const step of steps) {
		if (step.kind !== 'refactor') { continue; }
		if (step.status === 'committed') { delete files[step.file]; continue; }
		const blob = blobs.get(step.file);
		if (step.status === 'refused' && blob) { files[step.file] = { blob, reason: step.reason ?? '' }; }
	}
	return { files };
}

/** Why an earlier run refused this file's refactor, while its content is the same; else undefined. */
export function refusedBefore(cache: RefusedCache | undefined, file: string, blob: string | undefined): string | undefined {
	const known = cache?.files[file];
	return known && blob && known.blob === blob ? known.reason : undefined;
}

const isCache = (value: unknown): value is RefusedCache =>
	!!value && typeof value === 'object' && !!(value as RefusedCache).files && typeof (value as RefusedCache).files === 'object';

export function saveRefused(storageDir: string, root: string, cache: RefusedCache): void {
	saveJson(runDir(storageDir, root), FILE, cache);
}

export function loadRefused(storageDir: string, root: string): RefusedCache | undefined {
	return loadJson(runDir(storageDir, root), FILE, isCache);
}

/** When a run closes: its refused refactors, blob ids read in its worktree. Never fails the close. */
export async function rememberRefused(storageDir: string, root: string, worktree: string, steps: readonly StepRecord[]): Promise<void> {
	try {
		const blobs = new Map<string, string>();
		for (const file of new Set(steps.filter(step => step.kind === 'refactor' && step.status === 'refused').map(step => step.file))) {
			try { blobs.set(file, (await git(worktree, ['rev-parse', `HEAD:${file}`])).trim()); } catch { /* Not on the branch. */ }
		}
		saveRefused(storageDir, root, refusedCache(steps, blobs, loadRefused(storageDir, root)));
	} catch { /* Only a hint for the next picker. */ }
}
