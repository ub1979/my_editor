import * as vscode from 'vscode';
import { Proposal, Proposals } from '../chat/proposals';
import { passSource } from './filePassSource';
import { PreparedFile } from './filePassWorker';
import { proposeCandidate } from './filePassProposal';
import { PassOptions } from './filePassPlan';
import { validateFileEvidence } from './fileEvidenceLoader';

export interface ReviewUI {
	validatePlan(): Promise<void>;
	pending(proposal: Proposal): Promise<void>;
	running(): Promise<void>;
	permissionsChanged(): Promise<void>;
}

function decision(proposals: Proposals, proposal: Proposal, token: vscode.CancellationToken): Promise<void> {
	return new Promise((resolve, reject) => {
		const finish = () => {
			if (!token.isCancellationRequested && proposal.state === 'open') { return; }
			subscription.dispose(); cancellation.dispose();
			if (proposal.state === 'kept' && !token.isCancellationRequested) { resolve(); }
			else { reject(new Error('Review stopped.')); }
		};
		const subscription = proposals.onDidChange(change => { if (change.id === proposal.id) { finish(); } });
		const cancellation = token.onCancellationRequested(finish);
		finish();
	});
}

/** Save exactly one validated candidate at a time. Companion test paths need their own permission. */
export async function applyPrepared(root: vscode.Uri, prepared: PreparedFile, options: PassOptions, proposals: Proposals,
	token: vscode.CancellationToken, ui: ReviewUI): Promise<string | undefined> {
	let hash = prepared.hash;
	await validateFileEvidence(root, prepared.contextHashes);
	const allowed = () => !token.isCancellationRequested && root.toString() === vscode.workspace.workspaceFolders?.[0]?.uri.toString();
	for (const candidate of prepared.changes) {
		if (!allowed()) { throw new Error('Run stopped.'); }
		const extra = candidate.path !== prepared.path;
		if (extra && options.companionTests !== 'automatic') {
			const answer = await vscode.window.showInformationMessage(`Review a new test for ${prepared.path.split('/').pop()}?`,
				{ modal: true, detail: `The AI prepared ${candidate.path} inside your project. Review test opens the changes; Keep saves them. Allow tests for this run saves this and future new companion tests automatically. Cancel skips this extra test.` }, 'Review test', 'Allow tests for this run');
			if (!allowed()) { throw new Error('Run stopped.'); }
			if (answer === 'Allow tests for this run') {
				options.companionTests = 'automatic'; await ui.permissionsChanged();
			} else if (answer !== 'Review test') { prepared.note += `\nCompanion test declined: ${candidate.path}.`; continue; }
		}
		const auto = () => extra ? options.companionTests === 'automatic' : options.automatic;
		const proposal = await proposeCandidate(root, candidate, proposals, allowed, async () => {
			await ui.validatePlan(); await validateFileEvidence(root, prepared.contextHashes);
		});
		await ui.pending(proposal);
		const kept = auto() && allowed() && await proposals.keep(proposal.id, () => allowed() && auto());
		if (!kept) {
			if (allowed()) { await proposals.show(proposal.id); }
			await decision(proposals, proposal, token);
		}
		if (!extra) { hash = (await passSource(root, candidate.path)).hash; }
		await ui.running();
	}
	return hash;
}
