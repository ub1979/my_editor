import * as vscode from 'vscode';
import { ProposalEvent, saveProposalEvent } from './changeJournal';
import type { Proposal } from './proposals';

/** Writes a proposal's event to the change journal; a failure only warns. */
export function recordProposal(requestId: string, proposal: Proposal, event: ProposalEvent): void {
	void saveProposalEvent(requestId, proposal, event).catch(error =>
		vscode.window.showWarningMessage(`Could not save the change record: ${error instanceof Error ? error.message : String(error)}`));
}
