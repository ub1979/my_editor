import { character, CharacterId } from './characters';
import type { MemoryMessage, MemoryState } from './memory';
import { labelFor, Message } from './presentation';
import type { Proposal } from './proposals';
import { planningIntent } from './planningIntent';

/** Older messages are dropped from storage past this count. */
export const MAX_KEPT_MESSAGES = 200;
/** The webviews show only the most recent messages. */
export const MAX_VISIBLE_MESSAGES = 60;
/** Proposal states the model sees: the most recent ones only. */
const MAX_PROPOSAL_STATES = 12;

/** What workspace storage keeps of a conversation between sessions. */
export interface SavedChat {
	messages: Message[];
	mode?: string;
	memory?: MemoryState;
	characterId?: CharacterId;
	pinned?: boolean;
}

/** The Pair conversation: messages, the active skill, the working brief and the character. No VS Code calls. */
export class ChatState {
	messages: Message[];
	mode: string | undefined;
	memory: MemoryState;
	characterId: CharacterId;
	/** The user chose the character, so the project stage and task wording leave it alone. */
	pinned: boolean;
	/** The composer hint a compose-style skill left for the next message. */
	pendingPlaceholder: string | undefined;

	constructor(saved: SavedChat | undefined) {
		this.messages = saved?.messages.map(restoredMessage) ?? [];
		this.mode = saved?.mode;
		this.characterId = character(saved?.characterId).id;
		this.pinned = saved?.pinned ?? false;
		this.memory = saved?.memory ?? { brief: '' };
	}

	/** Drops messages past the kept limit and copies what storage needs, so later edits cannot change the snapshot. */
	snapshot(): SavedChat {
		this.messages = this.messages.slice(-MAX_KEPT_MESSAGES);
		return {
			messages: this.messages.map(message => ({ ...message, proposals: [...message.proposals], actions: [...message.actions] })),
			mode: this.mode,
			memory: this.memory,
			characterId: this.characterId,
			pinned: this.pinned,
		};
	}

	visibleMessages(): Message[] {
		return this.messages.slice(-MAX_VISIBLE_MESSAGES);
	}

	/** Starts an empty conversation; the character and its pin stay. */
	reset(): void {
		this.messages = [];
		this.mode = undefined;
		this.pendingPlaceholder = undefined;
		this.memory = { brief: '' };
	}

	clearMode(): void {
		this.mode = undefined;
		this.pendingPlaceholder = undefined;
	}

	/** A request to write a particular planning document also updates the visible active skill. */
	selectPlanningMode(text: string): boolean {
		const mode = planningIntent(text);
		if (!mode || mode === this.mode) { return false; }
		this.mode = mode;
		return true;
	}

	/** Adds a finished user line; a skill run without text shows the skill's label. */
	addUserMessage(id: string, text: string, mode?: string): void {
		this.messages.push({ id, role: 'user', markdown: text.trim() || labelFor(mode), mode, proposals: [], actions: [], done: true });
	}

	/** Adds an empty reply in the current character's voice and returns it for streaming. */
	addReply(id: string, mode?: string): Message {
		const reply: Message = {
			id, role: 'assistant', characterId: this.characterId, markdown: '', mode, proposals: [], actions: [], done: false,
		};
		this.messages.push(reply);
		return reply;
	}

	/** Finished turns the model may remember; `withoutLast` leaves out the request just added. */
	history(withoutLast: boolean): MemoryMessage[] {
		const finished = this.messages.filter(message => message.done && (message.historyText || message.markdown));
		return finished.slice(0, withoutLast ? -1 : undefined).map(message => ({ id: message.id, role: message.role, text: message.historyText ?? message.markdown }));
	}

	/** The latest proposal cards as `file: state` lines, for the model's context. */
	proposalStates(): string {
		return this.messages
			.flatMap(message => message.proposals.map(proposal => `${proposal.file}: ${proposal.state}`))
			.slice(-MAX_PROPOSAL_STATES)
			.join('\n');
	}

	/** Copies a proposal's new state onto its cards and returns the messages that hold one. */
	applyProposal(proposal: Pick<Proposal, 'id' | 'state' | 'operation'>): Message[] {
		const changed: Message[] = [];
		for (const message of this.messages) {
			const card = message.proposals.find(p => p.id === proposal.id);
			if (card) {
				card.state = proposal.state;
				if (proposal.operation) { card.operation = proposal.operation; }
				changed.push(message);
			}
		}
		return changed;
	}
}

/** Proposal contents live in memory: after a restart, an unkept diff is no longer reviewable. */
function restoredMessage(message: Message): Message {
	return {
		...message,
		done: true,
		progress: undefined,
		proposals: message.proposals.map(proposal => proposal.state === 'open' ? { ...proposal, state: 'expired' as const } : proposal),
	};
}
