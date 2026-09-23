import * as vscode from 'vscode';
import { EXCLUDE_GLOB, readText, SOURCE_GLOB } from '../brain/brain';
import { analyzeFit, fitMarkdown } from '../brain/fit';

const MAX_PROJECT_FILES = 5_000;
const MAX_FILE_BYTES = 400_000;

/**
 * Explorer command: checks how the selected files (or folders) fit together. The tool findings are
 * deterministic and saved to `.my_editor/qa/`; then the pair explains them in chat.
 */
export async function checkFit(uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	const picked = uris?.length ? uris : uri ? [uri] : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : [];
	if (!root || !picked.length) {
		void vscode.window.showInformationMessage('Select files or a folder in the explorer, then choose "Check How These Fit".');
		return;
	}
	await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Checking how these fit' }, async () => {
		const selected = new Set<string>();
		for (const target of picked) {
			const stat = await vscode.workspace.fs.stat(target);
			if (stat.type === vscode.FileType.Directory) {
				for (const found of await vscode.workspace.findFiles(new vscode.RelativePattern(target, SOURCE_GLOB), EXCLUDE_GLOB, MAX_PROJECT_FILES)) {
					selected.add(vscode.workspace.asRelativePath(found, false));
				}
			} else {
				selected.add(vscode.workspace.asRelativePath(target, false));
			}
		}
		const project: { path: string; text: string }[] = [];
		for (const found of await vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB, MAX_PROJECT_FILES)) {
			if ((await vscode.workspace.fs.stat(found)).size <= MAX_FILE_BYTES) {
				const text = await readText(found);
				if (text !== undefined) {
					project.push({ path: vscode.workspace.asRelativePath(found, false), text });
				}
			}
		}
		const report = analyzeFit(project.filter(f => selected.has(f.path)), project);
		const problems = [...selected].flatMap(path => vscode.languages.getDiagnostics(vscode.Uri.joinPath(root, path))
			.filter(d => d.severity <= vscode.DiagnosticSeverity.Warning)
			.map(d => ({ file: path, line: d.range.start.line + 1, severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning', message: d.message })));
		const now = new Date();
		const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
		const reportPath = `.my_editor/qa/${stamp}-fit.md`;
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, reportPath),
			new TextEncoder().encode(fitMarkdown(report, problems, now.toLocaleString())));
		await vscode.commands.executeCommand('myEditor.chat.ask', `/qa ${reportPath}`);
	});
}
