import * as vscode from 'vscode';

const CHAT_FOLDERS = 'myEditor.chatFolders';

function currentFolder(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Saves the conversation and remembers which folders have one, so a new folder can say whether an earlier chat exists. */
export async function saveConversation(context: vscode.ExtensionContext, key: string, snapshot: { readonly messages: readonly unknown[] }): Promise<void> {
	await context.workspaceState.update(key, snapshot);
	const folder = currentFolder();
	if (!folder || !snapshot.messages.length) { return; }
	const known = context.globalState.get<string[]>(CHAT_FOLDERS, []);
	if (!known.includes(folder)) { await context.globalState.update(CHAT_FOLDERS, [...known, folder]); }
}

/** Whether a conversation was saved for some other folder. */
export function hasOtherChats(context: vscode.ExtensionContext): boolean {
	const folder = currentFolder();
	return context.globalState.get<string[]>(CHAT_FOLDERS, []).some(known => known !== folder);
}
