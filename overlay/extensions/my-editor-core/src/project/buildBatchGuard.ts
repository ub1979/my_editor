import * as vscode from 'vscode';
import { checkedProjectPath } from '../chat/projectPath';
import { digest } from './buildProgress';
import { elidesCode } from '../pair/codeBlock';

/** Reject empty/no-op generation and work based on a file the developer has since changed. */
export async function buildBatchProblem(path: string, content: unknown, expected: string | undefined): Promise<string | undefined> {
	if (typeof content !== 'string' || !content.trim() || elidesCode(content)) {
		return 'Prepare complete file content, without empty or omitted-code placeholders.';
	}
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) { return 'The project is no longer open.'; }
	try {
		const uri = vscode.Uri.file(checkedProjectPath(root.fsPath, path, true));
		const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
		let current: string | undefined;
		try { current = document?.getText() ?? new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); }
		catch (error) { if (!['ENOENT', 'FileNotFound'].includes((error as { code?: string }).code ?? '')) { throw error; } }
		if (document?.isDirty || (current === undefined ? undefined : digest(current)) !== expected) {
			return 'This file changed during the batch. Preserve the developer’s work and pause for review.';
		}
		if (content.trim() === current?.trim()) { return 'The proposed file is unchanged. Implement its planned behavior before proposing it.'; }
		if (/\.json$/i.test(path)) { JSON.parse(content); }
	} catch (error) { return `Cannot prepare this build file: ${error instanceof Error ? error.message : String(error)}`; }
	return undefined;
}
