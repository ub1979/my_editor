import { readFileSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Sink } from '../chat/engine';
import { CheckResult, failureLines, runBaseline } from './baseline';
import { fixChoices, pickFixes, skippedWithLines } from './fixPicker';
import { logDir, RunState, saveState } from './fixState';
import { alreadyFailingText, approvalDetail, timeoutMinutes } from './fixText';
import { fileStats, scanHealth } from './health';
import type { LanguageAdapter } from './language';
import { runCommand, tail } from './projectCommands';
import { discard, freeFolder, initRepository, prepare, prerequisites, trackedFiles, Worktree } from './worktree';

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

/** Runs one approved command in the worktree, logs its full output in run state, and parses it. */
export async function runCheck(env: CommandEnv, adapter: LanguageAdapter, worktree: string, approved: readonly string[],
	command: string, label: string): Promise<CheckResult> {
	const log = path.join(logDir(env.storage, env.root), `${Date.now()}-${label}.log`);
	const output = await runCommand(command, { cwd: worktree, approved, timeoutMs: timeoutMs(), logFile: log, cancel: env.token, env: adapter.commandEnv });
	return {
		command, code: output.code, timedOut: output.timedOut, log,
		failures: label === 'test' ? [] : failureLines(output.error ?? output.output).slice(0, MAX_FAILURE_LINES),
		tests: label === 'test' && output.code !== undefined ? adapter.parseTests(output.stdout) : undefined,
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

/**
 * A new run: prerequisites, the fix picker (from a fresh deterministic scan, never the report's text), approval of the
 * exact commands, the worktree and branch, and the baseline run twice. Undefined when the user stopped or declined.
 */
export async function startRun(env: CommandEnv, adapter: (root: string, tracked: readonly string[]) => LanguageAdapter, sink: Sink): Promise<RunState | undefined> {
	const { root, token } = env;
	if (!await checkPrerequisites(root, sink)) { return undefined; }
	sink.progress('Finding files to fix…');
	const tracked = await trackedFiles(root);
	const local = adapter(root, tracked);
	const sources = tracked.filter(file => local.extensions.includes(path.extname(file)));
	const stats = sources.map(file => fileStats(file, readFileSync(path.join(root, file), 'utf8')));
	const findings = scanHealth(stats, tracked, { languages: [local.label], checks: [], tests: [] }, []);
	const candidates = [...new Set(findings.filter(f => f.file && (f.kind === 'too-long' || f.kind === 'untested')).map(f => f.file!))]
		.filter(file => sources.includes(file));
	const skipped = new Map<string, string>();
	for (const file of candidates) {
		if (token.isCancellationRequested) { return undefined; }
		try {
			const reason = (await local.parse(file)).skip;
			if (reason) { skipped.set(file, reason); }
		} catch (error) { skipped.set(file, error instanceof Error ? error.message : String(error)); }
	}
	const choices = fixChoices(findings, stats, local.extensions, skipped);
	sink.progress('');
	if (!choices.length) { sink.text(`Nothing here can be fixed on a branch yet: no long or untested ${local.label} files that may be split or tested.`); return undefined; }
	const picked = await pickFixes(choices, (items, options) => vscode.window.showQuickPick(items, { ...options, canPickMany: true }));
	if (!picked?.length) { sink.text('No fixes were chosen, so nothing changed.'); return undefined; }
	const checks = [...new Map(picked.flatMap(fix => local.checks(fix.file)).map(check => [check.command, check])).values()];
	const approved = checks.map(check => check.command);
	const folder = freeFolder(root);
	const answer = await vscode.window.showWarningMessage('Run these commands on a new local branch?',
		{ modal: true, detail: approvalDetail(folder, approved, local.label, picked.length) }, 'Run them');
	if (answer !== 'Run them') { sink.text('The commands were not approved, so nothing changed.'); return undefined; }
	const worktree = await prepare(root, folder);
	try {
		sink.text(`Working on branch \`${worktree.branch}\` in \`${worktree.path}\`. Your folder stays as it is.\n`);
		logDir(env.storage, root, true);
		const inWorktree = adapter(worktree.path, await trackedFiles(worktree.path));
		const outcome = await runBaseline(checks, {
			check: (command, label) => runCheck(env, inWorktree, worktree.path, approved, command, label),
			cancelled: () => token.isCancellationRequested,
			progress: text => sink.progress(text),
		});
		if ('stopped' in outcome) { return await discardUnstarted(root, worktree, sink, 'Stopped before any fix.'); }
		if ('problem' in outcome) { return await discardUnstarted(root, worktree, sink, outcome.problem); }
		const failing = Object.entries(outcome.baseline).filter(([, [first]]) => first.code !== 0).map(([command]) => command);
		if (failing.length) { sink.text(alreadyFailingText(failing)); }
		const state: RunState = {
			version: 1, root, language: local.label, worktree, startedAt: new Date().toISOString(), approved, fixes: picked, next: 0, steps: [],
			baseline: outcome.baseline, skippedFiles: skippedWithLines(skipped, stats),
		};
		saveState(env.storage, state);
		sink.progress('');
		return state;
	} catch (error) {
		return discardUnstarted(root, worktree, sink, `The run could not start: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Before any fix (Stop, a baseline that could not run, or an error): nothing was committed, so the worktree and branch go. */
async function discardUnstarted(root: string, worktree: Worktree, sink: Sink, reason: string): Promise<undefined> {
	sink.progress('');
	try {
		await discard(root, worktree);
		sink.text(`${reason} The branch \`${worktree.branch}\` and its working copy were removed.`);
	} catch {
		sink.text(`${reason} Remove the working copy \`${worktree.path}\` and the branch \`${worktree.branch}\` by hand.`);
	}
	return undefined;
}
