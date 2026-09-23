// @ts-check
const vscode = acquireVsCodeApi();
const root = /** @type {HTMLElement} */ (document.getElementById('root'));
const state = { tab: 'architecture', project: '', hasArchitecture: false, hasTree: false, visuals: { overview: '', parts: [], files: [] } };

/** @param {string} tag @param {Record<string, string>} attrs @param {(Node|string)[]} children */
function el(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
	node.append(...children);
	return node;
}

/** @param {string} label @param {() => void} action @param {string} className */
function button(label, action, className = '') {
	const node = el('button', { type: 'button', class: className }, [label]);
	node.addEventListener('click', action);
	return node;
}

function render() {
	root.replaceChildren();
	const header = el('header', {}, [
		el('div', {}, [el('p', { class: 'eyebrow' }, [state.project || 'Project']), el('h1', {}, ['Project map'])]),
	]);
	const tabs = el('nav', { 'aria-label': 'Project maps' }, [
		button('Architecture', () => select('architecture'), state.tab === 'architecture' ? 'active' : ''),
		button('File tree', () => select('tree'), state.tab === 'tree' ? 'active' : ''),
	]);
	root.append(header, tabs);
	if (state.tab === 'architecture') renderArchitecture();
	else renderTree();
}

/** @param {'architecture'|'tree'} tab */
function select(tab) {
	state.tab = tab;
	render();
}

function renderArchitecture() {
	const section = el('section', {}, []);
	section.append(el('div', { class: 'section-head' }, [
		el('div', {}, [el('h2', {}, ['Architecture']), el('p', { class: 'hint' }, ['Parts and links found in the saved project documents.'])]),
		button('Open document ↗', () => vscode.postMessage({ type: 'architectureSource' }), 'source'),
	]));
	if (state.visuals.overview) section.append(el('p', { class: 'overview' }, [state.visuals.overview]));
	if (!state.visuals.parts.length) {
		section.append(el('p', { class: 'empty' }, [state.hasArchitecture ? 'No architecture parts with section headings yet.' : 'No architecture document yet. Run Analyse or use the Architecture card in Pair.']));
		root.append(section);
		return;
	}
	const names = new Map(state.visuals.parts.map(part => [part.id, part.title]));
	const grid = el('div', { class: 'part-grid' }, []);
	for (const part of state.visuals.parts) {
		const card = el('article', { class: 'part-card', id: `part-${part.id}` }, [
			el('div', { class: 'part-top' }, [el('h3', {}, [part.title]), el('span', { class: 'count' }, [`${part.fileCount} file${part.fileCount === 1 ? '' : 's'}`])]),
			el('p', {}, [part.summary || 'No summary in the architecture document.']),
		]);
		if (part.uses.length) {
			const links = el('div', { class: 'links' }, [el('span', { class: 'links-label' }, ['Uses →'])]);
			for (const use of part.uses) {
				links.append(button(`${names.get(use.id) || use.id} · ${use.count}`, () => document.getElementById(`part-${use.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 'chip'));
			}
			card.append(links);
		}
		grid.append(card);
	}
	section.append(grid);
	root.append(section);
}

/** @param {string} name */
function folder(name) { return { name, folders: new Map(), files: [] }; }

function renderTree() {
	const section = el('section', {}, []);
	section.append(el('div', { class: 'section-head' }, [
		el('div', {}, [el('h2', {}, ['File tree']), el('p', { class: 'hint' }, [`${state.visuals.files.length} files from tree.json. Select a file to open it.`])]),
		button('Open tree.json ↗', () => vscode.postMessage({ type: 'treeSource' }), 'source'),
	]));
	if (!state.visuals.files.length) {
		section.append(el('p', { class: 'empty' }, [state.hasTree ? 'The file tree has no valid paths yet.' : 'No file tree yet. Run Analyse or use Plan the files in Pair.']));
		root.append(section);
		return;
	}
	const search = /** @type {HTMLInputElement} */ (el('input', { type: 'search', placeholder: 'Find a file…', 'aria-label': 'Find a file' }, []));
	const container = el('div', { class: 'tree-body' }, []);
	search.addEventListener('input', () => drawTree(container, search.value));
	section.append(search, container);
	root.append(section);
	drawTree(container, '');
}

/** @param {HTMLElement} container @param {string} query */
function drawTree(container, query) {
	container.replaceChildren();
	const value = query.trim().toLowerCase();
	if (value) {
		const matches = state.visuals.files.filter(file => `${file.path} ${file.role || ''}`.toLowerCase().includes(value));
		container.append(el('p', { class: 'hint' }, [`${matches.length} matching files${matches.length > 200 ? ' · showing first 200' : ''}`]));
		for (const file of matches.slice(0, 200)) container.append(fileRow(file, true));
		return;
	}
	const top = folder('');
	for (const file of state.visuals.files) {
		const segments = file.path.split('/').filter(Boolean);
		let at = top;
		for (const segment of segments.slice(0, -1)) {
			if (!at.folders.has(segment)) at.folders.set(segment, folder(segment));
			at = at.folders.get(segment);
		}
		at.files.push(file);
	}
	appendFolderContents(container, top, 0);
}

/** @param {HTMLElement} parent @param {ReturnType<typeof folder>} node @param {number} depth */
function appendFolderContents(parent, node, depth) {
	for (const child of [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
		const count = countFiles(child);
		const details = el('details', { class: 'folder' }, [el('summary', {}, [`${child.name}/`, el('span', { class: 'folder-count' }, [`${count} file${count === 1 ? '' : 's'}`])])]);
		if (depth === 0) details.open = true;
		if (details.open) appendFolderContents(details, child, depth + 1);
		else details.addEventListener('toggle', () => { if (details.open && details.children.length === 1) appendFolderContents(details, child, depth + 1); });
		parent.append(details);
	}
	for (const file of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) parent.append(fileRow(file, false));
}

/** @param {ReturnType<typeof folder>} node */
function countFiles(node) { return node.files.length + [...node.folders.values()].reduce((n, child) => n + countFiles(child), 0); }

/** @param {any} file @param {boolean} fullPath */
function fileRow(file, fullPath) {
	const name = fullPath ? file.path : file.path.split('/').at(-1);
	const row = button(name || file.path, () => vscode.postMessage({ type: 'openFile', path: file.path }), 'file-row');
	const status = el('span', { class: `file-status ${String(file.status || 'planned').replace(/[^a-z-]/g, '')}` }, [file.status || 'planned']);
	const wrap = el('div', { class: 'file' }, [row, status]);
	if (file.role) wrap.append(el('p', { class: 'role' }, [file.role]));
	return wrap;
}

window.addEventListener('message', event => {
	const data = event.data;
	if (data?.type === 'tab') select(data.tab);
	if (data?.type === 'state') {
		state.project = data.project || '';
		state.hasArchitecture = data.hasArchitecture;
		state.hasTree = data.hasTree;
		state.visuals = data.visuals;
		if (data.tab) state.tab = data.tab;
		render();
	}
});
vscode.postMessage({ type: 'ready' });
