import { documentFromReply } from '../pair/codeBlock';
import { planningError, type PlanningDocuments, type PlanningStage } from '../project/planning';

export const PLANNING_INCOMPLETE = 'The model did not produce a complete, valid planning document. '
	+ 'No document is ready for Keep and your saved files are unchanged.';

/** Correct redundant permission requests, while allowing a genuine missing decision to reach the user. */
export function planningRecovery(message: string, target: string, docs?: PlanningDocuments, authorized = true): string | undefined {
	if (docs) {
		try {
			const content = documentFromReply(message, target);
			const stage = /(?:^|\/)(requirements|architecture|tree)\.(?:md|json)$/.exec(target)?.[1] as PlanningStage | undefined;
			const error = content && stage ? planningError(stage, docs, content, 100) : undefined;
			if (error) {
				return `Your proposed document failed host validation: ${error}\n`
					+ 'Correct the listed defects in the proposed document now, preserving valid sections, IDs, anchors and agreed decisions. '
					+ 'For each component include its actual requirement IDs and concrete input/output signatures. '
					+ 'Do not invent requirements or interfaces merely to pass validation. If evidence is missing, retrieve it or explain the specific blocker. '
					+ 'Return action=final with the complete corrected fenced document for Keep. Do not change prerequisite documents or claim it is saved.';
			}
		} catch (error) {
			if (authorized) {
				return `The proposed document could not be read: ${error instanceof Error ? error.message : String(error)} `
					+ 'Return the COMPLETE corrected document in one properly closed outer fence. Use four backticks if the document contains fenced examples. '
					+ 'Preserve the agreed content and do not claim it is saved. If the complete document cannot fit, report that limit instead of returning a partial document.';
			}
		}
	}
	if (!authorized) { return undefined; }
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
