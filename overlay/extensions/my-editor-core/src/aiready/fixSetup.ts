import * as path from 'path';
import * as vscode from 'vscode';
import type { Sink } from '../chat/engine';
import { CheckResult, failureLines, runBaseline, runSetup } from './baseline';
import { fixTip } from './branchTip';
import { findCandidates } from './fixCandidates';
import { pickFixes, skippedWithLines } from './fixPicker';
import { needingRefactor, screenFix, screenQueue } from './fixScreen';
import { type FixChoice, logDir, RunState, saveState } from './fixState';
import { alreadyFailingText, approvalDetail, behindText, earlyText, timeoutMinutes } from './fixText';
import type { LanguageAdapter } from './language';
import { runCommand, tail } from './projectCommands';
import { changedFiles, discard, FIX_BRANCH, freeFolder, initRepository, prepare, prerequisites, trackedFiles, Worktree } from './worktree';

const MAX_FAILURE_LINES = 200;

/** Everything a run needs to run commands in the worktree. */
export interface CommandEnv {
	readonly storage: string;
	readonly root: string;
	readonly token: vscode.CancellationToken;
}

/** The per-command timeout from settings (minutes, default 10, clamped to 1–240). */
function timeoutMs(): number {
	return timeoutMinutes(vscode.workspace.getConfiguration('myEditor').get<unknown>('aiReady.commandTimeoutMinutes')) * 60_000;
}

/** Runs one approved command in the worktree (with its own `extra` env over the adapter's), logs its full output in run state, and parses it. */
export async function runCheck(env: CommandEnv, adapter: LanguageAdapter, worktree: string, approved: readonly string[],
	command: string, label: string, extra?: Readonly<Record<string, string>>): Promise<CheckResult> {
	const log = path.join(logDir(env.storage, env.root), `${Date.now()}-${label}.log`);
	const output = await runCommand(command, {
		cwd: worktree, approved, timeoutMs: timeoutMs(), logFile: log, cancel: env.token, env: { ...adapter.commandEnv, ...extra },
	});
	return {
		command, label, code: output.code, timedOut: output.timedOut, log,
		failures: label === 'test' ? [] : failureLines(output.error ?? output.output).slice(0, MAX_FAILURE_LINES),
		tests: label === 'test' && output.code !== undefined ? adapter.parseTests(adapter.testOutput === 'both' ? output.output : output.stdout) : undefined,
		tail: tail(output.error ?? output.output),
	};
}

/** Prerequisites, with `git init` and a first commit offered when the folder has no repository. False means stop. */
async function checkPrerequisites(root: string, sink: Sink): Promise<boolean> {
	let ready = await prerequisites(root);
	if (ready.noRepository) {
		const answer = await vscode.window.showInformationMessage('This folder is not a Git repository yet.',
			{ modal: true, detail: 'Fixes go on a separate branch. Create a repository here with one commit of the current files (not .my_editor/)?' }, 'Create it');
		if (answer !== 'Create it') { sink.text('Fixes need a Git repository, so nothing was changed.'); return false; }
		await initRepository(root);
		ready = await prerequisites(root);
	}
	if (ready.problem) { sink.text(ready.problem); return false; }
	return true;
}

/** A started run and the adapter for its worktree, built once for the install, the baseline and the fixes. */
export interface StartedRun {
	readonly state: RunState;
	readonly adapter: LanguageAdapter;
}

/**
 * A new run: prerequisites, the fix picker (from a fresh deterministic scan, never the report's text), approval of the
 * exact commands, the worktree and branch, and the baseline run twice. Undefined when the user stopped or declined.
 */
export async function startRun(env: CommandEnv, adapter: (root: string, tracked: readonly string[]) => LanguageAdapter,
	sink: Sink): Promise<StartedRun | undefined> {
	const { root, token } = env;
	if (!await checkPrerequisites(root, sink)) { return undefined; }
	sink.progress(`Finding files to fix${await fixTip(root) ? ` on ${FIX_BRANCH}, with the earlier runs' fixes` : ''}…`);
	const found = await findCandidates(root, adapter, () => token.isCancellationRequested);
	if (!found) { return undefined; }
	const { local, choices, refactor, skipped, stats } = found;
	sink.progress('');
	if (!choices.length) {
		sink.text(`Nothing here can be fixed on a branch yet: no long or untested ${local.label} files that may be split or tested.`);
		return undefined;
	}
	const picked = await pickFixes(choices, (items, options) => vscode.window.showQuickPick(items, { ...options, canPickMany: true }));
	if (!picked?.length) { sink.text('No fixes were chosen, so nothing changed.'); return undefined; }
	const checks = [...new Map(picked.flatMap(fix => local.checks(fix.file)).map(check => [check.command, check])).values()];
	const setup = local.setup?.() ?? [];
	const approved = [...setup, ...checks].map(check => check.command);
	const folder = freeFolder(root);
	const answer = await vscode.window.showWarningMessage('Run these commands on a new local branch?',
		{ modal: true, detail: approvalDetail(folder, approved, local.label, picked.length, setup.length > 0, local.approvalNote?.(folder)) }, 'Run them');
	if (answer !== 'Run them') { sink.text('The commands were not approved, so nothing changed.'); return undefined; }
	const limits = [...new Set(picked.filter(fix => fix.kind === 'split' && fix.narrowed).map(fix => fix.narrowed!))];
	const worktree = await prepare(root, folder);
	try {
		sink.text(`Working on branch \`${worktree.branch}\` in \`${worktree.path}\`. Your folder stays as it is.\n`);
		if (behindText(worktree)) { sink.text(`${behindText(worktree)} Nothing is merged or rebased.\n`); }
		if (limits.length) { sink.text(`In this project ${limits.join('; and ')}, so splits leave the run-time code in place.\n`); }
		logDir(env.storage, root, true);
		const inWorktree = adapter(worktree.path, await trackedFiles(worktree.path));
		const ready = await prepareWorktree(env, inWorktree, worktree.path, approved, sink);
		if (ready) { return await discardUnstarted(root, worktree, sink, ready === 'stopped' ? 'Stopped before any fix.' : ready); }
		const outcome = await runBaseline(checks, {
			check: (command, label, extra) => runCheck(env, inWorktree, worktree.path, approved, command, label, extra),
			cancelled: () => token.isCancellationRequested,
			progress: text => sink.progress(text),
		});
		if ('stopped' in outcome) { return await discardUnstarted(root, worktree, sink, 'Stopped before any fix.'); }
		if ('problem' in outcome) { return await discardUnstarted(root, worktree, sink, outcome.problem); }
		const failing = Object.entries(outcome.baseline).filter(([, [first]]) => first.code !== 0).map(([command]) => command);
		if (failing.length) { sink.text(alreadyFailingText(failing)); }
		sink.progress('Finding fixes nothing here can check…');
		const screen = (fix: FixChoice) => screenFix(inWorktree, worktree.path, outcome.baseline, fix);
		const cancelled = () => token.isCancellationRequested;
		// Splits that need a real refactor are settled here too, picked or not, so the change note lists them; they use none of the budget.
		const later = await needingRefactor(found.unparsed.filter(fix => !picked.some(p => p.file === fix.file && p.kind === fix.kind)), screen, cancelled);
		const queue = await screenQueue([...refactor, ...later, ...picked], screen, cancelled);
		if (queue === 'stopped') { return await discardUnstarted(root, worktree, sink, 'Stopped before any fix.'); }
		sink.text(earlyText(queue.early));
		const state: RunState = {
			version: 1, root, language: local.label, worktree, startedAt: new Date().toISOString(), approved,
			fixes: queue.fixes, next: queue.early.length, steps: queue.early.map(early => early.step),
			baseline: outcome.baseline, skippedFiles: skippedWithLines(skipped, stats), setupStamp: inWorktree.setupStamp?.(),
		};
		saveState(env.storage, state);
		sink.progress('');
		return { state, adapter: inWorktree };
	} catch (error) {
		return discardUnstarted(root, worktree, sink, `The run could not start: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Runs the adapter's setup (an install) once in the worktree: undefined when ready, else a plain message or 'stopped'.
 * On Continue, `stamp` is the setup stamp saved after the last install; while the adapter still reports it (TS:
 * node_modules is there and the lockfile is unchanged), the install does not run again.
 */
export async function prepareWorktree(env: CommandEnv, adapter: LanguageAdapter, worktree: string, approved: readonly string[], sink: Sink,
	stamp?: string): Promise<string | undefined> {
	const installed = stamp !== undefined && adapter.setupStamp?.() === stamp;
	return runSetup(adapter.setup?.() ?? [], {
		check: (command, label) => runCheck(env, adapter, worktree, approved, command, label),
		cancelled: () => env.token.isCancellationRequested,
		progress: text => sink.progress(text),
	}, () => changedFiles(worktree), () => adapter.ready?.(), installed);
}

/** Before any fix (Stop, a baseline that could not run, or an error): nothing was committed, so the worktree and branch go. */
async function discardUnstarted(root: string, worktree: Worktree, sink: Sink, reason: string): Promise<undefined> {
	sink.progress('');
	try {
		await discard(root, worktree);
		sink.text(`${reason} ${worktree.created ? `The branch \`${worktree.branch}\` and its working copy were removed.`
			: `Its working copy was removed; \`${worktree.branch}\` keeps the earlier runs' commits.`}`);
	} catch {
		sink.text(`${reason} Remove the working copy \`${worktree.path}\`${worktree.created ? ` and the branch \`${worktree.branch}\`` : ''} by hand.`);
	}
	return undefined;
}
