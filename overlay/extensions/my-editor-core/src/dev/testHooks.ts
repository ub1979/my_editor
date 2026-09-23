import * as vscode from 'vscode';
import { writeFileSync } from 'fs';

/**
 * Hooks for the automated UI driver only; inert unless these environment variables are set:
 * MY_EDITOR_TEST_REPORT (file to write model/command state to), MY_EDITOR_TEST_QUERY (a chat query to
 * send after MY_EDITOR_TEST_DELAY ms).
 */
export async function runTestHooks(): Promise<void> {
	const report = process.env.MY_EDITOR_TEST_REPORT;
	const query = process.env.MY_EDITOR_TEST_QUERY;
	if (!report && !query) {
		return;
	}
	await new Promise(resolve => setTimeout(resolve, Number(process.env.MY_EDITOR_TEST_DELAY ?? 0)));
	if (query) {
		await vscode.commands.executeCommand('workbench.action.chat.open', { query });
	}
	if (report) {
		const models = await vscode.lm.selectChatModels({ vendor: 'my-editor' });
		writeFileSync(report, `models: ${models.map(m => m.id).join(', ')}\n`);
	}
}
