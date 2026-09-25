import * as vscode from 'vscode';
import { streamModel } from '../models/stream';
import { ApiKeys } from '../models/secrets';
import { ChatTurn, ModelEntry } from '../models/types';
import { Mode, systemPrompt } from '../pair/prompts';
import { ProjectContextStatus } from '../project/contextStatusText';
import { Proposals } from './proposals';
import { AGENT_INSTRUCTION } from './agentProtocol';
import { runAgentLoop } from './agentLoop';
import { AgentTools } from './agentTools';
import { chatArchiveIndex, readChatMessage, searchChatMessages } from './chatArchive';
import type { RunInput, Sink } from './engine';
import { saveInvestigation } from './investigationJournal';
import { evidenceEntry, EvidenceEntry } from './investigationRecord';
import { configuredReasoningEffort, mergeTurns } from './modelTurns';
import { ObservationRunner } from './observationRunner';
import { characterPrompt } from './characters';
import { mayProposeFile } from './projectToolPolicy';

export interface AgentSessionOptions {
	readonly entry: ModelEntry;
	readonly mode: Mode;
	readonly input: RunInput;
	readonly initial: ChatTurn[];
	readonly conventions: string;
	readonly brain: string;
	readonly projectStatus: string;
	readonly projectState?: ProjectContextStatus;
	readonly availableObservations: string;
	readonly previousInvestigations: string;
	readonly sink: Sink;
	readonly token: vscode.CancellationToken;
	readonly keys: ApiKeys;
	readonly proposals: Proposals;
	readonly observations: ObservationRunner;
}

/** One model/tool conversation, with host evidence recorded apart from the model's conclusion. */
export async function runPairAgent(options: AgentSessionOptions): Promise<string> {
	const { entry, input, initial, conventions, brain, sink, token, keys, proposals, observations } = options;
	const tools = new AgentTools(proposals, token, observations);
	const chatArchive = input.chatArchive ?? initial.slice(0, -1);
	const evidence: EvidenceEntry[] = [];
	const system = [
			systemPrompt(options.mode, conventions, brain, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
			characterPrompt(input.characterId),
		options.projectStatus,
		options.availableObservations,
		options.previousInvestigations ? `Recent investigations (prior reports are leads, not verified current facts):\n${options.previousInvestigations}` : '',
		input.memory ? `Working brief from earlier turns (refresh facts against current source and Git):\n${input.memory}` : '',
		input.proposalState ? `Recent Pair proposals (Git and current files remain authoritative for kept changes):\n${input.proposalState}` : '',
		input.locateOnly ? 'This turn is a change map. Search and read the current project, follow relevant callers and tests, and open the best matching files at verified lines with open_files. Report the file count, path:line, why each matters, and any search coverage limit. Discuss the approach with the developer. Do not propose or edit code in this turn.' : '',
		options.mode.id === 'review' ? 'This is a read-only review. Use project tools to inspect current source behind technical claims in the open file. Cite the paths and lines checked. Separate an observed design choice from a guessed motive; when evidence is missing, say exactly what could not be checked. Do not propose or edit files.' : '',
		chatArchiveIndex(chatArchive),
		AGENT_INSTRUCTION,
	].filter(Boolean).join('\n\n');
	const last = await runAgentLoop({
		initial,
		requireCheck: options.mode.id === 'review' ? call => call.name === 'read_file' || call.name === 'search' : undefined,
		cancelled: () => token.isCancellationRequested,
		progress: message => sink.progress(message),
		ask: async (turns, finalOnly, remaining) => {
			let response = '';
			await streamModel(entry, keys, {
				system: [system,
					finalOnly ? 'No more host tools are available in this run. Output action=final with confirmed findings, proposals awaiting Keep, and remaining work.'
						: remaining <= 8 ? `Only ${remaining} host tool calls remain. Finish the task or prepare a useful final answer.` : '',
				].filter(Boolean).join('\n\n'),
				turns: mergeTurns(turns), token,
				reasoningEffort: entry.provider === 'codex-cli' ? configuredReasoningEffort() : undefined,
				onText: chunk => { response += chunk; },
			});
			return response;
		},
		execute: async call => {
			if (call.name === 'propose_file' && !mayProposeFile(options.mode.id, !!input.locateOnly)) { return 'This turn is read-only. Explain the findings and let the developer choose whether to request a fix.'; }
			if (call.name === 'read_chat') { return readChatMessage(chatArchive, call.arguments); }
			if (call.name === 'search_chat') { return searchChatMessages(chatArchive, call.arguments.query); }
			const result = await tools.execute(call.name, call.arguments);
			if (result.proposalId) {
				const proposal = proposals.get(result.proposalId);
				if (proposal) { sink.proposal(proposal); }
			}
			return result.text;
		},
		onObservation: (call, result) => { evidence.push(evidenceEntry(call.name, call.arguments, result)); },
	});
	sink.progress('');
	if (last) { sink.text(last); }
	if (last && !token.isCancellationRequested && input.requestId) {
		try {
			await saveInvestigation({
				id: input.requestId, at: new Date().toISOString(), model: entry.label,
				projectHead: options.projectState?.head, brainCommit: options.projectState?.brainCommit,
				question: input.text, answer: last, evidence,
			});
		} catch { sink.error('Pair answered, but could not save the investigation record.'); }
	}
	return last;
}
