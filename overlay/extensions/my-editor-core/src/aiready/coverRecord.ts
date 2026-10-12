import { runDir } from './fixState';
import { loadJson, saveJson } from './jsonStore';

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

/** Whether the last coverage of this file, as it is now, ran this function; undefined when unknown. */
export function ranBefore(cache: CoverageCache | undefined, file: string, blob: string | undefined, fn: string | undefined): boolean | undefined {
	const known = cache?.files[file];
	return known && blob && known.blob === blob && known.function === fn ? known.ran : undefined;
}

const isCache = (value: unknown): value is CoverageCache =>
	!!value && typeof value === 'object' && !!(value as CoverageCache).files && typeof (value as CoverageCache).files === 'object';

export function saveCoverage(storageDir: string, root: string, cache: CoverageCache): void {
	saveJson(runDir(storageDir, root), FILE, cache);
}

export function loadCoverage(storageDir: string, root: string): CoverageCache | undefined {
	return loadJson(runDir(storageDir, root), FILE, isCache);
}
