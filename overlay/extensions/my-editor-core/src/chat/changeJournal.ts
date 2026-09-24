import { createHash, randomBytes } from 'crypto';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { redact } from '../records/redact';
import { Proposal } from './proposals';

export type ProposalEvent = 'proposed' | 'kept' | 'undone';

function git(cwd: string, args: string[]): Promise<string | undefined> {
	return new Promise(resolve => execFile('git', args, { cwd, timeout: 4_000 },
		(error, output) => resolve(error ? undefined : output.trim())));
}

function hash(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

/** Append-only change event: links the chat request, reviewed proposal, base and kept result. */
export async function saveProposalEvent(requestId: string, proposal: Proposal, event: ProposalEvent): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root || root.scheme !== 'file' || !/^[a-f0-9]{12}$/.test(requestId)) { return; }
	try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, '.my_editor')); }
	catch { return; }
	const [head, branch, applied] = await Promise.all([
		git(root.fsPath, ['rev-parse', '--short', 'HEAD']),
		git(root.fsPath, ['branch', '--show-current']),
		event === 'kept' ? vscode.workspace.fs.readFile(proposal.target).then(hash, () => undefined) : Promise.resolve(undefined),
	]);
	const at = new Date().toISOString();
	const dir = vscode.Uri.joinPath(root, '.my_editor', 'changes', at.slice(0, 10));
	await vscode.workspace.fs.createDirectory(dir);
	const record = {
		at, requestId, proposalId: proposal.id, event,
		file: redact(proposal.relativePath), gitHead: head, branch,
		baseHash: hash(proposal.base), appliedHash: applied,
		added: proposal.added, removed: proposal.removed, isNewFile: proposal.isNewFile,
	};
	const name = `${at.replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.json`;
	await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, name), new TextEncoder().encode(JSON.stringify(record, null, 2) + '\n'));
}
