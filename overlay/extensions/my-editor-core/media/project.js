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

/** A button that posts one message to the extension. */
function action(label, message, className = 'pill', title = '') {
	const node = el('button', { class: className, type: 'button', ...(title ? { title } : {}) }, [label]);
	node.addEventListener('click', () => vscode.postMessage(message));
	return node;
}

/** Compact header actions retain a keyboard/screen-reader label and a native hover tooltip. */
function projectAction(label, message, paths) {
	const button = action('', message, 'project-action', label);
	button.setAttribute('aria-label', label);
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	for (const d of paths) {
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', d); svg.append(path);
	}
	button.append(svg);
	return button;
}

function section(title, ...children) {
	return el('section', {}, [el('p', { class: 'eyebrow' }, [title]), ...children]);
}

/** One line of the list: label on the left, value on the right; the whole row is the button when it can act. */
function row(label, value, message, title = '') {
	const parts = [el('span', { class: 'label' }, [label]), el('span', { class: message ? 'value' : 'value quiet' }, [value])];
	if (!message) {
		return el('div', { class: 'item' }, parts);
	}
	const node = el('button', { class: 'item', type: 'button', title: title || `${label}: ${value}` }, parts);
	node.addEventListener('click', () => vscode.postMessage(message));
	return node;
}

function stagesSection(stages) {
	const list = el('ol', { 'aria-label': 'Stages' });
	stages.forEach((stage, index) => {
		const mark = stage.state === 'done' ? '✓' : String(index + 1);
		const node = el('button', { class: `row ${stage.state}`, type: 'button', 'aria-label': `${stage.title}: ${stage.status}` }, [
			el('span', { class: 'mark', 'aria-hidden': 'true' }, [mark]),
			el('span', { class: 'title' }, [stage.title]),
			el('span', { class: 'status' }, [stage.status]),
		]);
		node.addEventListener('click', () => vscode.postMessage({ type: 'open', stage: stage.id, path: stage.file }));
		list.append(el('li', {}, [node]));
	});
	return section('Build path', list, el('div', { class: 'actions' }, [
		action('Start here', { type: 'nextFile' }, 'pill primary'),
		action('Build guide', { type: 'buildGuide' }),
		action('Build everything…', { type: 'buildProject' }),
		action('QA everything…', { type: 'qaProject' }),
	]));
}

function mapsSection() {
	return section('Visual maps', el('div', { class: 'actions' }, [
		action('Architecture ↗', { type: 'visual', tab: 'architecture' }),
		action('File tree ↗', { type: 'visual', tab: 'tree' }),
	]));
}

function readinessCard(fix) {
	const button = action(fix.label, { type: 'aiReadyFix' }, fix.primary ? 'pill primary' : 'pill');
	button.disabled = !!fix.disabled;
	return el('div', { class: 'card' }, [
		el('p', { class: 'card-title' }, ['AI readiness']),
		el('p', { class: 'card-text' }, [fix.text]),
		el('div', { class: 'actions' }, [
			button,
			action('Check', { type: 'aiReady' }, 'pill', 'Write the health report without changing code'),
		]),
	]);
}

/** Where the local branch stands against its remote, in one short card. */
function gitCard(sync, project) {
	const branch = project?.git?.branch ?? sync?.branch ?? 'branch unknown';
	const card = el('div', { class: 'card' });
	const head = el('div', { class: 'card-head' }, [
		el('span', { class: 'branch', title: branch }, [branch]),
		project?.head ? el('span', { class: 'commit', title: `Local commit ${project.head}` }, [project.head]) : '',
	]);
	card.append(head);
	const behind = sync?.behind ?? 0;
	const [tone, text] = !sync ? ['quiet', 'Checking the remote…']
		: sync.kind === 'no-upstream' ? ['quiet', 'No remote branch to follow']
			: sync.fetchError ? ['warn', 'Could not reach the remote']
				: behind ? ['new', `${behind} new commit${behind === 1 ? '' : 's'}`] : ['ok', 'Up to date'];
	card.append(el('p', { class: `sync ${tone}` }, [el('span', { class: 'dot', 'aria-hidden': 'true' }), text]));
	const notes = [];
	if (sync?.ahead) notes.push(`${sync.ahead} local commit${sync.ahead === 1 ? '' : 's'} not pushed yet.`);
	if (sync?.localEdits && behind) notes.push('Commit or stash your edits before updating.');
	if (sync?.kind === 'no-upstream') notes.push('This branch is not on GitHub yet; Push… puts it there.');
	if (sync?.fetchError) notes.push(sync.fetchError);
	for (const note of notes) card.append(el('p', { class: 'card-text' }, [note]));
	// Push is offered when there is something to send: local commits, or a branch with no remote branch yet.
	const pushable = !!sync && (sync.kind === 'no-upstream' ? sync.branch !== 'detached HEAD' : !!sync.ahead);
	card.append(el('div', { class: 'actions' }, [
		...(behind ? [action('Update', { type: 'updateGit' }, 'pill primary', `Fast-forward from ${sync.upstream}`)] : []),
		...(pushable ? [action('Push…', { type: 'pushGit' }, behind ? 'pill' : 'pill primary', 'Push to GitHub after you confirm where it goes')] : []),
		action('Check now', { type: 'checkGit' }),
	]));
	return card;
}

function memorySection(memory, project) {
	const list = el('div', { class: 'list' }, [
		row('Conventions', memory.conventions ? 'Open' : 'Write', { type: 'conventions' }),
		row('Brain', memory.brainFiles ? `${memory.brainFiles} files` : 'Analyse', { type: 'brain' },
			memory.brainFiles ? 'Analyse again to refresh the brain' : 'Analyse the project'),
		row('Decisions', memory.decisions ? String(memory.decisions) : 'none yet',
			memory.decisions ? { type: 'folder', path: '.my_editor/decisions' } : undefined),
		row('Chat history', memory.chatDays ? `${memory.chatDays} day${memory.chatDays === 1 ? '' : 's'}` : 'none yet',
			memory.chatDays ? { type: 'folder', path: '.my_editor/chats' } : undefined),
		row('Investigations', 'Open', { type: 'folder', path: '.my_editor/investigations' }),
		row('Reviewed changes', 'Open', { type: 'folder', path: '.my_editor/changes' }),
		row('Live checks', 'Configure', { type: 'observations' },
			'Project checks Pair may run. You review each exact recipe before its first run.'),
	]);
	const stale = project?.brainCommit && project?.head
		&& !project.head.startsWith(project.brainCommit) && !project.brainCommit.startsWith(project.head);
	return section('Memory', list, ...(stale ? [el('p', { class: 'hint' }, [
		`The brain was mapped at ${project.brainCommit}; the code is now ${project.head}. `,
		action('Analyse again', { type: 'brain' }, 'link'),
	])] : []));
}

const PLAIN_FIX = { label: 'Fix on a local branch', primary: true, text: 'Split long files and add tests on a local branch.' };

function render(state, model, sync, project, fix = PLAIN_FIX) {
	root.replaceChildren();
	root.append(
		el('div', { class: 'top' }, [el('p', { class: 'eyebrow' }, ['Project']), el('span', { class: 'links' }, [
			projectAction('All projects', { type: 'home' }, ['M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z']),
			projectAction('Close project', { type: 'closeProject' }, ['M6 6l12 12 M18 6L6 18']),
		])]),
		el('h1', {}, [state.name]),
		el('p', { class: 'summary' }, [state.summary]),
	);
	if (!state.hasWorkspace) {
		return;
	}
	root.append(stagesSection(state.stages), section('Health', readinessCard(fix)));
	if (sync?.kind !== 'not-git') root.append(section('Git', gitCard(sync, project)));
	root.append(mapsSection(), memorySection(state.memory, project), el('section', { class: 'model' }, [
		el('span', { class: 'model-name' }, [el('span', { class: 'status' }, ['Model ']), model ?? 'none set up']),
		action(model ? 'Change' : 'Set up', { type: 'models' }, 'link'),
	]));
}

window.addEventListener('message', event => {
	if (event.data?.type === 'state') {
		render(event.data.state, event.data.model, event.data.sync, event.data.project, event.data.fix);
	}
});
vscode.postMessage({ type: 'ready' });
