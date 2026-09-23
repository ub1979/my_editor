import * as vscode from 'vscode';
import { EXCLUDE_GLOB, readMap, readText, SOURCE_GLOB } from '../brain/brain';
import { extractFacts, resolveImport } from '../brain/facts';
import { requirementOn, sectionAt } from './impactSubject';
import { parseTree } from './stubs';

export interface Impact {
	readonly subject: string;
	readonly files: { path: string; reason: string }[];
}

async function treeFiles(root: vscode.Uri) {
	try {
		return parseTree(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.my_editor/specs/tree.json'))));
	} catch {
		return [];
	}
}

/**
 * Works out which files a change affects, from where the cursor is — deterministically, no model:
 * an architecture section, a requirement ID, or a code symbol (its references and the file's importers).
 */
export async function computeImpact(): Promise<Impact | undefined> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	const editor = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0];
	if (!root || !editor) {
		return undefined;
	}
	const document = editor.document;
	const path = vscode.workspace.asRelativePath(document.uri, false);
	const position = editor.selection.active;
	const found = new Map<string, string>();
	const add = (file: string, reason: string) => {
		if (file !== path && !found.has(file)) {
			found.set(file, reason);
		}
	};

	if (path.endsWith('specs/architecture.md')) {
		const section = sectionAt(document.getText().split('\n'), position.line);
		if (!section) {
			return { subject: 'this architecture document (put the cursor inside an anchored section)', files: [] };
		}
		for (const file of await treeFiles(root)) {
			if (file.section === section) {
				add(file.path, `planned under #${section}`);
			}
		}
		return { subject: `architecture section #${section}`, files: [...found].map(([p, reason]) => ({ path: p, reason })) };
	}
	if (path.endsWith('specs/requirements.md')) {
		const id = requirementOn(document.lineAt(position.line).text);
		if (!id) {
			return { subject: 'this requirements document (put the cursor on a line with an FR-/NFR- ID)', files: [] };
		}
		for (const file of await treeFiles(root)) {
			if (file.requirements?.includes(id)) {
				add(file.path, `serves ${id}`);
			}
		}
		return { subject: `requirement ${id}`, files: [...found].map(([p, reason]) => ({ path: p, reason })) };
	}

	const word = document.getWordRangeAtPosition(position);
	const symbol = word ? document.getText(word) : undefined;
	if (symbol) {
		let references = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', document.uri, position) ?? [];
		if (!references.length) {
			// The language server may still be starting; give it one more chance.
			await new Promise(resolve => setTimeout(resolve, 2000));
			references = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', document.uri, position) ?? [];
		}
		for (const reference of references) {
			const refPath = vscode.workspace.asRelativePath(reference.uri, false);
			add(refPath, `uses \`${symbol}\` (line ${reference.range.start.line + 1})`);
		}
	}
	const map = await readMap();
	const importers = map ? map.files[path]?.importedBy ?? [] : await scanImporters(path);
	for (const importer of importers) {
		add(importer, `imports ${path}`);
	}
	return { subject: symbol ? `\`${symbol}\` in ${path}` : path, files: [...found].map(([p, reason]) => ({ path: p, reason })) };
}

/** Opens an affected file and asks the pair for a reviewed change to adapt it. */
export async function adaptFile(path: string, change: string): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) {
		return;
	}
	await vscode.window.showTextDocument(vscode.Uri.joinPath(root, path));
	await vscode.commands.executeCommand('workbench.action.chat.open', { query: `/feature Adapt this file to this change: ${change}` });
}

/** Without a project brain: finds the files that import `path` by scanning the workspace once. */
async function scanImporters(path: string): Promise<string[]> {
	const uris = await vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB, 5_000);
	const known = new Set(uris.map(u => vscode.workspace.asRelativePath(u, false)));
	const importers: string[] = [];
	for (const uri of uris) {
		const from = vscode.workspace.asRelativePath(uri, false);
		const text = await readText(uri);
		if (text && extractFacts(from, text).imports.some(spec => resolveImport(from, spec, known) === path)) {
			importers.push(from);
		}
	}
	return importers;
}
