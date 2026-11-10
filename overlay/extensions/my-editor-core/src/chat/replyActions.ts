import { documentFromReply, fileFromReply } from '../pair/codeBlock';
import { documentProblems, planningDocumentKind } from '../project/planning';
import { isPlanningStage } from './planningStart';
import type { Message } from './presentation';

function retainedDocument(reply: string, target: string): string | undefined {
	try { return documentFromReply(reply, target); }
	catch { return fileFromReply(reply); }
}

function draftMatches(stage: string, content: string): boolean {
	const kind = planningDocumentKind(content);
	return kind === stage || stage === 'tree' && kind === undefined && /^[\[{]/.test(content.trim());
}

/** Re-review a complete retained reply after a validator fix, without generating another document. */
export function savedPlanningAction(message: Pick<Message, 'mode' | 'done' | 'error' | 'historyText' | 'proposals' | 'readOnly'>):
	Message['actions'][number] | undefined {
	if (message.readOnly || !message.done || !message.error || !message.historyText || !isPlanningStage(message.mode ?? '')
		|| message.proposals.some(proposal => ['open', 'kept'].includes(proposal.state))) { return; }
	const stage = message.mode!;
	try {
		const content = retainedDocument(message.historyText, stage === 'tree' ? 'tree.json' : `${stage}.md`);
		if (!content || !draftMatches(stage, content)) { return; }
		let malformed = false;
		try { documentFromReply(message.historyText, stage === 'tree' ? 'tree.json' : `${stage}.md`); } catch { malformed = true; }
		if (malformed || planningDocumentKind(content) === undefined
			|| (stage === 'architecture' || stage === 'requirements') && documentProblems(stage, content).length) {
			return { label: `Repair saved ${stage}`, command: 'myEditor.repairPlanningReply', args: [stage, message.historyText] };
		}
		return { label: `Review saved ${stage === 'tree' ? 'file tree' : stage}`, command: 'myEditor.reviewPlanningReply', args: [stage, message.historyText] };
	} catch { return; }
}

/** Reuse the whole retained draft after a failed validation, rather than reconstructing it from a preview. */
export function planningRepairRequest(stage: string, reply: string): { text: string; planningDraft: string } {
	if (!isPlanningStage(stage) || typeof reply !== 'string') { throw new Error('Choose a retained planning draft to repair.'); }
	const target = stage === 'tree' ? 'tree.json' : `${stage}.md`;
	const content = retainedDocument(reply, target);
	if (!content || !draftMatches(stage, content)) { throw new Error('The retained draft does not match the selected planning stage.'); }
	return { text: `/${stage} Repair the validation defects in the retained draft. Preserve valid sections, IDs, anchors, agreed decisions and saved prerequisite documents. `
		+ 'Use the current prerequisites as evidence and return the complete corrected document for Keep.', planningDraft: reply };
}

export function replyActions(message: Message | undefined): Message['actions'] {
	if (!message) { return []; }
	const recovery = savedPlanningAction(message);
	return recovery ? [...message.actions, recovery] : message.actions;
}
