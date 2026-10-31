import { validateTreePlan } from './stubs';

export type PlanningStage = 'requirements' | 'architecture' | 'tree';
export interface PlanningDocuments { requirements?: string; architecture?: string; tree?: string }
export interface PlanningProblem { stage: PlanningStage; reason: string }

const IDS = /\bN?FR-\d{3,}\b/g;
const DEFERRED = /\bwhen (?:you|the user) (?:say|ask|approve)[^\n.!?]*(?:write|produce|generate|full|complete)|\b(?:I['’]ll|I will) (?:write|produce|generate) (?:the |a )?(?:full|complete) (?:architecture|requirements|document)/i;

/** Saved summaries and deferred promises do not establish that a planning stage is complete. */
export function documentProblems(stage: 'requirements' | 'architecture', text = ''): string[] {
	if (!text.trim()) { return [`${stage}.md has not been written`]; }
	const problems: string[] = [];
	if (DEFERRED.test(text) || /<!--\s*my_editor:\s*draft\s*-->/i.test(text)
		|| /^\s*(?:#{1,3}\s+)?(?:status:\s*draft|(?:architecture\s+)?decisions summary)\b/im.test(text)) {
		problems.push(`${stage}.md is a draft or decisions summary`);
	}
	if (/\b(?:TBD|TODO)\b/.test(text)) { problems.push(`${stage}.md still contains unresolved placeholders`); }
	if (stage === 'requirements') {
		if (!/\bFR-\d{3,}\b/.test(text)) { problems.push('functional requirements need stable FR IDs'); }
		if (!/\bNFR-\d{3,}\b/.test(text)) { problems.push('non-functional requirements need stable NFR IDs'); }
		if (!/acceptance|given[\s\S]*when[\s\S]*then/i.test(text)) { problems.push('requirements need acceptance criteria'); }
		if (!/^#{1,3}\s+.*(?:goal|purpose|overview)/im.test(text)) { problems.push('requirements need the project goal'); }
		if (!/^#{1,3}\s+.*(?:users|audience|personas)/im.test(text)) { problems.push('requirements need the intended users'); }
		if (!/^#{1,3}\s+.*(?:out of scope|non-goals)/im.test(text)) { problems.push('requirements need an out-of-scope section'); }
	} else {
		const components = architectureComponents(text);
		const anchors = [...text.matchAll(/^##\s+.+\{#([\w-]+)\}\s*$/gm)].map(match => match[1]);
		if (new Set(anchors).size !== anchors.length) { problems.push('architecture section anchors must be unique'); }
		if (!components.size) { problems.push('architecture needs component sections with stable {#anchors}'); }
		for (const [anchor, body] of components) {
			if (!/\bN?FR-\d{3,}\b/.test(body) || !/interface|\bAPI\b|inputs?|outputs?|contracts?/i.test(body)) {
				problems.push(`architecture section #${anchor} needs requirement links and an interface`);
			}
		}
		if (!/\bflow\b/i.test(text)) { problems.push('architecture needs the main system flow'); }
		if (!/^#{1,3}\s+.*decisions/im.test(text)) { problems.push('architecture needs its decisions and trade-offs'); }
	}
	return problems;
}

/** Component bodies stop at the next section, so a later component cannot supply a missing interface. */
export function architectureComponents(text: string): Map<string, string> {
	const headings = [...text.matchAll(/^##\s+(.+)$/gm)];
	return new Map(headings.flatMap((heading, index) => {
		const anchor = /\{#([\w-]+)\}/.exec(heading[1])?.[1];
		return anchor ? [[anchor, text.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? text.length)]] : [];
	}));
}

/** Check the saved dependency chain and every reference before calling a tree ready to build. */
export function planningProblems(stage: PlanningStage, docs: PlanningDocuments): PlanningProblem[] {
	const problems: PlanningProblem[] = documentProblems('requirements', docs.requirements).map(reason => ({ stage: 'requirements', reason }));
	if (stage === 'requirements') { return problems; }
	problems.push(...documentProblems('architecture', docs.architecture).map(reason => ({ stage: 'architecture' as const, reason })));
	const ids = new Set(docs.requirements?.match(IDS) ?? []);
	for (const id of new Set(docs.architecture?.match(IDS) ?? [])) {
		if (!ids.has(id)) { problems.push({ stage: 'architecture', reason: `architecture refers to unknown requirement ${id}` }); }
	}
	if (stage === 'architecture') { return problems; }
	try {
		const files = validateTreePlan(docs.tree ?? '');
		const anchors = architectureComponents(docs.architecture ?? '');
		if (!files.length) { problems.push({ stage: 'tree', reason: 'the tree has no planned files' }); }
		const paths = new Set<string>();
		for (const file of files) {
			if (paths.has(file.path)) { problems.push({ stage: 'tree', reason: `${file.path} appears more than once` }); }
			paths.add(file.path);
			if (typeof file.role !== 'string' || !file.role.trim()) { problems.push({ stage: 'tree', reason: `${file.path} needs its one-line role` }); }
			if (typeof file.section !== 'string' || !anchors.has(file.section.replace(/^#/, ''))) {
				problems.push({ stage: 'tree', reason: `${file.path} refers to a missing architecture section ${file.section ?? '(none)'}` });
			}
			if (!Array.isArray(file.requirements) || file.requirements.some(id => typeof id !== 'string' || !ids.has(id))) {
				problems.push({ stage: 'tree', reason: `${file.path} needs confirmed requirement IDs (or [] for infrastructure)` });
			}
		}
	} catch { problems.push({ stage: 'tree', reason: 'tree.json must contain valid planned file entries' }); }
	return problems;
}
