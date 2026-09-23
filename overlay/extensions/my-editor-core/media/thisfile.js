// @ts-check
const vscode = acquireVsCodeApi();
const root = /** @type {HTMLElement} */ (document.getElementById('root'));
const LETTER = { class: 'C', interface: 'I', enum: 'E', function: 'ƒ', field: 'p', value: 'v', module: 'M' };
let current = { file: undefined, symbols: [], notes: [], cursor: 0 };

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node|string)[]} [children] */
function el(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		node.setAttribute(key, value);
	}
	node.append(...children);
	return node;
}

function row(className, children, onClick, title) {
	const button = el('button', { type: 'button', class: `row ${className}`, ...(title ? { title } : {}) }, children);
	button.addEventListener('click', onClick);
	return el('li', {}, [button]);
}

/** The innermost symbol whose range holds the cursor. */
function currentSymbol() {
	let best;
	for (const symbol of current.symbols) {
		if (symbol.line <= current.cursor && current.cursor <= symbol.endLine && (!best || symbol.line >= best.line)) {
			best = symbol;
		}
	}
	return best;
}

function render() {
	root.replaceChildren();
	const file = current.file;
	if (!file) {
		root.append(el('p', { class: 'none' }, ['Open a file to see its outline, notes and history here.']));
		return;
	}
	root.append(el('h2', { class: 'name', title: file.path }, [file.name]));
	if (file.role) {
		root.append(el('p', { class: 'role' }, [file.role]));
	}
	const quick = el('div', { class: 'quick' });
	for (const [skill, label] of [['explain', 'Explain'], ['review', 'Review'], ['why', 'Why?']]) {
		const button = el('button', { type: 'button' }, [label]);
		button.addEventListener('click', () => vscode.postMessage({ type: 'skill', skill }));
		quick.append(button);
	}
	root.append(quick);

	root.append(el('p', { class: 'eyebrow' }, ['In this file']));
	const at = currentSymbol();
	const symbols = el('ul', { 'aria-label': 'Symbols in this file' });
	for (const symbol of current.symbols) {
		symbols.append(row(`depth-${symbol.depth}${symbol === at ? ' current' : ''}`, [
			el('span', { class: `kind ${symbol.kind}`, 'aria-label': symbol.kind }, [LETTER[symbol.kind] ?? '·']),
			el('span', { class: 'label' }, [symbol.name]),
			el('span', { class: 'meta' }, [String(symbol.line + 1)]),
		], () => vscode.postMessage({ type: 'reveal', line: symbol.line })));
	}
	root.append(current.symbols.length ? symbols : el('p', { class: 'empty' }, ['Nothing to outline yet.']));

	if (current.notes.length) {
		root.append(el('p', { class: 'eyebrow' }, ['Pair notes']));
		const notes = el('ul', { 'aria-label': 'Notes from the navigator' });
		for (const note of current.notes) {
			notes.append(row(`note${note.warning ? ' warning' : ''}`, [
				el('span', { class: 'dot', 'aria-label': note.warning ? 'warning' : 'note' }),
				el('span', { class: 'label' }, [note.message]),
				el('span', { class: 'meta' }, [String(note.line + 1)]),
			], () => vscode.postMessage({ type: 'reveal', line: note.line }), note.message));
		}
		root.append(notes);
	}

	root.append(el('p', { class: 'eyebrow' }, ['History']));
	if (file.history?.length) {
		const history = el('ul', { 'aria-label': 'Recent commits to this file' });
		for (const commit of file.history) {
			history.append(row('commit', [
				el('span', { class: 'hash' }, [commit.hash]),
				el('span', { class: 'label' }, [commit.subject]),
				el('span', { class: 'meta' }, [commit.when.replace(/ ago$/, '')]),
			], () => vscode.postMessage({ type: 'commit', hash: commit.hash }), `${commit.subject} (${commit.when})`));
		}
		root.append(history);
	} else {
		root.append(el('p', { class: 'empty' }, ['No commits yet.']));
	}
}

window.addEventListener('message', event => {
	const data = event.data;
	if (data?.type === 'file') {
		const keep = current.file && data.file && !data.full ? { role: current.file.role, history: current.file.history } : {};
		current = { file: data.file ? { ...keep, ...data.file } : undefined, symbols: data.symbols ?? [], notes: data.notes ?? [], cursor: data.cursor ?? 0 };
		render();
	} else if (data?.type === 'cursor') {
		current.cursor = data.line;
		render();
	}
});
vscode.postMessage({ type: 'ready' });
