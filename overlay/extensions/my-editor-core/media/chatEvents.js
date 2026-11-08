// @ts-check
// Host messages update the already-created chat view; register before announcing readiness.
window.addEventListener('message', event => {
	const data = event.data;
	switch (data?.type) {
		case 'filePass':
			filePassState = data; renderFilePass(); renderContext(); break;
		case 'init':
			state.project = data.project ?? '';
			state.projectPath = data.projectPath ?? '';
			state.characters = data.characters ?? [];
			applyConversation(data);
			state.otherChats = !!data.otherChats;
			state.skills = data.skills;
			state.messages = data.messages;
			state.offer = data.offer;
			showSkills = false;
			renderCharacter();
			renderScroll(true);
			renderContext();
			break;
		case 'conversation':
			applyConversation(data);
			showSkills = false;
			renderCharacter();
			renderScroll(true);
			renderContext();
			renderSend();
			break;
		case 'offer':
			state.offer = data.offer;
			renderScroll();
			break;
		case 'messages':
			state.messages = data.messages;
			showSkills = false;
			renderScroll(true);
			break;
		case 'message':
			state.running = data.running;
			updateMessage(data.message);
			renderSend();
			break;
		case 'mode':
			state.mode = data.mode;
			state.modeLabel = data.label;
			state.running = data.running;
			renderContext();
			renderSend();
			renderCharacter();
			break;
		case 'character':
			state.characterId = data.characterId;
			state.pinned = !!data.pinned;
			state.switchNote = data.reason ?? '';
			renderCharacter();
			if (!state.messages.length || showSkills) { renderScroll(); }
			renderContext();
			break;
		case 'context':
			state.file = data.file;
			state.selection = data.selection;
			renderContext();
			if (!state.messages.length || showSkills) {
				renderScroll();
			}
			break;
		case 'models':
			state.models = data.models;
			state.model = data.current;
			state.reasoning = state.models.find(model => model.key === state.model)?.reasoning ?? 'default';
			renderModels();
			if (state.offer) {
				renderScroll(); // The offer names the model.
			}
			break;
		case 'toggleSkills':
			showSkills = !showSkills;
			renderScroll();
			break;
		case 'focusComposer':
			state.placeholder = data.placeholder;
			renderContext();
			renderSend();
			input.focus();
			break;
	}
});

/** Identity, skill and transcript change as one update; unsent drafts stay with their conversation. */
function applyConversation(data) {
	const id = data.conversationId ?? data.characterId ?? 'bamboo';
	if (id !== state.conversationId) {
		if (state.conversationId) { chatDrafts[state.conversationId] = input.value; }
		input.value = chatDrafts[id] ?? '';
		vscode.setState?.({ ...(vscode.getState?.() ?? {}), chatDrafts });
		closeMenu();
	}
	state.conversationId = id;
	state.chatLayout = data.chatLayout ?? 'agents';
	state.characterId = data.characterId ?? 'bamboo';
	state.pinned = !!data.pinned;
	state.messages = data.messages ?? [];
	state.mode = data.mode;
	state.modeLabel = data.label;
	state.placeholder = data.placeholder;
	state.switchNote = state.chatLayout === 'agents' ? 'Separate conversation' : 'One conversation for all agents';
}

renderContext();
renderSend();
renderModels();
vscode.postMessage({ type: 'ready' });
