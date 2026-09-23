// @ts-check
const vscode = acquireVsCodeApi();
const app = /** @type {HTMLElement} */ (document.getElementById('app'));

/** Simple stroke icons on a 24px grid, drawn with currentColor. */
const ICONS = {
	list: 'M3 7l2 2 4-4M3 17l2 2 4-4M13 6h8M13 12h8M13 18h8',
	layers: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
	tree: 'M5 3v14a2 2 0 0 0 2 2h5M5 8h7M15 5h6v5h-6zM15 16h6v5h-6z',
	bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2Z',
	step: 'M3 12h13M10 6l6 6-6 6M21 5v14',
	plus: 'M12 5v14M5 12h14',
	edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
	book: 'M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2ZM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7Z',
	history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2',
	eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
	bug: 'M9 7V6a3 3 0 0 1 6 0v1M6.5 7h11A1.5 1.5 0 0 1 19 8.5V14a7 7 0 0 1-14 0V8.5A1.5 1.5 0 0 1 6.5 7ZM12 20v-9M5 13H2M22 13h-3M4 21l2.5-2.5M20 21l-2.5-2.5M3 6l3 2M21 6l-3 2',
	flask: 'M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9.5V3M7 15h10',
	wand: 'M3 21l11-11M15 4V2M15 12v-2M11 6H9M21 6h-2M18 3l1.4-1.4M18 9l1.4 1.4',
	spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z',
	file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6',
	grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
	compose: 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z',
	up: 'M5 12l7-7 7 7M12 19V5',
	stop: 'M7 7h10v10H7z',
	x: 'M18 6 6 18M6 6l12 12',
	check: 'M20 6 9 17l-5-5',
	alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
	undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13',
	diff: 'M12 3v18M5 8h4M7 6v4M15 16h4',
};

const COMMANDS = [
	['feature', 'Add a feature to this file'], ['change', 'Rewrite the selected lines'], ['next', 'Take the next small step'],
	['file', 'Write the whole file'], ['explain', 'Explain the file or selection'], ['review', 'Review without editing'],
	['why', 'Why is this code like this?'], ['brainstorm', 'Explore approaches'], ['requirements', 'Work out what to build'],
	['architecture', 'Design the parts'], ['tree', 'Plan the files'], ['impact', 'What does a change affect?'], ['skill', 'Run a skill by name'],
];

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node|string)[]} [children] */
function el(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		node.setAttribute(key, value);
	}
	node.append(...children);
	return node;
}

function icon(name) {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('class', 'icon');
	svg.setAttribute('aria-hidden', 'true');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', ICONS[name] ?? ICONS.spark);
	svg.append(path);
	return svg;
}

/** The pair: a small gold face. */
function avatar(big = false) {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 32 32');
	svg.setAttribute('class', `avatar${big ? ' big' : ''}`);
	svg.setAttribute('aria-hidden', 'true');
	svg.innerHTML = '<circle cx="16" cy="16" r="16" fill="var(--accent)"/>'
		+ '<g class="eyes" fill="var(--on-accent)"><ellipse cx="11.5" cy="14" rx="1.9" ry="2.3"/><ellipse cx="20.5" cy="14" rx="1.9" ry="2.3"/></g>'
		+ '<path d="M11 19.2q5 4.6 10 0" fill="none" stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round"/>';
	return svg;
}

let state = {
	project: '',
	skills: [],
	messages: [],
	mode: undefined,
	modeLabel: undefined,
	running: false,
	file: undefined,
	selection: undefined,
	models: [],
	model: undefined,
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
const sendButton = /** @type {HTMLButtonElement} */ (el('button', { type: 'submit', class: 'send', 'aria-label': 'Send' }));
let menu = /** @type {HTMLElement | null} */ (null);
let menuIndex = 0;
let showSkills = false;

composer.append(context, input, el('div', { class: 'row' }, [modelSelect, el('span', { class: 'spacer' }), sendButton]));
app.append(scroll, composer);

/* Rendering */

function renderWelcome() {
	const groups = ['Plan', 'Build', 'Fix', 'Your skills'];
	const box = el('section', { class: 'welcome' }, [
		el('div', { class: 'hello' }, [avatar(true), el('div', {}, [
			el('h1', {}, [state.messages.length ? 'Pick a skill' : 'Hi, I’m your pair.']),
			el('p', {}, [state.project ? `What shall we work on in ${state.project}?` : 'Open a project and we can start.']),
		])]),
	]);
	if (state.offer) {
		box.append(renderOffer(state.offer));
	}
	for (const group of groups) {
		const cards = state.skills.filter(s => s.group === group);
		if (!cards.length) {
			continue;
		}
		const grid = el('div', { class: 'skills' });
		for (const skill of cards) {
			const disabled = skill.needsFile && !state.file;
			const button = el('button', { type: 'button', class: 'skill', title: disabled ? 'Open a file first' : skill.blurb }, [
				el('span', { class: 'tile' }, [icon(skill.icon)]),
				el('span', { class: 'title' }, [skill.title]),
				el('span', { class: 'blurb' }, [skill.blurb]),
			]);
			if (disabled) {
				button.setAttribute('disabled', '');
			}
			button.addEventListener('click', () => {
				showSkills = false;
				vscode.postMessage({ type: 'skill', id: skill.id });
			});
			grid.append(button);
		}
		box.append(el('p', { class: 'group-title' }, [group]));
		if (!state.file && cards.every(card => card.needsFile)) {
			box.append(el('p', { class: 'group-note' }, ['Open a file to use these.']));
		}
		box.append(grid);
	}
	return box;
}

/** Asks before reading an existing project: nothing is written until the user says yes. */
function renderOffer(files) {
	const yes = el('button', { type: 'button', class: 'pill primary' }, [icon('book'), 'Analyse this project']);
	const no = el('button', { type: 'button', class: 'pill' }, ['Not now']);
	yes.addEventListener('click', () => vscode.postMessage({ type: 'analyse' }));
	no.addEventListener('click', () => vscode.postMessage({ type: 'notNow' }));
	return el('div', { class: 'offer' }, [
		el('p', { class: 'offer-title' }, ['Shall I get to know this project?']),
		el('p', {}, [`I’ll read its ${files >= 5000 ? 'code (over 5,000 files, so the first 5,000)' : `${files.toLocaleString('en')} code file${files === 1 ? '' : 's'}`} and write the project brain: a line on every file, a note per part and a draft architecture. Your code stays as it is.`]),
		...(files > 1500 ? [el('p', { class: 'offer-note' }, ['It’s a big project, so I’ll start with the 1,500 most-used files. You can continue later.'])] : []),
		el('div', { class: 'offer-actions' }, [yes, no]),
	]);
}

function renderProposal(message, proposal) {
	const counts = el('span', { class: 'counts', 'aria-label': `${proposal.added} lines added, ${proposal.removed} removed` }, [
		el('span', { class: 'plus' }, [`+${proposal.added}`]), ' ', el('span', { class: 'minus' }, [`−${proposal.removed}`]),
	]);
	const name = `${proposal.isNewFile ? 'New · ' : ''}${proposal.file.split('/').pop()}`;
	// While the change is open, the file name opens the review.
	const file = proposal.state === 'open'
		? el('button', { type: 'button', class: 'file link', title: `Review the change to ${proposal.file}` }, [name])
		: el('span', { class: 'file', title: proposal.file }, [name]);
	file.addEventListener('click', () => proposal.state === 'open' && vscode.postMessage({ type: 'review', id: proposal.id }));
	const card = el('div', { class: 'proposal' }, [el('div', { class: 'head' }, [icon('file'), file, counts])]);
	if (proposal.state === 'open') {
		const keep = el('button', { type: 'button', class: 'pill primary' }, [icon('check'), 'Keep']);
		const undo = el('button', { type: 'button', class: 'pill' }, [icon('undo'), 'Undo']);
		keep.addEventListener('click', () => vscode.postMessage({ type: 'keep', id: proposal.id }));
		undo.addEventListener('click', () => vscode.postMessage({ type: 'undo', id: proposal.id }));
		card.append(el('div', { class: 'buttons' }, [keep, undo]));
	} else {
		card.append(el('span', { class: `state ${proposal.state}` }, proposal.state === 'kept' ? [icon('check'), 'Kept and saved'] : [icon('undo'), 'Undone. The file was not changed.']));
	}
	return card;
}

function renderMessage(message) {
	if (message.role === 'user') {
		return el('div', { class: 'message user', 'data-id': message.id }, [
			...(message.label ? [el('span', { class: 'chip' }, [message.label])] : []),
			el('div', { class: 'bubble' }, [message.html ? htmlFragment(message.html).textContent ?? '' : '']),
		]);
	}
	const body = el('div', { class: 'body' });
	if (message.html) {
		const md = el('div', { class: 'markdown' });
		md.innerHTML = message.html; // Rendered by markdown-it on the host with raw HTML disabled.
		body.append(md);
	} else if (!message.done) {
		body.append(el('span', { class: 'typing', 'aria-label': 'Pair is thinking' }, [el('span'), el('span'), el('span')]));
	}
	if (message.progress && !message.done) {
		body.append(el('div', { class: 'progress' }, [el('span', { class: 'spinner' }), message.progress]));
	}
	for (const proposal of message.proposals) {
		body.append(renderProposal(message, proposal));
	}
	if (message.actions.length) {
		const row = el('div', { class: 'actions' });
		message.actions.forEach((label, index) => {
			const button = el('button', { type: 'button', class: 'pill' }, [label]);
			button.addEventListener('click', () => vscode.postMessage({ type: 'action', id: message.id, index }));
			row.append(button);
		});
		body.append(row);
	}
	if (message.error) {
		const box = el('div', { class: 'error', role: 'alert' }, [icon('alert'), el('div', {}, [message.error])]);
		if (/model/i.test(message.error)) {
			const choose = el('button', { type: 'button', class: 'pill' }, ['Choose a model']);
			choose.addEventListener('click', () => vscode.postMessage({ type: 'chooseModel' }));
			box.lastElementChild?.append(el('div', { class: 'actions' }, [choose]));
		}
		body.append(box);
	}
	return el('div', { class: 'message assistant', 'data-id': message.id }, [avatar(), body]);
}

function htmlFragment(html) {
	const template = document.createElement('template');
	template.innerHTML = html;
	return template.content;
}

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
		vscode.postMessage({ type: 'model', key: modelSelect.value });
	} else {
		vscode.postMessage({ type: 'chooseModel' });
	}
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
			state.skills = data.skills;
			state.messages = data.messages;
			state.offer = data.offer;
			showSkills = false;
			renderScroll();
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
			renderModels();
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
