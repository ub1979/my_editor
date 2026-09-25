import * as vscode from 'vscode';

const SOURCES = new Set(['navigator', 'my_editor comments', 'my_editor structure']);

export function guidancePrompt(path: string, line: number, finding: string, fix: boolean): string {
	const location = `${path}:${line}`;
	return fix
		? `Please inspect ${location} and the relevant project conventions. Finding: ${finding} Explain the cause and approach, then propose a focused, reviewable fix. Keep every source file within 400 lines and one class per file.`
		: `Please guide me through fixing the finding at ${location} myself. Finding: ${finding} Inspect the relevant source, explain why it matters, and give me concrete steps and a way to check my change. Do not propose or edit files.`;
}

/** Quick fixes keep the choice with the person: a reviewed Pair proposal or manual guidance. */
export class GuidanceActions implements vscode.CodeActionProvider {
	provideCodeActions(document: vscode.TextDocument, _range: vscode.Range,
		context: vscode.CodeActionContext): vscode.CodeAction[] {
		const path = vscode.workspace.asRelativePath(document.uri, false);
		return context.diagnostics.filter(diagnostic => SOURCES.has(diagnostic.source ?? '')).flatMap(diagnostic => {
			const line = diagnostic.range.start.line + 1;
			return [true, false].map(fix => {
				const action = new vscode.CodeAction(fix ? 'Ask Pair for a reviewed fix' : 'Guide me to fix this', vscode.CodeActionKind.QuickFix);
				action.diagnostics = [diagnostic];
				action.command = {
					command: 'myEditor.chat.ask', title: action.title,
					arguments: [guidancePrompt(path, line, diagnostic.message, fix)],
				};
				return action;
			});
		});
	}
}
