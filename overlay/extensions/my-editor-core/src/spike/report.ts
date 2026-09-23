import * as vscode from 'vscode';
import { writeFileSync } from 'fs';

/** M0 spike diagnostics: when MY_EDITOR_SPIKE_REPORT is set, dump chat state to that file. */
export async function writeSpikeReport(): Promise<void> {
	const target = process.env.MY_EDITOR_SPIKE_REPORT;
	if (!target) {
		return;
	}
	const lines: string[] = [];
	const commands = await vscode.commands.getCommands(true);
	lines.push('chat commands: ' + commands.filter(c => /chat/i.test(c)).slice(0, 80).join(', '));
	const models = await vscode.lm.selectChatModels({});
	lines.push('models: ' + models.map(m => `${m.vendor}/${m.id}`).join(', '));
	lines.push('disableAIFeatures: ' + vscode.workspace.getConfiguration('chat').get('disableAIFeatures'));
	try {
		await vscode.commands.executeCommand('workbench.action.chat.open', { query: '@pair hello from the spike' });
		lines.push('chat.open: ok');
	} catch (err) {
		lines.push('chat.open: ' + String(err));
	}
	writeFileSync(target, lines.join('\n'));
}
