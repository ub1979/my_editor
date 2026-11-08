import type { ProjectState } from '../project/state';
import type { CharacterId } from './characters';

export interface CharacterRoute {
	readonly id: CharacterId;
	readonly reason?: string;
	readonly locateOnly: boolean;
}

const MODE_ROLES: Record<string, CharacterId> = {
	"researcher": "researcher", "spec": "spec", "proj-manager": "proj-manager", "oop-restructurer": "oop-restructurer", "ux-writer": "ux-writer", "a11y-auditor": "a11y-auditor", "security-auditor": "security-auditor", "devops-engineer": "devops-engineer", "benchmark": "benchmark", "tech-writer": "tech-writer", "health": "health", "context-save": "context-save", "learn": "learn",
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
		[/\b(research sources|compare vendors|technical research)\b/i, 'researcher', 'Working on researcher'],
		[/\b(write a spec|spec this|technical specification)\b/i, 'spec', 'Working on spec'],
		[/\b(sprint planning|milestones|project planning|backlog)\b/i, 'proj-manager', 'Working on proj-manager'],
		[/\b(restructure|refactor to classes|modularize)\b/i, 'oop-restructurer', 'Working on oop-restructurer'],
		[/\b(microcopy|ux writing|button labels)\b/i, 'ux-writer', 'Working on ux-writer'],
		[/\b(accessibility audit|a11y|screen reader|keyboard navigation)\b/i, 'a11y-auditor', 'Working on a11y-auditor'],
		[/\b(security audit|threat model|security review)\b/i, 'security-auditor', 'Working on security-auditor'],
		[/\b(deployment|rollback|ci\/cd|devops)\b/i, 'devops-engineer', 'Working on devops-engineer'],
		[/\b(benchmark|core web vitals|performance test)\b/i, 'benchmark', 'Working on benchmark'],
		[/\b(write docs|documentation|readme|user guide)\b/i, 'tech-writer', 'Working on tech-writer'],
		[/\b(project health|code health|health report)\b/i, 'health', 'Working on health'],
		[/\b(save project context|project memory|handoff notes)\b/i, 'context-save', 'Working on context-save'],
		[/\b(lesson learned|record this pattern|controlled learning)\b/i, 'learn', 'Working on learn'],
		[/\b(ui\/?ux|user interface|visual design|stylesheet|typography|responsive layout|design tokens|accessibility audit|redesign)\b/i, 'iris', 'Designing the interface'],
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
	if (stage('requirements') === 'started' || stage('requirements') === 'empty' && !project.memory.brain) { return 'soki'; }
	if (stage('requirements') === 'done' && stage('architecture') !== 'done') { return 'lisko'; }
	if (stage('architecture') === 'done' && stage('tree') !== 'done') { return 'flow'; }
	if (stage('build') === 'started') { return 'ada'; }
	if (stage('build') === 'done' && stage('qa') === 'empty') { return 'poppy'; }
	return 'bamboo';
}
