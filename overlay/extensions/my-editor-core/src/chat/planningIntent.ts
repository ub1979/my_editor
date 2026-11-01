import type { PlanningStage } from '../project/planning';

/** Explicit document requests use the same routing in typed messages, answer buttons and engine calls. */
export function planningIntent(text: string): PlanningStage | undefined {
	const plain = text.replace(/[`*_]/g, '').trim();
	const slash = /^\/(requirements|architecture|tree)\b/i.exec(plain);
	if (slash) { return slash[1].toLowerCase() as PlanningStage; }
	if (plain.startsWith('/')) { return; } // An explicit non-planning command wins.
	const handoff = /(?:^|[,:;.]\s*|\band\s+)(?:move on|switch|continue|go|proceed)\s+(?:on\s+)?to\s+(?:the\s+)?(requirements|architecture|(?:file\s+)?tree)\b/i.exec(plain);
	if (handoff) { return handoff[1].toLowerCase().includes('tree') ? 'tree' : handoff[1].toLowerCase() as PlanningStage; }
	const prefix = /^(?:(?:please|now)\s+|(?:can|could|would)\s+you\s+|I(?:'d| would)\s+like\s+you\s+to\s+)*/i;
	const request = plain.replace(prefix, '').replace(/^(?:check|review|inspect|verify)\s+(?:and|then)\s+/i, '');
	const action = /^(?:write|rewrite|produce|generate|regenerate|rebuild|restore|finali[sz]e|complete|fix|update|revise)\s+(?:(?:the|my|our|saved|full|complete)\s+)*(requirements|architecture|(?:file\s+)?tree)\b/i.exec(request);
	if (action) { return action[1].toLowerCase().includes('tree') ? 'tree' : action[1].toLowerCase() as PlanningStage; }
	// A short answer label can be followed by its explicit request: "Write it now: produce architecture.md".
	const described = /^(?:write it now|do it|go ahead)\s*:\s*(.+)/i.exec(request);
	return described ? planningIntent(described[1]) : undefined;
}
