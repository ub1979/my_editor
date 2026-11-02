import type { PlanningDocuments } from '../project/planning';
import { redact } from '../records/redact';

/** Keep whole planning documents in the initial turns, which survive tool-result compaction. */
export function planningEvidence(paths: readonly string[], docs: PlanningDocuments, maxInputTokens: number): string[] {
	// Reserve space for instructions, history, recent checks and the answer. Count characters conservatively.
	let remaining = Math.max(0, Math.min(180_000, Math.floor(maxInputTokens * 1.2)));
	return paths.map(path => {
		const key = /\/(requirements|architecture|tree)\.(?:md|json)$/.exec(path)?.[1] as keyof PlanningDocuments | undefined;
		const source = key ? docs[key] : undefined;
		if (!source) { return ''; }
		let content = source;
		if (key === 'tree') {
			// Remove indentation only: retain every entry, property, status and exact string value.
			try { content = JSON.stringify(JSON.parse(source)); } catch { /* Keep invalid JSON visible for repair. */ }
		}
		content = redact(content);
		if (content.length > remaining) {
			return `${path}: Full document (${content.length} characters) exceeds the remaining planning context budget. `
				+ 'Its contents are not included. Use read_file for targeted inspection; do not reconstruct a replacement from partial evidence. '
				+ 'If a complete replacement cannot fit, report that limit instead of asking for continue.';
		}
		remaining -= content.length;
		return `${path} (complete saved document; JSON whitespace may be compacted; secret values are redacted):\n${content}`;
	}).filter(Boolean);
}
