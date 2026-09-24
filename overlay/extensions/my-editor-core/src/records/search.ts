import * as vscode from 'vscode';
import { matchingRecordLines } from './searchText';

const MAX_FILES = 300;
const MAX_BYTES = 5_000_000;
const MAX_MATCHES = 30;

async function filesIn(root: vscode.Uri, parts: string[], nested: boolean): Promise<string[]> {
	const base = vscode.Uri.joinPath(root, '.my_editor', ...parts);
	let entries: [string, vscode.FileType][];
	try { entries = await vscode.workspace.fs.readDirectory(base); } catch { return []; }
	const files: string[] = [];
	for (const [name, type] of entries.sort().reverse()) {
		if (type === vscode.FileType.File && /\.(md|json)$/.test(name)) { files.push(['.my_editor', ...parts, name].join('/')); }
		else if (nested && type === vscode.FileType.Directory && /^\d{4}-\d{2}-\d{2}$/.test(name)) {
			files.push(...await filesIn(root, [...parts, name], false));
		}
		if (files.length >= MAX_FILES) { break; }
	}
	return files;
}

/** Search durable project chat, decision, investigation and change records across restarts. */
export async function searchProjectRecords(query: unknown): Promise<string> {
	if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120) {
		return 'Search needs a literal phrase of 2–120 characters.';
	}
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) { return 'No project folder is open.'; }
	const groups: [string[], boolean][] = [
		[['chats'], false], [['decisions'], false], [['investigations'], true], [['changes'], true],
	];
	const files = (await Promise.all(groups.map(([parts, nested]) => filesIn(root, parts, nested)))).flat().slice(0, MAX_FILES);
	let readBytes = 0;
	let inspected = 0;
	const matches: string[] = [];
	for (const path of files) {
		if (matches.length >= MAX_MATCHES || readBytes >= MAX_BYTES) { break; }
		try {
			const uri = vscode.Uri.joinPath(root, path);
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.size > 1_000_000 || readBytes + stat.size > MAX_BYTES) { continue; }
			const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
			inspected++;
			readBytes += stat.size;
			matches.push(...matchingRecordLines(path, text, query, MAX_MATCHES - matches.length));
		} catch { /* A moved or unreadable record is skipped. */ }
	}
	return `Searched ${inspected} saved project record files.\n${matches.length ? matches.join('\n') : 'No matching records.'}`
		+ (files.length >= MAX_FILES || readBytes >= MAX_BYTES ? '\nSearch limit reached; use a more specific phrase.' : '');
}
