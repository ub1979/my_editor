import type { PreparedFile } from './filePassWorker';

/** Prepared siblings are reusable only while every input snapshot still matches disk. */
export class PreparedBatch {
	private files = new Map<string, PreparedFile>();
	private hashes = new Map<string, string | undefined>();
	set(files: readonly PreparedFile[]) {
		this.files = new Map(files.map(file => [file.path, file]));
		this.hashes = new Map(files.map(file => [file.path, file.hash]));
	}
	clear() { this.files.clear(); this.hashes.clear(); }
	paths() { return [...this.files.keys()]; }
	async take(path: string, hash: (path: string) => Promise<string | undefined>): Promise<PreparedFile | undefined> {
		if (!this.files.has(path)) { return; }
		for (const [name, expected] of this.hashes) {
			if (await hash(name) !== expected) { this.clear(); return; }
		}
		const file = this.files.get(path); this.files.delete(path); return file;
	}
	saved(path: string, hash: string | undefined) {
		if (this.hashes.has(path)) { this.hashes.set(path, hash); }
		if (!this.files.size) { this.clear(); }
	}
}
