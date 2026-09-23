import * as vscode from 'vscode';

const LAYOUT_ONCE = 'myEditor.layout.centeredOnce';

/**
 * Opens the Project and Pair views once per workspace. Leave the editor width under the user's control.
 */
export async function applyFirstRunLayout(context: vscode.ExtensionContext): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length || context.workspaceState.get<boolean>(LAYOUT_ONCE)) {
		return;
	}
	await context.workspaceState.update(LAYOUT_ONCE, true);
	// Expand "This file" under the file tree once, then open on the project's table of contents with the Pair
	// beside it; the file explorer is one click away.
	await vscode.commands.executeCommand('myEditor.thisFile.focus');
	await vscode.commands.executeCommand('workbench.view.extension.myEditor');
	await vscode.commands.executeCommand('workbench.view.extension.myEditorPair');
}
