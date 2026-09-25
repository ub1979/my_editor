import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { loadCatalog, pickDefault } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import type { ActiveFile } from './activeFile';

export function editorContextMessage(preferred?: ActiveFile): { type: 'context'; file?: string; selection?: string } {
	const editor = vscode.window.activeTextEditor;
	const file = editor?.document.uri.scheme === 'file' ? editor.document.uri : preferred?.uri;
	const selection = editor?.selection.isEmpty === false ? editor.selection : preferred?.selection;
	return {
		type: 'context',
		file: file?.scheme === 'file' ? vscode.workspace.asRelativePath(file, false) : undefined,
		selection: selection ? `${selection.start.line + 1}–${selection.end.line + 1}` : undefined,
	};
}

export async function modelListMessage(keys: ApiKeys): Promise<unknown> {
	const entries = await loadCatalog(keys);
	return {
		type: 'models',
		current: pickDefault(entries)?.key,
		reasoning: vscode.workspace.getConfiguration('myEditor').get<string>('codexCli.reasoningEffort', 'default'),
		models: entries.map(entry => ({ key: entry.key, label: entry.label, detail: entry.detail })),
	};
}

export function newChatId(): string { return randomBytes(6).toString('hex'); }
