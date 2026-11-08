import type { Mode } from '../pair/prompts';

const objectives: Record<string, string> = {
	requirements: 'Review the supplied brief and existing behavior for contradictions, missing failure cases and testable acceptance criteria. '
		+ 'Separate observed requirements from assumptions. For each gap, identify an observable outcome and how it could be tested. Vague words such as fast or secure are not measurable acceptance criteria.',
	architecture: 'Review the existing repository or supplied design independently of the project-generation pipeline. '
		+ 'Trace real component boundaries, consumed and produced contracts, data ownership and runtime dependencies. Compare alternatives only where a demonstrated problem warrants them.',
	tree: 'Review or outline a plan for the requested function, file, module or project using the available brief and current code. '
		+ 'Identify dependency order, owned deliverables, contract changes and executable checks for each task. Distinguish code review from executed verification.',
};

/** Standalone inspection must not require generating a complete project specification first. */
export function specialistReview(mode: Mode, readOnly: boolean, kickoff: boolean): Mode {
	if (!readOnly || kickoff || !objectives[mode.id]) { return mode; }
	return { ...mode, writes: 'none', doc: undefined, instruction: objectives[mode.id]
		+ ' Read current source and relevant saved decisions before reporting findings. Missing planning documents are an evidence limit, not a prerequisite to this inspection. '
		+ 'Keep this request read-only. Report confirmed findings with file references, unresolved assumptions and checks not executed. Do not claim correctness from document structure alone.' };
}
