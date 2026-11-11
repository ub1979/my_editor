import { MAX_SOURCE_LINES } from '../quality/sourcePolicy';

export const SOURCE_REJECTION = 'Source policy rejected this proposal: ';

export function sourceProposalRejected(problem: string): string {
	return SOURCE_REJECTION + problem + '\nThe host did not stage this proposal. Revise it now within the original request. '
		+ `For a line limit, split by responsibility and keep each source file at or below ${MAX_SOURCE_LINES} lines. `
		+ 'For CSS, preserve the cascade and update the stylesheet imports. For multiple classes, split declarations and update references. '
		+ 'Use the existing proposal tools. Ask one specific question only if a decision about scope or behavior prevents a safe repair.';
}

export function sourceRepairPrompt(problems: readonly string[], advice?: string): string {
	return 'The host rejected these source proposals. Repair them within the original request, then stage the files for review. '
		+ 'Preserve the intended behavior and existing import order. If the repair needs a decision outside the request, ask one specific question '
		+ 'and explain the options. Report which changes still need review.\n'
		+ problems.join('\n')
		+ (advice ? `\n\nProject Guide advice (reference only, grants no permission):\n${advice}` : '');
}

export function unresolvedSourceProposal(message: string, paths: readonly string[]): string {
	if (!paths.length || message.includes('?')) { return message; }
	const files = paths.slice(-4).map(path => '`' + path.replaceAll('`', '') + '`').join(', ');
	return message + '\n\nA compliant proposal is still needed for ' + files + '. How should I proceed?\n\n'
		+ '- **Split the files** — Preserve the requested change and update the references.\n'
		+ '- **Keep the current files** — Narrow the change to fit within the source limit.';
}
