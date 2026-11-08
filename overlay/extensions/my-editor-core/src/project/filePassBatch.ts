import type * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import type { PairEngine } from '../chat/engine';
import { fileBuildBrief } from './fileBrief';
import { readPlanningDocuments } from './planningFiles';
import { passSource } from './filePassSource';
import { fileContentProblem, implementationRules } from './filePassPolicy';
import { stubContent, TreeFile } from './stubs';
import type { PreparedFile, Candidate } from './filePassWorker';
import { redact } from '../records/redact';
import { loadFileEvidence, trackFileEvidence, validateFileEvidence } from './fileEvidenceLoader';

export interface BatchTarget { path: string; file?: TreeFile; instruction: string; answers: string[] }

/** Generate a small exact set together; saving and progress remain independently validated per file. */
export async function prepareFileBatch(engine: PairEngine, root: vscode.Uri, targets: BatchTarget[], modelKey: string | undefined,
	token: vscode.CancellationToken, progress: (message: string) => void): Promise<PreparedFile[] | undefined> {
	if (targets.length < 2 || targets.length > 3) { return; }
	const docs = await readPlanningDocuments(root);
	const inputs = await Promise.all(targets.map(async target => {
		const base = await passSource(root, target.path);
		return { ...target, ...base, needsCode: !base.source?.trim() || !!target.file && base.source.trim() === stubContent(target.file).trim() };
	}));
	const context = inputs.map(input => `${input.path}\n${fileBuildBrief(docs, input.path, input.source ?? '').slice(0, 12000)}\n`
		+ `Current complete file:\n${input.source ?? '(missing)'}\nInstruction: ${input.instruction}\nApproved answers: ${JSON.stringify(input.answers)}`).join('\n\n');
	if (context.length > 60000 || token.isCancellationRequested) { return; }
	const evidence = await loadFileEvidence(root, inputs[0].path, inputs[0].source ?? '', token);
	for (const input of inputs) { delete evidence.snapshots[input.path]; }
	const changes = new Map<string, Candidate>();
	const invalid = new Set<string>();
	let reply = '', failure = '', rejected = false;
	const missing = () => inputs.filter(input => input.needsCode && !changes.has(input.path)).map(input => input.path);
	await engine.run({ mode: 'chat', modelKey, characterId: 'ada', requestId: randomBytes(6).toString('hex'),
		fileTarget: { path: inputs[0].path, source: inputs[0].source ?? '' },
		onSourceRead: trackFileEvidence(evidence.snapshots, inputs.map(input => input.path)),
		fileResultProblem: () => missing().length ? `Stage complete implementations for all missing batch files before finishing: ${missing().join(', ')}` : undefined,
		stageFile: async (name, content) => {
			const input = inputs.find(input => input.path === name);
			if (!input) { rejected = true; return 'Only the exact batch paths may be proposed. Return BLOCKED if another file is required.'; }
			const problem = fileContentProblem(input.path, content);
			if (problem) { invalid.add(input.path); return problem; }
			if ((await passSource(root, input.path)).hash !== input.hash) { throw new Error(`${input.path} changed during generation.`); }
			changes.set(input.path, { path: input.path, content: content as string, hash: input.hash });
			invalid.delete(input.path);
			return `Proposed ${input.path} for the batch. Nothing has been saved yet.`;
		},
		text: `Implement the requested Build pass for ${JSON.stringify(inputs[0].path)} as a related-file batch. `
			+ `The host authorizes ONLY these ${inputs.length} paths: ${JSON.stringify(inputs.map(input => input.path))}. `
			+ 'Implement all listed responsibilities together so imports, signatures and types agree. Preserve working behavior. '
			+ 'Use propose_file for each complete changed file; never write an unlisted path. Tests may be generated if listed, but execution and QA follow the implementation stage. '
			+ 'Read only missing dependency information; the complete current sources and focused briefs follow. '
			+ 'If any prerequisite outside this batch or unresolved decision prevents completion, return BLOCKED with the exact reason. '
			+ 'The host will discard the staged batch and use its dependency-aware individual-file workflow. Never invent exports in an out-of-batch dependency or contradict an agreed contract. '
			+ 'Define interfaces owned by the listed files as part of their implementation; empty future callers or tests are not blockers. '
			+ `${implementationRules}\n${context}\n${evidence.text}\n`
			+ 'Finish with action=final, message FILE_REVIEWED followed by a newline and JSON: '
			+ '{"files":[{"path":"exact batch path","summary":"Responsibility, concrete changes, and remaining tests in two short sentences."}]}. '
			+ 'Include every batch path exactly once. Do not claim anything was saved or tests ran; the host performs those steps.',
	}, [], { text: text => { reply += text; }, progress, proposal: () => {}, action: () => {}, error: text => { failure = text; } }, token);
	if (token.isCancellationRequested) { throw new Error('Stopped.'); }
	if (failure) { throw new Error(redact(failure)); }
	if (rejected || invalid.size || missing().length || !/^FILE_REVIEWED\s*\n/.test(reply.trim())) { return; }
	let notes: { path: string; summary: string }[];
	try { notes = JSON.parse(reply.trim().replace(/^FILE_REVIEWED\s*\n/, '')).files; } catch { return; }
	if (!Array.isArray(notes) || notes.length !== inputs.length || new Set(notes.map(note => note?.path)).size !== inputs.length
		|| notes.some(note => !note || !inputs.some(input => input.path === note.path) || typeof note.summary !== 'string' || !note.summary.trim())) { return; }
	for (const input of inputs) { if ((await passSource(root, input.path)).hash !== input.hash) { return; } }
	await validateFileEvidence(root, evidence.snapshots);
	return inputs.map(input => ({ path: input.path, hash: input.hash, needsCode: input.needsCode,
		note: redact(notes.find(note => note.path === input.path)!.summary), changes: changes.has(input.path) ? [changes.get(input.path)!] : [], contextHashes: evidence.snapshots }));
}
