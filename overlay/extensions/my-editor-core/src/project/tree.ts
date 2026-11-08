import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { checkedProjectPath } from '../chat/projectPath';
import { safeRelativePath } from '../chat/agentProtocol';
import { serial } from '../util/serial';
import { parseTree, stubContent, TreeFile, validateTreePlan } from './stubs';
import { assertPlanningReady } from './planningFiles';

const TREE = '.my_editor/specs/tree.json';

async function load(): Promise<{ root: vscode.Uri; files: TreeFile[]; text: string } | undefined> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) {
		return undefined;
	}
	try {
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, TREE)));
		return { root, files: parseTree(text), text };
	} catch {
		void vscode.window.showInformationMessage('No file tree yet. Plan it with the pair first: /tree in chat.');
		return undefined;
	}
}

async function save(root: vscode.Uri, files: TreeFile[]): Promise<void> {
	const uri = vscode.Uri.joinPath(root, TREE);
	const raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
	const entries = validateTreePlan(JSON.stringify(raw));
	for (const file of files) {
		const current = entries.find(entry => entry.path === file.path);
		if (current) { current.status = file.status; }
	}
	const updated = Array.isArray(raw) ? entries : { ...raw, files: entries };
	const content = new TextEncoder().encode(JSON.stringify(updated, null, '\t') + '\n');
	if (uri.scheme !== 'file') { await vscode.workspace.fs.writeFile(uri, content); return; }
	// A running build can read the plan while save tracking updates a file's status.
	// Replace the local file atomically so readers never see an empty or partial plan.
	const temporary = `${uri.fsPath}.${randomUUID()}.tmp`;
	try {
		const stat = await fs.stat(uri.fsPath);
		await fs.writeFile(temporary, content, { flag: 'wx', mode: stat.mode });
		await fs.rename(temporary, uri.fsPath);
	} finally { await fs.rm(temporary, { force: true }); }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

/** A kept tree is the user's approval to create every missing planned file. */
export function scaffoldKeptTree(root: vscode.Uri): Promise<{ created: number; skipped: string[] }> {
	return serial(() => createFiles(root));
}

/** Exclusive writes also preserve files created while the picker or another Keep was open. */
async function createFiles(root: vscode.Uri, selected?: ReadonlySet<string>, expected?: string): Promise<{ created: number; skipped: string[] }> {
	await assertPlanningReady(root, 'tree');
	const treeUri = vscode.Uri.joinPath(root, TREE);
	const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(treeUri));
	if (expected !== undefined && text !== expected) { throw new Error('The file tree changed while the picker was open. Open it again to review the current plan.'); }
	const files = validateTreePlan(text).filter(file => !selected || selected.has(file.path));
	const skipped: string[] = [];
	const created: TreeFile[] = [];
	const seen = new Set<string>();
	for (const file of files) {
		try {
			if (!safeRelativePath(file.path)) { throw new Error('Use a project-relative path outside Git metadata and dependencies.'); }
			const target = checkedProjectPath(root.fsPath, file.path, true);
			if (seen.has(target)) { continue; }
			seen.add(target);
			const uri = vscode.Uri.file(target);
			if (await exists(uri)) { continue; }
			if (vscode.workspace.textDocuments?.some(document => document.uri.fsPath === target && document.isDirty)) {
				throw new Error('This file has unsaved edits. Save it before creating planned files.');
			}
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
			checkedProjectPath(root.fsPath, file.path, true);
			await fs.writeFile(target, stubContent(file), { flag: 'wx' });
			file.status = 'stub';
			created.push(file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EEXIST') { continue; }
			skipped.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (created.length) { await save(root, created); }
	return { created: created.length, skipped };
}

/** Lets the user tick planned files, then creates each as a stub. Existing files are never touched. */
export async function scaffoldFromTree(): Promise<void> {
	const tree = await load();
	if (!tree) {
		return;
	}
	try { await assertPlanningReady(tree.root, 'tree'); }
	catch (error) {
		void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
		return;
	}
	const missing: TreeFile[] = [];
	for (const file of tree.files) {
		if (!await exists(vscode.Uri.joinPath(tree.root, file.path))) {
			missing.push(file);
		}
	}
	if (!missing.length) {
		void vscode.window.showInformationMessage('Every planned file already exists.');
		return;
	}
	const picked = await vscode.window.showQuickPick(
		missing.map(file => ({ label: file.path, description: file.requirements?.join(', '), detail: file.role, picked: true, file })),
		{ canPickMany: true, title: 'Create these files as stubs?', placeHolder: 'Untick anything you want to create yourself later' });
	if (!picked?.length) {
		return;
	}
	try {
		const result = await serial(() => createFiles(tree.root, new Set(picked.map(item => item.file.path)), tree.text));
		void vscode.window.showInformationMessage(`Created ${result.created} stub${result.created === 1 ? '' : 's'}. `
			+ (result.skipped.length ? `Could not create: ${result.skipped.join('; ')}` : 'Open Build in the Project view to start file by file.'));
	} catch (error) {
		void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
	}
}

/** Opens the next file with its own focused conversation. */
export async function openNextFile(): Promise<void> {
	await vscode.commands.executeCommand('myEditor.buildGuide.next');
}

/** Marks the active file done (or back in progress) in the tree. */
export async function toggleFileDone(): Promise<void> {
	const tree = await load();
	const uri = vscode.window.activeTextEditor?.document.uri;
	if (!tree || !uri) {
		return;
	}
	const path = vscode.workspace.asRelativePath(uri, false);
	const file = tree.files.find(f => f.path === path);
	if (!file) {
		void vscode.window.showInformationMessage(`${path} is not in the planned tree.`);
		return;
	}
	file.status = file.status === 'done' ? 'in-progress' : 'done';
	await serial(() => save(tree.root, [file]));
	void vscode.window.showInformationMessage(`${path}: ${file.status === 'done' ? 'done' : 'back in progress'}.`);
}

/** A planned file that gets real content moves from stub to in progress on save. */
export function trackProgress(document: vscode.TextDocument): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root || document.uri.path.includes('/.my_editor/')) {
		return Promise.resolve();
	}
	const path = vscode.workspace.asRelativePath(document.uri, false);
	const text = document.getText();
	return serial(async () => {
		let files: TreeFile[];
		try {
			files = parseTree(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, TREE))));
		} catch {
			return;
		}
		const file = files.find(f => f.path === path);
		if (file && (file.status === 'stub' || file.status === 'planned' || !file.status) && text.trim() !== stubContent(file).trim()) {
			file.status = 'in-progress';
			await save(root, [file]);
		}
	});
}
