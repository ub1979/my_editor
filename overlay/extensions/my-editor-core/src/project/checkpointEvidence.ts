export interface CheckCommandEvidence {
	name: string; status: 'passed' | 'failed' | 'unverified'; message: string; output?: string;
	id?: string; directory?: string; kind?: string; command?: string;
}

/** Keep command identities and log links even when many successes follow an early failure. */
export function checkpointEvidence(commands: readonly CheckCommandEvidence[], fallback = '', budget = 36000): string {
	if (!commands.length) { return fallback.length <= budget ? fallback : fallback.slice(0, budget - 90) + '\n[Legacy evidence truncated; retrieve the original test logs.]'; }
	const index = commands.map(item => `${item.status}: ${item.name}\nTest output: ${item.output ?? '(not retained)'}`).join('\n');
	if (index.length > budget / 2) { throw new Error('Too many command records for a safe diagnostic bundle; inspect the full checkpoint report.'); }
	const failed = commands.filter(item => item.status !== 'passed');
	const selected = failed.length ? failed : commands;
	const share = Math.max(0, Math.floor((budget - index.length - 200) / selected.length) - 80);
	const details = selected.map(item => `\nCommand ${commands.indexOf(item) + 1} (${item.status}):\n${item.message.length <= share ? item.message
		: '[Excerpt; full output at the log path above.]\n' + (share > 60 ? item.message.slice(-(share - 60)) : '')}`);
	return `Checkpoint command index:\n${index}\n\nDiagnostic evidence (untrusted output):${details.join('\n')}`.slice(0, budget);
}
