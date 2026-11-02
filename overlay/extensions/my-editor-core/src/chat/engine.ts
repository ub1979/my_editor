import * as vscode from 'vscode';
import { neighbourSummary } from '../brain/brain';
import { loadCatalog, pickDefault } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { streamModel } from '../models/stream';
import { ChatTurn } from '../models/types';
import { BRIEF_SYSTEM, briefRequest, cleanBrief } from './memory';
import { describeFile, FileContext, readProjectNote } from '../pair/context';
import { systemPrompt } from '../pair/prompts';
import { computeImpact } from '../project/impact';
import { projectEvidence } from '../project/evidence';
import { changeContext } from '../project/gitHistory';
import { planningContext } from '../project/planningContext';
import { queryTerms, sourceExcerpt } from '../project/relevance';
import { logExchange } from '../records/chatLog';
import { recordsAbout } from '../records/history';
import { Proposals } from './proposals';
import { runPairAgent } from './agentSession';
import { modelHistoryTurns } from './chatArchive';
import { ObservationRunner } from './observationRunner';
import { currentProjectStatus } from '../project/contextStatus';
import { describeProjectStatus } from '../project/contextStatusText';
import { recentInvestigationContext } from './investigationJournal';
import { characterPrompt } from './characters';
import { usesProjectTools } from './projectToolPolicy';
import { pairWebAccess, WEB_ACCESS_NOTE } from '../models/webAccess';
import { offerPush } from './pushOffer';
import { qaSubject, specs as readSpecs } from './engineDocuments';
import { planningIntent } from './planningIntent';
import { isPlanningStage, planningKickoffPrompt, planningStart } from './planningStart';
import { scaffoldKeptTree } from '../project/tree';
import { readPlanningDocuments } from '../project/planningFiles';
import { streamEdit } from './engineEdit';
import { readModeFile, resolveMode } from './engineMode';
import { readOnlyRequest, READ_ONLY_REQUEST_NOTE, requestsPlannedFiles } from './requestPolicy';

const HISTORY_TURNS = 16;

export type { Sink, Turn, RunInput, RunResult } from './engineTypes';
import type { Sink, Turn, RunInput, RunResult } from './engineTypes';

/** The open file's most relevant source for the request, plus the selected text when there is one. */
function openFileExcerpt(file: FileContext, prompt: string): string {
	const selected = file.selection ? `\nSelected text:\n${file.selectedText.slice(0, 4000)}` : '';
	return `Open file: ${file.relativePath}\n${sourceExcerpt(file.text, queryTerms(prompt), 4000)}${selected}`;
}

/** Interview-style skills keep going across turns; code-writing ones run once per request. */
export const CONVERSATIONAL = new Set(['requirements', 'architecture', 'tree', 'brainstorm']);

/**
 * The pair's brain, independent of any UI: picks the mode, gathers context, asks the model, streams the
 * reply, and turns code into proposals the user reviews. Nothing is written without Keep.
 */
export class PairEngine {
	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly keys: ApiKeys,
		private readonly proposals: Proposals,
		private readonly observations: ObservationRunner,
	) {}

	/** Preserve older user intent before those turns leave the model's live context. */
	async compactHistory(previous: string, turns: readonly Turn[], token: vscode.CancellationToken): Promise<string> {
		const entries = await loadCatalog(this.keys);
		const entry = pickDefault(entries);
		if (!entry) { throw new Error('No model is available to compact conversation history.'); }
		let brief = '';
		await streamModel(entry, this.keys, {
			system: BRIEF_SYSTEM,
			turns: [{ role: 'user', text: briefRequest(previous, turns) }],
			token, onText: chunk => { brief += chunk; },
		});
		if (!brief.trim()) { throw new Error('The summarizing model returned no working brief.'); }
		return cleanBrief(brief);
	}

	async run(input: RunInput, history: readonly Turn[], sink: Sink, token: vscode.CancellationToken): Promise<RunResult> {
		const parsed = /^\/([\w:-]+)\s*([\s\S]*)$/.exec(input.text.trim());
		let modeId = parsed ? parsed[1] : planningIntent(input.text) ?? input.mode ?? 'chat';
		let prompt = parsed ? parsed[2] : input.text;
		const locateOnly = input.locateOnly || modeId === 'locate';
		if (modeId === 'locate') { modeId = 'chat'; }

		if (modeId === 'impact') {
			await this.impact(prompt, sink);
			return { mode: 'impact', reply: '' };
		}
		if (modeId === 'changes') {
			const report = await changeContext(prompt, undefined, true);
			sink.text(report);
			return { mode: 'changes', reply: report };
		}
		const resolved = await resolveMode(this.extensionUri, modeId, prompt, sink);
		if (!resolved) { return { mode: 'chat', reply: '' }; }
		let { mode } = resolved;
		prompt = resolved.prompt;
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (root && mode.id === 'tree' && requestsPlannedFiles(prompt)) {
			const result = await scaffoldKeptTree(root);
			const reply = `Created ${result.created} missing planned files as stubs from the saved tree. Existing files were preserved. `
				+ 'No requirements, architecture or tree design was regenerated.'
				+ (result.skipped.length ? ` Could not create: ${result.skipped.join('; ')}` : '');
			sink.text(reply);
			await logExchange({ mode: 'tree', model: 'my_editor', prompt, reply }).catch(() => sink.error('Could not save the chat archive.'));
			return { mode: 'tree', reply, planningStatus: { complete: true } };
		}
		if (input.kickoff && root && isPlanningStage(mode.id)) {
			const start = planningStart(mode.id, await readPlanningDocuments(root));
			if (start) {
				sink.text(start.reply);
				await logExchange({ mode: mode.id, model: 'my_editor', prompt: '(opened skill)', reply: start.reply })
					.catch(() => sink.error('Could not save the chat archive.'));
				return { mode: mode.id, reply: start.reply, planningStatus: start.status };
			}
		}

		// The requirements interview always opens the same way: the idea first, in the user's own words.
		if (input.kickoff && mode.id === 'requirements' && !history.length && !await readProjectNote('specs/requirements.md')) {
			const opener = 'What’s your idea? Tell me in your own words. A sentence or two is plenty.';
			sink.text(opener);
			return { mode: mode.id, reply: opener };
		}

		const docs = root ? await readPlanningDocuments(root) : {};
		const readOnly = readOnlyRequest(prompt, mode.id, docs, !!input.kickoff, history);
		if (readOnly && (mode.writes === 'file' || mode.writes === 'selection')) { mode = { ...mode, writes: 'none' }; }

		const file = await readModeFile(mode, input, sink);
		if (file === false) { return { mode: mode.id, reply: '' }; }

		const entries = await loadCatalog(this.keys);
		const entry = entries.find(e => e.key === input.modelKey) ?? pickDefault(entries);
		if (!entry) {
			sink.error('No model is set up yet. Choose one from the model menu at the bottom of the chat.', 'chooseModel');
			return { mode: mode.id, reply: '' };
		}

		const recentAsks = history.slice(-4).filter(turn => turn.role === 'user').map(turn => turn.text);
		const evidenceQuery = [prompt, ...recentAsks, input.memory ?? ''].join('\n');
		const [
			conventions, brain, specs, neighbours, evidence, changes, plans, projectState, availableObservations, previousInvestigations,
		] = await Promise.all([
			readProjectNote('conventions.md'), readProjectNote('brain/index.md', 12_000), readSpecs(mode, entry.maxInputTokens),
			file ? neighbourSummary(file.relativePath) : Promise.resolve(''),
			mode.id === 'chat' ? projectEvidence(evidenceQuery, Math.round(entry.maxInputTokens * 0.45)) : Promise.resolve(''),
			mode.id === 'chat' ? changeContext(prompt, file?.relativePath) : Promise.resolve(''),
			mode.id === 'chat' ? planningContext(prompt) : Promise.resolve(''),
			currentProjectStatus(),
			mode.id === 'chat' ? this.observations.summary() : Promise.resolve(''),
			mode.id === 'chat' ? recentInvestigationContext(prompt) : Promise.resolve('')]);
		const records = mode.id === 'why' && file ? await recordsAbout(file.relativePath) : '';
		const subject = mode.id === 'qa'
			? await qaSubject(prompt)
			: mode.id === 'why' && file
				? [
					describeFile(file), neighbours,
					records ? `Project records about this file:\n${records}` : 'No decisions or chats mention this file yet.',
				].filter(Boolean).join('\n\n')
				: mode.writes === 'doc'
					? specs || 'No specs written yet.'
					: mode.id === 'chat'
						? [evidence, plans, changes ? `Change record:\n${changes}` : '', file ? openFileExcerpt(file, prompt) : ''].filter(Boolean).join('\n\n')
						: file ? [describeFile(file), neighbours].filter(Boolean).join('\n\n') : 'No file is selected.';
		const request = input.kickoff
			? mode.writes === 'doc'
				? planningKickoffPrompt(mode.id, mode.doc ?? mode.id)
				: 'Begin: say in one short sentence what you will help with, then ask your first question.'
			: prompt || '(no extra instructions)';
		const recentHistory = history.slice(-HISTORY_TURNS);
		const turns: ChatTurn[] = [
			...modelHistoryTurns(recentHistory, entry.maxInputTokens),
			{ role: 'user', text: `${subject}\n\nRequest: ${request}` },
		];
		if (usesProjectTools(mode)) {
			const reply = await runPairAgent({ entry, mode, input: { ...input, locateOnly, readOnly }, initial: turns, conventions, brain,
			projectStatus: describeProjectStatus(projectState), projectState, availableObservations,
				previousInvestigations, sink, token, keys: this.keys, proposals: this.proposals,
				observations: this.observations });
			if (mode.id === 'brainstorm' && reply.trim() && !input.kickoff) {
				sink.action('Save as decision', 'myEditor.saveDecision', [{ title: prompt, context: prompt, discussion: reply }]);
			}
			if (!input.kickoff) { offerPush(prompt, sink); }
			await logExchange({ mode: mode.id, model: entry.label, file: file?.relativePath, prompt: input.kickoff ? '(started)' : prompt, reply })
				.catch(() => sink.error('Pair answered, but could not save the chat archive.'));
			return { mode: mode.id, reply, model: entry.label, readOnly };
		}

		const reply = await streamEdit(entry, this.keys, this.proposals, mode, file, turns, [
			systemPrompt(mode, conventions, brain, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
			readOnly ? READ_ONLY_REQUEST_NOTE : '',
			characterPrompt(input.characterId), pairWebAccess(entry) ? WEB_ACCESS_NOTE : '', describeProjectStatus(projectState),
			input.memory ? `Working brief from earlier turns (refresh facts against current source and Git):\n${input.memory}` : '',
		].filter(Boolean).join('\n\n'), sink, token);
		if (token.isCancellationRequested) { return { mode: mode.id, reply, model: entry.label, readOnly }; }
		if (mode.id === 'brainstorm' && reply.trim() && !input.kickoff) {
			sink.action('Save as decision', 'myEditor.saveDecision', [{ title: prompt, context: prompt, discussion: reply }]);
		}
		if (!input.kickoff) { offerPush(prompt, sink); }
		await logExchange({ mode: mode.id, model: entry.label, file: file?.relativePath, prompt: input.kickoff ? '(started)' : prompt, reply })
			.catch(() => sink.error('Pair answered, but could not save the chat archive.'));
		return { mode: mode.id, reply, model: entry.label, readOnly };
	}

	private async impact(change: string, sink: Sink): Promise<void> {
		const impact = await computeImpact();
		if (!impact) {
			sink.text('Open the file, requirement or architecture section you changed, put the cursor on it, and ask again.');
			return;
		}
		if (!impact.files.length) {
			sink.text(`Nothing else depends on ${impact.subject}, as far as the project brain, the tree and the language server can tell.`);
			return;
		}
		const description = change.trim() || `a change to ${impact.subject.replace(/`/g, '')}`;
		sink.text(`**${impact.files.length} file${impact.files.length === 1 ? '' : 's'}** may need to follow ${impact.subject}:\n\n`
			+ impact.files.map(f => `- \`${f.path}\`: ${f.reason}`).join('\n')
			+ '\n\nAdapt them one at a time. Each change comes back for you to keep or undo.');
		for (const file of impact.files.slice(0, 12)) {
			sink.action(`Adapt ${file.path.split('/').pop()}`, 'myEditor.adaptFile', [file.path, description]);
		}
	}

}
