import * as vscode from 'vscode';
import { writeFileSync } from 'fs';

/**
 * Hooks for the automated UI driver only; inert unless these environment variables are set:
 * MY_EDITOR_TEST_REPORT (file to write model/command state to), MY_EDITOR_TEST_QUERY (a chat query to
 * send after MY_EDITOR_TEST_DELAY ms), MY_EDITOR_TEST_COMMAND (a command id to run first).
 */
export async function runTestHooks(): Promise<void> {
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
	if (query) {
		await vscode.commands.executeCommand('workbench.action.chat.open', { query });
	}
	if (report) {
		const models = await vscode.lm.selectChatModels({ vendor: 'my-editor' });
		writeFileSync(report, `models: ${models.map(m => m.id).join(', ')}\n`);
	}
}
