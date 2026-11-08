/** A final answer must describe host actions that actually happened, rather than imagined filesystem access. */
export function recoveryForFinal(message: string, proposed: boolean, toolsAvailable: boolean, pendingProposal = false): string | undefined {
	if (toolsAvailable && /\b(?:cannot|can['’]t|unable to|do not have|don['’]t have|am not able to)\b[^.\n]{0,90}\b(?:access|read|edit|modify|create)\b[^.\n]{0,70}\b(?:files?|filesystem|workspace|project)\b/i.test(message)) {
		return 'The editor host exposes list_files, search, read_file, propose_file and propose_edit for the open project. '
			+ 'Your model process does not need direct filesystem access. Use a host tool now; if it fails, report its actual error.';
	}
	const firstPersonChange = /\bI(?:['’]ve| have)?\s+(?:(?:successfully|already|now)\s+)?(?:created|updated|modified|edited|deleted|removed|saved|written|added)\b/i.test(message);
	const implicitChange = /\b(?:the rewrite (?:moves|uses|adds|removes)|(?:is|was|has been) (?:corrected|rewritten|fixed)|now (?:throws|answers|includes|handles))\b/i.test(message);
	const claimedProposal = /\bI(?:['’]ve| have)?\s+proposed\b|\b(?:proposal|diff)\b[^\n]{0,180}\b(?:is|are)\s+(?:(?:created|prepared) and )?(?:ready|waiting|staged)\b/i.test(message)
		&& !/\bno (?:file )?(?:proposal|diff)\b/i.test(message);
	if (firstPersonChange || !proposed && (implicitChange || !pendingProposal && claimedProposal)) {
		return proposed
			? 'The host created reviewable proposals only. Nothing was applied. Give a final answer describing the proposals awaiting Keep.'
			: 'No file proposal has been created or applied by the host. Do not claim a file changed. '
				+ 'If the user requested a change, call propose_file, propose_edit or propose_delete with the required arguments now; otherwise explain the limit truthfully.';
	}
	return undefined;
}
