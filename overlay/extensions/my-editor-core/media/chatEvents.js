// @ts-check
// Host messages update the already-created chat view; register before announcing readiness.
window.addEventListener('message', event => {
	const data = event.data;
	switch (data?.type) {
		case 'init':
			state.project = data.project ?? '';
			state.projectPath = data.projectPath ?? '';
			state.characters = data.characters ?? [];
			state.characterId = data.characterId ?? 'bamboo';
			state.pinned = !!data.pinned;
			state.otherChats = !!data.otherChats;
			state.switchNote = '';
			state.skills = data.skills;
			state.messages = data.messages;
			state.offer = data.offer;
			showSkills = false;
			renderScroll();
			renderCharacter();
			renderContext();
			break;
		case 'offer':
			state.offer = data.offer;
			renderScroll();
			break;
		case 'messages':
			state.messages = data.messages;
			showSkills = false;
			renderScroll();
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
			state.reasoning = data.reasoning ?? 'default';
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

renderContext();
renderSend();
renderModels();
vscode.postMessage({ type: 'ready' });
