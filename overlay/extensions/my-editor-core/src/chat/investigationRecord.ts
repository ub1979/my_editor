import { createHash } from 'crypto';
import { redactObservation } from './observationProcess';

export interface EvidenceEntry {
	readonly tool: string;
	readonly subject: string;
	readonly resultHash: string;
	readonly excerpt: string;
}

export interface InvestigationRecord {
	readonly id: string;
	readonly at: string;
	readonly projectHead?: string;
	readonly brainCommit?: string;
	readonly model: string;
	readonly question: string;
	readonly answer: string;
	readonly evidence: readonly EvidenceEntry[];
}

/** Save source provenance and a bounded excerpt, not a model's paraphrase of a tool result. */
export function evidenceEntry(tool: string, args: Record<string, unknown>, result: string): EvidenceEntry {
	const subject = typeof args.path === 'string' ? args.path
		: typeof args.id === 'string' ? args.id
			: typeof args.query === 'string' ? args.query
				: typeof args.question === 'string' ? args.question : '';
	const safe = redactObservation(result);
	return {
		tool: tool.slice(0, 50), subject: redactObservation(subject).slice(0, 180),
		resultHash: createHash('sha256').update(safe).digest('hex'),
		excerpt: safe.slice(0, 1_500) + (safe.length > 1_500 ? '\n[Excerpt limited]' : ''),
	};
}

export function compactInvestigation(record: InvestigationRecord): InvestigationRecord {
	return {
		...record,
		question: redactObservation(record.question).slice(0, 2_000),
		answer: redactObservation(record.answer).slice(0, 4_000),
		evidence: record.evidence.slice(0, 60),
	};
}
