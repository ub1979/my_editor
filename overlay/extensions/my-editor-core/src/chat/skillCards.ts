import * as vscode from 'vscode';
import { loadSkills } from '../skills/loader';

/**
 * How a card starts: `kickoff` lets the skill speak first; `run` works on the open file at once;
 * `compose` waits for the user to say what they want.
 */
export interface SkillCard {
	readonly id: string;
	readonly title: string;
	readonly blurb: string;
	readonly group: 'Plan' | 'Build' | 'Fix' | 'Your skills';
	readonly icon: string;
	readonly start: 'kickoff' | 'run' | 'compose';
	readonly placeholder?: string;
	readonly needsFile?: boolean;
}

const BUILT_IN: SkillCard[] = [
	{ id: 'analyse', title: 'Analyse this project', blurb: 'Read the code and build the project brain', group: 'Plan', icon: 'book', start: 'run' },
	{ id: 'requirements', title: 'Requirements', blurb: 'Work out what to build, one question at a time', group: 'Plan', icon: 'list', start: 'kickoff' },
	{ id: 'architecture', title: 'Architecture', blurb: 'Design the parts and the patterns', group: 'Plan', icon: 'layers', start: 'kickoff' },
	{ id: 'tree', title: 'Plan the files', blurb: 'Map every file before writing it', group: 'Plan', icon: 'tree', start: 'kickoff' },
	{ id: 'brainstorm', title: 'Brainstorm', blurb: 'Explore approaches together', group: 'Plan', icon: 'bulb', start: 'kickoff' },
	{ id: 'changes', title: 'Change history', blurb: 'See commits, current edits and likely downstream files', group: 'Plan', icon: 'history', start: 'run' },
	{ id: 'next', title: 'Next step', blurb: 'I write the next small piece; you review it', group: 'Build', icon: 'step', start: 'compose', placeholder: 'What should the next step be? Or say "go".', needsFile: true },
	{ id: 'feature', title: 'Add a feature', blurb: 'One feature in this file, nothing else', group: 'Build', icon: 'plus', start: 'compose', placeholder: 'Describe the feature to add', needsFile: true },
	{ id: 'change', title: 'Change selection', blurb: 'Rewrite only the lines you selected', group: 'Build', icon: 'edit', start: 'compose', placeholder: 'How should the selected lines change?', needsFile: true },
	{ id: 'explain', title: 'Explain', blurb: 'How this code works, and why', group: 'Build', icon: 'book', start: 'run', needsFile: true },
	{ id: 'why', title: 'Why is it like this?', blurb: 'Answers from your decisions and past chats', group: 'Build', icon: 'history', start: 'run', needsFile: true },
	{ id: 'review', title: 'Review', blurb: 'A careful second look, no edits', group: 'Fix', icon: 'eye', start: 'run', needsFile: true },
	{ id: 'impact', title: 'Change impact', blurb: 'See what depends on the selected file or symbol', group: 'Fix', icon: 'link', start: 'run', needsFile: true },
	{ id: 'skill:debug', title: 'Debug', blurb: 'Find the cause, then one small fix', group: 'Fix', icon: 'bug', start: 'compose', placeholder: 'What goes wrong? Paste the error if there is one.', needsFile: true },
	{ id: 'skill:tests', title: 'Tests', blurb: 'What to test and how', group: 'Fix', icon: 'flask', start: 'run', needsFile: true },
	{ id: 'skill:refactor', title: 'Refactor', blurb: 'Better structure, same behaviour', group: 'Fix', icon: 'wand', start: 'run', needsFile: true },
];

/** The cards on the chat's start screen: built-in skills plus the user's own SKILL.md files. */
export async function skillCards(extensionUri: vscode.Uri): Promise<SkillCard[]> {
	const builtInIds = new Set(BUILT_IN.map(card => card.id));
	const own = [...(await loadSkills(extensionUri)).values()]
		.filter(skill => !builtInIds.has(`skill:${skill.name}`))
		.map(skill => ({
			id: `skill:${skill.name}`,
			title: skill.name[0].toUpperCase() + skill.name.slice(1),
			blurb: skill.description || 'Your skill',
			group: 'Your skills' as const,
			icon: 'spark',
			start: 'compose' as const,
			placeholder: `What should ${skill.name} do?`,
		}));
	return [...BUILT_IN, ...own];
}
