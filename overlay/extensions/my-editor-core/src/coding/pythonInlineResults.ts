import * as vscode from 'vscode';
import { moveOutputAnchor, OutputAnchor, outputHeight, pythonOutputHtml, PythonOutputEvent } from './pythonOutputHtml';

interface BlockOutput {
	id: number; uri: vscode.Uri; anchor: OutputAnchor; text: string; status: string; version: number;
	views: Map<vscode.TextEditor, vscode.WebviewEditorInset>;
}

/** Native editor view zones put results below executed source without inserting text into the file. */
export class PythonInlineResults implements vscode.Disposable {
	private readonly blocks = new Map<number, BlockOutput>();
	private readonly rendered = new WeakMap<vscode.WebviewEditorInset, number>();
	private timer?: NodeJS.Timeout;
	private readonly subscriptions = [
		vscode.window.onDidChangeVisibleTextEditors(() => this.schedule()),
		vscode.workspace.onDidCloseTextDocument(document => this.clear(document.uri)),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (!event.contentChanges.length) { return; }
			for (const block of this.blocks.values()) {
				if (block.uri.toString() !== event.document.uri.toString()) { continue; }
				const anchor = moveOutputAnchor(block.anchor, event.contentChanges);
				if (!anchor) { this.remove(block.id); }
				else { block.anchor = anchor; this.disposeViews(block); }
			}
			this.schedule();
		}),
	];

	begin(id: number, editor: vscode.TextEditor, start: number, end: number): void {
		const document = editor.document;
		const anchor = { start: document.offsetAt(new vscode.Position(start, 0)), end: document.offsetAt(document.lineAt(end).range.end) };
		for (const block of this.blocks.values()) {
			if (block.uri.toString() === document.uri.toString() && anchor.start <= block.anchor.end && anchor.end >= block.anchor.start) { this.remove(block.id); }
		}
		if (this.blocks.size >= 100) { this.remove(this.blocks.keys().next().value!); }
		const block: BlockOutput = { id, uri: document.uri, anchor, text: '', status: 'Queued', version: 0, views: new Map() };
		this.blocks.set(id, block);
		this.render(block);
	}

	consume(event: PythonOutputEvent): void {
		const block = this.blocks.get(event.id);
		if (!block) { return; }
		if (event.started) { block.status = 'Running'; }
		if (event.text && block.text.length < 100_000) {
			block.text += event.text.slice(0, 100_000 - block.text.length);
			if (block.text.length === 100_000) { block.text += '\n[Output shortened; full output is in Python Results]'; }
		}
		if (event.done) { block.status = event.failed ? 'Error' : 'Finished'; }
		block.version++;
		this.schedule();
	}

	clear(uri?: vscode.Uri): void {
		for (const block of this.blocks.values()) { if (!uri || block.uri.toString() === uri.toString()) { this.remove(block.id); } }
	}

	private schedule(): void {
		this.timer ??= setTimeout(() => {
			this.timer = undefined;
			for (const block of this.blocks.values()) { this.render(block); }
		}, 50);
	}

	private render(block: BlockOutput): void {
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() !== block.uri.toString()) { continue; }
			const line = editor.document.positionAt(block.anchor.end).line;
			const height = outputHeight(block.text);
			let view = block.views.get(editor);
			if (view && (view.line !== line || view.height !== height)) { view.dispose(); view = undefined; }
			if (!view) {
				view = vscode.window.createWebviewTextEditorInset(editor, line, height, { enableScripts: true, localResourceRoots: [] });
				block.views.set(editor, view);
				const current = view;
				view.onDidDispose(() => { if (block.views.get(editor) === current) { block.views.delete(editor); } });
				view.webview.onDidReceiveMessage(message => { if (message?.type === 'dismiss') { this.remove(block.id); } });
			}
			if (this.rendered.get(view) !== block.version) {
				view.webview.html = pythonOutputHtml(block.id, block.status, block.text);
				this.rendered.set(view, block.version);
			}
		}
	}

	private disposeViews(block: BlockOutput): void { for (const view of block.views.values()) { view.dispose(); } block.views.clear(); }
	private remove(id: number): void { const block = this.blocks.get(id); if (block) { this.blocks.delete(id); this.disposeViews(block); } }
	dispose(): void { clearTimeout(this.timer); this.clear(); for (const item of this.subscriptions) { item.dispose(); } }
}
