import * as vscode from 'vscode';
import { streamModel } from '../models/stream';
import { ApiKeys } from '../models/secrets';
import { ChatTurn, ModelEntry, NativeToolCall } from '../models/types';
import { Mode, systemPrompt } from '../pair/prompts';
import { ProjectContextStatus } from '../project/contextStatusText';
import { Proposals } from './proposals';
import { AGENT_INSTRUCTION } from './agentProtocol';
import { runProjectAgent } from '../runtime/projectRuntime';
import { AgentTools } from './agentTools';
import { chatArchiveIndex, readChatMessage, searchChatMessages } from './chatArchive';
import type { RunInput, Sink } from './engine';
import { saveInvestigation } from './investigationJournal';
import { evidenceEntry, EvidenceEntry } from './investigationRecord';
import { mergeTurns } from './modelTurns';
import { ObservationRunner } from './observationRunner';
import { characterPrompt } from './characters';
import { mayProposeFile, mayUsePlanningTool } from './projectToolPolicy';
import { proposeDoc } from './engineEdit';
import { mayRevisePlanningPath, READ_ONLY_REQUEST_NOTE, requestsRevision } from './requestPolicy';
import { planningRecovery, PLANNING_INCOMPLETE } from './planningRecovery';
import { documentFromReply } from '../pair/codeBlock';
import { planningReplyPreview } from '../pair/fencedBlocks';
import { pairWebAccess, WEB_ACCESS_NOTE } from '../models/webAccess';

/** The locate-only turn: map where a change belongs, open the files, and propose nothing. */
const CHANGE_MAP_NOTE = 'This turn is a change map. Search and read the current project, follow relevant callers and tests, and open '
	+ 'the best matching files at verified lines with open_files. Report the file count, path:line, why each '
	+ 'matters, and any search coverage limit. Discuss the approach with the developer. Do not propose or edit code '
	+ 'in this turn.';
/** A review reads current source behind its claims and never proposes edits. */
const REVIEW_NOTE = 'This is a read-only review. Use project tools to inspect current source behind technical claims in the open '
	+ 'file. Cite the paths and lines checked. Separate an observed design choice from a guessed motive; when '
	+ 'evidence is missing, say exactly what could not be checked. Do not propose or edit files.';
const READ_ONLY_TURN = 'This turn is read-only. Explain the findings and let the developer choose whether to request a fix.';

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
	const work = new vscode.CancellationTokenSource();
	const parent = options.token.onCancellationRequested(() => work.cancel());
	if (options.token.isCancellationRequested) { work.cancel(); }
	try { return await runSupervisedSession({ ...options, token: work.token }, options.token, () => work.cancel()); }
	finally { parent.dispose(); work.dispose(); }
}

async function runSupervisedSession(options: AgentSessionOptions, parentToken: vscode.CancellationToken, abortRuntimeWork: () => void): Promise<string> {
	const { entry, input, initial, conventions, brain, sink, token, keys, proposals, observations } = options;
	const tools = new AgentTools(proposals, token, observations, input.onSourceRead);
	const chatArchive = input.chatArchive ?? initial.slice(0, -1);
	const evidence: EvidenceEntry[] = [];
	const web = pairWebAccess(entry);
	const planning = options.mode.writes === 'doc';
	const reviewing = !!input.readOnly;
	const system = [
			systemPrompt(options.mode, conventions, brain, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
			characterPrompt(input.characterId),
		options.projectStatus,
		options.availableObservations,
		options.previousInvestigations ? `Recent investigations (prior reports are leads, not verified current facts):\n${options.previousInvestigations}` : '',
		input.memory ? `Working brief from earlier turns (refresh facts against current source and Git):\n${input.memory}` : '',
		input.proposalState ? `Recent AI proposals (Git and current files remain authoritative for kept changes):\n${input.proposalState}` : '',
		input.locateOnly ? CHANGE_MAP_NOTE : '',
		options.mode.id === 'review' ? REVIEW_NOTE : '',
		chatArchiveIndex(chatArchive),
		web ? WEB_ACCESS_NOTE : '',
		AGENT_INSTRUCTION,
		input.stageFile ? 'This is one file or an explicitly listed small related-file batch in a host-controlled Build or QA pass. Use read-only project tools to inspect actual contracts and tests. '
			+ 'Use propose_file for complete changes or propose_edit for exact replacements only in the authorized target paths. The host applies the selected write permission after your reply; do not ask for Keep or continuation. '
			+ 'A focused file brief, linked planning excerpts and the complete current file are supplied already: use the brain and lookup paths for actual dependencies and tests, and avoid repeating satisfied reads. '
			+ 'Follow the final FILE_REVIEWED or BLOCKED format in the request.' : '',
		planning ? `The active planning target is ${options.mode.doc}. Only propose that document in this turn. `
			+ 'If another stage should come next, explain it and offer a choice; do not generate another document under this target. '
			+ 'For this planning turn, only read-only tools are available: list_files, search, read_file, git_history, '
			+ 'read_chat, search_chat and search_records. Retrieve earlier agreed decisions when needed. '
			+ 'Return your response in action=final; its message must include the complete fenced document when ready, '
			+ 'as required by this planning mode. The host prepares a Keep/Undo proposal for the designated document. '
			+ 'Do not call propose_file, propose_edit or propose_delete, and do not claim the document is already saved.' : '',
		reviewing ? READ_ONLY_REQUEST_NOTE : '',
	].filter(Boolean).join('\n\n');
	const last = await runProjectAgent({
		initial,
		fileReview: !!input.stageFile,
		// Repairs also need their dependency bodies after more than four reads. Keep a bounded,
		// deduplicated evidence set for every project conversation, not just queued file passes.
		retainedResultChars: Math.min(120_000, entry.maxInputTokens),
		toolsAvailable: !!vscode.workspace.workspaceFolders?.length,
		pendingProposal: () => !input.stageFile && proposals.hasOpenProposal,
		deferredProposal: planning && !reviewing,
		finalRecovery: input.stageFile ? {
			correction: message => /^BLOCKED\b/.test(message.trim()) ? input.fileBlockedProblem?.(message)
				: /^FILE_REVIEWED\s*\n\s*\S/.test(message.trim()) ? input.fileResultProblem?.()
					: 'Return action=final JSON whose message starts with FILE_REVIEWED on its own line and your findings, or BLOCKED and the precise decision needed.',
			failure: 'The model did not finish this file review. Resume to retry.',
		} : planning && !reviewing && requestsRevision(input.text, chatArchive)
			? { correction: message => planningRecovery(message, options.mode.doc!), failure: PLANNING_INCOMPLETE } : undefined,
		requireCheck: options.mode.id === 'review' || reviewing && options.mode.writes === 'none' && ['requirements', 'architecture', 'tree'].includes(options.mode.id)
			? call => call.name === 'read_file' || call.name === 'search' : undefined,
		cancelled: () => token.isCancellationRequested,
		abortRuntimeWork,
		progress: message => sink.progress(message),
		ask: async (turns, finalOnly, remaining) => {
			let response = '';
			const nativeCalls: NativeToolCall[] = [];
			let nextProgress = 0;
			await streamModel(entry, keys, {
				system: [system,
					finalOnly ? 'No more host tools are available in this run. Output action=final with confirmed findings and remaining work. The host controls proposal saving.'
						: remaining <= 8 ? `Only ${remaining} host tool calls remain. Finish the task or prepare a useful final answer.` : '',
				].filter(Boolean).join('\n\n'),
				turns: mergeTurns(turns), token,
				webAccess: web, onActivity: label => { if (label) { sink.progress(label); } },
				onToolCalls: calls => { nativeCalls.push(...calls); },
				onText: chunk => {
					response += chunk;
					if (Date.now() < nextProgress) { return; }
					const prefix = response.slice(0, 500);
					const activity = /"name"\s*:\s*"propose_(?:file|edit)"|"action"\s*:\s*"propose_(?:file|edit)"/.test(prefix)
						? 'Writing proposed code…' : /"action"\s*:\s*"final"/.test(prefix)
							? planning ? `Preparing the ${options.mode.doc} response…`
								: input.stageFile ? 'Preparing the file summary…' : 'Preparing the response…' : '';
					if (activity) { sink.progress(activity); nextProgress = Date.now() + 500; }
				},
			});
			if (nativeCalls.length) {
				evidence.push(evidenceEntry('native_tool_request', { id: entry.label }, JSON.stringify(nativeCalls)));
				// Native requests enter the same parser and tool host as JSON replies. Batches still
				// permit only read operations; proposals never bypass staging or Keep permission.
				return JSON.stringify(nativeCalls.length === 1 ? { action: 'tool', ...nativeCalls[0] }
					: { action: 'tools', calls: nativeCalls });
			}
			return response;
		},
		execute: async call => {
			if (input.stageFile && !mayUsePlanningTool(call.name)) {
				if (!['propose_file', 'propose_edit'].includes(call.name) || token.isCancellationRequested) { return 'Only scoped proposals and read-only retrieval are available.'; }
				if (call.name === 'propose_edit') {
					try {
						const edit = await tools.prepareEdit(call.arguments.path, call.arguments.edits);
						return input.stageFile(edit.relative, edit.content);
					} catch (error) { return `Tool error: ${error instanceof Error ? error.message : String(error)}`; }
				}
				return input.stageFile(call.arguments.path, call.arguments.content);
			}
			if (reviewing && !mayUsePlanningTool(call.name) && call.name !== 'open_files') { return READ_ONLY_TURN; }
			if (['propose_file', 'propose_edit', 'propose_delete'].includes(call.name)
				&& !mayRevisePlanningPath(call.arguments.path, input.text, chatArchive)) { return 'This request does not authorize revising that planning document. Report the issue with its path and requirement IDs.'; }
			if (planning && !mayUsePlanningTool(call.name)) { return 'Planning allows only read-only retrieval. Return the complete document in the final message for Keep/Undo.'; }
			if (['propose_file', 'propose_edit', 'propose_delete'].includes(call.name) && !mayProposeFile(options.mode.id, !!input.locateOnly)) { return READ_ONLY_TURN; }
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
		onConclusionCorrection: (message, reason) => {
			evidence.push(evidenceEntry('model_conclusion_correction', { id: entry.label }, `${reason}\nModel conclusion: ${message.slice(0, 2000)}`));
		},
		onMalformedReply: reply => {
			// Retain a redacted, bounded protocol sample for provider diagnosis, without a thinking prelude.
			const body = reply.replace(/^[\s\S]*?<\/think>/i, '').trim();
			let problem = 'Unsupported action shape';
			try { JSON.parse(body); } catch (error) { problem = String(error); }
			evidence.push(evidenceEntry('model_protocol_error', { id: entry.label },
				`${problem}\nReply length: ${body.length}\n${body.slice(0, 900)}\nReply ending: ${body.slice(-250)}`));
		},
	}, parentToken);

	sink.progress('');
	if (last && planning && !token.isCancellationRequested) {
		sink.archive?.(last);
		try {
			if (reviewing) {
				const document = documentFromReply(last, options.mode.doc!);
				sink.text(document ? 'The model returned a replacement document during a read-only check. No replacement was prepared and your saved plan is unchanged.' : last);
			} else {
				const document = await proposeDoc(proposals, options.mode, last, sink);
				sink.text(planningReplyPreview(last, document));
			}
		}
		catch (error) {
			sink.error(error instanceof Error ? error.message : String(error));
			sink.text('The planning document could not be prepared for Keep. Your saved files are unchanged.');
		}
	} else if (last) { sink.text(last); }
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
