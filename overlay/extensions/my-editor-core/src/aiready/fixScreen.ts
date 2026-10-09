import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { MAX_SOURCE_LINES, sourceLines } from '../quality/sourcePolicy';
import { type CheckResult, buildBlocker, noVerifyingCheck } from './baseline';
import type { FixChoice, StepRecord } from './fixState';
import type { FileInfo, LanguageAdapter } from './language';
import { needsRefactor } from './stillOver';

/** A fix settled before any model call or edit: its step, a few words for grouping, and whether it is unchecked. */
export interface EarlyOutcome {
	readonly step: StepRecord;
	readonly brief: string;
	/** True when nothing here can check it (no passing compile check of its unit). */
	readonly unchecked: boolean;
}

/** What screening needs from the language adapter. */
export type Screener = Pick<LanguageAdapter, 'checks' | 'parse' | 'testFileName'>;

type Baseline = Readonly<Record<string, readonly [CheckResult, CheckResult]>>;

/** The unit a file's checks compile, as the run text names it (`./internal/engine`, or `.` at the root). */
export function unitOf(file: string): string {
	const dir = path.posix.dirname(file);
	return dir === '.' ? '.' : `./${dir}`;
}

/** Why a parsed fix is settled before any work, or undefined when it should run. */
export function screenParsed(adapter: Screener, worktree: string, baseline: Baseline, fix: FixChoice, info: FileInfo):
	EarlyOutcome | undefined {
	const settle = (reason: string, brief: string, unchecked = false, testFile?: string): EarlyOutcome => ({
		step: { file: fix.file, kind: fix.kind, status: 'skipped', reason, early: true, ...(testFile ? { testFile } : {}) },
		brief, unchecked,
	});
	if (fix.kind === 'tests') {
		const testFile = adapter.testFileName(fix.file);
		if (info.skip) { return settle(`No tests added: ${info.skip}.`, `no tests added: ${info.skip}`, false, testFile); }
		if (existsSync(path.join(worktree, testFile))) { return settle(`${testFile} already exists.`, `${testFile} already exists`, false, testFile); }
		return undefined;
	}
	if (info.skip) { return settle(`Never split: ${info.skip}.`, `never split: ${info.skip}`); }
	if (!info.declarations.some(d => d.movable)) { return settle('Nothing in it may move.', 'nothing in it may move'); }
	const refactor = needsRefactor(info, fix.lines);
	if (refactor) {
		const outcome = settle(`${refactor.reason[0].toUpperCase()}${refactor.reason.slice(1)}.`, refactor.reason);
		return { ...outcome, step: { ...outcome.step, over: [refactor] } };
	}
	const checks = adapter.checks(fix.file);
	const blocker = buildBlocker(checks, baseline);
	return blocker ? settle(noVerifyingCheck(checks, baseline, unitOf(fix.file))!, blocker, true) : undefined;
}

/** Parses and screens one fix; a file that cannot be parsed is settled too (nothing was asked or written). */
export async function screenFix(adapter: Screener, worktree: string, baseline: Baseline, fix: FixChoice): Promise<EarlyOutcome | undefined> {
	let info: FileInfo;
	try { info = await adapter.parse(fix.file); } catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { step: { file: fix.file, kind: fix.kind, status: 'skipped', reason: message, early: true }, brief: message, unchecked: false };
	}
	return screenParsed(adapter, worktree, baseline, fix, info) ?? alreadyShort(worktree, fix);
}

/** The picker sized files in the user's folder; the run's branch may already have split this one in an earlier run. */
function alreadyShort(worktree: string, fix: FixChoice): EarlyOutcome | undefined {
	const file = path.join(worktree, fix.file);
	if (fix.kind !== 'split' || !existsSync(file)) { return undefined; }
	const lines = sourceLines(readFileSync(file, 'utf8'));
	if (lines > MAX_SOURCE_LINES) { return undefined; }
	const reason = `Already ${lines} lines on this branch (the limit is ${MAX_SOURCE_LINES}).`;
	return { step: { file: fix.file, kind: fix.kind, status: 'skipped', reason, early: true }, brief: `already ${lines} lines on this branch`, unchecked: false };
}

/** The queue after one pass right after the baseline: settled fixes first (in order), then the rest in order. */
export interface ScreenedQueue {
	readonly fixes: FixChoice[];
	readonly early: EarlyOutcome[];
}

export async function screenQueue(fixes: readonly FixChoice[], screen: (fix: FixChoice) => Promise<EarlyOutcome | undefined>,
	cancelled: () => boolean): Promise<ScreenedQueue | 'stopped'> {
	const early: EarlyOutcome[] = [];
	const settled: FixChoice[] = [];
	const rest: FixChoice[] = [];
	for (const fix of fixes) {
		if (cancelled()) { return 'stopped'; }
		const outcome = await screen(fix);
		if (outcome) { early.push(outcome); settled.push(fix); } else { rest.push(fix); }
	}
	return { fixes: [...settled, ...rest], early };
}

/** The fixes screening settles as needing a real refactor: the change note lists them even when nobody picked them. */
export async function needingRefactor(fixes: readonly FixChoice[], screen: (fix: FixChoice) => Promise<EarlyOutcome | undefined>,
	cancelled: () => boolean): Promise<FixChoice[]> {
	const found: FixChoice[] = [];
	for (const fix of fixes) {
		if (cancelled()) { break; }
		if ((await screen(fix))?.step.over?.length) { found.push(fix); }
	}
	return found;
}
