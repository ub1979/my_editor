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

function button(label, className, message) {
	const node = el('button', { type: 'button', class: className }, [label]);
	node.addEventListener('click', () => vscode.postMessage(message));
	return node;
}

/** Width is set through the CSSOM: the page's CSP forbids inline style attributes. */
function progressFill(fraction) {
	const fill = el('span');
	fill.style.width = `${Math.round(fraction * 100)}%`;
	return fill;
}

function actions() {
	return el('div', { class: 'actions' }, [
		button('New project', 'primary', { type: 'new' }),
		button('Open folder…', 'secondary', { type: 'open' }),
		button('Clone from Git…', 'secondary', { type: 'clone' }),
	]);
}

function render(projects) {
	root.replaceChildren();
	const [latest, ...others] = projects;
	root.append(el('header', {}, [
		el('div', {}, [
			el('p', { class: 'eyebrow' }, ['my_editor']),
			el('h1', {}, [latest ? 'Your projects' : 'Welcome']),
			el('p', { class: 'lede' }, [latest ? 'Pick up where you left off, or start something new.' : 'Build software yourself, with a pair who writes only what you ask.']),
		]),
		actions(),
	]));

	if (!latest) {
		root.append(el('section', { class: 'empty' }, [
			el('h2', {}, ['Start your first project']),
			el('p', {}, ['Create a new project, or open a folder you already have.']),
			el('ol', { class: 'steps' }, [
				el('li', {}, [el('strong', {}, ['Talk it through']), el('span', {}, ['The pair interviews you and writes the requirements.'])]),
				el('li', {}, [el('strong', {}, ['Plan the files']), el('span', {}, ['Architecture, then the file tree, each one yours to approve.'])]),
				el('li', {}, [el('strong', {}, ['Build file by file']), el('span', {}, ['Write it yourself, or ask for exactly the part you want.'])]),
			]),
		]));
		return;
	}

	const featured = el('button', { type: 'button', class: 'featured', 'aria-label': `Continue ${latest.name}: ${latest.status}` }, [
		el('div', {}, [
			el('p', { class: 'eyebrow' }, ['Last opened']),
			el('h2', {}, [latest.name]),
			el('div', { class: 'path' }, [latest.path]),
			el('div', { class: 'status' }, [latest.status]),
		]),
		el('span', { class: 'continue' }, ['Continue']),
		el('div', { class: 'bar', 'aria-hidden': 'true' }, [progressFill(latest.progress)]),
	]);
	featured.addEventListener('click', () => vscode.postMessage({ type: 'recent', uri: latest.uri }));
	root.append(featured);

	if (others.length) {
		const grid = el('div', { class: 'grid' });
		for (const project of others) {
			const card = el('button', { type: 'button', class: `card${project.usesMyEditor ? '' : ' plain'}` }, [
				el('span', { class: 'name' }, [project.name]),
				el('span', { class: 'path' }, [project.path]),
				el('span', { class: 'status' }, [project.status]),
			]);
			card.addEventListener('click', () => vscode.postMessage({ type: 'recent', uri: project.uri }));
			grid.append(card);
		}
		root.append(el('section', {}, [el('h3', {}, ['Recent']), grid]));
	}
}

window.addEventListener('message', event => {
	if (event.data?.type === 'projects') {
		render(event.data.projects);
	}
});
vscode.postMessage({ type: 'ready' });
