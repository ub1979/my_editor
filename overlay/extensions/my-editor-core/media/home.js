// @ts-check
const vscode = acquireVsCodeApi();
const root = /** @type {HTMLElement} */ (document.getElementById('root'));
const SEARCH_FROM = 7;
let projects = [];
let query = '';
let version = '';

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node|string)[]} [children] */
function el(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		node.setAttribute(key, value);
	}
	node.append(...children);
	return node;
}

function action(label, className, message, attrs = {}) {
	const node = el('button', { type: 'button', class: className, ...attrs }, [label]);
	node.addEventListener('click', event => {
		event.stopPropagation();
		vscode.postMessage(message);
	});
	return node;
}

/** Lucide "x", drawn inline so it follows the text colour. */
function closeIcon() {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.innerHTML = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';
	return svg;
}

function removeButton(project) {
	const button = action('', 'remove', { type: 'remove', uri: project.uri }, {
		'aria-label': `Remove ${project.name} from this list`,
		title: 'Remove from this list. The folder stays on disk.',
	});
	button.append(closeIcon());
	return button;
}

/** Five labelled steps: done, current, or still to come. Never colour alone: each has a text label. */
function stages(project, withLabels) {
	const list = el('ol', { class: `stages${withLabels ? ' labelled' : ''}`, 'aria-label': 'Build path' });
	project.stages.forEach((stage, index) => {
		const state = stage.state === 'done' ? 'done' : project.next?.index === index ? 'current' : 'todo';
		const spoken = state === 'done' ? 'done' : state === 'current' ? 'current stage' : 'not started';
		list.append(el('li', { class: state, 'aria-label': `${stage.title}: ${spoken}` }, withLabels ? [el('span', {}, [stage.title])] : []));
	});
	return list;
}

function progressLine(project) {
	if (!project.usesMyEditor) {
		return 'Not set up with my_editor yet';
	}
	return project.next ? `Stage ${project.next.index + 1} of 5 · ${project.next.title}` : 'All five stages done';
}

function header() {
	return el('header', {}, [
		el('div', {}, [
			el('div', { class: 'identity' }, [
				el('p', { class: 'eyebrow' }, ['my_editor']),
				...(version ? [el('span', { class: 'version', 'aria-label': `my_editor version ${version}` }, [version])] : []),
			]),
			el('h1', {}, [projects.length ? 'Your projects' : 'Welcome']),
			el('p', { class: 'lede' }, [projects.length ? 'Pick up where you left off, or start something new.' : 'Build software yourself, with a pair who writes only what you ask.']),
		]),
		el('div', { class: 'actions' }, [
			action('New project', 'primary', { type: 'new' }),
			action('Open folder…', 'secondary', { type: 'open' }),
			action('Clone from Git…', 'secondary', { type: 'clone' }),
		]),
	]);
}

function featured(project) {
	const body = el('div', { class: 'featured-main' }, [
		el('p', { class: 'eyebrow' }, ['Last opened']),
		el('h2', {}, [project.name]),
		el('p', { class: 'path', title: project.fullPath }, [project.path]),
	]);
	const side = el('div', { class: 'featured-side' }, [
		action('Open project', 'open', { type: 'recent', uri: project.uri }, { 'aria-label': `Open ${project.name}` }),
	]);
	const progress = el('div', { class: 'featured-progress' }, [
		el('p', { class: 'progress-line' }, [
			el('strong', {}, [progressLine(project)]),
			...(project.next ? [el('span', {}, [project.next.status])] : []),
		]),
		...(project.usesMyEditor ? [stages(project, true)] : []),
	]);
	return el('article', { class: 'featured', 'aria-label': `Last opened: ${project.name}` }, [body, side, progress, removeButton(project)]);
}

function card(project) {
	const open = action(project.name, 'card-link', { type: 'recent', uri: project.uri }, { title: `Open ${project.name}` });
	return el('article', { class: `card${project.usesMyEditor ? '' : ' plain'}` }, [
		el('h3', {}, [open]),
		el('p', { class: 'path', title: project.fullPath }, [project.path]),
		...(project.usesMyEditor ? [stages(project, false)] : []),
		el('p', { class: 'status' }, [project.usesMyEditor ? (project.next ? `Next: ${project.next.title}` : 'All stages done') : 'Not set up with my_editor yet']),
		removeButton(project),
	]);
}

function emptyState() {
	return el('section', { class: 'empty' }, [
		el('h2', {}, ['Start your first project']),
		el('p', {}, ['Create a new project, or open a folder you already have.']),
		el('ol', { class: 'steps' }, [
			el('li', {}, [el('strong', {}, ['Talk it through']), el('span', {}, ['The pair interviews you and writes the requirements.'])]),
			el('li', {}, [el('strong', {}, ['Plan the files']), el('span', {}, ['Architecture, then the file tree, each one yours to approve.'])]),
			el('li', {}, [el('strong', {}, ['Build file by file']), el('span', {}, ['Write it yourself, or ask for exactly the part you want.'])]),
		]),
	]);
}

function recentSection() {
	const heading = el('div', { class: 'section-head' }, [el('h3', { class: 'section-title' }, ['Recent'])]);
	if (projects.length >= SEARCH_FROM) {
		const search = el('input', { type: 'search', class: 'search', placeholder: 'Find a project', 'aria-label': 'Find a project', value: query });
		search.addEventListener('input', () => {
			query = /** @type {HTMLInputElement} */ (search).value;
			renderGrid();
		});
		heading.append(search);
	}
	const grid = el('div', { class: 'grid', id: 'grid' });
	return el('section', {}, [heading, grid]);
}

function renderGrid() {
	const grid = document.getElementById('grid');
	if (!grid) {
		return;
	}
	const needle = query.trim().toLowerCase();
	const others = projects.slice(1).filter(p => !needle || p.name.toLowerCase().includes(needle) || p.fullPath.toLowerCase().includes(needle));
	grid.replaceChildren(...(others.length ? others.map(card) : [el('p', { class: 'none' }, [`No project matches “${query.trim()}”.`])]));
}

function render() {
	root.replaceChildren(header());
	if (!projects.length) {
		root.append(emptyState());
		return;
	}
	root.append(featured(projects[0]));
	if (projects.length > 1) {
		root.append(recentSection());
		renderGrid();
	}
}

window.addEventListener('message', event => {
	if (event.data?.type === 'projects') {
		projects = event.data.projects;
		version = event.data.version ?? '';
		render();
	}
});
vscode.postMessage({ type: 'ready' });
