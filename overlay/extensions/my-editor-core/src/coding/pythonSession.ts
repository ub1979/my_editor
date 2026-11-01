import * as vscode from 'vscode';
import * as path from 'path';
import { pythonCell, pythonSelectionCommand } from './pythonCode';
import { PythonResults } from './pythonResults';

interface PythonApi {
	environments?: {
		getActiveEnvironmentPath(uri?: vscode.Uri): { path: string };
		resolveEnvironment(value: { path: string }): Promise<{ executable?: { uri?: vscode.Uri } } | undefined>;
	};
}

/** A terminal-backed Python session keeps variables between runs and uses the project's selected interpreter. */
export class PythonSession implements vscode.Disposable {
	private readonly results = new PythonResults();
	private terminal?: vscode.Terminal;
	private sessionKey?: string;
	private readonly closed = vscode.window.onDidCloseTerminal(terminal => {
		if (terminal === this.terminal) { this.results.stopPending(); this.terminal = undefined; this.sessionKey = undefined; }
	});

	async run(cell = false): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'python') {
			void vscode.window.showInformationMessage('Open a Python file first.'); return;
		}
		if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage('Trust this project before running its Python code.'); return; }
		const document = editor.document;
		const block = cell ? pythonCell(document.getText(), editor.selection.active.line) : undefined;
		const code = block ? block.code
			: document.getText(editor.selection.isEmpty ? document.lineAt(editor.selection.active.line).range : editor.selection);
		if (!code.trim()) { return; }
		const executable = await this.interpreter(document.uri);
		const cwd = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? path.dirname(document.uri.fsPath);
		const key = `${cwd}\0${executable}`;
		if (!this.terminal || this.sessionKey !== key) {
			this.restart();
			this.terminal = vscode.window.createTerminal({ name: 'Python · my_editor', shellPath: executable,
				shellArgs: ['-i', '-q', path.join(__dirname, '..', 'resources', 'python', 'session.py')], cwd,
				env: { PYTHONSTARTUP: '', MY_EDITOR_PYTHON_RESULTS: this.results.file } });
			this.sessionKey = key;
		}
		const start = (block?.start ?? editor.selection.start.line) + 1;
		const end = block?.end ?? (editor.selection.isEmpty ? start : editor.selection.end.line + (editor.selection.end.character ? 1 : 0));
		const id = this.results.begin(`${vscode.workspace.asRelativePath(document.uri)}:${start}–${Math.max(start, end)}`, editor, start - 1, Math.max(start, end) - 1);
		this.terminal.sendText(pythonSelectionCommand(code, document.uri.fsPath, id));
		if (!cell && editor.selection.isEmpty && editor.selection.active.line < document.lineCount - 1) {
			const next = new vscode.Position(editor.selection.active.line + 1, 0);
			editor.selection = new vscode.Selection(next, next);
		}
	}

	restart(): void { this.results.stopPending(); this.terminal?.dispose(); this.terminal = undefined; this.sessionKey = undefined; }
	showResults(): void { this.results.show(); }
	clearInlineResults(): void { this.results.clearInline(vscode.window.activeTextEditor?.document.uri); }

	private async interpreter(uri: vscode.Uri): Promise<string> {
		const extension = vscode.extensions.getExtension<PythonApi>('ms-python.python');
		if (extension) {
			try {
				const api = await extension.activate();
				const active = api.environments?.getActiveEnvironmentPath(uri);
				const environment = active && await api.environments?.resolveEnvironment(active);
				const executable = environment?.executable?.uri?.fsPath;
				if (executable) { return executable; }
			} catch { /* The user setting remains available when the Python extension cannot resolve an environment. */ }
		}
		return vscode.workspace.getConfiguration('python', uri).get<string>('defaultInterpreterPath')
			|| (process.platform === 'win32' ? 'python' : 'python3');
	}

	dispose(): void { this.closed.dispose(); this.restart(); this.results.dispose(); }
}
