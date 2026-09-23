import * as vscode from 'vscode';
import { isSensitiveFile } from '../records/sensitive';

const MAX_FILE_CHARS = 60_000;
const EDITABLE_SCHEMES = new Set(['file', 'untitled']);

/** What the pair sees about the file the user is working on. */
export interface FileContext {
	readonly uri: vscode.Uri;
	readonly relativePath: string;
	readonly languageId: string;
	readonly text: string;
	readonly selection: vscode.Selection | undefined;
	readonly selectedText: string;
	readonly diagnostics: string;
	/** True when the file is longer than the model is shown; whole-file edits must not be applied. */
	readonly truncated: boolean;
}

/** The editor the request is about: the active one, else the first visible, else the first attached file. */
export async function currentFile(attached: readonly vscode.Uri[] = []): Promise<FileContext | undefined> {
	// Only real files: never a diff, output or git view that happens to be visible.
	const editable = (e: vscode.TextEditor | undefined) => e && EDITABLE_SCHEMES.has(e.document.uri.scheme) ? e : undefined;
	const editor = editable(vscode.window.activeTextEditor) ?? vscode.window.visibleTextEditors.find(e => editable(e));
	let document = editor?.document;
	if (!document && attached[0]) {
		document = await vscode.workspace.openTextDocument(attached[0]);
	}
	if (!document) {
		return undefined;
	}
	const relativePath = vscode.workspace.asRelativePath(document.uri);
	if (isSensitiveFile(relativePath, document.languageId)) {
		throw new Error(`${relativePath} looks like a secrets file; my_editor never sends it to a model.`);
	}
	const selection = editor && editor.document === document && !editor.selection.isEmpty ? editor.selection : undefined;
	const diagnostics = vscode.languages.getDiagnostics(document.uri)
		.filter(d => d.severity <= vscode.DiagnosticSeverity.Warning)
		.slice(0, 20)
		.map(d => `line ${d.range.start.line + 1}: ${d.message}`)
		.join('\n');
	const fullText = document.getText();
	return {
		uri: document.uri,
		relativePath,
		languageId: document.languageId,
		text: fullText.slice(0, MAX_FILE_CHARS),
		truncated: fullText.length > MAX_FILE_CHARS,
		selection,
		selectedText: selection ? document.getText(selection) : '',
		diagnostics,
	};
}

/** Reads a small project file from `.my_editor/`, if present. */
export async function readProjectNote(name: string, maxChars = 8_000): Promise<string> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) {
		return '';
	}
	try {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.my_editor', name));
		return new TextDecoder().decode(bytes).slice(0, maxChars);
	} catch {
		return '';
	}
}

/** The file as the model sees it, with line numbers so it can refer to places precisely. */
export function describeFile(file: FileContext): string {
	const numbered = file.text.split('\n').map((line, i) => `${String(i + 1).padStart(4)}| ${line}`).join('\n');
	const parts = [`File: ${file.relativePath} (${file.languageId})${file.truncated ? ' — only the beginning is shown; the file continues' : ''}`, numbered];
	if (file.selection) {
		parts.push(`Selected lines ${file.selection.start.line + 1}-${file.selection.end.line + 1}:\n${file.selectedText}`);
	}
	if (file.diagnostics) {
		parts.push(`Current problems:\n${file.diagnostics}`);
	}
	return parts.join('\n\n');
}
