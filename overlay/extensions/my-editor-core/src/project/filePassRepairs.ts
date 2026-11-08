import type { PassModule } from './filePassPlan';
import type { PlanningDocuments } from './planning';
import { eligibleFile } from './filePassPolicy';
import { decisionProse, decisionReferences } from './decisionReferences';

export interface RepairDecision { source: 'developer' | 'requirements' | 'architecture'; quote: string; reference?: string }
export interface RepairSpec { path: string; reason: string }
export interface RepairRequest { files: RepairSpec[]; decision: RepairDecision }
export interface RepairRecord extends RepairRequest { origin: string }
export interface QueuedRepair extends RepairSpec { origin: string; decision: RepairDecision }

export function repairDecisionProblem(decision: RepairDecision, answers: readonly string[], docs: PlanningDocuments): string | undefined {
	const { source, quote } = decision;
	if (decision.reference) {
		const entry = decisionReferences(docs, answers).find(entry => entry.reference === decision.reference && entry.source === source);
		// A model may pinpoint one clause within the referenced section. Validate only
		// against that section, then materialize its full text so qualifications survive.
		const matchingQuote = entry && (!quote || (source === 'developer' ? quote === entry.quote
			: decisionProse(quote).length >= 16 && decisionProse(entry.quote).includes(decisionProse(quote))));
		if (!matchingQuote) { return 'The decision reference is unknown, changed, or paired with a different quote. Use a reference from the current saved evidence.'; }
		return;
	}
	const authorized = source === 'developer' ? answers.some(answer => answer.trim() === quote)
		: decisionProse(quote).length >= 16 && !!docs[source] && decisionProse(docs[source]!).includes(decisionProse(quote));
	if (!authorized) { return 'The repair decision does not match a developer answer or explicit saved-plan quote. Retry using the actual approved decision.'; }
}

export function materializeRepairDecision(decision: RepairDecision, answers: readonly string[], docs: PlanningDocuments): RepairDecision {
	const problem = repairDecisionProblem(decision, answers, docs);
	if (problem) { throw new Error(problem); }
	return decision.reference ? { ...decision, quote: decisionReferences(docs, answers).find(entry => entry.reference === decision.reference)!.quote } : decision;
}

export class PlannedRepairs extends Error {
	constructor(readonly request: RepairRequest) { super('Repair planned files before continuing.'); }
}

export const repairInstructions = 'When an agreed decision requires changes to OTHER already-planned files in this run, do not ask for permission again or edit them in this turn. '
	+ 'Read the affected interfaces, then return action=final with message BLOCKED, a newline, REPAIRS_REQUIRED and JSON: '
	+ '{"files":[{"path":"exact/project/path","reason":"specific repair"}],"decision":{"source":"developer","quote":"exact complete developer answer"}}. '
	+ 'List every affected implementation and existing test in dependency order (up to 20 files), excluding the current file. '
	+ 'For an explicit saved-plan decision, source may instead be requirements or architecture with an exact decisive quote from that document. '
	+ 'Prefer a supplied content-addressed reference: decision={"source":"requirements","reference":"requirements:…"}; omit quote, or quote a contiguous passage from that referenced section. Copy an actual supplied reference, never invent one. A reference identifies evidence; it does not resolve a genuine gap or authorize new scope. '
	+ 'Generated code or its comments are not proof of a developer-approved decision. If the decision is genuinely missing, use the evidence/recommendation/question format. '
	+ 'Stage no changes in a repair request. The host will repair each scoped file separately using the existing saving permission, then retry this file. '
	+ 'During a coordinated repair, other listed files may temporarily retain the old interface: implement this file against the agreed target without requesting those already-queued repairs again. '
	+ 'Preserve existing user data; never drop data or rewrite applied migrations to pretend a migration succeeded. Use a planned migration when available. '
	+ 'If a necessary supporting file (such as a forward migration) is absent from the plan, include its exact new path beside existing files in the selected module and its reason in this request. '
	+ 'The host will ask for scope approval once for those new paths before queuing them; do not replace this request with another question about the already-approved design.';

export function requestedRepairs(reply: string): RepairRequest | undefined {
	const match = /^BLOCKED\s*\nREPAIRS_REQUIRED\s+([\s\S]+)$/.exec(reply.trim());
	if (!match) { return; }
	let value: RepairRequest;
	try { value = JSON.parse(match[1]); } catch { throw new Error('Invalid coordinated repair request. Retry this file.'); }
	if (!value || !Array.isArray(value.files) || !value.files.length || value.files.length > 20
		|| value.files.some(file => !file || typeof file.path !== 'string' || !eligibleFile(file.path)
			|| typeof file.reason !== 'string' || !file.reason.trim() || file.reason.length > 1500)
		|| new Set(value.files.map(file => file.path)).size !== value.files.length
		|| !value.decision || !['developer', 'requirements', 'architecture'].includes(value.decision.source)
		|| (value.decision.reference !== undefined && (typeof value.decision.reference !== 'string' || !/^(developer|requirements|architecture):[a-f0-9]{20}$/.test(value.decision.reference)))
		|| (!value.decision.reference && (typeof value.decision.quote !== 'string' || value.decision.quote.trim().length < 3))
		|| (value.decision.quote !== undefined && (typeof value.decision.quote !== 'string' || value.decision.quote.length > 8000))) {
		throw new Error('A repair request needs distinct safe file paths, repair reasons and an exact approved decision.');
	}
	return { files: value.files.map(({ path, reason }) => ({ path, reason })), decision: { source: value.decision.source,
		quote: value.decision.quote?.trim() ?? '', ...(value.decision.reference ? { reference: value.decision.reference } : {}) } };
}

/** Existing files may be revisited, but model text cannot expand the chosen scope or invent consent. */
export function queueRepairs(origin: string, request: RepairRequest, modules: readonly PassModule[], planned: readonly string[],
	answers: readonly string[], docs: PlanningDocuments, pending: readonly QueuedRepair[], history: readonly RepairRecord[]): QueuedRepair[] {
	const scope = new Set(modules.flatMap(group => group.files).filter(path => planned.includes(path)));
	if (!scope.has(origin) || request.files.some(file => file.path === origin || !scope.has(file.path))) {
		throw new Error('The repair includes a file outside this run’s planned scope. Add it to the plan or run a separate authorized repair.');
	}
	const decisionProblem = repairDecisionProblem(request.decision, answers, docs);
	if (decisionProblem) { throw new Error(decisionProblem); }
	const decision = materializeRepairDecision(request.decision, answers, docs);
	const normalize = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();
	const priorRepairs = (path: string): RepairSpec[] => history.filter(record => record.origin === origin)
		.flatMap(record => record.files.filter(file => file.path === path));
	if (request.files.some(file => priorRepairs(file.path).some(old => normalize(old.reason) === normalize(file.reason)))) {
		throw new Error('The same coordinated repair was requested again without resolving the blocker. Review the repair report before retrying.');
	}
	// Separate defects can affect the same dependency. Bound even reworded requests so they cannot loop indefinitely.
	if (history.length >= 100 || request.files.some(file => priorRepairs(file.path).length >= 3)) {
		throw new Error('The coordinated repair retry limit was reached. Review the repair report before retrying.');
	}
	const edges = new Map<string, string[]>();
	for (const record of [...history, { origin, ...request }]) { edges.set(record.origin, [...(edges.get(record.origin) ?? []), ...record.files.map(file => file.path)]); }
	const reaches = (path: string, target: string, seen = new Set<string>()): boolean => {
		if (path === target) { return true; }
		if (seen.has(path)) { return false; }
		seen.add(path); return (edges.get(path) ?? []).some(next => reaches(next, target, seen));
	};
	if (request.files.some(file => reaches(file.path, origin))) { throw new Error('The coordinated repairs form a cycle. Review the intended interface before retrying.'); }
	if (request.files.some(file => pending.some(item => item.path === file.path))) {
		throw new Error('That file is already in the coordinated repair queue. Implement against the agreed target interface instead of scheduling it again.');
	}
	return [...request.files.map(file => ({ ...file, origin, decision })), ...pending];
}

export function repairContext(item: QueuedRepair, queue: readonly QueuedRepair[]): string {
	return `Coordinated repair for ${item.origin}: ${item.reason}\nApproved decision (${item.decision.source}): ${item.decision.quote}\n`
		+ `Remaining repair order: ${queue.map(file => file.path).join(', ')}. Repair ONLY ${item.path} in this turn, even if it already contains code. `
		+ 'Other queued files will be updated separately. Do not treat their old types as a new design conflict. The blocked file resumes after this queue finishes.';
}
