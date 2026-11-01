import { character, CHARACTERS, CharacterId } from './characters';
import { routeCharacter } from './characterRouting';
import { ChatState, SavedChat } from './chatState';
import type { Message } from './presentation';
import type { Proposal } from './proposals';

export type ChatLayout = 'agents' | 'shared';
export type ConversationId = CharacterId | 'shared';
export interface SavedConversations extends SavedChat {
	conversations?: { version: 1; layout: ChatLayout; activeAgent: CharacterId; chats: Partial<Record<ConversationId, SavedChat>> };
}

/** Planning agents open their own document; other agents start with ordinary project chat. */
export function agentMode(id: CharacterId): string | undefined {
	return ({ soki: 'requirements', lisko: 'architecture', flow: 'tree' } as Partial<Record<CharacterId, string>>)[id];
}

/** Independent histories and working briefs, with one optional shared conversation per project. */
export class ChatConversations {
	private readonly chats = new Map<ConversationId, ChatState>();
	layout: ChatLayout = 'agents';
	private activeAgent: CharacterId = 'bamboo';

	constructor(saved?: SavedConversations) {
		const collection = saved?.conversations;
		if (collection?.version === 1) {
			this.layout = collection.layout === 'shared' ? 'shared' : 'agents';
			this.activeAgent = character(collection.activeAgent).id;
			for (const id of ['shared', ...CHARACTERS.map(item => item.id)] as ConversationId[]) {
				if (collection.chats[id]) { this.chats.set(id, new ChatState(collection.chats[id])); }
			}
		} else if (saved) {
			this.migrate(saved);
		}
	}

	get id(): ConversationId { return this.layout === 'shared' ? 'shared' : this.activeAgent; }
	get state(): ChatState { return this.get(this.id); }

	selectAgent(id: CharacterId): void {
		if (this.layout === 'shared') {
			this.state.characterId = id;
			this.state.mode = agentMode(id);
			this.state.pinned = true;
		} else {
			this.activeAgent = id;
			this.state.pinned = true;
		}
	}

	setLayout(layout: ChatLayout): void { this.layout = layout; }

	/** The active snapshot stays at the top level for existing workspace readers. */
	snapshot(): SavedConversations {
		return { ...this.state.snapshot(), conversations: { version: 1, layout: this.layout, activeAgent: this.activeAgent,
			chats: Object.fromEntries([...this.chats].map(([id, state]) => [id, state.snapshot()])) } };
	}

	/** Keep/Undo can finish a proposal while its agent's chat is hidden. */
	applyProposal(proposal: Pick<Proposal, 'id' | 'state' | 'operation'>): Message[] {
		const changed: Message[] = [];
		for (const state of this.chats.values()) { changed.push(...state.applyProposal(proposal)); }
		return changed;
	}

	private get(id: ConversationId): ChatState {
		let state = this.chats.get(id);
		if (!state) {
			state = new ChatState(undefined);
			state.characterId = id === 'shared' ? this.activeAgent : id;
			state.mode = agentMode(state.characterId);
			this.chats.set(id, state);
		}
		return state;
	}

	/** Keep the complete legacy conversation in Shared chat and copy each exchange to its owning agent. */
	private migrate(saved: SavedChat): void {
		this.chats.set('shared', new ChatState(saved));
		this.activeAgent = routeCharacter('', saved.mode, character(saved.characterId).id, false).id;
		let pending: Message[] = [];
		const copy = (messages: Message[], id: CharacterId) => {
			// Restore each copy independently: editing a card must not mutate another conversation's snapshot.
			this.get(id).messages.push(...new ChatState({ messages: structuredClone(messages) }).messages);
		};
		for (const message of saved.messages) {
			if (message.role === 'user') { pending.push(message); continue; }
			const id = routeCharacter('', message.mode ?? pending.at(-1)?.mode, character(message.characterId).id, false).id;
			copy([...pending, message], id);
			pending = [];
		}
		if (pending.length) { copy(pending, this.activeAgent); }
		this.state.mode = saved.mode ?? agentMode(this.activeAgent);
		this.state.pinned = true;
		// A legacy brief mixes agents, so only Shared chat retains it. Individual briefs rebuild from their own turns.
	}
}
