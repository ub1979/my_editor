import type { BuildGuideState } from './buildStore';
import type { StepState } from './buildProgress';
import { digest } from './buildProgress';

export function needsImplementation(guide: BuildGuideState, path: string): boolean {
	const snapshot = guide.snapshots.get(path);
	return !snapshot?.hash || !!snapshot.stub;
}

/** Coding can proceed from saved prerequisite code; verification remains a separate recorded fact. */
export function canImplement(guide: BuildGuideState, state: StepState, seen = new Set<string>()): boolean {
	if (seen.has(state.step.id)) { return false; }
	const visited = new Set(seen).add(state.step.id);
	return state.step.dependsOn.every(id => {
		const dependency = guide.steps.find(item => item.step.id === id);
		return !!dependency && canImplement(guide, dependency, visited)
			&& dependency.step.files.every(path => !needsImplementation(guide, path) && !guide.snapshots.get(path)?.dirty);
	});
}

export function nextImplementation(guide: BuildGuideState): StepState | undefined {
	return guide.steps.find(state => canImplement(guide, state)
		&& state.step.files.some(path => needsImplementation(guide, path) || guide.snapshots.get(path)?.dirty));
}

export function isCodingFile(path: string): boolean {
	return /\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|c|cpp|h|cs|rb|php|sql)$/i.test(path)
		&& !/(?:^|\/)(?:[^/]*config[^/]*|vitest\.shared)\.[^/]+$/i.test(path);
}

export function buildPlanIdentity(guide: BuildGuideState): string {
	return digest(JSON.stringify({ plan: guide.plan, files: guide.files.map(({ status, ...file }) => file) }));
}

/** An explicit request for the whole implementation, not a question, review or planning rewrite. */
export function wantsProjectBuild(text: string): boolean {
	const plain = text.replace(/^\/chat\s+/i, '').trim();
	return /^(?:(?:ok(?:ay)?|yes|please|now|just)[,\s]+)*(?:code|build|implement|write)\s+(?:all(?:\s+(?:the|remaining))?\s+(?:code|files)|everything|(?:the\s+)?(?:whole|entire)\s+(?:project|app|application|software))(?:\s+(?:for me|now|please))*[.!\s]*$/i.test(plain);
}
