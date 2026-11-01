import type { PlanningDocuments, PlanningStage } from '../project/planning';
import type { Turn } from './engineTypes';

const EDIT = '(?:fix|repair|change|edit|update|revise|rewrite|replace|regenerate|generate|write|produce|create|make|add|remove|delete|implement|apply|finali[sz]e|complete|restore|rebuild)';
const REQUEST = new RegExp(`(?:^|[.!?;:,]\\s*|\\b(?:and|then|but)\\s+)(?:(?:please|now|also|just)\\s+|(?:can|could|would|will)\\s+you\\s+|I(?:'d| would)\\s+like\\s+you\\s+to\\s+)*${EDIT}\\b`, 'i');
const NO_EDIT = /\b(?:do not|don't|don’t|without|never)\s+(?:chang(?:e|ing)|edit(?:ing)?|modif(?:y|ying)|rewrit(?:e|ing)|replac(?:e|ing)|fix(?:ing)?|updat(?:e|ing)|delet(?:e|ing))|\b(?:read[ -]only|report only|check only|no changes)\b/i;

/** Revision authority comes from this request, or a direct yes to the preceding concrete revision offer. */
export function requestsRevision(text: string, history: readonly Turn[] = []): boolean {
	const plain = text.replace(/^\/[\w:-]+\s*/, '').replace(/[`*_]/g, '').trim()
		.replace(/\bmake sure\b/gi, 'check')
		.replace(/\b(?:write|produce|prepare|generate|create|make)\s+(?:(?:me|a|an|the|only|short|detailed)\s+)*(?:report|review|assessment|summary|list|recommendations|findings|explanation|checklist)\b/gi, 'report');
	if (NO_EDIT.test(plain)) { return false; }
	if (REQUEST.test(plain) || /^(?:please\s+)?prepare\s+(?:(?:a|the|full|complete|saved)\s+)*(?:requirements|architecture|tree|document)\b/i.test(plain)) { return true; }
	if (!/^(?:yes(?:[,!\s]+(?:please|go ahead|do it))?|go ahead|do it|decide for me|approved)[.!\s]*$/i.test(plain)) { return false; }
	const previous = history.at(-1);
	return previous?.role === 'assistant' && /(?:(?:shall|should|may|can) I|would you like me to)\s+(?:apply|update|fix|revise|write|generate|prepare)\b[^?]*\?/i.test(previous.text);
}

export function inspectionRequest(text: string, history: readonly Turn[] = []): boolean {
	if (NO_EDIT.test(text)) { return true; }
	return !requestsRevision(text, history)
		&& /\b(?:check|review|inspect|audit|verify|validate|assess|analyse|analyze|explain|make sure|look over|what(?:'s| is) missing|anything missing)\b/i.test(text);
}

/** Existing documents are a baseline, not an invitation to generate another version on every turn. */
export function readOnlyRequest(text: string, stage: string, docs: PlanningDocuments, kickoff: boolean,
	history: readonly Turn[] = []): boolean {
	return kickoff || inspectionRequest(text, history)
		|| ['requirements', 'architecture', 'tree'].includes(stage)
			&& !!docs[stage as PlanningStage]?.trim() && !requestsRevision(text, history);
}

/** Generic coding turns cannot use a tool to redesign another agent's plan incidentally. */
export function mayRevisePlanningPath(path: unknown, text: string, history: readonly Turn[] = []): boolean {
	if (typeof path !== 'string') { return true; }
	const match = /^\.my_editor\/specs\/(requirements|architecture|tree)\.(?:md|json)$/i.exec(path.replaceAll('\\', '/').replace(/^\.\//, ''));
	return !match || requestsRevision(text, history) && new RegExp(`\\b${match[1]}\\b`, 'i').test(text);
}

export const READ_ONLY_REQUEST_NOTE = 'This request is a read-only check or discussion of the existing work. '
	+ 'This overrides any instruction above to finalize a planning document automatically. '
	+ 'Read the current saved files; report evidence-backed findings with paths, anchors or requirement IDs. '
	+ 'Do not return a replacement document, propose files, delete files or run commands. '
	+ 'Separate a demonstrated defect from an optional improvement. Do not call a document incomplete because you prefer a different design.';

/** Creating already planned files should consume the saved tree, never ask a model to redesign it. */
export function requestsPlannedFiles(text: string): boolean {
	return /^(?:please\s+)?(?:make|create|scaffold)\s+(?:(?:all|the|missing|planned|project)\s+)*files(?:\s+(?:now|from (?:the )?(?:saved )?(?:file )?tree(?:\.json)?))*[.!\s]*$/i.test(text.trim());
}
