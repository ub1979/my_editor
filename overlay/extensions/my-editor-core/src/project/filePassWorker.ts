import type * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import type { PairEngine } from '../chat/engine';
import { companionTest, fileContentProblem, implementationRules } from './filePassPolicy';
import { passSource } from './filePassSource';
import { stubContent, TreeFile } from './stubs';
import { PassOptions } from './filePassPlan';
import { redact } from '../records/redact';
import { PlannedDependencies, requestedDependencies } from './filePassDependencies';
import { readPlanningDocuments } from './planningFiles';
import { decisionEvidence, decisionQuestionProblem, decisionRecovery, decisionRules } from './fileDecision';
import { PlannedRepairs, materializeRepairDecision, repairDecisionProblem, repairInstructions, requestedRepairs } from './filePassRepairs';
import { loadFileEvidence, trackFileEvidence, validateFileEvidence } from './fileEvidenceLoader';
import { decisionReference } from './decisionReferences';

export interface Candidate { path: string; content: string; hash?: string }
export interface PreparedFile { path: string; hash?: string; needsCode: boolean; note: string; changes: Candidate[]; contextHashes?: Record<string, string | undefined> }

interface Staging { changes: Map<string, Candidate>; rejected: string }

async function stageCandidate(root: vscode.Uri, path: string, hash: string | undefined, buffer: Staging, name: unknown, content: unknown) {
	const target = String(name);
	if (target !== path && !companionTest(target)) { buffer.rejected = 'Only the current file and a new companion test may be proposed.'; return buffer.rejected; }
	const problem = fileContentProblem(target, content);
	if (problem) { buffer.rejected = problem; return problem; }
	const current = await passSource(root, target);
	if (target === path && current.hash !== hash) { throw new Error(`${path} changed during generation.`); }
	if (target !== path && (current.source !== undefined || [...buffer.changes.keys()].some(key => key !== path && key !== target))) {
		return 'An existing test belongs to its own file pass. Only one new companion test can be requested here.';
	}
	if (current.source?.trim() === (content as string).trim()) { return 'This proposal is unchanged. Inspect the existing implementation.'; }
	buffer.changes.set(target, { path: target, content: content as string, hash: current.hash });
	buffer.rejected = '';
	return `Proposed ${target} for this file pass. The host will validate and apply the user’s review settings.`;

}

/** Tools may gather evidence and stage content. The controller alone can authorize a disk write. */
export async function preparePassFile(engine: PairEngine, root: vscode.Uri, path: string, options: PassOptions,
	context: { instruction?: string; clarifications?: string[] }, file: TreeFile | undefined, modelKey: string | undefined, token: vscode.CancellationToken,
	progress: (message: string) => void, preview?: (candidate?: Candidate) => void): Promise<PreparedFile> {
	const base = await passSource(root, path);
	progress('Loading current dependency contracts, callers and tests…');
	const evidence = await loadFileEvidence(root, path, base.source ?? '', token);
	const needsCode = options.kind === 'Build' && (!base.source?.trim() || !!file && base.source.trim() === stubContent(file).trim());
	const buffer: Staging = { changes: new Map(), rejected: '' };
	let failure = '', reply = '';
	const task = options.kind === 'Build' ? 'Implement all behavior assigned to this file. Inspect existing code and preserve working behavior.'
		: 'Inspect this file against its requirements, architecture, flow, callers and actual tests. Propose concrete fixes for demonstrated defects and missing executable tests. Cite findings and remaining checks.';
	let recovery = '';
	for (let attempt = 0; attempt < 2; attempt++) {
		failure = ''; reply = '';
		await engine.run({ mode: 'chat', modelKey, requestId: randomBytes(6).toString('hex'), characterId: options.kind === 'Build' ? 'ada' : 'poppy',
			fileTarget: { path, source: base.source ?? '' },
			onSourceRead: trackFileEvidence(evidence.snapshots, [path]),
			fileBlockedProblem: attempt ? message => requestedDependencies(message) || requestedRepairs(message) ? undefined : decisionQuestionProblem(message) : undefined,
			fileResultProblem: () => needsCode && !buffer.changes.has(path)
				? `No implementation was staged for ${path}. Use propose_file with the complete implementation now; a summary alone does not build the file. If a required decision prevents implementation, return BLOCKED with the precise question.`
				: undefined,
			stageFile: async (name, content) => {
				const result = await stageCandidate(root, path, base.hash, buffer, name, content);
				const candidate = buffer.changes.get(path);
				if (!token.isCancellationRequested && result.startsWith('Proposed ') && name === path && candidate) { preview?.(candidate); }
				return result;
			}, text: `Implement the requested ${options.kind} pass for ${JSON.stringify(path)}. ${task}\n`
				+ (context.instruction ? `Developer instruction: ${context.instruction}\n` : '')
				+ (options.kind === 'Build' && options.workflow === 'buildThenQA'
					? 'This is the implementation stage. Build this file from its brief and dependency contracts. Write its planned tests, but defer running tests, auditing other implementations and cross-project QA until all planned files exist. Do not expand into a general review.\n' : '')
				+ (context.clarifications?.length ? `Developer answers for this file: ${JSON.stringify(context.clarifications)}\n` : '')
				+ (context.clarifications?.length ? `Developer decision references: ${JSON.stringify(context.clarifications.map(quote => ({ reference: decisionReference('developer', quote), quote })))}\n` : '')
				+ (needsCode ? 'This file is absent or a placeholder. Implement it in THIS pass with propose_file before concluding; do not defer it to a later pass. '
					+ 'Once the required interfaces are known, reserve your remaining tool calls for the complete proposal instead of repeating reads.\n' : '')
				+ `${implementationRules}\n${evidence.text}\nCurrent complete file: \n${base.source ?? '(file does not exist)'}\n`
				+ 'Read only real dependencies and existing tests needed to resolve this file’s implementation. Lookup hints are not a checklist: stop reading when its interfaces and acceptance criteria are clear. Use propose_file for the complete target if changes are needed. '
				+ 'For missing coverage, implement the planned test in its own turn, or propose one new companion test file using the project naming convention. '
				+ `${decisionRules}\n`
				+ (!options.selected ? `${repairInstructions}\n` : '')
				+ 'For a Build pass blocked only by unimplemented interfaces in other already-planned files in this same module, '
				+ 'read those files first, then return action=final with message BLOCKED, a newline, DEPENDENCIES_REQUIRED and a JSON array of their exact project-relative paths. '
				+ 'For example: BLOCKED\\nDEPENDENCIES_REQUIRED ["src/core/service.ts"]. Do not stage any changes in that response. '
				+ 'The host may build these dependencies first within the chosen scope, then retry this file. Never use this for a design question or a circular dependency. '
				+ 'When finished, return action=final JSON whose message starts with FILE_REVIEWED followed by a newline and a short account of what you checked, changed, and what still needs testing. '
				+ 'Use two or three short sentences: explain this file’s responsibility, the concrete change (or why no change is needed), and remaining test coverage. '
				+ 'Do not tell the user to Keep, continue or approve: the host manages saving according to their selected permission. '
				+ 'Only use FILE_REVIEWED after inspecting this file. Never claim a test ran.\n' + recovery }, [], {
			text: chunk => { reply += chunk; }, progress, proposal: () => {}, action: () => {}, error: message => { failure = message; },
		}, token);
		if (token.isCancellationRequested) { throw new Error('Stopped.'); }
		const repairs = !failure && requestedRepairs(reply);
		if (repairs) {
			if (options.selected) { throw new Error('Coordinated repairs require a project run; this run authorizes only the selected file.'); }
			buffer.changes.clear(); buffer.rejected = ''; preview?.();
			const docs = await readPlanningDocuments(root);
			if (token.isCancellationRequested) { throw new Error('Stopped.'); }
			const problem = repairDecisionProblem(repairs.decision, context.clarifications ?? [], docs);
			if (problem) {
				if (attempt) { throw new Error(problem); }
				progress('Checking the repair citation against saved plans…');
				recovery = `Repair citation rejected: ${problem}\nThe rejected request is not an approved decision: ${redact(reply).slice(0, 4000)}\n`
					+ 'Use a current supplied reference with its matching source and omit quote, or read the saved documents and correct the exact quote, including code punctuation. Do not invent authorization. '
					+ 'If no decision supports the repair, use the evidence/recommendation/question format.\n'
					+ decisionEvidence(docs, `${path}\n${reply}`);
				continue;
			}
			repairs.decision = materializeRepairDecision(repairs.decision, context.clarifications ?? [], docs);
			throw new PlannedRepairs(repairs);
		}
		const dependencies = !failure && requestedDependencies(reply);
		if (dependencies && options.kind === 'Build' && !options.selected && !buffer.changes.size && !buffer.rejected) {
			throw new PlannedDependencies(dependencies);
		}
		if (!failure && /^BLOCKED\b/.test(reply.trim()) && !attempt) {
			progress('Checking saved requirements and architecture before asking you…');
			buffer.changes.clear(); buffer.rejected = ''; preview?.();
			const docs = await readPlanningDocuments(root);
			if (token.isCancellationRequested) { throw new Error('Stopped.'); }
			recovery = `${decisionRecovery}\nBlocker to investigate (not an approved decision): ${redact(reply).slice(0, 4000)}\n`
				+ decisionEvidence(docs, `${path}\n${reply}`);
			continue;
		}
		break;
	}
	// A failed proposal can lead to a genuine design question. Keep that question actionable.
	if (!failure && /^BLOCKED\b/.test(reply.trim())) {
		if (decisionQuestionProblem(reply)) { throw new Error('The model could not substantiate its design question against the saved plans. Resume to retry; no decision or file change was applied.'); }
		throw new Error(redact(reply.trim()));
	}
	if (failure || buffer.rejected || !/^FILE_REVIEWED\s*\n\s*\S/.test(reply.trim())) {
		throw new Error(redact(failure || buffer.rejected || reply || 'The model returned no file result.'));
	}
	if (needsCode && !buffer.changes.has(path)) {
		throw new Error(redact(`The model left ${path} unimplemented.\n${reply.trim().replace(/^FILE_REVIEWED\s*/, '')}`));
	}
	if ((await passSource(root, path)).hash !== base.hash) { throw new Error(`${path} changed during generation. Review it and resume.`); }
	await validateFileEvidence(root, evidence.snapshots);
	return { path, hash: base.hash, needsCode, note: redact(reply.trim().replace(/^FILE_REVIEWED\s*/, '')), changes: [...buffer.changes.values()], contextHashes: evidence.snapshots };
}
