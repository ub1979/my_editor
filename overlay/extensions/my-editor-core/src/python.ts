import * as vscode from 'vscode';

const BASEDPYRIGHT = 'detachhead.basedpyright';
const DONT_ASK = 'myEditor.python.dontAskBasedpyright';

/**
 * Pylance is not licensed for forks, so Python projects get type checking from basedpyright (Open VSX).
 * Offered once when a workspace contains Python files; the user decides.
 */
export async function offerPythonSupport(context: vscode.ExtensionContext): Promise<void> {
	if (context.globalState.get<boolean>(DONT_ASK) || vscode.extensions.getExtension(BASEDPYRIGHT)
		|| vscode.extensions.getExtension('ms-python.vscode-pylance')) {
		return;
	}
	const [python] = await vscode.workspace.findFiles('**/*.py', '{**/node_modules/**,**/.venv/**,**/venv/**}', 1);
	if (!python) {
		return;
	}
	const choice = await vscode.window.showInformationMessage(
		'This project has Python files. Install basedpyright for type checking and go-to-definition?',
		'Install', 'Not now', "Don't ask again");
	if (choice === 'Install') {
		await vscode.commands.executeCommand('workbench.extensions.installExtension', BASEDPYRIGHT);
	} else if (choice === "Don't ask again") {
		await context.globalState.update(DONT_ASK, true);
	}
}
