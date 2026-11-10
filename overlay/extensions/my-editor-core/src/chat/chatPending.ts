/** A request made before any chat webview was open; it runs when the first one says it is ready. */
export interface PendingRequest {
	readonly text: string;
	readonly mode?: string;
	readonly kickoff?: boolean;
	readonly planningDraft?: string;
}

/** What a pending request starts once the chat is ready. */
export type PendingStart =
	| { readonly kind: 'analyse'; readonly aiReady: boolean }
	| { readonly kind: 'skill'; readonly id: string }
	| { readonly kind: 'send'; readonly text: string; readonly planningDraft?: string };

/** Stand in for a skill id while the analysis waits for the chat to open. */
const ANALYSE = '#analyse';
const AI_READY = '#ai-ready';

/** An analysis (or, with `aiReady`, an AI-readiness check) to run once the chat opens. */
export function pendingAnalysis(aiReady: boolean): PendingRequest {
	return { text: '', mode: aiReady ? AI_READY : ANALYSE };
}

/** An analysis marker wins, then a skill kickoff, then plain text. */
export function pendingStart(pending: PendingRequest): PendingStart {
	if (pending.mode === ANALYSE || pending.mode === AI_READY) {
		return { kind: 'analyse', aiReady: pending.mode === AI_READY };
	}
	if (pending.kickoff && pending.mode) {
		return { kind: 'skill', id: pending.mode };
	}
	return { kind: 'send', text: pending.text, ...(pending.planningDraft ? { planningDraft: pending.planningDraft } : {}) };
}
