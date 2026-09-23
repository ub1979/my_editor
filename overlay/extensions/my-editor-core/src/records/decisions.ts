import * as vscode from 'vscode';
import { collapseCode, redact } from './redact';

export interface DecisionDraft {
	readonly title: string;
	readonly context: string;
	readonly discussion: string;
}

function slug(title: string): string {
	return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'decision';
}

/** Writes `.my_editor/decisions/NNNN-slug.md` from a brainstorm and opens it for the user to finish. */
export async function saveDecision(draft: DecisionDraft): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) {
		return;
	}
	const dir = vscode.Uri.joinPath(root, '.my_editor', 'decisions');
	let existing: [string, vscode.FileType][] = [];
	try {
		existing = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		existing = [];
	}
	const next = Math.max(0, ...existing.map(([name]) => Number.parseInt(name, 10)).filter(Number.isFinite)) + 1;
	const number = String(next).padStart(4, '0');
	const title = draft.title.trim().replace(/\s+/g, ' ').slice(0, 90) || 'Untitled decision';
	const uri = vscode.Uri.joinPath(dir, `${number}-${slug(title)}.md`);
	const body = [
		`# ${number} — ${title}`,
		'',
		`**Date:** ${new Date().toISOString().slice(0, 10)} · **Status:** proposed`,
		'',
		'## Question',
		'',
		redact(draft.context.trim()),
		'',
		'## Options discussed',
		'',
		redact(collapseCode(draft.discussion.trim())),
		'',
		'## Decision',
		'',
		'_What you chose and why — one or two sentences. Then set Status to accepted._',
		'',
	].join('\n');
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(body));
	await vscode.window.showTextDocument(uri);
}
