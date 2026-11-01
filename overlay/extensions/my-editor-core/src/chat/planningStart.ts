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
	if (problems.length) {
		if (!docs[stage]?.trim()) { return; }
		return { reply: `Your saved ${stage === 'tree' ? 'file tree' : stage} is open. No revision has been requested. `
			+ `The saved-file check reports: ${problems.map(problem => problem.reason).join('; ')}. `
			+ 'These checks do not authorize replacing the document. Tell me what you want to review or revise.', status: { complete: false } };
	}
	const next = STAGES.slice(STAGES.indexOf(stage) + 1).find(candidate => planningProblems(candidate, docs).length);
	return { reply: `Your saved ${stage === 'tree' ? 'file tree is' : `${stage} ${stage === 'requirements' ? 'are' : 'is'}`} complete. `
		+ 'Tell me what you want to change'
		+ (next ? `, or continue to ${LABELS[next]}.` : '. The saved planning documents are ready.'),
		status: { complete: true, next } };
}

/** Name the exact active document so stale conversation requests cannot choose its replacement. */
export function planningKickoffPrompt(stage: string, document: string): string {
	return `The user opened the ${stage} skill for ${document}. Opening a skill does not request a replacement document. `
		+ 'Earlier requests for other planning documents are historical context, not a new instruction to generate them. '
		+ 'Read the saved draft and agreed decisions, then explain the current state or ask the next essential question. '
		+ 'Do not generate a document merely because the skill was opened. '
		+ 'Do not restart an existing interview or generate a different document.';
}
