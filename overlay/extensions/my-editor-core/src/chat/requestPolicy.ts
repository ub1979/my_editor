import type { PlanningDocuments, PlanningStage } from '../project/planning';
import type { Turn } from './engineTypes';
import { approvesRevision } from './revisionApproval';

const EDIT = '(?:fix|repair|patch|change|edit|update|revise|rewrite|replace|regenerate|generate|write|produce|create|make|add|remove|delete|implement|apply|finali[sz]e|complete|restore|rebuild)';
const REQUEST = new RegExp(`(?:^|[.!?;:,]\\s*|\\b(?:and|then|but)\\s+)(?:(?:please|now|also|just)\\s+|(?:can|could|would|will)\\s+you\\s+|I(?:'d| would)\\s+like\\s+you\\s+to\\s+)*${EDIT}\\b`, 'i');
const NO_EDIT = /\b(?:do not|don't|don’t|without|never)\s+(?:chang(?:e|ing)|patch(?:ing)?|edit(?:ing)?|modif(?:y|ying)|rewrit(?:e|ing)|replac(?:e|ing)|fix(?:ing)?|updat(?:e|ing)|delet(?:e|ing))|\b(?:read[ -]only|report only|check only|no changes)\b/i;

/** A named-file repair can exclude other files without turning the whole turn into an audit. */
function revisionScope(text: string): string {
	text = text.replace(/\bcontinue\s+(implementing|repairing|fixing|editing|updating)\b/gi,
		(_, verb: string) => ({ implementing: 'implement', repairing: 'repair', fixing: 'fix', editing: 'edit', updating: 'update' }[verb.toLowerCase()]!));
	if (REQUEST.test(text)) {
		// Narrow preservation constraints are not global edit prohibitions. Ambiguity still fails closed.
		text = text.replace(/\b(?:do not|don't|don’t|never)\s+(?:change|modify|weaken|bypass)\s+(?:the\s+)?(?:source[- ]size (?:policy|limit)|existing permissions|Keep\/Undo|public (?:API|contracts?|behavior)|existing (?:handlers|semantics|functionality))(?:\s+or\s+(?:dependencies|permissions))?(?=[.;!\n]|$)/gi, 'Preserve that invariant');
		text = text.replace(/\bread-only\s+(?:inspection|evidence)\s+(?:verified|confirmed|showed)\b/gi, 'Inspection evidence confirmed');
	}

	// "Read only this file" limits retrieval in an explicit repair; "read-only" still forbids edits.
	if (REQUEST.test(text)) {
		text = text.replace(/\bread only\s+(?=(?:(?:the|this|that|these|those|current|following|selected|test|source|two|three|\d+)\s+)*files?\b|[\w./-]+\.(?:ts|tsx|js|jsx|json|md|py|go|css|html|yaml|yml)\b)/gi, 'Read ');
	}
	const negative = /\b(?:do not|don't|don’t|without|never)\s+(?:chang(?:e|ing)|patch(?:ing)?|edit(?:ing)?|modif(?:y|ying)|rewrit(?:e|ing)|replac(?:e|ing)|fix(?:ing)?|updat(?:e|ing)|delet(?:e|ing))\s+([^!?;\n]*?)(?=\.(?:\s|$)|[!?;\n]|$)/gi;
	const fileNames = (value: string): string[] => value.match(/[\w./-]+\.(?:ts|tsx|js|jsx|json|md|py|go|css|html|yaml|yml)\b/gi) ?? [];
	const firstNegative = text.search(negative);
	const affirmative = firstNegative < 0 ? text : text.slice(0, firstNegative);
	const targets = fileNames(affirmative);
	if (!REQUEST.test(affirmative) || !targets.length) { return text; }
	return text.replace(negative, (clause, object: string) => {
		const excluded = fileNames(object);
		// Ambiguous/global prohibitions and conflicting instructions stay read-only.
		const remainder = object.replace(/[\w./-]+\.(?:ts|tsx|js|jsx|json|md|py|go|css|html|yaml|yml)\b/gi, '')
			.replace(/\b(?:the|production|source|code|files?|or|and|any other)\b/gi, '').replace(/[,\s]/g, '');
		if (remainder || !excluded.length || excluded.some(path => targets.some(target =>
			target === path || target.endsWith('/' + path) || path.endsWith('/' + target)))) { return clause; }
		return '';
	});
}

/** Revision authority comes from this request, or a direct yes to the preceding concrete revision offer. */
export function requestsRevision(text: string, history: readonly Turn[] = []): boolean {
	const plain = revisionScope(text.replace(/^\/[\w:-]+\s*/, '').replace(/[`*_]/g, '').trim())
		.replace(/\bmake sure\b/gi, 'check')
		.replace(/\b(?:write|produce|prepare|generate|create|make)\s+(?:(?:me|a|an|the|only|short|detailed)\s+)*(?:report|review|assessment|summary|list|recommendations|findings|explanation|checklist)\b/gi, 'report');
	if (NO_EDIT.test(plain)) { return false; }
	if (REQUEST.test(plain) || /^(?:please\s+)?prepare\s+(?:(?:a|the|full|complete|saved)\s+)*(?:requirements|architecture|tree|document)\b/i.test(plain)) { return true; }
	return approvesRevision(plain, history);
}

export function inspectionRequest(text: string, history: readonly Turn[] = []): boolean {
	if (NO_EDIT.test(revisionScope(text.replace(/[`*_]/g, '')))) { return true; }
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
	return !match || requestsRevision(text, history) && new RegExp(`\\b${match[1]}\\b`, 'i').test(revisionScope(text.replace(/[`*_]/g, '')));
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
