import type { Turn } from './engineTypes';
import { questionChoices } from './replyChoices';

const ACTION = '(?:apply|update|fix|repair|revise|rewrite|write|generate|prepare|add|remove|replace|implement|create|finali[sz]e)';
const OFFER = new RegExp(`(?:(?:shall|should|may|can) I|would you like me to|do you want me to|ask me to)\\s+(?:now\\s+)?${ACTION}\\b`, 'i');
const REQUEST_TO_SEND = new RegExp(`\\b(?:send|use|type|reply with)\\s+(?:this|the following)\\s+(?:message|request|command)\\s*:\\s*(?:/[\\w:-]+\\s+)?${ACTION}\\b`, 'i');
const SUGGESTION = new RegExp(`(?:^|[:—–]\\s*|\\b(?:I['’]d|I would|I['’]ll|I will|we can|we could|let['’]s)\\s+)${ACTION}\\b`, 'i');
const ACKNOWLEDGEMENT = /^(?:(?:yes|yeah|yep|ok(?:ay)?|sure|approved)[,!\s]*)?(?:(?:please[,!\s]*)?(?:go ahead|do it|continue|proceed|decide for me)[,!\s]*)?(?:please)?[.!\s]*$/i;

function normalized(text: string): string {
	return text.replace(/[`*_]/g, '').replace(/[’‘]/g, "'").replace(/[:.!?,]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** A follow-up accepts the immediately preceding concrete edit offer, not unrelated older work. */
export function approvesRevision(text: string, history: readonly Turn[]): boolean {
	const previous = history.at(-1);
	if (previous?.role !== 'assistant') { return false; }
	const choices = questionChoices(previous.text).choices;
	const selected = choices.find(choice => normalized(text) === normalized(choice.text)
		|| normalized(text) === normalized(choice.label));
	if (selected) { return SUGGESTION.test(selected.text); }
	const offer = previous.text.replace(/[`*_]/g, '');
	return !!text.trim() && ACKNOWLEDGEMENT.test(text) && (OFFER.test(offer) || REQUEST_TO_SEND.test(offer));
}
