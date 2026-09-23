import * as vscode from 'vscode';
import { readProjectNote } from '../pair/context';
import { redact } from '../records/redact';
import { queryTerms, sourceExcerpt } from './relevance';

/** A small, refreshed slice of project plans and accepted decisions for ordinary chat. */
export async function planningContext(question: string): Promise<string> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) { return ''; }
	const terms = queryTerms(question);
	const [architecture, requirements] = await Promise.all([
		readProjectNote('specs/architecture.md', 60_000),
		readProjectNote('specs/requirements.md', 60_000),
	]);
	const parts = [
		architecture ? `Architecture plan (selected lines):\n${redact(sourceExcerpt(architecture, terms, 3800))}` : '',
		requirements ? `Requirements (selected lines):\n${redact(sourceExcerpt(requirements, terms, 2000))}` : '',
	];
	const dir = vscode.Uri.joinPath(root, '.my_editor', 'decisions');
	let files: [string, vscode.FileType][] = [];
	try { files = await vscode.workspace.fs.readDirectory(dir); } catch { /* No decision log yet. */ }
	const relevant: { name: string; text: string; score: number }[] = [];
	for (const [name, type] of files.filter(([, type]) => type === vscode.FileType.File).sort().reverse().slice(0, 100)) {
		try {
			const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name))).slice(0, 8_000);
			if (!/\*\*Status:\*\*\s*accepted/i.test(text)) { continue; }
			const lower = `${name} ${text}`.toLowerCase();
			const score = terms.reduce((count, term) => count + (lower.includes(term) ? 1 : 0), 0);
			relevant.push({ name, text, score });
		} catch { /* Decision moved during this turn. */ }
	}
	relevant.sort((a, b) => b.score - a.score || b.name.localeCompare(a.name));
	for (const decision of relevant.slice(0, 2)) {
		parts.push(`Accepted decision ${decision.name}:\n${redact(decision.text.slice(0, 1800))}`);
	}
	return parts.filter(Boolean).join('\n\n');
}
