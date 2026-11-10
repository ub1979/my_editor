import { character, CharacterId } from './characters';
import { agentMode } from './chatConversations';
import { finalizeChoice } from './replyChoices';
import { planningStart } from './planningStart';
import type { PlanningDocuments } from '../project/planning';

export interface AgentStartAction { label: string; description: string; text: string; kickoff?: boolean }

/** Host-owned defaults: selecting an agent never starts model work by itself. */
export function agentStartAction(id: CharacterId, docs: PlanningDocuments): AgentStartAction {
	const stage = agentMode(id);
	if (stage) {
		const title = stage === 'tree' ? 'file tree' : stage;
		const saved = planningStart(stage, docs);
		if (saved?.status.next && !saved.status.complete) {
			return { label: 'Check prerequisites', description: saved.reply, text: '', kickoff: true };
		}
		if (saved?.status.complete) {
			return { label: `Check saved ${title}`, description: 'Review the saved document and identify the next step.',
				text: `/${stage} Review the saved ${title}${stage === 'requirements' ? '' : ' against its prerequisites'}. Report specific gaps and the next step. Do not change files.` };
		}
		if (stage === 'requirements' && !docs.requirements?.trim()) {
			return { label: 'Start requirements', description: 'Check saved decisions and ask the next essential question.', text: '', kickoff: true };
		}
		return { label: stage === 'tree' ? 'Generate file tree' : stage === 'architecture' ? 'Design architecture' : 'Finalize requirements',
			description: stage === 'tree' ? 'Use saved requirements and architecture to propose the complete file plan for Keep.'
				: 'Check saved planning documents and propose this document for Keep.', text: finalizeChoice(stage).text };
	}
	const defaults: Partial<Record<CharacterId, [string, string]>> = {
		bamboo: ['Check project & next step', 'Inspect the saved project state and relevant files. Explain what is complete, any blockers, and the next agent and action. Do not change files.'],
		ada: ['Start Build', '/build'], poppy: ['Start QA', '/qa'],
		diji: ['Review project', 'Review the current project against the saved requirements and architecture. Inspect relevant source files and report actionable findings with source references. Do not change files.'],
		iris: ['Check UI & next step', 'Inspect the existing UI and saved requirements. Identify the main usability gaps and recommend the next design task. Do not change files.'],
		hopper: ['Check errors & next step', 'Inspect available project errors and recent failure evidence. Identify the next debugging step. Ask for the symptom only if relevant evidence is missing. Do not change files.'],
	};
	const chosen = character(id);
	const [label, text] = defaults[id] ?? [`Start ${chosen.role.toLowerCase()} check`,
		`Inspect the saved project documents and relevant source for your ${chosen.role} role. Report evidence, gaps and the next useful action. Ask only if essential information is missing. Do not change files.`];
	return { label, description: 'Check the current project using this agent’s role.', text };
}
