import type { PlanningDocuments } from './planning';
import { queryTerms } from './relevance';
import { redact } from '../records/redact';
import { decisionReferences } from './decisionReferences';

export const decisionRules = 'Before asking a design question, check the saved requirements, architecture, developer answers and relevant contracts. '
	+ 'A clear saved decision is already authorized: implement it without asking again. A generated implementation disagreeing with an explicit saved decision is a code defect, not a new design choice. '
	+ 'A generated shared schema or its comments alone do not establish an approved architectural decision when the saved plans are silent. '
	+ 'Do not confuse event-envelope IDs with payload/entity IDs. Do not invent a type or infer it merely from a field name. '
	+ 'If authoritative sources are missing or contradictory, explain the exact gap, cite the sections checked, recommend one option with reasons, and give alternatives with trade-offs. '
	+ 'If the answer is known but needs another planned file, use the coordinated repair protocol when available rather than ask the user to approve the same decision again. '
	+ 'Do not change planning documents or broaden this file’s write scope.';

/** Search the full saved plans on a blocker, not just the original file brief's excerpts. */
export function decisionEvidence(docs: PlanningDocuments, question: string): string {
	const identifiers = [...question.matchAll(/`([^`]+)`|\b([A-Za-z]+(?:Id|ID|Data|Schema))\b/g)]
		.map(match => (match[1] ?? match[2]).toLowerCase());
	const terms = [...new Set([...identifiers, ...queryTerms(question)])];
	const excerpts = (['requirements', 'architecture'] as const).map(name => {
		const source = docs[name], path = `.my_editor/specs/${name}.md`;
		if (!source) { return `${path}: missing or unreadable. Do not claim it was checked.`; }
		const lines = source.split('\n');
		const ranked = lines.map((line, index) => ({ index, score: terms.reduce((score, term) =>
			score + (line.toLowerCase().includes(term) ? identifiers.includes(term) ? 8 : 1 : 0), 0) }))
			.filter(item => item.score).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 16);
		const selected = new Set<number>();
		for (const { index } of ranked) {
			for (let i = Math.max(0, index - 4); i <= Math.min(lines.length - 1, index + 5); i++) { selected.add(i); }
		}
		let excerpt = `${path} (${lines.length} lines; ranked excerpts, not the complete document):\n`;
		for (const index of [...selected].sort((a, b) => a - b)) {
			const line = `${path}:${index + 1}: ${lines[index]}\n`;
			if (excerpt.length + line.length > 10000) { excerpt += '[Excerpt limit; read the relevant ranges before concluding.]\n'; break; }
			excerpt += line;
		}
		return ranked.length ? excerpt : `${excerpt}No literal matches. Inspect the document and related contracts before claiming the decision is missing.`;
	});
	const references = decisionReferences(docs).map(entry => `${entry.reference} — ${entry.title}`).join('\n');
	return redact(excerpts.join('\n\n') + '\n\nSaved-section decision references (read the section before citing):\n' + references.slice(0, 10000));
}

export const decisionRecovery = 'The host is checking this blocker before asking the developer. Use the fresh saved-plan evidence below and read any needed ranges or actual contract definitions. '
	+ 'Resolve the issue and finish the file with FILE_REVIEWED when the saved decision is clear. If genuinely unresolved, return BLOCKED followed by these sections: '
	+ 'Evidence: cite actual paths/lines checked and what each establishes; Missing or conflicting: the precise unanswered decision or contradiction; '
	+ 'Recommendation: your preferred option and why; Options: numbered alternatives 1. and 2. with trade-offs; Question: one concise decision for the user. '
	+ 'Do not claim an excerpt search proves absence; verify relevant sections. Distinguish documented facts from your recommendation.';

/** Reject bare repeated questions: they need evidence and useful decision support. */
export function decisionQuestionProblem(message: string): string | undefined {
	for (const label of ['Evidence', 'Missing or conflicting', 'Recommendation', 'Options', 'Question']) {
		if (!new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${label}:(?:\\*\\*)?\\s*\\S`, 'i').test(message)) {
			return `${decisionRecovery} Missing required section: ${label}.`;
		}
	}
	if (!['requirements', 'architecture'].every(name => message.includes(`.my_editor/specs/${name}.md`))) {
		return `${decisionRecovery} Identify the saved planning files checked, or explicitly identify them as missing/unreadable.`;
	}
	const alternatives = /Options:([\s\S]*?)\n\s*(?:\*\*)?Question:/i.exec(message)?.[1] ?? '';
	if (!/\n\s*1[.)]\s*\S/.test(alternatives) || !/\n\s*2[.)]\s*\S/.test(alternatives)) {
		return `${decisionRecovery} Include two numbered alternatives with their trade-offs.`;
	}
	return undefined;
}

export function decisionAnswerPrompt(message: string): string {
	const question = /(?:^|\n)\s*(?:\*\*)?Question:(?:\*\*)?\s*([\s\S]*)/i.exec(message)?.[1];
	return (question ? `${question.trim()} See the recommendation and alternatives in the agent chat.` : message).slice(0, 800);
}
