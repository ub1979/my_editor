import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import * as path from 'path';
import { runDir } from './fixState';

/**
 * Whether the package's tests ran a refactor offer's function, kept by the file's blob id. Checks are kept by tip, and
 * every run that commits moves the tip; a refactor offer's file is not changed by the run that measured it.
 */
export interface CoverageEntry {
	readonly blob: string;
	readonly function: string;
	readonly ran: boolean;
}

export interface CoverageCache {
	readonly files: Readonly<Record<string, CoverageEntry>>;
}

const FILE = 'coverage.json';

/** This run's entries over the earlier record. */
export function coverageCache(entries: ReadonlyMap<string, CoverageEntry>, previous?: CoverageCache): CoverageCache {
	return { files: { ...previous?.files, ...Object.fromEntries(entries) } };
}

/** Whether the last coverage of this file, as it is now, ran its function; undefined when unknown. */
export function ranBefore(cache: CoverageCache | undefined, file: string, blob: string | undefined): boolean | undefined {
	const known = cache?.files[file];
	return known && blob && known.blob === blob ? known.ran : undefined;
}

export function saveCoverage(storageDir: string, root: string, cache: CoverageCache): void {
	const dir = runDir(storageDir, root);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, `${FILE}.tmp`), JSON.stringify(cache));
	renameSync(path.join(dir, `${FILE}.tmp`), path.join(dir, FILE));
}

export function loadCoverage(storageDir: string, root: string): CoverageCache | undefined {
	try {
		const cache = JSON.parse(readFileSync(path.join(runDir(storageDir, root), FILE), 'utf8')) as CoverageCache;
		return cache.files && typeof cache.files === 'object' ? cache : undefined;
	} catch {
		return undefined;
	}
}
