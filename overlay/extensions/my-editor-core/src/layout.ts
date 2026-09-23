import * as vscode from 'vscode';

const CENTERED_ONCE = 'myEditor.layout.centeredOnce';

/**
 * Opens each workspace once in the "page" layout (the editor centred between quiet margins) with the
 * Project view showing.
 * Remembered per workspace, so a user who turns it off keeps it off.
 */
export async function applyFirstRunLayout(context: vscode.ExtensionContext): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length || context.workspaceState.get<boolean>(CENTERED_ONCE)) {
		return;
	}
	await context.workspaceState.update(CENTERED_ONCE, true);
	await vscode.commands.executeCommand('workbench.action.toggleCenteredLayout');
	// Expand "This file" under the file tree once, then open on the project's table of contents with the Pair
	// beside it; the file explorer is one click away.
	await vscode.commands.executeCommand('myEditor.thisFile.focus');
	await vscode.commands.executeCommand('workbench.view.extension.myEditor');
	await vscode.commands.executeCommand('workbench.view.extension.myEditorPair');
}
