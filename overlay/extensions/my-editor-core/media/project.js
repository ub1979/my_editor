// @ts-check
const vscode = acquireVsCodeApi();
const root = /** @type {HTMLElement} */ (document.getElementById('root'));

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node|string)[]} [children] */
function el(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		node.setAttribute(key, value);
	}
	node.append(...children);
	return node;
}

function button(label, onClick, className = 'link') {
	const node = el('button', { class: className, type: 'button' }, [label]);
	node.addEventListener('click', onClick);
	return node;
}

function render(state, model) {
	root.replaceChildren();
	const top = el('div', { class: 'top' }, [el('p', { class: 'eyebrow' }, ['Project']), button('All projects', () => vscode.postMessage({ type: 'home' }))]);
	root.append(top, el('h1', {}, [state.name]), el('p', { class: 'summary' }, [state.summary]));
	if (!state.hasWorkspace) {
		return;
	}

	const stages = el('ol', { 'aria-label': 'Stages' });
	state.stages.forEach((stage, index) => {
		const mark = stage.state === 'done' ? '✓' : String(index + 1);
		const row = el('button', { class: `row ${stage.state}`, type: 'button', 'aria-label': `${stage.title}: ${stage.status}` }, [
			el('span', { class: 'mark', 'aria-hidden': 'true' }, [mark]),
			el('span', { class: 'title' }, [stage.title]),
			el('span', { class: 'status' }, [stage.status]),
		]);
		row.addEventListener('click', () => vscode.postMessage({ type: 'open', stage: stage.id, path: stage.file }));
		stages.append(el('li', {}, [row]));
	});
	root.append(el('section', {}, [el('p', { class: 'eyebrow' }, ['Build path']), stages]));

	const memory = el('dl', { class: 'memory' }, [
		el('dt', {}, ['Conventions']),
		el('dd', {}, [button(state.memory.conventions ? 'Open' : 'Write', () => vscode.postMessage({ type: 'conventions' }))]),
		el('dt', {}, ['Brain']),
		el('dd', {}, [button(state.memory.brainFiles ? `${state.memory.brainFiles} files · analyse again` : 'Analyse', () => vscode.postMessage({ type: 'brain' }))]),
		el('dt', {}, ['Decisions']),
		el('dd', {}, [state.memory.decisions ? button(String(state.memory.decisions), () => vscode.postMessage({ type: 'folder', path: '.my_editor/decisions' })) : el('span', { class: 'empty' }, ['none yet'])]),
		el('dt', {}, ['Chat history']),
		el('dd', {}, [state.memory.chatDays ? button(`${state.memory.chatDays} day${state.memory.chatDays === 1 ? '' : 's'}`, () => vscode.postMessage({ type: 'folder', path: '.my_editor/chats' })) : el('span', { class: 'empty' }, ['none yet'])]),
	]);
	root.append(el('section', {}, [el('p', { class: 'eyebrow' }, ['Memory']), memory]));

	root.append(el('section', { class: 'model' }, [
		el('span', {}, [el('span', { class: 'status' }, ['Model ']), model ?? 'none set up']),
		button(model ? 'Change' : 'Set up', () => vscode.postMessage({ type: 'models' })),
	]));
}

window.addEventListener('message', event => {
	if (event.data?.type === 'state') {
		render(event.data.state, event.data.model);
	}
});
vscode.postMessage({ type: 'ready' });
