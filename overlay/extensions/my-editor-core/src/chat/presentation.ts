import MarkdownIt from 'markdown-it';
import type { Proposal } from './proposals';
import { planningNextStep, replyChoices } from './replyChoices';
import type { PlanningStatus } from './planningStart';
import { replyActions } from './replyActions';

export interface ProposalCard {
	readonly id: string;
	readonly file: string;
	readonly added: number;
	readonly removed: number;
	readonly isNewFile: boolean;
	operation?: 'write' | 'delete';
	planningDraft?: boolean;
	state: Proposal['state'] | 'expired';
}

export interface Message {
	readonly id: string;
	readonly role: 'user' | 'assistant';
	characterId?: string;
	markdown: string;
	/** Full model reply, including reviewed document content hidden from the chat presentation. */
	historyText?: string;
	/** Host-validated saved stage state, used to offer the correct continuation instead of regeneration. */
	planningStatus?: PlanningStatus;
	mode?: string;
	progress?: string;
	error?: string;
	errorAction?: 'chooseModel';
	readOnly?: boolean;
	proposals: ProposalCard[];
	actions: { label: string; command: string; args: unknown[] }[];
	done: boolean;
}

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });
const LABELS: Record<string, string> = {
	requirements: 'Requirements', architecture: 'Architecture', tree: 'Flow & tree', brainstorm: 'Brainstorm',
	next: 'Next step', feature: 'Add a feature', change: 'Change selection', explain: 'Explain', why: 'Why is it like this?',
	review: 'Review', qa: 'Fit check', file: 'Write the file', impact: 'Impact', changes: 'Change history', locate: 'Find a change',
};

export function labelFor(mode: string | undefined): string {
	if (!mode) { return ''; }
	if (mode.startsWith('skill:')) {
		const name = mode.slice(6);
		return name[0].toUpperCase() + name.slice(1);
	}
	return LABELS[mode] ?? mode;
}

/** Raw HTML is disabled so model replies cannot inject markup into the webview. */
export function render(message: Message) {
	const reply = replyChoices(message);
	return {
		id: message.id,
		role: message.role,
		characterId: message.characterId,
		html: reply.markdown ? markdown.render(reply.markdown) : '',
		choices: reply.choices.map(choice => ({ label: choice.label, description: choice.description })),
		nextStep: planningNextStep(message),
		label: message.role === 'user' && message.mode ? labelFor(message.mode) : undefined,
		progress: message.progress,
		error: message.error,
		errorAction: message.errorAction,
		proposals: message.proposals,
		actions: replyActions(message).map(action => action.label),
		done: message.done,
	};
}
