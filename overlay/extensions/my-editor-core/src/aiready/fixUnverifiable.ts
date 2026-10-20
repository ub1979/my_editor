import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import * as path from 'path';
import { type CheckResult, errorLine } from './baseline';
import { fixTip } from './branchTip';
import { unitOf } from './fixScreen';
import { type FixChoice, runDir } from './fixState';
import type { CheckCommand } from './language';

/**
 * What the last closed run's baseline showed, kept so the next picker can leave unticked the files nothing here can
 * check. Keyed by the `ai_fix` tip that run left: once the branch moves, the record no longer counts.
 */
export interface CheckCache {
	readonly tip: string;
	/** Each recorded command, and whether both baseline runs passed. */
	readonly passed: Readonly<Record<string, boolean>>;
	/** For each recorded command that failed, its most telling error line, so the picker can say why. */
	readonly errors?: Readonly<Record<string, string>>;
}

type Baseline = Readonly<Record<string, readonly [CheckResult, CheckResult]>>;

const FILE = 'checks.json';

/**
 * The cache after a run that left `tip`: its baseline over the earlier record, so a package this run did not recheck
 * keeps its entry (and its error), and one drops out only when a baseline shows it compiling.
 */
export function checkCache(tip: string, baseline: Baseline, previous?: CheckCache): CheckCache {
	const now = Object.fromEntries(Object.entries(baseline).map(([command, runs]) => [command, runs.every(r => r.code === 0)]));
	const errors: Record<string, string> = { ...previous?.errors };
	for (const [command, runs] of Object.entries(baseline)) {
		const failed = runs.find(r => r.code !== 0);
		const line = failed && errorLine(failed);
		if (line && line !== 'no output') { errors[command] = line; } else { delete errors[command]; }
	}
	return { tip, passed: { ...previous?.passed, ...now }, ...(Object.keys(errors).length ? { errors } : {}) };
}

export function saveChecks(storageDir: string, root: string, cache: CheckCache): void {
	const dir = runDir(storageDir, root);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, `${FILE}.tmp`), JSON.stringify(cache));
	renameSync(path.join(dir, `${FILE}.tmp`), path.join(dir, FILE));
}

export function loadChecks(storageDir: string, root: string): CheckCache | undefined {
	try {
		const cache = JSON.parse(readFileSync(path.join(runDir(storageDir, root), FILE), 'utf8')) as CheckCache;
		return typeof cache.tip === 'string' && cache.passed && typeof cache.passed === 'object' ? cache : undefined;
	} catch {
		return undefined;
	}
}

/** When a run closes: records its baseline over the earlier record, under the `ai_fix` tip it left. Never fails the close. */
export async function rememberChecks(storageDir: string, root: string, baseline: Baseline): Promise<void> {
	try {
		const tip = await fixTip(root);
		if (tip) { saveChecks(storageDir, root, checkCache(tip, baseline, loadChecks(storageDir, root))); }
	} catch { /* Only a hint for the next picker. */ }
}

/**
 * The files the last run's baseline showed can't be checked here, each with the picker's reason: at least one of the
 * file's compile checks was recorded and none passed. A file none of whose checks was recorded is unknown, so it is not
 * listed. Empty unless the cache was saved at `tip`, the tip the picker sized the files on.
 */
export function blockedFiles(choices: readonly FixChoice[], checks: (file: string) => readonly CheckCommand[], cache: CheckCache | undefined,
	tip: string | undefined): Map<string, string> {
	const blocked = new Map<string, string>();
	if (!cache || !tip || cache.tip !== tip) { return blocked; }
	for (const file of new Set(choices.map(choice => choice.file))) {
		let commands: readonly CheckCommand[];
		try { commands = checks(file); } catch { continue; }
		const recorded = commands.filter(check => check.verifies && check.command in cache.passed);
		if (recorded.length && !recorded.some(check => cache.passed[check.command])) {
			const error = recorded.map(check => cache.errors?.[check.command]).find(Boolean);
			blocked.set(file, `can't be checked here: ${unitOf(file)} build already fails${error ? ` (${error})` : ''}`);
		}
	}
	return blocked;
}
