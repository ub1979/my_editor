/** Commands a reply's buttons may run; anything else is ignored. */
const ALLOWED_ACTIONS = new Set(['myEditor.saveDecision', 'myEditor.adaptFile', 'myEditor.analyseProject', 'myEditor.aiReadyFix']);
const REASONING_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh'];

/** A reply button may run only one of the allowed commands. */
export function allowedAction(command: string): boolean {
	return ALLOWED_ACTIONS.has(command);
}

/** The reasoning efforts the model menu offers. */
export function isReasoningEffort(key: string | undefined): boolean {
	return REASONING_EFFORTS.includes(key ?? '');
}

/** Links in replies open in the browser only when they are web addresses. */
export function isWebLink(href: string | undefined): href is string {
	return !!href && /^https?:\/\//.test(href);
}
