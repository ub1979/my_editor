import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { changedHunks } from '../navigator/hunks';
import { sourcePolicyError } from '../quality/sourcePolicy';
import { ProposalFileSystem } from './proposalFileSystem';
import { checkedProjectPath } from './projectPath';
import { scaffoldKeptTree } from '../project/tree';
import { validateTreePlan } from '../project/stubs';
import * as path from 'path';
import { validatePlanningFile } from '../project/planningFiles';
import { filePassWillSave } from '../project/filePassEvents';

export const PROPOSAL_SCHEME = 'my-editor-proposal';

interface ScopedProposal {
	validate(text: string): Promise<void>;
	allowed(): boolean;
}

export interface Proposal {
	readonly scope?: ScopedProposal;
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
	operation?: 'write' | 'delete';
	readonly planningDraft?: boolean;
	state: 'open' | 'kept' | 'undone';
}

/**
 * Every AI change is a proposal the user reviews in a diff: nothing reaches the real file until Keep.
 * Reverting a part in the diff drops that part; Keep applies whatever is left.
 */
export class Proposals implements vscode.Disposable {
	private readonly fs = new ProposalFileSystem();
	private readonly byId = new Map<string, Proposal>();
	private readonly keeping = new Map<string, Promise<boolean>>();
	private readonly changed = new vscode.EventEmitter<Proposal>();
	readonly onDidChange = this.changed.event;
	private readonly registration: vscode.Disposable;

	constructor() {
		this.registration = vscode.workspace.registerFileSystemProvider(PROPOSAL_SCHEME, this.fs, { isCaseSensitive: true });
	}

	async propose(target: vscode.Uri, proposed: string, operation: 'write' | 'delete' = 'write', planningDraft = false, scope?: ScopedProposal, expectedBase?: string): Promise<Proposal> {
		if (operation !== 'delete' && !planningDraft) { await validatePlanningFile(target, proposed); }
		const policyError = sourcePolicyError(target.fsPath, proposed);
		if (policyError) { throw new Error(policyError); }
		const existing = this.findOpenFor(target);
		if (existing && (scope || existing.scope)) { throw new Error('Resolve the existing proposal before continuing.'); }
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
		if (expectedBase !== undefined && base !== expectedBase) { throw new Error('The file changed while preparing edits. Read it again before proposing.'); }
		if (operation === 'delete' && isNewFile) { throw new Error('The file to delete does not exist.'); }
		if (scope && !scope.allowed()) { throw new Error('Run stopped.'); }
		const newer = this.findOpenFor(target);
		if (newer && (scope || newer.scope)) { throw new Error('Review the current proposal for this file first.'); }
		const id = randomBytes(6).toString('hex');
		const name = target.path.split('/').pop() ?? 'file';
		const proposalUri = vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: `/${id}/${name}` });
		// Freeze the reviewed base: applying Keep must not mutate a live diff's original model mid-update.
		const leftUri = vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: `/${id}/base/${name}` });
		this.fs.set(proposalUri, proposed);
		this.fs.set(leftUri, base);
		const count = (a: string, b: string) => changedHunks(a, b).reduce((n, h) => n + h.end - h.start + 1, 0);
		const proposal: Proposal = {
			id, target, scope, relativePath: vscode.workspace.asRelativePath(target, false), base, proposalUri, leftUri, isNewFile,
			added: count(base, proposed), removed: count(proposed, base), operation, planningDraft, state: 'open',
		};
		this.byId.set(id, proposal);
		if (!scope) { await this.show(id); }
		return proposal;
	}

	get(id: string): Proposal | undefined {
		return this.byId.get(id);
	}

	/** Used to distinguish an existing review from a model inventing a new proposal. */
	get hasOpenProposal(): boolean { return [...this.byId.values()].some(proposal => proposal.state === 'open'); }

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
			`${proposal.relativePath.split('/').pop()} · ${proposal.operation === 'delete' ? 'deletion ' : ''}proposed by AI`, { preview: false });
	}

	/** Writes what is left of the proposal into the file and saves it. */
	keep(id: string, authorize?: () => boolean): Promise<boolean> {
		const pending = this.keeping.get(id);
		if (pending) { return pending; }
		const saving = this.apply(id, authorize).finally(() => this.keeping.delete(id));
		this.keeping.set(id, saving); return saving;
	}

	private async apply(id: string, authorize?: () => boolean): Promise<boolean> {
		const proposal = this.byId.get(id);
		if (!proposal || proposal.state !== 'open') {
			return false;
		}
		const text = await this.currentProposalText(proposal);
		if (proposal.scope) {
			try { await proposal.scope.validate(text); }
			catch (error) { void vscode.window.showWarningMessage(String(error)); return false; }
		}
		const deleting = proposal.operation === 'delete' && text.length === 0;
		if (!deleting && !proposal.planningDraft) {
			try { await validatePlanningFile(proposal.target, text); }
			catch (error) {
				void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
				return false;
			}
		}
		const keepingTree = !deleting && !proposal.planningDraft && proposal.relativePath.replaceAll('\\', '/') === '.my_editor/specs/tree.json';
		if (keepingTree) {
			try { validateTreePlan(text); }
			catch (error) {
				void vscode.window.showWarningMessage(`The file tree is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
				return false;
			}
		}
		const root = vscode.workspace.getWorkspaceFolder(proposal.target)?.uri.fsPath;
		if (!root) { throw new Error('Open the proposal’s project before keeping it.'); }
		checkedProjectPath(root, path.relative(root, proposal.target.fsPath), proposal.isNewFile);
		const policyError = sourcePolicyError(proposal.target.fsPath, text);
		if (policyError) {
			void vscode.window.showWarningMessage(policyError);
			return false;
		}
		if (authorize && !authorize()) { return false; }
		if (deleting) {
			const document = await vscode.workspace.openTextDocument(proposal.target);
			if (document.getText() !== proposal.base) {
				void vscode.window.showWarningMessage('The file changed since deletion was proposed. Ask for a fresh proposal.');
				return false;
			}
			await vscode.workspace.fs.delete(proposal.target, { recursive: false, useTrash: true });
		} else if (proposal.isNewFile && proposal.scope) {
			const fs = await import('fs/promises');
			await fs.mkdir(path.dirname(proposal.target.fsPath), { recursive: true });
			await proposal.scope.validate(text);
			if (authorize && !authorize()) { return false; }
			await fs.writeFile(proposal.target.fsPath, text, { flag: 'wx' });
		} else if (proposal.isNewFile) {
			try {
				await vscode.workspace.fs.stat(proposal.target);
				const choice = await vscode.window.showWarningMessage(`${proposal.relativePath} was created since this was proposed.`,
					{ modal: true, detail: 'Keeping the proposal replaces it.' }, 'Replace it');
				if (choice !== 'Replace it') {
					return false;
				}
			} catch {
				// Still new: good.
			}
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(proposal.target.fsPath)));
			await vscode.workspace.fs.writeFile(proposal.target, new TextEncoder().encode(text));
		} else {
			const document = await vscode.workspace.openTextDocument(proposal.target);
			if (proposal.scope && (document.isDirty || document.getText() !== proposal.base)) { return false; }
			if (document.getText() !== proposal.base) {
				const choice = await vscode.window.showWarningMessage(`${proposal.relativePath} changed since this was proposed.`,
					{ modal: true, detail: 'Keeping the proposal replaces those newer edits.' }, 'Keep anyway');
				if (choice !== 'Keep anyway') {
					return false;
				}
			}
			if (authorize && !authorize()) { return false; }
			const edit = new vscode.WorkspaceEdit();
			edit.replace(proposal.target, new vscode.Range(0, 0, document.lineCount, 0), text);
			if (proposal.scope) { filePassWillSave.fire(proposal.target.toString()); }
			if (!await vscode.workspace.applyEdit(edit) || !await document.save()) {
				void vscode.window.showWarningMessage(`${proposal.relativePath} was not saved. The proposal remains open; check the file and try Keep again.`);
				return false;
			}
		}
		proposal.operation = deleting ? 'delete' : 'write';
		await this.close(proposal, 'kept');
		if (keepingTree) {
			try {
				const result = await scaffoldKeptTree(vscode.Uri.file(root));
				const suffix = result.skipped.length ? ` ${result.skipped.length} could not be created: ${result.skipped.join('; ')}` : '';
				void vscode.window.showInformationMessage(`Created ${result.created} planned file${result.created === 1 ? '' : 's'} from the tree.${suffix}`);
			} catch (error) {
				void vscode.window.showWarningMessage(`The tree was kept, but its files could not be created: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (!deleting && !authorize && !proposal.scope) { await vscode.window.showTextDocument(proposal.target, { preview: false }); }
		return true;
	}

	/** Discards the proposal; the file is untouched. */
	async undo(id: string, silent = false): Promise<void> {
		if (this.keeping.has(id)) { await this.keeping.get(id); }
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
		this.fs.delete(proposal.leftUri);
		this.changed.fire(proposal);
	}

	dispose(): void {
		this.registration.dispose();
		this.changed.dispose();
	}
}
