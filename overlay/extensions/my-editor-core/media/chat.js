// @ts-check
const vscode = acquireVsCodeApi();
let chatTextSize = Math.max(12, Math.min(22, Number(vscode.getState?.()?.chatTextSize) || 13));
let state = {
	project: '',
	conversationId: undefined,
	chatLayout: 'agents',
	projectPath: '',
	characters: [],
	characterId: 'bamboo',
	pinned: false,
	otherChats: false,
	switchNote: '',
	skills: [],
	messages: [],
	mode: undefined,
	modeLabel: undefined,
	running: false,
	file: undefined,
	selection: undefined,
	models: [],
	model: undefined,
	reasoning: 'default',
	placeholder: undefined,
	/** The first-open offer ({ files, kind }) while it is shown; undefined once answered. */
	offer: undefined,
};

/* Layout: header, scroll area, composer. Built once; parts update in place. */

const scroll = el('div', { class: 'scroll', role: 'region', 'aria-label': 'Conversation and file activity' });
scroll.style.setProperty('--chat-text-size', `${chatTextSize}px`);
const header = el('header', { class: 'character-header' });
const rail = el('nav', { class: 'character-rail', 'aria-label': 'Agent chats' });
const composer = el('form', { class: 'composer' });
const context = el('div', { class: 'context' });
const input = /** @type {HTMLTextAreaElement} */ (el('textarea', { rows: '1', 'aria-label': 'Message the pair' }));
const modelSelect = /** @type {HTMLSelectElement} */ (el('select', { class: 'model', 'aria-label': 'Model' }));
const reasoningSelect = /** @type {HTMLSelectElement} */ (el('select', {
	class: 'reasoning', 'aria-label': 'Model effort level', title: 'Model effort level',
}));
const sendButton = /** @type {HTMLButtonElement} */ (el('button', { type: 'submit', class: 'send', 'aria-label': 'Send' }));
let showSkills = false;
const chatDrafts = { ...(vscode.getState?.()?.chatDrafts ?? {}) };

composer.append(context, input, el('div', { class: 'row' }, [modelSelect, reasoningSelect, el('span', { class: 'spacer' }), sendButton]));
app.append(header, scroll, composer, rail);

function activeCharacter() {
	return state.characters.find(item => item.id === state.characterId)
		?? { id: 'bamboo', name: 'Project agent', role: 'Project guide', greeting: 'Where shall we look?' };
}

function renderCharacter() {
	renderFilePass();
	const chosen = activeCharacter();
	const skills = el('button', { type: 'button', class: 'header-action', title: 'Explore skills', 'aria-label': 'Explore skills' }, [icon('grid')]);
	skills.addEventListener('click', () => { showSkills = !showSkills; renderScroll(); });
	const wide = el('button', {
		type: 'button', class: 'header-action', title: 'Expand agent chat', 'aria-label': 'Expand agent chat',
	}, [icon('expand')]);
	wide.addEventListener('click', () => vscode.postMessage({ type: 'openLounge' }));
	const side = el('button', {
		type: 'button', class: 'header-action', title: 'Show file and chat in columns', 'aria-label': 'Show file and chat in columns',
	}, [icon('sidebar')]);
	side.addEventListener('click', () => vscode.postMessage({ type: 'openSidebar' }));
	const auto = el('button', { type: 'button', class: `auto-character${state.pinned ? ' pinned' : ''}`,
		title: state.pinned ? 'Use automatic character switching' : 'Character switches with your task',
		'aria-label': state.pinned ? 'Resume automatic character switching' : 'Automatic character switching is on' },
		[state.pinned ? 'Pinned' : 'Auto']);
	auto.hidden = state.chatLayout !== 'shared';
	auto.disabled = state.running;
	auto.addEventListener('click', () => { if (state.pinned) { vscode.postMessage({ type: 'autoCharacter' }); } });
	const layout = el('select', { class: 'chat-layout', 'aria-label': 'Chat organization',
		title: 'Separate agent conversations by default, or use one shared chat' });
	for (const [value, label] of [['agents', 'Agent chats'], ['shared', 'Shared chat']]) {
		const option = el('option', { value }, [label]);
		if (state.chatLayout === value) { option.setAttribute('selected', ''); }
		layout.append(option);
	}
	layout.disabled = state.running;
	layout.addEventListener('change', () => vscode.postMessage({ type: 'chatLayout', id: layout.value }));
	const textSize = el('span', { class: 'text-size-controls', 'aria-label': 'Chat text size' });
	for (const [label, change, title] of [['A−', -1, 'Decrease chat text size'], ['A+', 1, 'Increase chat text size']]) {
		const button = el('button', { type: 'button', class: 'header-action text-size-button', title, 'aria-label': title }, [label]);
		button.disabled = change < 0 ? chatTextSize <= 12 : chatTextSize >= 22;
		button.addEventListener('click', () => {
			chatTextSize = Math.max(12, Math.min(22, chatTextSize + change));
			scroll.style.setProperty('--chat-text-size', `${chatTextSize}px`);
			vscode.setState?.({ ...(vscode.getState?.() ?? {}), chatTextSize });
			renderCharacter();
		});
		textSize.append(button);
	}
	header.replaceChildren(el('span', { class: 'header-face' }, [avatar(true, chosen.id)]),
		el('span', { class: 'character-identity' }, [el('strong', {}, [chosen.name]), el('small', {}, [chosen.role]),
			...(state.switchNote ? [el('span', { class: 'switch-note' }, [state.switchNote])] : [])]),
		el('span', { class: 'header-actions' }, [auto, textSize, skills, wide, side, layout]));
	rail.replaceChildren(el('span', { class: 'rail-title' }, [state.chatLayout === 'shared' ? 'AGENTS IN SHARED CHAT' : 'AGENT CHATS']));
	const choices = el('div', { class: 'character-choices' });
	let selectedChoice;
	for (const item of state.characters) {
		const selected = item.id === state.characterId;
		const button = el('button', { type: 'button', class: `character-choice${selected ? ' selected' : ''}`,
			title: `${item.name} · ${item.role}`, 'aria-label': `${item.name}, ${item.role}`, 'aria-pressed': String(selected) }, [avatar(false, item.id), el('span', {}, [item.role])]);
		button.disabled = state.running;
		button.addEventListener('click', () => {
			if (state.running) { return; }
			vscode.postMessage({ type: 'character', id: item.id });
		});
		choices.append(button);
		if (selected) { selectedChoice = button; }
	}
	rail.append(choices);
	selectedChoice?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}


function renderScroll(follow = false) {
	const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
	const position = scroll.scrollTop;
	scroll.replaceChildren();
	if (!state.messages.length || showSkills) {
		scroll.append(renderWelcome());
	}
	if (!showSkills) {
		for (const message of state.messages) {
			scroll.append(renderMessage(message));
		}
	}
	scroll.append(filePassPanel);
	filePassPanel.hidden = showSkills || !['ada', 'poppy'].includes(state.characterId);
	// The skills start at the top; a conversation follows its newest message.
	scroll.scrollTop = !state.messages.length || showSkills ? 0 : follow || atBottom ? scroll.scrollHeight : position;
}

function updateMessage(message) {
	const index = state.messages.findIndex(m => m.id === message.id);
	if (index >= 0) {
		state.messages[index] = message;
	} else {
		state.messages.push(message);
	}
	if (showSkills) {
		return;
	}
	const existing = scroll.querySelector(`[data-id="${message.id}"]`);
	const fresh = renderMessage(message);
	const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
	if (existing) {
		existing.replaceWith(fresh);
	} else {
		renderScroll();
	}
	if (nearBottom) {
		scroll.scrollTop = scroll.scrollHeight;
	}
}

function renderContext() {
	context.replaceChildren();
	if (state.project) {
		context.append(el('span', { class: 'ctx', title: state.projectPath || state.project }, [`Chat for ${state.project}`]));
	}
	if (state.mode) {
		const clear = el('button', { type: 'button', 'aria-label': `Stop using ${state.modeLabel}`, title: 'Back to plain chat' }, [icon('x')]);
		clear.addEventListener('click', () => vscode.postMessage({ type: 'clearMode' }));
		context.append(el('span', { class: 'ctx mode' }, [el('span', {}, [state.modeLabel ?? state.mode]), clear]));
	}
	const activeFileRun = typeof filePassState !== 'undefined' && filePassState?.agent === state.characterId
		&& ['running', 'review'].includes(filePassState.run?.status);
	if (state.file && !activeFileRun) {
		const name = state.file.split('/').pop() + (state.selection ? ` · lines ${state.selection}` : '');
		context.append(el('span', { class: 'ctx', title: state.file }, [icon('file'), el('span', {}, [name])]));
	}
	input.placeholder = state.placeholder ?? (state.mode ? `Talk to ${state.modeLabel}…` : `Message ${activeCharacter().name}…`);
}

function renderSend() {
	sendButton.replaceChildren(icon(state.running ? 'stop' : 'up'));
	sendButton.classList.toggle('stop', state.running);
	sendButton.setAttribute('aria-label', state.running ? 'Stop' : 'Send');
	sendButton.disabled = !state.running && !input.value.trim() && !state.mode;
}

function renderModels() {
	modelSelect.replaceChildren();
	if (!state.models.length) {
		modelSelect.append(el('option', { value: '' }, ['No model yet: choose…']));
	}
	for (const model of state.models) {
		const option = el('option', { value: model.key, title: `${model.label} · ${model.detail}` }, [model.label]);
		if (model.key === state.model) {
			option.setAttribute('selected', '');
		}
		modelSelect.append(option);
	}
	reasoningSelect.replaceChildren();
	const selected = state.models.find(model => model.key === state.model);
	const levels = selected?.effortLevels ?? [];
	const labels = { low: 'Low (light)', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum' };
	const effort = levels.includes(state.reasoning) ? state.reasoning : 'default';
	for (const value of ['default', ...levels]) {
		const option = el('option', { value }, [`Effort: ${value === 'default' ? 'Model default' : labels[value]}`]);
		if (value === effort) { option.setAttribute('selected', ''); }
		reasoningSelect.append(option);
	}
	reasoningSelect.hidden = levels.length === 0;
}

/* Events */

function send() {
	if (state.running) {
		vscode.postMessage({ type: 'stop' });
		return;
	}
	const text = input.value;
	if (!text.trim() && !state.mode) {
		return;
	}
	vscode.postMessage({ type: 'send', text });
	input.value = '';
	state.placeholder = undefined;
	autosize();
	renderSend();
	renderContext();
}

function autosize() {
	input.style.height = 'auto';
	input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

composer.addEventListener('submit', event => {
	event.preventDefault();
	send();
});

input.addEventListener('input', () => {
	autosize();
	renderSend();
	openMenu();
});

input.addEventListener('keydown', event => {
	if (menuKey(event)) {
		return;
	}
	if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		send();
	}
});

modelSelect.addEventListener('change', () => {
	if (modelSelect.value) {
		state.model = modelSelect.value;
		state.reasoning = state.models.find(model => model.key === state.model)?.reasoning ?? 'default';
		renderModels();
		vscode.postMessage({ type: 'model', key: modelSelect.value });
	} else {
		vscode.postMessage({ type: 'chooseModel' });
	}
});

reasoningSelect.addEventListener('change', () => {
	state.reasoning = reasoningSelect.value;
	const selected = state.models.find(model => model.key === state.model);
	if (selected) { selected.reasoning = state.reasoning; }
	vscode.postMessage({ type: 'reasoning', key: reasoningSelect.value, id: state.model });
});

scroll.addEventListener('click', event => {
	const link = /** @type {HTMLElement} */ (event.target).closest('a');
	if (link) {
		event.preventDefault();
		vscode.postMessage({ type: 'link', href: link.getAttribute('href') });
	}
});
