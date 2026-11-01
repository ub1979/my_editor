import { documentFromReply } from '../pair/codeBlock';
import { documentProblems, planningDocumentKind } from '../project/planning';
import { isPlanningStage } from './planningStart';
import type { Message } from './presentation';

/** Re-review a complete retained reply after a validator fix, without generating another document. */
export function savedPlanningAction(message: Pick<Message, 'mode' | 'done' | 'error' | 'historyText' | 'proposals' | 'readOnly'>):
	Message['actions'][number] | undefined {
	if (message.readOnly || !message.done || !message.error || !message.historyText || !isPlanningStage(message.mode ?? '')
		|| message.proposals.some(proposal => ['open', 'kept'].includes(proposal.state))) { return; }
	const stage = message.mode!;
	try {
		const content = documentFromReply(message.historyText, stage === 'tree' ? 'tree.json' : `${stage}.md`);
		if (!content || planningDocumentKind(content) !== stage) { return; }
		if ((stage === 'architecture' || stage === 'requirements') && documentProblems(stage, content).length) { return; }
		return { label: `Review saved ${stage === 'tree' ? 'file tree' : stage}`, command: 'myEditor.reviewPlanningReply', args: [stage, message.historyText] };
	} catch { return; }
}

export function replyActions(message: Message | undefined): Message['actions'] {
	if (!message) { return []; }
	const recovery = savedPlanningAction(message);
	return recovery ? [...message.actions, recovery] : message.actions;
}
