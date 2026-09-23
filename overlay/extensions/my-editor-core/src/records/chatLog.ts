import * as vscode from 'vscode';
import { serial } from '../util/serial';
import { collapseCode, redact } from './redact';

/**
 * Appends each exchange to `.my_editor/chats/YYYY-MM-DD.md` so decisions can be traced later (FR-041), in
 * projects that already have a `.my_editor/` folder.
 */
export async function logExchange(entry: { mode: string; model: string; file?: string; prompt: string; reply: string }): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root || !vscode.workspace.getConfiguration('myEditor').get<boolean>('records.chatHistory', true)) {
		return;
	}
	// Only in projects already using my_editor: chatting in someone else's repo never creates .my_editor/.
	try {
		await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, '.my_editor'));
	} catch {
		return;
	}
	const now = new Date();
	const day = now.toISOString().slice(0, 10);
	const target = vscode.Uri.joinPath(root, '.my_editor', 'chats', `${day}.md`);
	const block = [
		'',
		`## ${now.toTimeString().slice(0, 5)} · /${entry.mode} · ${entry.model}${entry.file ? ` · ${entry.file}` : ''}`,
		'',
		`**You:** ${redact(entry.prompt)}`,
		'',
		`**Pair:** ${redact(collapseCode(entry.reply))}`,
		'',
	].join('\n');
	await serial(async () => {
		let existing: string;
		try {
			existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
		} catch {
			existing = `# Chats — ${day}\n`;
		}
		await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(existing + block));
	});
}
