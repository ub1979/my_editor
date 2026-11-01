import type { Proposal } from './proposals';
import type { ActiveFile } from './activeFile';
import type { PlanningStatus } from './planningStart';

/** Where a reply goes: the chat panel implements this. */
export interface Sink {
	text(markdown: string): void;
	archive?(markdown: string): void;
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
	readonly planningStatus?: PlanningStatus;
}

