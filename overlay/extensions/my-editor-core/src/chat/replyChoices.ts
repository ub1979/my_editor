import MarkdownIt from 'markdown-it';
import { planningIntent } from './planningIntent';
import type { Message } from './presentation';
import type { PlanningStage } from '../project/planning';
import type { ChatState } from './chatState';
import { savedPlanningAction } from './replyActions';

export interface ReplyChoice { label: string; description?: string; text: string; mode?: PlanningStage }
const markdown = new MarkdownIt({ html: false });
const STAGES = new Set(['requirements', 'architecture', 'tree']);

function plain(text: string): string {
	return (markdown.parseInline(text, {})[0]?.children ?? []).map(token => token.type === 'softbreak' ? ' ' : token.content).join('').trim();
}

/** Read the final question's Markdown list, without turning reports or code samples into actions. */
export function questionChoices(text: string): { markdown: string; choices: ReplyChoice[] } {
	const lines = text.split('\n');
	const groups: { start: number; end: number; items: string[] }[] = [];
	let fenced = false;
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*(```|~~~)/.test(lines[i])) { fenced = !fenced; continue; }
		if (fenced || !/^(?:[-*+] |\d+[.)] )/.test(lines[i])) { continue; }
		const start = i;
		const items: string[] = [];
		while (i < lines.length) {
			const item = /^(?:[-*+] |\d+[.)] )(.+)$/.exec(lines[i]);
			if (item) { items.push(item[1]); }
			else if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += ` ${lines[i].trim()}`; }
			else if (lines[i].trim()) { break; }
			i++;
		}
		groups.push({ start, end: i, items });
		i--;
	}
	for (const group of groups.reverse()) {
		const before = lines.slice(0, group.start).join('\n');
		const after = lines.slice(group.end).join('\n');
		const lead = before.trim().split(/\n\s*\n/).at(-1) ?? '';
		if (group.items.length < 2 || group.items.length > 6 || after.trim().length > 200
			|| !/[?？]|\b(?:choose|choices|options|suggested answers)\b/i.test(`${lead}\n${after}`)) { continue; }
		const choices = group.items.map(item => {
			const strong = /^\*\*(.+?)\*\*\s*[:—–-]?\s*([\s\S]*)$/.exec(item);
			const full = plain(item);
			const label = strong ? plain(strong[1]).replace(/:$/, '') : full;
			return { label, description: strong ? plain(strong[2]) || undefined : undefined, text: full };
		}).filter(choice => choice.label.length > 0 && choice.label.length <= 160 && choice.text.length <= 1200);
		if (choices.length !== group.items.length) { continue; }
		return { markdown: `${before.trimEnd()}\n\n${after.trimStart()}`.trim(), choices };
	}
	return { markdown: text, choices: [] };
}

export function finalizeChoice(stage: PlanningStage): ReplyChoice {
	const label = stage === 'tree' ? 'Generate the complete file tree' : `Finalize ${stage}`;
	return { label, mode: stage, text: `Write the complete ${stage === 'tree' ? 'file tree JSON' : `${stage} document`} now, using our agreed decisions. `
		+ 'Use the saved requirements and architecture as evidence. Resolve delegated choices with explicit assumptions, '
		+ 'ask only if a critical decision is missing, and propose the full document for Keep. Do not save a decisions summary or promise to write it later.' };
}

/** Keep the original reply for history; expose reviewed answer text, never model-supplied commands. */
export function replyChoices(message: Pick<Message, 'role' | 'done' | 'markdown' | 'mode' | 'error' | 'proposals' | 'planningStatus' | 'historyText' | 'readOnly'>):
	{ markdown: string; choices: ReplyChoice[] } {
	if (message.role !== 'assistant' || !message.done) { return { markdown: message.markdown, choices: [] }; }
	if (savedPlanningAction(message)) { return { markdown: message.markdown, choices: [] }; }
	if (message.planningStatus) {
		const next = message.planningStatus.next;
		const choice = next ? finalizeChoice(next) : undefined;
		if (choice && message.planningStatus.complete) {
			choice.label = `Continue to ${next === 'tree' ? 'Flow & tree' : next === 'architecture' ? 'Architecture' : 'Requirements'}`;
		}
		return { markdown: message.markdown, choices: choice ? [choice] : [] };
	}
	const result = questionChoices(message.markdown);
	for (const choice of result.choices) {
		choice.mode = planningIntent(choice.text);
	}
	if (!message.readOnly && message.mode && STAGES.has(message.mode) && !message.proposals.some(proposal => proposal.state === 'open' || proposal.state === 'kept')) {
		const repair = /Finalize (requirements|architecture|tree) before continuing/.exec(message.error ?? '')?.[1]
			?? /Use \/(requirements|architecture|tree)\b/.exec(message.error ?? '')?.[1];
		const stage = (repair ?? message.mode) as PlanningStage;
		if (!result.choices.some(choice => choice.mode === stage)) { result.choices.push(finalizeChoice(stage)); }
	}
	return result;
}

/** Only the newest finished question can be answered, including after reopening a saved chat. */
export function selectedReplyChoice(messages: readonly Message[], id: string, index: number): ReplyChoice | undefined {
	const last = messages.at(-1);
	if (!last || last.id !== id || last.error && !STAGES.has(last.mode ?? '') || !Number.isInteger(index)) { return; }
	return replyChoices(last).choices[index];
}

export async function answerReplyChoice(state: ChatState, id: string, index: number, running: boolean,
	send: (text: string) => Promise<void>): Promise<void> {
	if (running) { return; }
	const choice = selectedReplyChoice(state.messages, id, index);
	if (!choice) { return; }
	if (choice.mode) { state.mode = choice.mode; state.pinned = false; }
	await send(choice.text);
}
