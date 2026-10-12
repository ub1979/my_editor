import * as vscode from 'vscode';
import { fixRunning } from '../aiready/fixStatus';

/**
 * Close the open project and go back to Home, where another can be opened. A fix run in progress stops (it keeps
 * where it was, so Continue picks it up later); the user is asked first.
 */
export async function closeProject(): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length) { await vscode.commands.executeCommand('myEditor.home'); return; }
	if (fixRunning()) {
		const answer = await vscode.window.showWarningMessage('A fix run is still working on this project.', {
			modal: true, detail: 'Closing the project stops it. Its finished fixes stay on ai_fix, and Continue picks up the rest later.',
		}, 'Close anyway');
		if (answer !== 'Close anyway') { return; }
	}
	await vscode.commands.executeCommand('workbench.action.closeFolder');
}
