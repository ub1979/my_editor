// @ts-check
const vscode = acquireVsCodeApi();
let state = {
	project: '',
	projectPath: '',
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
	/** Code files in a project the pair has not read yet; set while the analysis is on offer. */
	offer: undefined,
};

/* Layout: header, scroll area, composer. Built once; parts update in place. */

const scroll = el('div', { class: 'scroll', role: 'log', 'aria-live': 'polite' });
const composer = el('form', { class: 'composer' });
const context = el('div', { class: 'context' });
const input = /** @type {HTMLTextAreaElement} */ (el('textarea', { rows: '1', 'aria-label': 'Message the pair' }));
const modelSelect = /** @type {HTMLSelectElement} */ (el('select', { class: 'model', 'aria-label': 'Model' }));
const reasoningSelect = /** @type {HTMLSelectElement} */ (el('select', { class: 'reasoning', 'aria-label': 'Codex reasoning level', title: 'Codex reasoning level' }));
const sendButton = /** @type {HTMLButtonElement} */ (el('button', { type: 'submit', class: 'send', 'aria-label': 'Send' }));
let menu = /** @type {HTMLElement | null} */ (null);
let menuIndex = 0;
let showSkills = false;

composer.append(context, input, el('div', { class: 'row' }, [modelSelect, reasoningSelect, el('span', { class: 'spacer' }), sendButton]));
app.append(scroll, composer);

function renderScroll() {
	const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
	scroll.replaceChildren();
	if (!state.messages.length || showSkills) {
		scroll.append(renderWelcome());
	}
	if (!showSkills) {
		for (const message of state.messages) {
			scroll.append(renderMessage(message));
		}
	}
	// The skills start at the top; a conversation follows its newest message.
	scroll.scrollTop = !state.messages.length || showSkills ? 0 : atBottom || !showSkills ? scroll.scrollHeight : scroll.scrollTop;
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
	if (state.file) {
		context.append(el('span', { class: 'ctx', title: state.file }, [icon('file'), el('span', {}, [state.file.split('/').pop() + (state.selection ? ` · lines ${state.selection}` : '')])]));
	}
	input.placeholder = state.placeholder ?? (state.mode ? `Talk to ${state.modeLabel}…` : 'Ask anything, or type / for a command');
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
	for (const [value, label] of [['default', 'Effort: Codex default'], ['low', 'Effort: Low'], ['medium', 'Effort: Medium'], ['high', 'Effort: High'], ['xhigh', 'Effort: Extra high']]) {
		const option = el('option', { value }, [label]);
		if (value === state.reasoning) { option.setAttribute('selected', ''); }
		reasoningSelect.append(option);
	}
	reasoningSelect.hidden = !String(state.model ?? '').startsWith('codex-cli:');
}

/* "/" command menu */

function closeMenu() {
	menu?.remove();
	menu = null;
}

function openMenu() {
	const match = /^\/(\w*)$/.exec(input.value);
	if (!match) {
		closeMenu();
		return;
	}
	const items = COMMANDS.filter(([name]) => name.startsWith(match[1]));
	if (!items.length) {
		closeMenu();
		return;
	}
	menuIndex = Math.min(menuIndex, items.length - 1);
	closeMenu();
	menu = el('div', { class: 'menu', role: 'listbox' });
	items.forEach(([name, desc], index) => {
		const option = el('button', { type: 'button', role: 'option', 'aria-selected': String(index === menuIndex) }, [
			el('span', { class: 'cmd' }, [`/${name}`]), el('span', { class: 'desc' }, [desc]),
		]);
		option.addEventListener('mousedown', event => {
			event.preventDefault();
			pick(name);
		});
		menu?.append(option);
	});
	composer.append(menu);
}

function pick(name) {
	input.value = `/${name} `;
	closeMenu();
	input.focus();
	renderSend();
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
	if (menu) {
		const count = menu.children.length;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			menuIndex = (menuIndex + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
			openMenu();
			return;
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault();
			const option = /** @type {HTMLElement} */ (menu.children[menuIndex]);
			pick(option.querySelector('.cmd')?.textContent?.slice(1) ?? '');
			return;
		}
		if (event.key === 'Escape') {
			closeMenu();
			return;
		}
	}
	if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		send();
	}
});

modelSelect.addEventListener('change', () => {
	if (modelSelect.value) {
		state.model = modelSelect.value;
		renderModels();
		vscode.postMessage({ type: 'model', key: modelSelect.value });
	} else {
		vscode.postMessage({ type: 'chooseModel' });
	}
});

reasoningSelect.addEventListener('change', () => {
	state.reasoning = reasoningSelect.value;
	vscode.postMessage({ type: 'reasoning', key: reasoningSelect.value });
});

scroll.addEventListener('click', event => {
	const link = /** @type {HTMLElement} */ (event.target).closest('a');
	if (link) {
		event.preventDefault();
		vscode.postMessage({ type: 'link', href: link.getAttribute('href') });
	}
});

window.addEventListener('message', event => {
	const data = event.data;
	switch (data?.type) {
		case 'init':
			state.project = data.project ?? '';
			state.projectPath = data.projectPath ?? '';
			state.skills = data.skills;
			state.messages = data.messages;
			state.offer = data.offer;
			showSkills = false;
			renderScroll();
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
