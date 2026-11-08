import * as vscode from 'vscode';
import { Proposals } from '../chat/proposals';
import { fileContentProblem } from './filePassPolicy';
import { passSource } from './filePassSource';
import { Candidate } from './filePassWorker';

export async function proposeCandidate(root: vscode.Uri, candidate: Candidate, proposals: Proposals,
	allowed: () => boolean, validatePlan: () => Promise<void>) {
	const validate = async (text: string) => {
		await validatePlan();
		const source = await passSource(root, candidate.path);
		if (source.hash !== candidate.hash) { throw new Error(`${candidate.path} changed. Generate a fresh proposal.`); }
		const problem = fileContentProblem(candidate.path, text);
		if (problem) { throw new Error(problem); }
	};
	await validate(candidate.content);
	const uri = vscode.Uri.joinPath(root, candidate.path);
	if (!allowed()) { throw new Error('Run stopped.'); }
	if (proposals.fromUri(uri)) { throw new Error(`Review the open proposal for ${candidate.path} before continuing.`); }
	return proposals.propose(uri, candidate.content, 'write', false, { validate, allowed });
}
