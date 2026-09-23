import * as vscode from 'vscode';
import { writeFileSync } from 'fs';
import { loadCatalog } from '../models/catalog';
import { ApiKeys } from '../models/secrets';

/**
 * Hooks for the automated UI driver only; inert unless these environment variables are set:
 * MY_EDITOR_TEST_REPORT (file to write model/command state to), MY_EDITOR_TEST_QUERY (a chat query to
 * send after MY_EDITOR_TEST_DELAY ms), MY_EDITOR_TEST_COMMAND (a command id to run first).
 */
export async function runTestHooks(keys: ApiKeys): Promise<void> {
	const report = process.env.MY_EDITOR_TEST_REPORT;
	const query = process.env.MY_EDITOR_TEST_QUERY;
	const command = process.env.MY_EDITOR_TEST_COMMAND;
	if (!report && !query && !command) {
		return;
	}
	await new Promise(resolve => setTimeout(resolve, Number(process.env.MY_EDITOR_TEST_DELAY ?? 0)));
	if (command) {
		// MY_EDITOR_TEST_COMMAND_ARG: an optional workspace-relative path passed as the command's URI argument.
		const arg = process.env.MY_EDITOR_TEST_COMMAND_ARG;
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		await vscode.commands.executeCommand(command, ...(arg && root ? [vscode.Uri.joinPath(root, arg)] : []));
	}
	// MY_EDITOR_TEST_CURSOR: "line:column" (1-based) to place the cursor in the active editor first.
	const cursor = process.env.MY_EDITOR_TEST_CURSOR?.split(':').map(Number);
	const editor = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0];
	if (cursor && editor) {
		const position = new vscode.Position(cursor[0] - 1, cursor[1] - 1);
		editor.selection = new vscode.Selection(position, position);
	}
	if (query) {
		await vscode.commands.executeCommand('myEditor.chat.ask', query);
	}
	if (report) {
		const models = (await loadCatalog(keys)).map(e => ({ id: e.key }));
		const recent = await vscode.commands.executeCommand<{ workspaces: { folderUri?: vscode.Uri }[] }>('_workbench.getRecentlyOpened');
		writeFileSync(report, `models: ${models.map(m => m.id).join(', ')}\nrecent: ${(recent?.workspaces ?? []).map(w => w.folderUri?.path).join(', ')}\n`);
	}
}
