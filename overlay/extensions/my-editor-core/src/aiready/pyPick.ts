import * as vscode from 'vscode';
import { checkedPython, pythonCandidates, rememberPython } from './pyInterpreter';
import { BROWSE_DIALOG, pythonChoice, pythonChosenMessage, pythonQuestion } from './pyPickPlan';

/** Asks for the project's Python: confirm the only candidate, pick among several, or choose a file. */
export async function choosePython(candidates: readonly string[]): Promise<string | undefined> {
	const question = pythonQuestion(candidates);
	let answer: string | undefined;
	if (question.kind === 'confirm') {
		answer = await vscode.window.showInformationMessage(question.message, { modal: true, detail: question.detail }, ...question.buttons);
	} else if (question.kind === 'pick') {
		answer = await vscode.window.showQuickPick([...question.items], { title: question.title });
	}
	const choice = pythonChoice(question, answer);
	if (choice.kind === 'done') { return choice.file; }
	const files = await vscode.window.showOpenDialog({ ...BROWSE_DIALOG });
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
	void vscode.window.showInformationMessage(pythonChosenMessage(file, probed.version));
}
