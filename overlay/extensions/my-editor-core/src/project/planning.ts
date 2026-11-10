import { planningSections } from './planningSections';
import { architectureAnchors, architectureComponentSections, hasComponentContract } from './architectureSections';
import { validateTreePlan } from './stubs';
import { buildPlanProblems } from './buildPlan';

export type PlanningStage = 'requirements' | 'architecture' | 'tree';
export interface PlanningDocuments { requirements?: string; architecture?: string; tree?: string }
export interface PlanningProblem { stage: PlanningStage; reason: string }

/** IDs alone cannot detect a requirement's changed meaning while a design is being prepared. */
export function changedPlanningPrerequisites(stage: PlanningStage, before: PlanningDocuments, after: PlanningDocuments): PlanningStage[] {
	const prerequisites: PlanningStage[] = stage === 'tree' ? ['requirements', 'architecture'] : stage === 'architecture' ? ['requirements'] : [];
	return prerequisites.filter(key => before[key] !== after[key]);
}

/** Supply the complete saved section list without requiring a model to page through the file tree. */
export function savedTreeSections(tree = ''): string[] {
	try {
		return [...new Set(validateTreePlan(tree).flatMap(file => typeof file.section === 'string'
			&& file.section.trim() ? [file.section.replace(/^#/, '')] : []))];
	} catch { return []; }
}

const IDS = /\bN?FR-\d{3,}\b/g;
const DEFERRED = /\bwhen (?:you|the user) (?:say|ask|approve)[^\n.!?]*(?:write|produce|generate|full|complete)|\b(?:I['’]ll|I will) (?:write|produce|generate) (?:the |a )?(?:full|complete) (?:architecture|requirements|document)/i;

/** A clear document title or JSON tree must never be accepted as a different planning file. */
export function planningDocumentKind(text: string): PlanningStage | undefined {
	try {
		const value = JSON.parse(text);
		if (Array.isArray(value) || value && typeof value === 'object' && Array.isArray(value.files)) { return 'tree'; }
	} catch { /* Markdown document. */ }
	const title = planningSections(text).find(section => section.level === 1)?.title;
	const match = /^(?:\d+[.)]?\s+)?(requirements?|architecture|(?:file\s+)?tree)\b/i.exec(title ?? '')
		?? /[:—–-]\s*(requirements?|architecture|(?:file\s+)?tree)\s*$/i.exec(title ?? '');
	if (!match) { return; }
	return /requirements?/i.test(match[1]) ? 'requirements' : /architecture/i.test(match[1]) ? 'architecture' : 'tree';
}

/** Explain whether a rejected check concerns the new proposal or a saved prerequisite. */
export function planningError(stage: PlanningStage, docs: PlanningDocuments, proposed?: string, maxProblems = 4): string | undefined {
	const kind = proposed === undefined ? undefined : planningDocumentKind(proposed);
	if (kind && kind !== stage) {
		return `The reply contains ${kind}, but this request targets ${stage}. Use /${kind} to prepare the correct document. No saved file was changed.`;
	}
	const problems = planningProblems(stage, proposed === undefined ? docs : { ...docs, [stage]: proposed });
	if (!problems.length) { return; }
	const shown = problems.slice(0, maxProblems);
	const detail = shown.map(problem => `${proposed !== undefined && problem.stage === stage ? 'Proposed' : 'Saved'} ${problem.stage}: ${problem.reason}`);
	const remaining = problems.length - shown.length;
	return `Planning is not complete: ${detail.join('; ')}${remaining ? `; and ${remaining} more issue(s)` : ''}. Finalize ${problems[0].stage} before continuing. No planned files were created.`;
}

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
		const anchors = planningSections(text).flatMap(section => section.anchor ? [section.anchor] : []);
		if (new Set(anchors).size !== anchors.length) { problems.push('architecture section anchors must be unique'); }
		if (!components.size) { problems.push('architecture needs component sections with stable anchors ({#id} or an HTML anchor)'); }
		for (const [anchor, body] of components) {
			if (!hasComponentContract(body)) {
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
	return new Map(architectureComponentSections(text).map(section => [section.anchor!, section.body]));
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
		problems.push(...buildPlanProblems(JSON.parse(docs.tree ?? ''), files).map(reason => ({ stage: 'tree' as const, reason })));
		const anchors = architectureAnchors(docs.architecture ?? '');
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
