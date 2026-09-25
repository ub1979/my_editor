import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { changedHunks } from '../navigator/hunks';
import { sourcePolicyError } from '../quality/sourcePolicy';
import { ProposalFileSystem } from './proposalFileSystem';

export const PROPOSAL_SCHEME = 'my-editor-proposal';

export interface Proposal {
	readonly id: string;
	readonly target: vscode.Uri;
	readonly relativePath: string;
	/** The file's text when the change was proposed; Keep warns if the file moved on since. */
	readonly base: string;
	readonly proposalUri: vscode.Uri;
	readonly leftUri: vscode.Uri;
	readonly isNewFile: boolean;
	readonly added: number;
	readonly removed: number;
	state: 'open' | 'kept' | 'undone';
}

/**
 * Every AI change is a proposal the user reviews in a diff: nothing reaches the real file until Keep.
 * Reverting a part in the diff drops that part; Keep applies whatever is left.
 */
export class Proposals implements vscode.Disposable {
	private readonly fs = new ProposalFileSystem();
	private readonly byId = new Map<string, Proposal>();
	private readonly changed = new vscode.EventEmitter<Proposal>();
	readonly onDidChange = this.changed.event;
	private readonly registration: vscode.Disposable;

	constructor() {
		this.registration = vscode.workspace.registerFileSystemProvider(PROPOSAL_SCHEME, this.fs, { isCaseSensitive: true });
	}

	async propose(target: vscode.Uri, proposed: string): Promise<Proposal> {
		const policyError = sourcePolicyError(target.fsPath, proposed);
		if (policyError) { throw new Error(policyError); }
		const existing = this.findOpenFor(target);
		if (existing) {
			await this.undo(existing.id, true);
		}
		let base = '';
		let isNewFile = false;
		try {
			base = (await vscode.workspace.openTextDocument(target)).getText();
		} catch {
			isNewFile = true;
		}
		const id = randomBytes(6).toString('hex');
		const name = target.path.split('/').pop() ?? 'file';
		const proposalUri = vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: `/${id}/${name}` });
		const leftUri = isNewFile ? vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: `/${id}/empty/${name}` }) : target;
		this.fs.set(proposalUri, proposed);
		if (isNewFile) {
			this.fs.set(leftUri, '');
		}
		const count = (a: string, b: string) => changedHunks(a, b).reduce((n, h) => n + h.end - h.start + 1, 0);
		const proposal: Proposal = {
			id, target, relativePath: vscode.workspace.asRelativePath(target, false), base, proposalUri, leftUri, isNewFile,
			added: count(base, proposed), removed: count(proposed, base), state: 'open',
		};
		this.byId.set(id, proposal);
		await this.show(id);
		return proposal;
	}

	get(id: string): Proposal | undefined {
		return this.byId.get(id);
	}

	/** Finds a proposal from any of its URIs (used by the editor toolbar buttons). */
	fromUri(uri: vscode.Uri | undefined): Proposal | undefined {
		if (!uri) {
			return undefined;
		}
		return [...this.byId.values()].find(p => p.state === 'open' && (p.proposalUri.toString() === uri.toString() || (p.target.toString() === uri.toString())));
	}

	async show(id: string): Promise<void> {
		const proposal = this.byId.get(id);
		if (!proposal || proposal.state !== 'open') {
			return;
		}
		await vscode.commands.executeCommand('vscode.diff', proposal.leftUri, proposal.proposalUri,
			`${proposal.relativePath.split('/').pop()} · proposed by Pair`, { preview: false });
	}

	/** Writes what is left of the proposal into the file and saves it. */
	async keep(id: string): Promise<boolean> {
		const proposal = this.byId.get(id);
		if (!proposal || proposal.state !== 'open') {
			return false;
		}
		const text = await this.currentProposalText(proposal);
		const policyError = sourcePolicyError(proposal.target.fsPath, text);
		if (policyError) {
			void vscode.window.showWarningMessage(policyError);
			return false;
		}
		if (proposal.isNewFile) {
			try {
				await vscode.workspace.fs.stat(proposal.target);
				const choice = await vscode.window.showWarningMessage(`${proposal.relativePath} was created since this was proposed.`, { modal: true, detail: 'Keeping the proposal replaces it.' }, 'Replace it');
				if (choice !== 'Replace it') {
					return false;
				}
			} catch {
				// Still new: good.
			}
			await vscode.workspace.fs.writeFile(proposal.target, new TextEncoder().encode(text));
		} else {
			const document = await vscode.workspace.openTextDocument(proposal.target);
			if (document.getText() !== proposal.base) {
				const choice = await vscode.window.showWarningMessage(`${proposal.relativePath} changed since this was proposed.`, { modal: true, detail: 'Keeping the proposal replaces those newer edits.' }, 'Keep anyway');
				if (choice !== 'Keep anyway') {
					return false;
				}
			}
			const edit = new vscode.WorkspaceEdit();
			edit.replace(proposal.target, new vscode.Range(0, 0, document.lineCount, 0), text);
			if (!await vscode.workspace.applyEdit(edit) || !await document.save()) {
				void vscode.window.showWarningMessage(`${proposal.relativePath} was not saved. The proposal remains open; check the file and try Keep again.`);
				return false;
			}
		}
		await this.close(proposal, 'kept');
		await vscode.window.showTextDocument(proposal.target, { preview: false });
		return true;
	}

	/** Discards the proposal; the file is untouched. */
	async undo(id: string, silent = false): Promise<void> {
		const proposal = this.byId.get(id);
		if (!proposal || proposal.state !== 'open') {
			return;
		}
		await this.close(proposal, 'undone');
		if (!silent && !proposal.isNewFile) {
			await vscode.window.showTextDocument(proposal.target, { preview: false });
		}
	}

	private findOpenFor(target: vscode.Uri): Proposal | undefined {
		return [...this.byId.values()].find(p => p.state === 'open' && p.target.toString() === target.toString());
	}

	/** The proposal as it is now: the user may have reverted parts in the diff editor. */
	private async currentProposalText(proposal: Proposal): Promise<string> {
		const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === proposal.proposalUri.toString());
		return open ? open.getText() : new TextDecoder().decode(this.fs.readFile(proposal.proposalUri));
	}

	private async close(proposal: Proposal, state: 'kept' | 'undone'): Promise<void> {
		// Save the in-memory proposal first so closing its tab never asks "save changes?".
		const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === proposal.proposalUri.toString());
		if (open?.isDirty) {
			await open.save();
		}
		const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
			tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.toString() === proposal.proposalUri.toString());
		if (tabs.length) {
			await vscode.window.tabGroups.close(tabs);
		}
		proposal.state = state;
		this.fs.delete(proposal.proposalUri);
		if (proposal.isNewFile) {
			this.fs.delete(proposal.leftUri);
		}
		this.changed.fire(proposal);
	}

	dispose(): void {
		this.registration.dispose();
		this.changed.dispose();
	}
}
