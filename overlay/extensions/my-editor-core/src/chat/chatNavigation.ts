import * as vscode from 'vscode';
import { readProjectState } from '../project/state';
import { character } from './characters';
import { CharacterRoute, projectCharacter, routeCharacter } from './characterRouting';
import { ChatBroadcast } from './chatBroadcast';
import { ChatConversations, ChatLayout } from './chatConversations';
import { planningIntent } from './planningIntent';
import { skillCards } from './skillCards';

interface NavigationSource {
	readonly context: vscode.ExtensionContext;
	readonly conversations: ChatConversations;
	readonly broadcast: ChatBroadcast;
	readonly running: () => boolean;
	readonly save: () => void;
	readonly send: (text: string, kickoff?: boolean) => Promise<void>;
	readonly analyse: () => Promise<void>;
}

/** Agent navigation changes conversations before choosing a skill or assembling a model request. */
export class ChatNavigation {
	constructor(private readonly source: NavigationSource) {}

	chooseCharacter(id: string | undefined): void {
		if (this.source.running()) { return; }
		this.source.conversations.selectAgent(character(id).id);
		this.refresh();
	}

	setLayout(layout: string | undefined): void {
		if (this.source.running() || !['agents', 'shared'].includes(layout ?? '')) { return; }
		this.source.conversations.setLayout(layout as ChatLayout);
		this.refresh();
	}

	async autoCharacter(): Promise<void> {
		if (this.source.running() || this.source.conversations.layout !== 'shared') { return; }
		this.source.conversations.state.pinned = false;
		await this.selectForProject();
	}

	async selectForProject(): Promise<void> {
		const { conversations, running } = this.source;
		const state = conversations.state;
		if (state.pinned || running()) { return; }
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
		const project = await readProjectState();
		if (state !== conversations.state || state.pinned || running()
			|| root !== vscode.workspace.workspaceFolders?.[0]?.uri.toString()) { return; }
		const id = state.mode ? routeCharacter('', state.mode, state.characterId, false).id : projectCharacter(project);
		if (conversations.layout === 'agents') { conversations.selectAgent(id); }
		else { state.characterId = id; }
		this.refresh();
	}

	async pickSkill(id: string): Promise<void> {
		const card = (await skillCards(this.source.context.extensionUri)).find(item => item.id === id);
		if (!card || this.source.running()) { return; }
		const { conversations, broadcast } = this.source;
		const idForSkill = routeCharacter('', card.id, conversations.state.characterId, false).id;
		if (conversations.layout === 'agents') { conversations.selectAgent(id === 'analyse' ? 'bamboo' : idForSkill); }
		const state = conversations.state;
		const resume = conversations.layout === 'agents' && state.mode === card.id && state.messages.length > 0;
		state.mode = id === 'analyse' ? undefined : card.id;
		if (conversations.layout === 'shared') { state.characterId = idForSkill; state.pinned = false; }
		state.pendingPlaceholder = card.start === 'compose' ? card.placeholder : undefined;
		this.refresh();
		if (id === 'analyse') { await this.source.analyse(); }
		else if (card.start === 'kickoff' && !resume) { await this.source.send('', true); }
		else if (card.start === 'run') { await this.source.send(''); }
		else { broadcast.post({ type: 'focusComposer', placeholder: state.pendingPlaceholder }); }
	}

	/** Explicit requests can hand off to another agent; ordinary follow-ups stay with the selected agent. */
	prepare(text: string): CharacterRoute {
		const { conversations } = this.source;
		const explicit = /^\/([\w:-]+)/.exec(text.trim())?.[1] ?? planningIntent(text);
		if (explicit && conversations.layout === 'agents') {
			const id = routeCharacter('', explicit, conversations.state.characterId, false).id;
			conversations.selectAgent(id);
		}
		const state = conversations.state;
		if (explicit) { state.mode = explicit; }
		const route = routeCharacter(text, state.mode, state.characterId, conversations.layout === 'agents' || state.pinned);
		state.characterId = route.id;
		this.refresh();
		return route;
	}

	private refresh(): void {
		this.source.save();
		this.source.broadcast.conversation();
	}
}
