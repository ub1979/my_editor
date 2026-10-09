import { createHash } from 'crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import type { CheckResult } from './baseline';
import type { Worktree } from './worktree';

export type FixKind = 'split' | 'tests';

/** One fix the user picked. */
export interface FixChoice {
	readonly file: string;
	readonly kind: FixKind;
	readonly lines: number;
}

/** What happened to one fix. */
export interface StepRecord {
	readonly file: string;
	readonly kind: FixKind;
	readonly status: 'committed' | 'skipped' | 'refused' | 'discarded';
	readonly reason?: string;
	readonly commit?: string;
	/** For a split: each new file and the declarations moved into it. */
	readonly moved?: readonly { readonly file: string; readonly names: readonly string[] }[];
	/** For new tests: the test file and the tests dropped because they failed. */
	readonly testFile?: string;
	readonly dropped?: readonly string[];
	readonly checks?: string;
	readonly notes?: readonly string[];
}

/** A run's saved state, in global storage, keyed by project path. Nothing is written to the project during a run. */
export interface RunState {
	readonly version: 1;
	readonly root: string;
	readonly language: string;
	/** Updated when Continue has to check the branch out again. */
	worktree: Worktree;
	readonly startedAt: string;
	/** The exact commands the user approved. */
	readonly approved: readonly string[];
	readonly fixes: readonly FixChoice[];
	/** Index of the next fix to run. */
	next: number;
	readonly steps: StepRecord[];
	/** Two baseline runs per command. */
	readonly baseline: Record<string, readonly [CheckResult, CheckResult]>;
	/** Files that are never split, with the reason, for the change note. */
	readonly skippedFiles: readonly { readonly file: string; readonly reason: string }[];
}

/** "Discard the rest": records every fix not yet run as discarded by the user and ends the run's queue. */
export function discardRest(state: RunState): void {
	for (const fix of state.fixes.slice(state.next)) { state.steps.push({ file: fix.file, kind: fix.kind, status: 'discarded' }); }
	state.next = state.fixes.length;
}

/** At most this many fixes per run; Continue picks up the rest. */
export const MAX_FIXES_PER_RUN = 25;

/** The folder holding a project's run state and command logs. */
export function runDir(storageDir: string, root: string): string {
	return path.join(storageDir, 'ai-ready', createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 16));
}

export function loadState(storageDir: string, root: string): RunState | undefined {
	try {
		const state = JSON.parse(readFileSync(path.join(runDir(storageDir, root), 'state.json'), 'utf8')) as RunState;
		return state.version === 1 && state.root === root ? state : undefined;
	} catch {
		return undefined;
	}
}

/** Writes the state atomically, so a crash leaves either the old or the new state. */
export function saveState(storageDir: string, state: RunState): void {
	const dir = runDir(storageDir, state.root);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, 'state.json.tmp'), JSON.stringify(state));
	renameSync(path.join(dir, 'state.json.tmp'), path.join(dir, 'state.json'));
}

/** Forgets a finished or discarded run. Its logs stay until the next run starts. */
export function clearState(storageDir: string, root: string): void {
	rmSync(path.join(runDir(storageDir, root), 'state.json'), { force: true });
}

/** The folder for this run's command logs, emptied when a new run starts. */
export function logDir(storageDir: string, root: string, fresh = false): string {
	const dir = path.join(runDir(storageDir, root), 'logs');
	if (fresh) { rmSync(dir, { recursive: true, force: true }); }
	mkdirSync(dir, { recursive: true });
	return dir;
}
