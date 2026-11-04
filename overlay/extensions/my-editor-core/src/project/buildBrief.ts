import type { BuildGuideState } from './buildStore';
import type { StepState } from './buildProgress';
import { canImplement, isCodingFile, needsImplementation } from './buildWork';

export interface BuildFileBrief {
	title: string; position: string; purpose: string; instruction: string;
	tasks: string[]; checks: string[]; files: string[]; next?: string; blocked: boolean;
}

/** Resume an unfinished file without treating existing code as verified work. */
export function firstBuildFile(guide: BuildGuideState, step: StepState): string {
	return step.step.files.find(path => guide.snapshots.get(path)?.dirty)
		?? step.step.files.find(path => isCodingFile(path) && needsImplementation(guide, path))
		?? step.step.files.find(path => !guide.snapshots.get(path)?.hash || guide.snapshots.get(path)?.stub)
		?? step.step.files[0];
}

/** Orientation comes from the saved plan, so opening Build needs no model request. */
export function buildFileBrief(guide: BuildGuideState, path: string): BuildFileBrief | undefined {
	if (guide.problems.length) { return; }
	const file = guide.files.find(file => file.path === path);
	const index = guide.steps.findIndex(state => state.step.files.includes(path));
	if (!file || index < 0) { return; }
	const { step, status } = guide.steps[index];
	const blocked = !canImplement(guide, guide.steps[index]);
	const at = step.files.indexOf(path);
	const unfinished = !guide.snapshots.get(path)?.hash || guide.snapshots.get(path)?.stub;
	const setup = /(?:^|\/)(?:package\.json|[^/]*config[^/]*|pnpm-workspace\.yaml)$/.test(path);
	return {
		title: `Step ${index + 1} of ${guide.steps.length}: ${step.title}`,
		position: `File ${at + 1} of ${step.files.length} in this step`, purpose: file.role || 'No file purpose is recorded in the saved tree.',
		instruction: blocked ? 'Prerequisite implementation is still missing. Build whole project can prepare the setup and dependencies for you.'
			: status === 'verified' ? 'You confirmed this step’s checks for the current files.'
				: unfinished ? `${setup ? 'Set up this configuration before the code that uses it. ' : ''}Start with the purpose above. Choose “Help me start” for a small first action, or “Prepare this file” for a complete change to review.`
					: 'This file already has content. Review it against the saved tasks before adding more. Existing content does not mean its checks passed.',
		tasks: step.tasks, checks: step.checks, files: step.files, next: step.files[at + 1], blocked,
	};
}
