import * as vscode from 'vscode';

const LAYOUT_ONCE = 'myEditor.layout.centeredOnce';

/** Opens the Project view once per workspace. Pair opens in the editor when needed. */
export async function applyFirstRunLayout(context: vscode.ExtensionContext): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length || context.workspaceState.get<boolean>(LAYOUT_ONCE)) {
		return;
	}
	await context.workspaceState.update(LAYOUT_ONCE, true);
	// Expand "This file" under the tree, then open the project's table of contents.
	await vscode.commands.executeCommand('myEditor.thisFile.focus');
	await vscode.commands.executeCommand('workbench.view.extension.myEditor');
}
