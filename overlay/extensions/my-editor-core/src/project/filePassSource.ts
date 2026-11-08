import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { checkedProjectPath } from '../chat/projectPath';
import { hasCredentialLikeSource } from '../records/sourceSecrets';
import { eligibleFile } from './filePassPolicy';
import { digest } from './buildProgress';

/** A file pass owns an exact lexical path, never a symlink alias into a different responsibility. */
export async function passSource(root: vscode.Uri, relative: string) {
	return readPassSource(root, relative, 80_000);
}

/** Tool-read context can be larger than an editable file; retain its full freshness hash. */
export async function evidenceSource(root: vscode.Uri, relative: string) {
	return readPassSource(root, relative, 400_000);
}

async function readPassSource(root: vscode.Uri, relative: string, maxBytes: number) {
	if (root.scheme !== 'file' || !eligibleFile(relative)) { throw new Error(`Choose a non-sensitive local project file: ${relative}`); }
	const target = checkedProjectPath(root.fsPath, relative, true);
	const boundary = await fs.realpath(root.fsPath);
	let ancestor = target;
	for (;;) {
		try {
			const stat = await fs.lstat(ancestor);
			if (stat.isSymbolicLink() || await fs.realpath(ancestor) !== path.resolve(boundary, path.relative(root.fsPath, ancestor))) {
				throw new Error(`Choose a direct project path instead of a symbolic link: ${relative}`);
			}
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
			ancestor = path.dirname(ancestor);
		}
	}
	const uri = vscode.Uri.file(target);
	const open = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
	if (open?.isDirty) { throw new Error(`Save or discard edits to ${relative} before continuing.`); }
	let source: string | undefined;
	try {
		const stat = await fs.stat(target);
		if (!stat.isFile() || stat.size > maxBytes) { throw new Error(`${relative} is too large or is not a regular text file.`); }
		source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await fs.readFile(target));
		if (source.includes('\0') || hasCredentialLikeSource(relative, source)) { throw new Error(`${relative} contains binary content or values that look like credentials. Review it manually.`); }
	} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
	return { uri, source, hash: source === undefined ? undefined : digest(source) };
}
