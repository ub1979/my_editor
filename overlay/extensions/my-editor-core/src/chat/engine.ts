import * as vscode from 'vscode';
import { neighbourSummary } from '../brain/brain';
import { loadCatalog, pickDefault } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { streamModel } from '../models/stream';
import { ChatTurn } from '../models/types';
import { cleanBrief } from './memory';
import { documentFromReply, elidesCode, fileFromReply } from '../pair/codeBlock';
import { currentFile, describeFile, FileContext, readProjectNote } from '../pair/context';
import { Mode, MODES, systemPrompt } from '../pair/prompts';
import { computeImpact } from '../project/impact';
import { projectEvidence } from '../project/evidence';
import { changeContext } from '../project/gitHistory';
import { planningContext } from '../project/planningContext';
import { queryTerms, sourceExcerpt } from '../project/relevance';
import { logExchange } from '../records/chatLog';
import { recordsAbout } from '../records/history';
import { loadSkills } from '../skills/loader';
import { Proposal, Proposals } from './proposals';
import { looksLikeAgentProtocol } from './agentProtocol';
import { runPairAgent } from './agentSession';
import { modelHistoryTurns } from './chatArchive';
import { configuredReasoningEffort, mergeTurns } from './modelTurns';
import { ObservationRunner } from './observationRunner';
import { currentProjectStatus } from '../project/contextStatus';
import { describeProjectStatus } from '../project/contextStatusText';
import { recentInvestigationContext } from './investigationJournal';
import { characterPrompt } from './characters';
import type { ActiveFile } from './activeFile';

const HISTORY_TURNS = 16;

/** Where a reply goes: the chat panel implements this. */
export interface Sink {
	text(markdown: string): void;
	progress(message: string): void;
	proposal(proposal: Proposal): void;
	action(label: string, command: string, args: unknown[]): void;
	error(message: string): void;
}

export interface Turn {
	readonly role: 'user' | 'assistant';
	readonly text: string;
}

export interface RunInput {
	/** What the user typed; may start with a /command. */
	readonly text: string;
	/** The skill chosen in the panel (sticky), e.g. `requirements` or `skill:debug`. */
	readonly mode?: string;
	/** A kickoff: the skill speaks first, without a visible user message. */
	readonly kickoff?: boolean;
	readonly modelKey?: string;
	/** Condensed earlier turns, kept separately from the live transcript. */
	readonly memory?: string;
	/** Recent proposal outcomes from the chat UI; refreshed every turn. */
	readonly proposalState?: string;
	/** Full stored turns before this request; long messages are fetched through read_chat when needed. */
	readonly chatArchive?: readonly Turn[];
	/** Stable id of the user's request, used for its durable investigation record. */
	readonly requestId?: string;
	readonly characterId?: string;
	/** Find and open relevant source before discussing a change; no file proposals in this turn. */
	readonly locateOnly?: boolean;
	readonly activeFile?: ActiveFile;
}

export interface RunResult {
	readonly mode: string;
	readonly reply: string;
	readonly model?: string;
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
			system: `Summarize an ongoing Pair conversation into a working brief of at most 4,500 characters. Preserve: the user's active goal, explicit constraints and preferences, accepted decisions, work completed, files changed, unresolved questions, and next steps. Separate confirmed facts from ideas or claims that still need checking. Treat assistant statements as claims unless supported by user acceptance or recorded changes. Do not invent facts. Return only the brief.`,
			turns: [{ role: 'user', text: `Previous working brief:\n${previous || '(none)'}\n\nOlder turns to incorporate:\n${turns.map(turn => `${turn.role === 'user' ? 'User' : 'Pair'}: ${turn.role === 'assistant' && looksLikeAgentProtocol(turn.text) ? '[internal tool request shown by a prior display error]' : turn.text.slice(0, 1600)}`).join('\n\n')}` }],
			token, onText: chunk => { brief += chunk; },
		});
		if (!brief.trim()) { throw new Error('The summarizing model returned no working brief.'); }
		return cleanBrief(brief);
	}

	async run(input: RunInput, history: readonly Turn[], sink: Sink, token: vscode.CancellationToken): Promise<RunResult> {
		const parsed = /^\/([\w:-]+)\s*([\s\S]*)$/.exec(input.text.trim());
		let modeId = parsed ? parsed[1] : input.mode ?? 'chat';
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
		let mode: Mode | undefined = MODES[modeId];
		if (modeId === 'skill' || modeId.startsWith('skill:')) {
			const name = modeId === 'skill' ? prompt.trim().split(/\s+/)[0] ?? '' : modeId.slice(6);
			if (modeId === 'skill') {
				prompt = prompt.trim().slice(name.length).trim();
			}
			const skill = (await loadSkills(this.extensionUri)).get(name.toLowerCase());
			if (!skill) {
				sink.text(`There is no skill called \`${name}\`. Pick one from the list at the top of the chat.`);
				return { mode: 'chat', reply: '' };
			}
			modeId = `skill:${skill.name}`;
			mode = { id: modeId, writes: skill.writes, instruction: skill.instruction };
		}
		if (!mode) {
			sink.text(`I don't know \`/${modeId}\`. Try /feature, /change, /next, /explain, /review, /brainstorm or a skill.`);
			return { mode: 'chat', reply: '' };
		}

		// The requirements interview always opens the same way: the idea first, in the user's own words.
		if (input.kickoff && mode.id === 'requirements') {
			const opener = 'What’s your idea? Tell me in your own words. A sentence or two is plenty.';
			sink.text(opener);
			return { mode: mode.id, reply: opener };
		}

		let file: FileContext | undefined;
		try {
			file = await currentFile(input.activeFile);
		} catch (err) {
			sink.error(err instanceof Error ? err.message : String(err));
			return { mode: mode.id, reply: '' };
		}
		if ((mode.writes === 'file' || mode.writes === 'selection') && !file) {
			sink.text('Open the file you want to work on, then ask again.');
			return { mode: mode.id, reply: '' };
		}
		if (mode.writes === 'file' && file?.truncated) {
			sink.text(`\`${file.relativePath}\` is too long to rewrite as a whole (over 60,000 characters). Select the part to work on and use \`/change\`.`);
			return { mode: mode.id, reply: '' };
		}
		if (mode.writes === 'selection' && !file?.selection) {
			sink.text('Select the lines to change first, or use `/feature` to change the file.');
			return { mode: mode.id, reply: '' };
		}

		const entries = await loadCatalog(this.keys);
		const entry = entries.find(e => e.key === input.modelKey) ?? pickDefault(entries);
		if (!entry) {
			sink.error('No model is set up yet. Choose one from the model menu at the bottom of the chat.');
			return { mode: mode.id, reply: '' };
		}

		const [conventions, brain, specs, neighbours, evidence, changes, plans, projectState, availableObservations, previousInvestigations] = await Promise.all([
			readProjectNote('conventions.md'), readProjectNote('brain/index.md', 12_000), this.specs(mode),
			file ? neighbourSummary(file.relativePath) : Promise.resolve(''),
			mode.id === 'chat' ? projectEvidence([prompt, ...history.slice(-4).filter(turn => turn.role === 'user').map(turn => turn.text), input.memory ?? ''].join('\n'), Math.round(entry.maxInputTokens * 0.45)) : Promise.resolve(''),
			mode.id === 'chat' ? changeContext(prompt, file?.relativePath) : Promise.resolve(''),
			mode.id === 'chat' ? planningContext(prompt) : Promise.resolve(''),
			currentProjectStatus(),
			mode.id === 'chat' ? this.observations.summary() : Promise.resolve(''),
			mode.id === 'chat' ? recentInvestigationContext(prompt) : Promise.resolve('')]);
		const records = mode.id === 'why' && file ? await recordsAbout(file.relativePath) : '';
		const subject = mode.id === 'qa'
			? await this.qaSubject(prompt)
			: mode.id === 'why' && file
				? [describeFile(file), neighbours, records ? `Project records about this file:\n${records}` : 'No decisions or chats mention this file yet.'].filter(Boolean).join('\n\n')
				: mode.writes === 'doc'
					? specs || 'No specs written yet.'
					: mode.id === 'chat'
						? [evidence, plans, changes ? `Change record:\n${changes}` : '', file ? `Open file: ${file.relativePath}\n${sourceExcerpt(file.text, queryTerms(prompt), 4000)}${file.selection ? `\nSelected text:\n${file.selectedText.slice(0, 4000)}` : ''}` : ''].filter(Boolean).join('\n\n')
						: file ? [describeFile(file), neighbours].filter(Boolean).join('\n\n') : 'No file is selected.';
		const request = input.kickoff
			? 'Begin: say in one short sentence what you will help with, then ask your first question.'
			: prompt || '(no extra instructions)';
		const recentHistory = history.slice(-HISTORY_TURNS);
		const turns: ChatTurn[] = [
			...modelHistoryTurns(recentHistory, entry.maxInputTokens),
			{ role: 'user', text: `${subject}\n\nRequest: ${request}` },
		];
		if (mode.id === 'chat') {
			const reply = await runPairAgent({ entry, input: { ...input, locateOnly }, initial: turns, conventions, brain,
			projectStatus: describeProjectStatus(projectState), projectState, availableObservations,
				previousInvestigations, sink, token, keys: this.keys, proposals: this.proposals,
				observations: this.observations });
			void logExchange({ mode: mode.id, model: entry.label, file: file?.relativePath, prompt: input.kickoff ? '(started)' : prompt, reply });
			return { mode: mode.id, reply, model: entry.label };
		}

		let reply = '';
		let shown = 0;
		let writing = false;
		await streamModel(entry, this.keys, {
			system: [systemPrompt(mode, conventions, brain, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath), characterPrompt(input.characterId), describeProjectStatus(projectState), input.memory ? `Working brief from earlier turns (refresh facts against the current brain, source and Git):\n${input.memory}` : ''].filter(Boolean).join('\n\n'),
			turns: mergeTurns(turns),
			token,
			reasoningEffort: entry.provider === 'codex-cli' ? configuredReasoningEffort() : undefined,
			onText: chunk => {
				reply += chunk;
				if (mode!.writes === 'none') {
					sink.text(chunk);
					return;
				}
				if (writing) {
					return;
				}
				// Show prose; once a code block starts, show progress instead of the code.
				const fence = reply.indexOf('```');
				const safeEnd = fence >= 0 ? fence : Math.max(shown, reply.length - 2);
				if (safeEnd > shown) {
					sink.text(reply.slice(shown, safeEnd));
					shown = safeEnd;
				}
				if (fence >= 0) {
					writing = true;
					sink.progress(`Writing ${mode!.doc ?? file?.relativePath ?? 'the change'}…`);
				}
			},
		});
		if (token.isCancellationRequested) {
			return { mode: mode.id, reply, model: entry.label };
		}
		if (mode.writes !== 'none' && !writing && reply.length > shown) {
			sink.text(reply.slice(shown));
		}
		if (mode.writes === 'doc') {
			await this.proposeDoc(mode, reply, sink);
		} else if ((mode.writes === 'file' || mode.writes === 'selection') && file) {
			await this.proposeEdit(mode, file, reply, sink);
		}
		if (mode.id === 'brainstorm' && reply.trim() && !input.kickoff) {
			sink.action('Save as decision', 'myEditor.saveDecision', [{ title: prompt, context: prompt, discussion: reply }]);
		}
		void logExchange({ mode: mode.id, model: entry.label, file: file?.relativePath, prompt: input.kickoff ? '(started)' : prompt, reply });
		return { mode: mode.id, reply, model: entry.label };
	}

	private async proposeEdit(mode: Mode, file: FileContext, reply: string, sink: Sink): Promise<void> {
		const code = fileFromReply(reply);
		if (code === undefined) {
			sink.text('\n\n_No code came back, so nothing was changed._');
			return;
		}
		if (mode.writes === 'file' && elidesCode(code)) {
			sink.text('\n\n_The reply left out parts of the file ("… existing code …"), which would delete them, so nothing was changed. Try again, or select the part to change and use `/change`._');
			return;
		}
		const document = await vscode.workspace.openTextDocument(file.uri);
		let proposed: string;
		if (mode.writes === 'selection' && file.selection) {
			const text = document.getText();
			proposed = text.slice(0, document.offsetAt(file.selection.start)) + code + text.slice(document.offsetAt(file.selection.end));
		} else {
			proposed = document.getText().endsWith('\n') && !code.endsWith('\n') ? `${code}\n` : code;
		}
		sink.proposal(await this.proposals.propose(file.uri, proposed));
	}

	private async proposeDoc(mode: Mode, reply: string, sink: Sink): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		const content = mode.doc ? documentFromReply(reply, mode.doc) : undefined;
		if (!root || !mode.doc || content === undefined) {
			return; // Still interviewing: nothing to write yet.
		}
		sink.proposal(await this.proposals.propose(vscode.Uri.joinPath(root, mode.doc), content.endsWith('\n') ? content : `${content}\n`));
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

	private async qaSubject(prompt: string): Promise<string> {
		const reportPath = /\.my_editor\/qa\/\S+\.md/.exec(prompt)?.[0];
		if (!reportPath) {
			return 'No fit report given. Right-click files or a folder and choose "Check How These Fit".';
		}
		const report = await readProjectNote(reportPath.replace(/^\.my_editor\//, ''), 20_000);
		const architecture = await readProjectNote('specs/architecture.md', 15_000);
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		const files = [...report.matchAll(/^- `([^`]+)`$/gm)].map(m => m[1]);
		let budget = 40_000;
		const contents: string[] = [];
		for (const path of files) {
			if (!root || budget <= 0) {
				break;
			}
			try {
				const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, path))).slice(0, budget);
				budget -= text.length;
				contents.push(`${path}:\n${text}`);
			} catch {
				// Moved or deleted since the check; the report still lists it.
			}
		}
		return [`Fit report (${reportPath}):\n${report}`, architecture ? `Architecture:\n${architecture}` : '', ...contents].filter(Boolean).join('\n\n');
	}

	private async specs(mode: Mode): Promise<string> {
		const parts = await Promise.all((mode.reads ?? []).map(async path => {
			const text = await readProjectNote(path.replace(/^\.my_editor\//, ''), 30_000);
			return text ? `${path}:\n${text}` : '';
		}));
		return parts.filter(Boolean).join('\n\n');
	}
}
