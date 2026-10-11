import { existsSync, mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ask } from '../brain/analyse';
import type { Sink } from '../chat/engine';
import { loadCatalog, pickDefault } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { noteFileName, renderChangeNote, reportPath, runFlaky, writeRunReport } from './changeNote';
import { CommandEnv, prepareWorktree, runCheck, startRun } from './fixSetup';
import { runQueue } from './fixQueue';
import { clearState, discardRest, loadState, RUNAWAY_LIMIT, RunState, saveState, StepRecord } from './fixState';
import { setFixRunning } from './fixStatus';
import { closeEmpty } from './fixEmpty';
import { rememberSettled } from './fixSettled';
import { refactorRunLine } from './refactorText';
import { runRefactor } from './refactorStep';
import { rememberRefused } from './refusedRecord';
import { rememberChecks } from './fixUnverifiable';
import { closingText, pausedText } from './fixText';
import type { LanguageAdapter } from './language';
import { adapterFor, languageNote } from './languages';
import { choosePython } from './pyPick';
import { runAddTests, runSplit, StepContext } from './steps';
import { aheadOf, commit, reattach, remove, trackedFiles } from './worktree';

const ASK_TIMEOUT_MS = 300_000;

export interface FixOptions {
	/** Resume the saved run without asking (the Continue button). */
	readonly continue?: boolean;
}

/** "Fix on a local branch": pick fixes, prepare the safety net, run every chosen fix, and close when all are done. */
export async function fixOnBranch(context: vscode.ExtensionContext, keys: ApiKeys, sink: Sink, token: vscode.CancellationToken,
	options: FixOptions = {}): Promise<void> {
	setFixRunning(true);
	try { await fixRun(context, keys, sink, token, options); } finally { setFixRunning(false); }
}

async function fixRun(context: vscode.ExtensionContext, keys: ApiKeys, sink: Sink, token: vscode.CancellationToken,
	options: FixOptions): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) { sink.text('Open a project folder first.'); return; }
	const storage = context.globalStorageUri.fsPath;
	const env: CommandEnv = { storage, root, token };
	let state = loadState(storage, root);
	if (!state && options.continue) { sink.text('That fix run has already finished.'); return; }
	const model = pickDefault(await loadCatalog(keys));
	if (!model) { sink.text('No model is available. Choose one with **my_editor: Choose Default Model** first.'); return; }
	const language = await adapterFor(root, {
		extensionPath: context.extensionUri.fsPath, storageDir: storage, version: String(context.extension.packageJSON.version ?? 'dev'), appRoot: vscode.env.appRoot,
		choosePython,
	});
	if (typeof language === 'string') { sink.text(language); return; }
	if (state && !options.continue) {
		const answer = await vscode.window.showInformationMessage(`A fix run on ${state.worktree.branch} is not finished.`, {
			modal: true, detail: `${state.next} of ${state.fixes.length} fixes done. Continue it, or discard the rest (the branch and its commits stay)?`,
		}, 'Continue', 'Discard the rest');
		if (answer === 'Discard the rest') { discardRest(state); }
		else if (answer !== 'Continue') { return; }
	}
	let adapter: LanguageAdapter;
	if (!state) {
		const note = languageNote(root);
		if (note) { sink.text(`${note}\n`); }
		const started = await startRun(env, language, sink);
		if (!started) { return; }
		({ state, adapter } = started);
	} else {
		try { state.worktree = await reattach(root, state.worktree); }
		catch (error) { return forgetRun(storage, state, sink, error); }
		adapter = language(state.worktree.path, await trackedFiles(state.worktree.path));
		const ready = await prepareWorktree(env, adapter, state.worktree.path, state.approved, sink, state.setupStamp);
		if (ready) { sink.progress(''); sink.text(ready === 'stopped' ? 'Stopped before any fix.' : ready); return; }
		state.setupStamp = adapter.setupStamp?.();
		const left = state.fixes.length - state.next;
		if (left > 0) { sink.text(`Continuing on \`${state.worktree.branch}\` with ${left} fix${left === 1 ? '' : 'es'} left.\n`); }
	}
	await runFixes(env, state, adapter, sink, (system, text) => ask(model, keys, system, text, token, ASK_TIMEOUT_MS));
}

/** The branch's working copy cannot be reopened: offer to forget the run (the branch and its commits stay) instead of asking again next time. */
async function forgetRun(storage: string, state: RunState, sink: Sink, error: unknown): Promise<void> {
	const message = error instanceof Error ? error.message : String(error);
	const answer = await vscode.window.showWarningMessage(`The working copy for ${state.worktree.branch} could not be reopened.`, {
		modal: true, detail: `${message}\n\nForget this run? The branch and its commits stay; only my_editor's record of the run is removed.`,
	}, 'Forget this run');
	if (answer !== 'Forget this run') { sink.text(`The run on \`${state.worktree.branch}\` could not continue: ${message}`); return; }
	clearState(storage, state.root);
	sink.text(`Forgot the run. The branch \`${state.worktree.branch}\` and its commits are still there.`);
}

function stepLine(step: StepRecord): string {
	if (step.kind === 'refactor') { return refactorRunLine(step); }
	const what = step.kind === 'split' ? `Split \`${step.file}\`` : `Tests for \`${step.file}\``;
	if (step.status === 'committed') {
		const detail = step.kind === 'split' ? ` into ${(step.moved ?? []).map(m => `\`${m.file}\``).join(', ')}` : ` in \`${step.testFile}\``;
		return `- ${what}${detail}: committed \`${step.commit?.slice(0, 7)}\`.`;
	}
	return `- ${what}: ${step.status}. ${step.reason ?? ''}`.trimEnd();
}

async function runFixes(env: CommandEnv, state: RunState, adapter: LanguageAdapter, sink: Sink,
	askModel: (system: string, text: string) => Promise<string>): Promise<void> {
	const { storage, token } = env;
	const worktree = state.worktree.path;
	const ctx: StepContext = {
		adapter, worktree, ask: askModel, baseline: state.baseline, flaky: runFlaky(state),
		check: (command, label, extra) => runCheck(env, adapter, worktree, state.approved, command, label, extra),
		cancelled: () => token.isCancellationRequested,
		progress: text => sink.progress(text),
		coverage: state.coverage,
	};
	const steps = { split: runSplit, tests: runAddTests, refactor: runRefactor };
	const attempted = await runQueue(state, {
		run: (fix, progress) => steps[fix.kind]({ ...ctx, progress }, fix),
		cancelled: () => token.isCancellationRequested,
		progress: text => sink.progress(text),
		record: step => { saveState(storage, state); sink.text(`${stepLine(step)}\n`); },
	});
	sink.progress('');
	if (state.next < state.fixes.length) {
		saveState(storage, state);
		const left = state.fixes.length - state.next;
		const bound = !token.isCancellationRequested && attempted >= RUNAWAY_LIMIT ? RUNAWAY_LIMIT : undefined;
		sink.text(pausedText({ left, branch: state.worktree.branch, next: state.fixes[state.next].file, bound }));
		sink.action('Continue', 'myEditor.aiReadyFix', [{ continue: true }]);
		return;
	}
	await closeRun(env, state, sink, adapter.mayDiffer);
}

/** Commits the change note on the branch, removes the worktree (the branch stays), and updates the report. */
async function closeRun(env: CommandEnv, state: RunState, sink: Sink, mayDiffer: string | undefined): Promise<void> {
	await rememberSettled(env.storage, state.root, state.worktree.path, state.steps);
	// Before an empty close removes the worktree the blob ids are read in: a refused refactor must not be ticked again.
	await rememberRefused(env.storage, state.root, state.worktree.path, state.steps);
	if (!state.steps.some(step => step.status === 'committed')) { return closeEmpty(env.storage, state, sink); }
	const at = new Date();
	const note = noteFileName(at);
	const worktree = state.worktree.path;
	mkdirSync(path.dirname(path.join(worktree, note)), { recursive: true });
	writeFileSync(path.join(worktree, note), renderChangeNote(state, at, mayDiffer, existsSync(reportPath(state.root))));
	await commit(worktree, [note], 'my_editor: change note for the AI-ready fixes',
		'What this run changed, how each change was checked, and what was left.');
	await rememberChecks(env.storage, state.root, state.baseline);
	let removed = true;
	try { await remove(state.root, worktree); } catch { removed = false; }
	const reportUpdated = writeRunReport(state.root, state, note);
	clearState(env.storage, state.root);
	const committed = state.steps.filter(step => step.status === 'committed').length;
	const discarded = state.steps.filter(step => step.status === 'discarded').length;
	const stillOver = state.steps.flatMap(step => step.over ?? []).length;
	let ahead: number | undefined;
	try { ahead = await aheadOf(state.root, state.worktree.branch); } catch { ahead = undefined; }
	const { branch, base, userRef } = state.worktree;
	sink.text(closingText({ committed, discarded, branch, base, note, removed, worktree, reportUpdated, stillOver, ahead, userRef }));
	// No "Refresh the brain" action: the user's folder did not change; the note says to run Analyse after switching to the branch.
}
