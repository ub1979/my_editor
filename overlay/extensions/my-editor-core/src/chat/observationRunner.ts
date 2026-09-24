import * as vscode from 'vscode';
import { observationFingerprint, ObservationCheck, observationSummary, parseObservationProfile } from './observationProfile';
import { runObservationProcess } from './observationProcess';

const PROFILE = '.my_editor/observations.json';

/** Binds project-authored diagnostic recipes to an explicit, content-specific user approval. */
export class ObservationRunner {
	constructor(private readonly context: vscode.ExtensionContext) {}

	private workspace(): vscode.WorkspaceFolder | undefined {
		const root = vscode.workspace.workspaceFolders?.[0];
		return root?.uri.scheme === 'file' ? root : undefined;
	}

	private async checks(): Promise<ObservationCheck[]> {
		const root = this.workspace();
		if (!root) { return []; }
		const uri = vscode.Uri.joinPath(root.uri, PROFILE);
		try { return parseObservationProfile(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))); }
		catch (error) {
			if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') { return []; }
			throw error;
		}
	}

	async summary(): Promise<string> {
		try { return observationSummary(await this.checks()); }
		catch (error) { return `Observation profile is invalid: ${error instanceof Error ? error.message : String(error)}`; }
	}

	async run(id: unknown, token: vscode.CancellationToken): Promise<string> {
		const root = this.workspace();
		if (!root) { return 'No local project folder is open.'; }
		let checks: ObservationCheck[];
		try { checks = await this.checks(); }
		catch (error) { return `Observation profile is invalid: ${error instanceof Error ? error.message : String(error)}`; }
		const check = checks.find(candidate => candidate.id === id);
		if (!check) { return `No observation named ${String(id)}. ${observationSummary(checks)}`; }
		const fingerprint = observationFingerprint(root.uri.fsPath, check);
		const approvalKey = `myEditor.observation.approved.${fingerprint}`;
		if (!this.context.workspaceState.get<boolean>(approvalKey)) {
			const detail = `${check.description}\n\nExecutable: ${check.command}\nArguments: ${JSON.stringify(check.args)}\n\nInput:\n${check.stdin || '(none)'}\n\nApproval applies only to this exact recipe in this project. If it changes, Pair will ask again.`;
			if (detail.length > 8_000) {
				await vscode.window.showTextDocument(vscode.Uri.joinPath(root.uri, PROFILE));
				return 'The observation recipe is too long for the approval dialog. It was opened for review; shorten the recipe before requesting it again.';
			}
			const choice = await vscode.window.showInformationMessage(`Pair wants to run: ${check.title}`, {
				modal: true, detail,
			}, 'Run observation', 'Open recipe');
			if (choice === 'Open recipe') {
				await vscode.window.showTextDocument(vscode.Uri.joinPath(root.uri, PROFILE));
				return 'The observation recipe was opened for review. Ask again after inspecting it.';
			}
			if (choice !== 'Run observation') { return 'The user did not approve this observation. Do not request it again in this reply.'; }
			await this.context.workspaceState.update(approvalKey, true);
		}
		if (token.isCancellationRequested) { return 'Observation stopped before it started.'; }
		const controller = new AbortController();
		const cancellation = token.onCancellationRequested(() => controller.abort());
		try {
			const started = new Date().toISOString();
			const result = await runObservationProcess(check, root.uri.fsPath, controller.signal);
			return `Observation ${check.id} at ${started}: ${result.status}.\n${result.output || '(no output)'}`;
		} finally { cancellation.dispose(); }
	}
}
