import * as vscode from 'vscode';
import { classNames, hasClassSyntax, isSourceFile, MAX_SOURCE_LINES, WARN_SOURCE_LINES } from './sourcePolicy';

/** Gives human edits a visible warning before the limit and a diagnostic after it is crossed. */
export class SourceWatch implements vscode.Disposable {
	private readonly diagnostics = vscode.languages.createDiagnosticCollection('my_editor structure');
	private readonly subscriptions: vscode.Disposable[];

	constructor() {
		this.subscriptions = [
			this.diagnostics,
			vscode.workspace.onDidOpenTextDocument(document => this.check(document)),
			vscode.workspace.onDidChangeTextDocument(event => this.check(event.document)),
		];
		for (const document of vscode.workspace.textDocuments) { this.check(document); }
	}

	private check(document: vscode.TextDocument): void {
		if (document.uri.scheme !== 'file' || !isSourceFile(document.uri.fsPath)) { return; }
		const findings: vscode.Diagnostic[] = [];
		const lines = document.lineCount - (document.lineAt(document.lineCount - 1).text.length === 0 ? 1 : 0);
		if (lines >= WARN_SOURCE_LINES) {
			const over = lines > MAX_SOURCE_LINES;
			const message = over
				? `${lines} lines exceeds the ${MAX_SOURCE_LINES}-line source limit. Split this file by responsibility before adding more.`
				: `${lines}/${MAX_SOURCE_LINES} lines. Plan a focused split before this file grows further.`;
			findings.push(new vscode.Diagnostic(document.lineAt(Math.max(0, document.lineCount - 1)).range,
				message, over ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Information));
		}
		const names = hasClassSyntax(document.uri.fsPath) && lines <= 1000
			? classNames(document.getText(), document.uri.fsPath) : [];
		if (names.length > 1) {
			findings.push(new vscode.Diagnostic(document.lineAt(0).range,
				`This file contains ${names.length} classes (${names.join(', ')}). Keep one class per file.`, vscode.DiagnosticSeverity.Warning));
		}
		for (const finding of findings) { finding.source = 'my_editor structure'; }
		this.diagnostics.set(document.uri, findings);
	}

	dispose(): void { vscode.Disposable.from(...this.subscriptions).dispose(); }
}
