import MarkdownIt from 'markdown-it';
import type { Proposal } from './proposals';

export interface ProposalCard {
	readonly id: string;
	readonly file: string;
	readonly added: number;
	readonly removed: number;
	readonly isNewFile: boolean;
	state: Proposal['state'] | 'expired';
}

export interface Message {
	readonly id: string;
	readonly role: 'user' | 'assistant';
	markdown: string;
	mode?: string;
	progress?: string;
	error?: string;
	proposals: ProposalCard[];
	actions: { label: string; command: string; args: unknown[] }[];
	done: boolean;
}

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });
const LABELS: Record<string, string> = {
	requirements: 'Requirements', architecture: 'Architecture', tree: 'Plan the files', brainstorm: 'Brainstorm',
	next: 'Next step', feature: 'Add a feature', change: 'Change selection', explain: 'Explain', why: 'Why is it like this?',
	review: 'Review', qa: 'Fit check', file: 'Write the file', impact: 'Impact', changes: 'Change history',
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
	return {
		id: message.id,
		role: message.role,
		html: message.markdown ? markdown.render(message.markdown) : '',
		label: message.role === 'user' && message.mode ? labelFor(message.mode) : undefined,
		progress: message.progress,
		error: message.error,
		proposals: message.proposals,
		actions: message.actions.map(action => action.label),
		done: message.done,
	};
}
