import * as vscode from 'vscode';

const MAX_CHARS = 24_000;

async function readDir(dir: vscode.Uri): Promise<[string, vscode.FileType][]> {
	try {
		return await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return [];
	}
}

/**
 * Everything the project has recorded about a file: decisions that mention it, and the chat sections
 * (from `.my_editor/chats/`) about it, newest first, within a budget.
 */
export async function recordsAbout(path: string): Promise<string> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) {
		return '';
	}
	const name = path.split('/').pop() ?? path;
	const mentions = (text: string) => text.includes(path) || text.includes(name);
	const out: string[] = [];
	let budget = MAX_CHARS;

	const decisionsDir = vscode.Uri.joinPath(root, '.my_editor', 'decisions');
	for (const [file] of (await readDir(decisionsDir)).sort().reverse()) {
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(decisionsDir, file)));
		if (mentions(text) && budget > 0) {
			const chunk = text.slice(0, Math.min(4_000, budget));
			out.push(`Decision ${file}:\n${chunk}`);
			budget -= chunk.length;
		}
	}
	const chatsDir = vscode.Uri.joinPath(root, '.my_editor', 'chats');
	for (const [file] of (await readDir(chatsDir)).sort().reverse()) {
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(chatsDir, file)));
		for (const section of text.split(/\n(?=## )/).reverse()) {
			if (section.startsWith('## ') && section.split('\n')[0].includes(path) && budget > 0) {
				const chunk = section.slice(0, Math.min(3_000, budget));
				out.push(`Chat on ${file.replace(/\.md$/, '')}:\n${chunk}`);
				budget -= chunk.length;
			}
		}
	}
	return out.join('\n\n');
}
