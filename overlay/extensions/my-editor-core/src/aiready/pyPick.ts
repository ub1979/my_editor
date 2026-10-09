import * as vscode from 'vscode';
import { checkedPython, pythonCandidates, rememberPython } from './pyInterpreter';

const BROWSE = 'Choose a file…';

/** Asks for the project's Python: confirm the only candidate, pick among several, or choose a file. */
export async function choosePython(candidates: readonly string[]): Promise<string | undefined> {
	if (candidates.length === 1) {
		const answer = await vscode.window.showInformationMessage('Use this Python for fixes on a local branch?', { modal: true, detail: candidates[0] },
			'Use it', BROWSE);
		if (answer !== BROWSE) { return answer === 'Use it' ? candidates[0] : undefined; }
	} else if (candidates.length > 1) {
		const pick = await vscode.window.showQuickPick([...candidates, BROWSE], { title: 'Python for fixes on a local branch' });
		if (pick !== BROWSE) { return pick; }
	}
	const files = await vscode.window.showOpenDialog({ title: 'The project\'s Python interpreter', canSelectMany: false, openLabel: 'Use this Python' });
	return files?.[0]?.fsPath;
}

/** **AI-Ready: Choose Python Interpreter**: pick again, check it, and remember it for this folder. */
export async function choosePythonCommand(storageDir: string): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) { void vscode.window.showInformationMessage('Open a project folder first.'); return; }
	const file = await choosePython(pythonCandidates(root));
	if (!file) { return; }
	const probed = checkedPython(root, file);
	if (typeof probed === 'string') { void vscode.window.showWarningMessage(probed); return; }
	rememberPython(storageDir, root, file);
	void vscode.window.showInformationMessage(`Fixes in this folder use ${file} (Python ${probed.version.join('.')}).`);
}
