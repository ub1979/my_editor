import type { ProjectState } from '../project/state';
import type { CharacterId } from './characters';

export interface CharacterRoute {
	readonly id: CharacterId;
	readonly reason?: string;
	readonly locateOnly: boolean;
}

const MODE_ROLES: Record<string, CharacterId> = {
	requirements: 'soki', brainstorm: 'soki', architecture: 'lisko', tree: 'flow',
	feature: 'ada', change: 'ada', file: 'ada', next: 'ada', 'skill:refactor': 'lisko',
	review: 'diji', qa: 'poppy', 'skill:tests': 'poppy', 'skill:debug': 'hopper',
	impact: 'bamboo', changes: 'bamboo', locate: 'bamboo',
};

/** A change-location request maps the project before any code proposal is allowed. */
export function wantsChangeMap(text: string, mode?: string): boolean {
	if (mode === 'locate' || /^\/(?:locate|findchange)\b/i.test(text)) { return true; }
	if (mode && !['chat', 'locate'].includes(mode)) { return false; }
	return /\bwhere\s+(?:do|can|should|would)\s+(?:i|we)\s+(?:change|modify|update|adjust|find|add|remove)\b/i.test(text)
		|| /\b(?:where\s+is|find\s+(?:the\s+)?(?:code|files?|place|function)\s+(?:for|that|which))\b/i.test(text);
}

/** A manual pin keeps its voice; otherwise the selected skill wins over task wording and project stage. */
export function routeCharacter(text: string, mode: string | undefined, current: CharacterId, pinned: boolean): CharacterRoute {
	const locateOnly = wantsChangeMap(text, mode);
	if (pinned) { return { id: current, locateOnly }; }
	const slash = /^\/([\w:-]+)/.exec(text.trim())?.[1];
	const chosenMode = slash ?? mode;
	const fromMode = chosenMode ? MODE_ROLES[chosenMode] : undefined;
	if (fromMode) { return { id: fromMode, reason: `Working on ${chosenMode?.replace(/^skill:/, '')}`, locateOnly }; }
	if (locateOnly) { return { id: 'bamboo', reason: 'Finding the change', locateOnly }; }
	const intent: [RegExp, CharacterId, string][] = [
		[/\b(requirements?|acceptance criteria|what should (?:it|this) do)\b/i, 'soki', 'Working out requirements'],
		[/\b(flow|file tree|plan the files)\b/i, 'flow', 'Planning the flow and files'],
		[/\b(architecture|design|module boundaries)\b/i, 'lisko', 'Planning the design'],
		[/\b(review|code quality|spot mistakes|check this code)\b/i, 'diji', 'Reviewing code'],
		[/\b(test|qa|edge cases?|verification)\b/i, 'poppy', 'Checking quality'],
		[/\b(debug|error|crash(?:es|ed|ing)?|bug|slow|performance|why (?:does|is) .* fail)\b/i, 'hopper', 'Tracing the cause'],
		[/\b(build|implement|write|code|add a feature|fix this)\b/i, 'ada', 'Building together'],
	];
	const match = intent.find(([pattern]) => pattern.test(text));
	return match ? { id: match[1], reason: match[2], locateOnly } : { id: current, locateOnly };
}

/** Starting point when a different project opens. Task wording can still route the next turn. */
export function projectCharacter(project: ProjectState): CharacterId {
	if (!project.hasWorkspace) { return 'bamboo'; }
	const stage = (id: string) => project.stages.find(item => item.id === id)?.state;
	if (stage('requirements') === 'empty' && !project.memory.brain) { return 'soki'; }
	if (stage('requirements') === 'done' && stage('architecture') === 'empty') { return 'lisko'; }
	if (stage('architecture') === 'done' && stage('tree') === 'empty') { return 'flow'; }
	if (stage('build') === 'started') { return 'ada'; }
	if (stage('build') === 'done' && stage('qa') === 'empty') { return 'poppy'; }
	return 'bamboo';
}
