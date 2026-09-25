import * as vscode from 'vscode';
import { EXCLUDE_GLOB, SOURCE_GLOB } from '../brain/brain';

/** Count code files for the one-time invitation to build the project brain. */
export async function analysisOffer(context: vscode.ExtensionContext, answeredKey: string): Promise<number | undefined> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root || context.workspaceState.get(answeredKey)) { return undefined; }
	try {
		await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, '.my_editor', 'brain', 'map.json'));
		return undefined;
	} catch {
		const files = await vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB, 5_000);
		return files.length || undefined;
	}
}
