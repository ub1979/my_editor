import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PythonInlineResults } from './pythonInlineResults';
import { PythonOutputEvent } from './pythonOutputHtml';

/** Copy the Python session's structured output into a visible, labelled block history. */
export class PythonResults implements vscode.Disposable {
	private readonly inline = new PythonInlineResults();
	private readonly channel = vscode.window.createOutputChannel('Python Results');
	private readonly directory = fs.mkdtempSync(path.join(os.tmpdir(), 'my-editor-python-results-'));
	readonly file = path.join(this.directory, 'events.jsonl');
	private offset = 0;
	private remainder = '';
	private counter = 0;
	private readonly labels = new Map<number, string>();
	private readonly watcher: fs.FSWatcher;
	private poll?: NodeJS.Timeout;

	constructor() {
		fs.writeFileSync(this.file, '', { mode: 0o600 });
		this.watcher = fs.watch(this.file, () => this.drain());
	}

	begin(label: string, editor: vscode.TextEditor, start: number, end: number): number {
		this.labels.set(++this.counter, label);
		this.inline.begin(this.counter, editor, start, end);
		// File notifications can coalesce while Python writes several events in one burst.
		this.poll ??= setInterval(() => this.drain(), 100);
		return this.counter;
	}

	show(): void { this.channel.show(true); }
	clearInline(uri?: vscode.Uri): void { this.inline.clear(uri); }
	stopPending(): void {
		for (const id of this.labels.keys()) { this.inline.consume({ id, done: true, failed: true, text: '\n[Session stopped]' }); }
		this.labels.clear(); clearInterval(this.poll); this.poll = undefined;
	}

	private drain(): void {
		try {
			const bytes = fs.readFileSync(this.file);
			const lines = (this.remainder + bytes.subarray(this.offset).toString('utf8')).split('\n');
			this.offset = bytes.length;
			this.remainder = lines.pop() ?? '';
			for (const line of lines) {
				if (!line) { continue; }
				const event = JSON.parse(line) as PythonOutputEvent;
				this.inline.consume(event);
				if (event.started) { this.channel.appendLine(`\n── Block ${event.id} · ${this.labels.get(event.id) ?? 'Python'} ──`); }
				if (event.text) { this.channel.append(event.text); }
				if (event.done) {
					this.channel.appendLine(`\n[Block ${event.id} ${event.failed ? 'failed' : 'finished'}]`);
					this.labels.delete(event.id);
				}
			}
			if (!this.labels.size) { clearInterval(this.poll); this.poll = undefined; }
		} catch { /* The terminal can close while its final output is being read. */ }
	}

	dispose(): void {
		clearInterval(this.poll);
		this.inline.dispose();
		this.watcher.close();
		this.channel.dispose();
		fs.rmSync(this.directory, { recursive: true, force: true });
	}
}
