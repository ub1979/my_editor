import * as vscode from 'vscode';
import { runGit } from './gitRun';
import { branchNameProblem, confirmText, pushArgs, pushFailure, type PushPlan, withoutLogin } from './pushPlan';

/** What a caller may suggest; the user still picks and confirms everything. */
export interface PushRequest {
	/** The branch name on the remote, from the chat message that asked for the push. */
	readonly target?: string;
}

const PUSH_TIMEOUT_MS = 120_000;

/** The remote to push to: the only one, or the user's pick with origin first; undefined when there is none or the pick is cancelled. */
async function pickRemote(cwd: string): Promise<{ name: string; url: string } | undefined> {
	const names = (await runGit(cwd, ['remote'])).split('\n').map(name => name.trim()).filter(Boolean)
		.sort((a, b) => Number(b === 'origin') - Number(a === 'origin'));
	if (!names.length) {
		void vscode.window.showWarningMessage('This project has no remote to push to. Add one in Source Control first.');
		return undefined;
	}
	const remotes = await Promise.all(names.map(async name => ({ name, url: withoutLogin(await runGit(cwd, ['remote', 'get-url', name])) })));
	if (remotes.length === 1) { return remotes[0]; }
	const picked = await vscode.window.showQuickPick(remotes.map(remote => ({ label: remote.name, description: remote.url, remote })),
		{ title: 'Push to which remote?' });
	return picked?.remote;
}

/** A branch pushed under its own name that followed no remote branch now follows it, so update notices work. */
async function followNewBranch(cwd: string, plan: PushPlan): Promise<void> {
	if (!plan.branch || plan.target !== plan.branch) { return; }
	try { await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']); return; } catch { /* None yet. */ }
	await runGit(cwd, ['branch', `--set-upstream-to=${plan.remote}/${plan.target}`, plan.branch]).catch(() => undefined);
}

/**
 * Push the current commit to a remote, only after the user has named the branch there and confirmed exactly what goes
 * where. Uses the user's own git login; never forces. Returns whether it pushed.
 */
export async function pushBranch(request: PushRequest = {}): Promise<boolean> {
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!cwd) { void vscode.window.showWarningMessage('Open a project folder first.'); return false; }
	let branch: string | undefined;
	let commit: string;
	try {
		commit = await runGit(cwd, ['rev-parse', 'HEAD']);
		branch = await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => undefined);
	} catch {
		void vscode.window.showWarningMessage('This folder has no commit to push yet.');
		return false;
	}
	const remote = await pickRemote(cwd);
	if (!remote) { return false; }
	const suggested = request.target && !branchNameProblem(request.target) ? request.target : branch;
	const target = await vscode.window.showInputBox({
		title: `Push ${commit.slice(0, 7)} to ${remote.name}`, prompt: 'The branch name on the remote',
		value: suggested ?? '', validateInput: value => branchNameProblem(value.trim()),
	});
	if (!target) { return false; }
	const plan: PushPlan = { remote: remote.name, remoteUrl: remote.url, branch, commit, target: target.trim() };
	const answer = await vscode.window.showWarningMessage(`Push to ${plan.target} on ${plan.remote}?`, { modal: true, detail: confirmText(plan) }, 'Push');
	if (answer !== 'Push') { return false; }
	try {
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Pushing to ${plan.target} on ${plan.remote}` },
			() => runGit(cwd, pushArgs(plan), PUSH_TIMEOUT_MS));
	} catch (error) {
		void vscode.window.showErrorMessage(pushFailure(error instanceof Error ? error.message : String(error)));
		return false;
	}
	await followNewBranch(cwd, plan);
	void vscode.window.showInformationMessage(`Pushed ${plan.commit.slice(0, 7)} to ${plan.target} on ${plan.remote} (${plan.remoteUrl}).`);
	return true;
}
