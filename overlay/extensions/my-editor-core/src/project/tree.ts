import * as vscode from 'vscode';
import * as path from 'path';
import { checkedProjectPath } from '../chat/projectPath';
import { serial } from '../util/serial';
import { nextFile, parseTree, stubContent, TreeFile, validateTreePlan } from './stubs';
import { assertPlanningReady } from './planningFiles';

const TREE = '.my_editor/specs/tree.json';

async function load(): Promise<{ root: vscode.Uri; files: TreeFile[] } | undefined> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) {
		return undefined;
	}
	try {
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, TREE)));
		return { root, files: parseTree(text) };
	} catch {
		void vscode.window.showInformationMessage('No file tree yet. Plan it with the pair first: /tree in chat.');
		return undefined;
	}
}

async function save(root: vscode.Uri, files: TreeFile[]): Promise<void> {
	await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, TREE), new TextEncoder().encode(JSON.stringify(files, null, '\t') + '\n'));
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
export async function scaffoldKeptTree(root: vscode.Uri): Promise<{ created: number; skipped: string[] }> {
	await assertPlanningReady(root, 'tree');
	const treeUri = vscode.Uri.joinPath(root, TREE);
	const files = validateTreePlan(new TextDecoder().decode(await vscode.workspace.fs.readFile(treeUri)));
	const skipped: string[] = [];
	let created = 0;
	const seen = new Set<string>();
	for (const file of files) {
		try {
			const target = checkedProjectPath(root.fsPath, file.path, true);
			if (seen.has(target)) { continue; }
			seen.add(target);
			const uri = vscode.Uri.file(target);
			if (await exists(uri)) { continue; }
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(stubContent(file)));
			file.status = 'stub';
			created++;
		} catch (error) {
			skipped.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (created) { await serial(() => save(root, files)); }
	return { created, skipped };
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
	for (const { file } of picked) {
		const target = checkedProjectPath(tree.root.fsPath, file.path, true);
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
		await vscode.workspace.fs.writeFile(vscode.Uri.file(target), new TextEncoder().encode(stubContent(file)));
		file.status = 'stub';
	}
	await serial(() => save(tree.root, tree.files));
	void vscode.window.showInformationMessage(
		`Created ${picked.length} stub${picked.length === 1 ? '' : 's'}. Open Build in the Project view to start file by file.`);
}

/** Opens the next file to work on and turns the chat to the Next step skill. */
export async function openNextFile(): Promise<void> {
	const tree = await load();
	if (!tree) {
		return;
	}
	const file = nextFile(tree.files);
	if (!file) {
		void vscode.window.showInformationMessage('Every planned file is done.');
		return;
	}
	const uri = vscode.Uri.joinPath(tree.root, file.path);
	if (!await exists(uri)) {
		await scaffoldFromTree();
		if (!await exists(uri)) {
			return;
		}
	}
	await vscode.window.showTextDocument(uri);
	await vscode.commands.executeCommand('myEditor.chat.start', 'next');
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
	await serial(() => save(tree.root, tree.files));
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
			await save(root, files);
		}
	});
}
