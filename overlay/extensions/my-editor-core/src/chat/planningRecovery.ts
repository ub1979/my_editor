import { documentFromReply } from '../pair/codeBlock';

export const PLANNING_INCOMPLETE = 'The model stopped before producing the requested planning document. '
	+ 'No document is ready for Keep and your saved files are unchanged.';

/** Correct redundant permission requests, while allowing a genuine missing decision to reach the user. */
export function planningRecovery(message: string, target: string): string | undefined {
	const permission = /\b(?:say|reply|type|send|click|press)\s+(?:with\s+)?[\s*`"“'’]*(?:continue|go ahead|generate|yes)\b/i.test(message)
		|| /\b(?:shall|should|may|can) I\s+(?:now\s+)?(?:read|write|generate|prepare|finish|continue)\b[^?]*\?/i.test(message)
		|| /\b(?:would you like|do you want) me to\s+(?:read|write|generate|prepare|finish|continue)\b[^?]*\?/i.test(message);
	if (!permission) { return undefined; }
	try {
		const document = documentFromReply(message, target);
		if (document && (target.endsWith('.json') ? !!JSON.parse(document) : /^```/m.test(message))) { return undefined; }
	} catch { /* A partial response is not a completed proposal. */ }
	return `The user already authorized preparing ${target} in this request. Do not ask them to say continue or click Generate again. `
		+ 'The complete saved documents in the initial context remain available on every turn. Use those documents, '
		+ 'and only retrieve genuinely missing evidence with the remaining read-only tools. Finish the complete fenced document '
		+ 'in action=final for Keep now. Never omit saved entries to fit. If a critical user decision or a real tool/context limit '
		+ 'prevents completion, state that specific blocker concisely; another permission request does not resolve it.';
}
