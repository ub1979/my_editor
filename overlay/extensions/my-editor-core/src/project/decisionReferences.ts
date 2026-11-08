import { createHash } from 'crypto';
import type { PlanningDocuments } from './planning';
import { planningSections } from './planningSections';

export type DecisionSource = 'developer' | 'requirements' | 'architecture';
export interface DecisionReference { source: DecisionSource; reference: string; quote: string; title: string }

export function decisionProse(text: string): string {
	return text.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/^[\t ]*[-+*][\t ]+/gm, '').replace(/\s+/g, ' ').trim();
}

/** Content-addressed provenance, not a model assertion that a contract decision was approved. */
export function decisionReference(source: DecisionSource, text: string): string {
	const content = source === 'developer' ? text.trim() : decisionProse(text);
	return `${source}:${createHash('sha256').update(content).digest('hex').slice(0, 20)}`;
}

export function decisionReferences(docs: PlanningDocuments, answers: readonly string[] = []): DecisionReference[] {
	const entries: DecisionReference[] = answers.map(quote => ({ source: 'developer', quote: quote.trim(), title: 'Developer answer',
		reference: decisionReference('developer', quote) }));
	for (const source of ['requirements', 'architecture'] as const) {
		for (const section of planningSections(docs[source] ?? '')) {
			const quote = section.body.trim();
			if (decisionProse(quote).length < 16 || quote.length > 8000) { continue; }
			entries.push({ source, quote, title: section.title, reference: decisionReference(source, quote) });
		}
	}
	return entries;
}
