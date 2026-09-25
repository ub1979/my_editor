import * as vscode from 'vscode';

export interface ActiveFile { readonly uri: vscode.Uri; readonly selection?: vscode.Selection }

/** Remembers the last code editor when the centered Pair tab takes focus. */
export class ActiveFileTracker implements vscode.Disposable {
	private file: ActiveFile | undefined;
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private readonly subscriptions: vscode.Disposable[];

	constructor() {
		this.capture(vscode.window.activeTextEditor);
		this.subscriptions = [
			this.changed,
			vscode.window.onDidChangeActiveTextEditor(editor => this.capture(editor)),
			vscode.window.onDidChangeTextEditorSelection(event => this.capture(event.textEditor)),
	];
	}

	get current(): ActiveFile | undefined { return this.file; }

	private capture(editor: vscode.TextEditor | undefined): void {
		if (!editor || !['file', 'untitled'].includes(editor.document.uri.scheme)) { return; }
		this.file = { uri: editor.document.uri, selection: editor.selection.isEmpty ? undefined : editor.selection };
		this.changed.fire();
	}

	dispose(): void { vscode.Disposable.from(...this.subscriptions).dispose(); }
}
