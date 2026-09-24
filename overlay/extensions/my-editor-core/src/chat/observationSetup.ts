import * as vscode from 'vscode';

/** Gives the user one discoverable place to register fixed diagnostic checks for a project. */
export async function openObservationProfile(): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root || root.scheme !== 'file') {
		void vscode.window.showInformationMessage('Open a local project folder to configure observations.');
		return;
	}
	const dir = vscode.Uri.joinPath(root, '.my_editor');
	const uri = vscode.Uri.joinPath(dir, 'observations.json');
	try { await vscode.workspace.fs.stat(uri); }
	catch {
		await vscode.workspace.fs.createDirectory(dir);
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('{\n  "version": 1,\n  "checks": []\n}\n'));
	}
	await vscode.window.showTextDocument(uri);
}
