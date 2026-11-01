import type * as vscode from 'vscode';
import type { ActiveFile } from './activeFile';
import type { ChatState } from './chatState';
import type { PairEngine, Sink } from './engine';
import { fallbackBrief, liveTurns, memoryBatch, MemoryMessage } from './memory';
import type { Message } from './presentation';
import { isPlanningStage } from './planningStart';

/** One request to answer: what the user sent and the empty reply it streams into. */
export interface ChatTurn {
	readonly text: string;
	readonly mode: string | undefined;
	readonly kickoff: boolean;
	readonly reply: Message;
	/** The request asks where to change something, so the reply maps the project instead of proposing code. */
	readonly locateOnly: boolean;
	/** Earlier finished turns, for the working brief and the chat archive. */
	readonly history: readonly MemoryMessage[];
}

/** What answering a turn reads and updates. */
export interface TurnContext {
	readonly state: ChatState;
	readonly engine: Pick<PairEngine, 'compactHistory' | 'run'>;
	readonly activeFile: () => ActiveFile | undefined;
	/** Modes that stay on after a reply (conversations); every other mode runs once. */
	readonly conversational: ReadonlySet<string>;
	readonly save: () => void;
}

/** Folds older turns into the working brief, then asks the model with the recent turns. */
export async function runChatTurn(turn: ChatTurn, context: TurnContext, sink: Sink, token: vscode.CancellationToken): Promise<void> {
	if (token.isCancellationRequested) { return; }
	const { state } = context;
	if (!isDeterministic(turn.text, turn.mode) && !(turn.kickoff && isPlanningStage(turn.mode ?? ''))) {
		const compacted = await compactMemory(turn.history, context, sink, token);
		if (!compacted) {
			return;
		}
	}
	sink.progress('');
	const live = liveTurns(turn.history, state.memory).map(item => ({ role: item.role, text: item.text }));
	const result = await context.engine.run({
		text: turn.text,
		mode: turn.mode,
		kickoff: turn.kickoff,
		characterId: turn.reply.characterId,
		locateOnly: turn.locateOnly,
		activeFile: context.activeFile(),
		memory: state.memory.brief,
		proposalState: state.proposalStates(),
		requestId: turn.reply.id,
		chatArchive: turn.history.map(item => ({ role: item.role, text: item.text })),
	}, live, sink, token);
	if (!token.isCancellationRequested) { turn.reply.planningStatus = result.planningStatus; turn.reply.readOnly = result.readOnly; }
	if (!token.isCancellationRequested && endsMode(result.mode, state.mode, turn.mode, context.conversational)) {
		state.mode = undefined;
	}
}

/** Change history and impact answers come from Git, not the model, so they need no working brief. */
export function isDeterministic(text: string, mode: string | undefined): boolean {
	return mode === 'changes' || mode === 'impact' || /^\/(changes|impact)\b/.test(text.trim());
}

/**
 * Conversations keep their skill; code-writing requests run once, then chat is plain again.
 * Skills stay, and so does a mode the user changed while the reply ran.
 */
export function endsMode(resultMode: string, current: string | undefined, requested: string | undefined,
	conversational: ReadonlySet<string>): boolean {
	return !conversational.has(resultMode) && current === requested && requested !== undefined && !requested.startsWith('skill:');
}

/** Compacts batch after batch of older turns; false when the user stopped it. */
async function compactMemory(history: readonly MemoryMessage[], context: TurnContext, sink: Sink,
	token: vscode.CancellationToken): Promise<boolean> {
	const { state } = context;
	let batch = memoryBatch(history, state.memory);
	while (batch.length) {
		sink.progress('Keeping track of earlier conversation…');
		let brief: string;
		try {
			brief = await context.engine.compactHistory(state.memory.brief, batch, token);
		} catch {
			brief = fallbackBrief(state.memory.brief, batch);
		}
		if (token.isCancellationRequested) {
			return false;
		}
		state.memory = { brief, throughId: batch[batch.length - 1].id };
		context.save();
		batch = memoryBatch(history, state.memory);
	}
	return true;
}
