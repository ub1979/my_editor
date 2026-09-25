import * as vscode from 'vscode';

/** Proposed text lives in memory and can be edited in the diff before Keep. */
export class ProposalFileSystem implements vscode.FileSystemProvider {
	private readonly files = new Map<string, Uint8Array>();
	private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile = this.changed.event;

	set(uri: vscode.Uri, text: string): void { this.files.set(uri.path, new TextEncoder().encode(text)); }
	delete(uri: vscode.Uri): void { this.files.delete(uri.path); }
	watch(): vscode.Disposable { return new vscode.Disposable(() => undefined); }

	stat(uri: vscode.Uri): vscode.FileStat {
		const data = this.files.get(uri.path);
		if (!data) { throw vscode.FileSystemError.FileNotFound(uri); }
		return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: data.byteLength };
	}

	readDirectory(): [string, vscode.FileType][] { return []; }
	createDirectory(): void { /* Proposals are flat. */ }

	readFile(uri: vscode.Uri): Uint8Array {
		const data = this.files.get(uri.path);
		if (!data) { throw vscode.FileSystemError.FileNotFound(uri); }
		return data;
	}

	writeFile(uri: vscode.Uri, content: Uint8Array): void {
		this.files.set(uri.path, content);
		this.changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
	}

	rename(): void { throw vscode.FileSystemError.NoPermissions('Proposals cannot be renamed.'); }
}
