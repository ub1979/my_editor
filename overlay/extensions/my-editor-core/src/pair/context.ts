import * as vscode from 'vscode';

const MAX_FILE_CHARS = 60_000;
const BLOCKED_FILES = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa|id_ed25519|\.npmrc|\.netrc)$/i;

/** What the pair sees about the file the user is working on. */
export interface FileContext {
	readonly uri: vscode.Uri;
	readonly relativePath: string;
	readonly languageId: string;
	readonly text: string;
	readonly selection: vscode.Selection | undefined;
	readonly selectedText: string;
	readonly diagnostics: string;
}

/** The editor the request is about: the active one, else the first visible, else the first #file reference. */
export async function currentFile(request: vscode.ChatRequest): Promise<FileContext | undefined> {
	const editor = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0];
	let document = editor?.document;
	if (!document) {
		const ref = request.references.find(r => r.value instanceof vscode.Uri);
		if (ref) {
			document = await vscode.workspace.openTextDocument(ref.value as vscode.Uri);
		}
	}
	if (!document) {
		return undefined;
	}
	const relativePath = vscode.workspace.asRelativePath(document.uri);
	if (BLOCKED_FILES.test(relativePath)) {
		throw new Error(`${relativePath} looks like a secrets file; my_editor never sends it to a model.`);
	}
	const selection = editor && editor.document === document && !editor.selection.isEmpty ? editor.selection : undefined;
	const diagnostics = vscode.languages.getDiagnostics(document.uri)
		.filter(d => d.severity <= vscode.DiagnosticSeverity.Warning)
		.slice(0, 20)
		.map(d => `line ${d.range.start.line + 1}: ${d.message}`)
		.join('\n');
	return {
		uri: document.uri,
		relativePath,
		languageId: document.languageId,
		text: document.getText().slice(0, MAX_FILE_CHARS),
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
	const parts = [`File: ${file.relativePath} (${file.languageId})`, numbered];
	if (file.selection) {
		parts.push(`Selected lines ${file.selection.start.line + 1}-${file.selection.end.line + 1}:\n${file.selectedText}`);
	}
	if (file.diagnostics) {
		parts.push(`Current problems:\n${file.diagnostics}`);
	}
	return parts.join('\n\n');
}
