import * as vscode from 'vscode';
import { describeEntry, readMap, SOURCE_GLOB, EXCLUDE_GLOB } from '../brain/brain';
import { redact } from '../records/redact';
import { isSensitiveFile } from '../records/sensitive';
import { queryTerms, rankPaths, sourceExcerpt } from './relevance';

const MAX_FILES = 12;
const MAX_TOTAL_CHARS = 30_000;
const EXTRA_GLOB = '**/*.{sql,prisma,graphql}';

/** The host reads relevant project files so every model provider receives the same source evidence. */
export async function projectEvidence(question: string, maxChars = MAX_TOTAL_CHARS): Promise<string> {
	const root = vscode.workspace.workspaceFolders?.[0];
	if (!root) { return 'No project folder is open in my_editor.'; }
	const identity = `Project open in my_editor: ${root.name}\nWorkspace location: ${root.uri.fsPath}`;
	const terms = queryTerms(question);
	if (!terms.length) { return identity; }
	const map = await readMap();
	const candidates: Record<string, string> = {};
	for (const [path, entry] of Object.entries(map?.files ?? {})) {
		candidates[path] = describeEntry(entry);
	}
	// Include files added after the brain was built and SQL migrations, which the brain scan omits.
	const discovered = await Promise.all([
		vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB, 5000),
		vscode.workspace.findFiles(EXTRA_GLOB, EXCLUDE_GLOB, 2000),
	]);
	for (const uri of discovered.flat()) {
		const path = vscode.workspace.asRelativePath(uri, false);
		candidates[path] ??= '';
	}
	const ranked = rankPaths(candidates, terms, value => value);
	const selected: string[] = [];
	const directoryCount = new Map<string, number>();
	for (const path of ranked) {
		if (isSensitiveFile(path) || path.startsWith('/') || path.split('/').some(part => part === '..' || part === '.')) { continue; }
		const directory = path.split('/').slice(0, -1).join('/');
		if ((directoryCount.get(directory) ?? 0) >= 5) { continue; }
		selected.push(path);
		directoryCount.set(directory, (directoryCount.get(directory) ?? 0) + 1);
		if (selected.length >= MAX_FILES) { break; }
	}
	let remaining = Math.min(MAX_TOTAL_CHARS, Math.max(4_000, maxChars));
	const evidence: string[] = [];
	for (const path of selected) {
		try {
			const uri = vscode.Uri.joinPath(root.uri, path);
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.size > 400_000) { continue; }
			const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
			const excerpt = redact(sourceExcerpt(source, terms, Math.min(2800, remaining)));
			if (excerpt.length > remaining) { break; }
			evidence.push(`File: ${path}${candidates[path] ? ` — ${candidates[path]}` : ''}\n${excerpt}`);
			remaining -= excerpt.length;
		} catch { /* File moved since discovery; continue with the others. */ }
	}
	return `${identity}\n\nSource excerpts read from this workspace (line numbers refer to each file):\n${evidence.length ? evidence.join('\n\n') : 'No matching source files were found for this question.'}\n\nThese are selected excerpts, not a complete project audit. Use them to identify concrete paths; state clearly when measurements or query plans are still needed.`;
}
