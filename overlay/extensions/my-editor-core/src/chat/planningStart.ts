import { planningProblems, PlanningDocuments, PlanningStage } from '../project/planning';

const STAGES: PlanningStage[] = ['requirements', 'architecture', 'tree'];
const LABELS = { requirements: 'Requirements', architecture: 'Architecture', tree: 'Flow & tree' };
export interface PlanningStatus {
	readonly complete: boolean;
	readonly next?: PlanningStage;
}

export function isPlanningStage(stage: string): stage is PlanningStage {
	return STAGES.includes(stage as PlanningStage);
}

/** Opening a completed stage reports saved state; it never resumes an old generation request. */
export function planningStart(stage: PlanningStage, docs: PlanningDocuments):
	{ reply: string; status: PlanningStatus } | undefined {
	const problems = planningProblems(stage, docs);
	const prerequisite = problems.find(problem => problem.stage !== stage);
	if (prerequisite) {
		return { reply: `Before continuing ${LABELS[stage]}, finish and Keep ${LABELS[prerequisite.stage]}. `
			+ `The saved document needs attention: ${prerequisite.reason}.`, status: { complete: false, next: prerequisite.stage } };
	}
	if (problems.length) { return; }
	const next = STAGES.slice(STAGES.indexOf(stage) + 1).find(candidate => planningProblems(candidate, docs).length);
	return { reply: `Your saved ${stage === 'tree' ? 'file tree is' : `${stage} ${stage === 'requirements' ? 'are' : 'is'}`} complete. `
		+ 'Tell me what you want to change'
		+ (next ? `, or continue to ${LABELS[next]}.` : '. The saved planning documents are ready.'),
		status: { complete: true, next } };
}

/** Name the exact active document so stale conversation requests cannot choose its replacement. */
export function planningKickoffPrompt(stage: string, document: string): string {
	return `The user opened the ${stage} skill. The only document this turn may propose is ${document}. `
		+ 'Earlier requests for other planning documents are historical context, not a new instruction to generate them. '
		+ 'Continue this document from its saved draft and agreed decisions. Check completeness first. '
		+ 'If enough is known, prepare its complete content for Keep; otherwise ask only the next essential question. '
		+ 'Do not restart an existing interview or generate a different document.';
}
