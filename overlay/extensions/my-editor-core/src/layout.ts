import * as vscode from 'vscode';

const CENTERED_ONCE = 'myEditor.layout.centeredOnce';

/**
 * Opens each workspace in the "page" layout once: the editor centred between quiet margins.
 * Remembered per workspace, so a user who turns it off keeps it off.
 */
export async function applyFirstRunLayout(context: vscode.ExtensionContext): Promise<void> {
	if (context.workspaceState.get<boolean>(CENTERED_ONCE)) {
		return;
	}
	await context.workspaceState.update(CENTERED_ONCE, true);
	await vscode.commands.executeCommand('workbench.action.toggleCenteredLayout');
}
