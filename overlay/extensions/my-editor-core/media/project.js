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

function render(state, model, sync, project) {
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
	const maps = el('div', { class: 'visual-links' }, [
		button('Architecture map ↗', () => vscode.postMessage({ type: 'visual', tab: 'architecture' }), 'visual-link'),
		button('File tree ↗', () => vscode.postMessage({ type: 'visual', tab: 'tree' }), 'visual-link'),
	]);
	root.append(el('section', {}, [el('p', { class: 'eyebrow' }, ['Visual maps']), maps]));
	if (sync?.kind !== 'not-git') {
		const git = el('section', { class: 'git' }, [el('p', { class: 'eyebrow' }, ['Git updates'])]);
		if (project?.head) git.append(el('p', { class: 'status' }, [`Local commit ${project.head} · ${project.git?.branch ?? 'branch unknown'}`]));
		if (!sync) {
			git.append(el('p', { class: 'status' }, ['Checking the remote branch…']));
		} else if (sync.kind === 'no-upstream') {
			git.append(el('p', {}, [`${sync.branch ?? 'This branch'} has no tracked remote branch. Set an upstream in Source Control to receive update notices.`]));
		} else {
			const count = sync.behind ?? 0;
			const ahead = sync.ahead ?? 0;
			git.append(el('p', {}, [sync.fetchError
				? `Could not check ${sync.upstream}; the last known Git status may be stale.`
				: count ? `${count} new commit${count === 1 ? '' : 's'} available from ${sync.upstream}.`
					: `Up to date with ${sync.upstream}.`]));
			if (ahead) git.append(el('p', { class: 'status' }, [`${ahead} local commit${ahead === 1 ? '' : 's'} ahead.`]));
			if (sync.localEdits && count) git.append(el('p', { class: 'status' }, ['Commit or stash local file edits before updating.']));
			if (sync.fetchError) git.append(el('p', { class: 'status' }, [`Remote check failed: ${sync.fetchError}`]));
			if (count) git.append(button('Update project', () => vscode.postMessage({ type: 'updateGit' }), 'git-update'));
		}
		git.append(button('Check now', () => vscode.postMessage({ type: 'checkGit' })));
		root.append(git);
	}

	const memory = el('dl', { class: 'memory' }, [
		el('dt', {}, ['Conventions']),
		el('dd', {}, [button(state.memory.conventions ? 'Open' : 'Write', () => vscode.postMessage({ type: 'conventions' }))]),
		el('dt', {}, ['Brain']),
		el('dd', {}, [button(state.memory.brainFiles ? `${state.memory.brainFiles} files · analyse again` : 'Analyse', () => vscode.postMessage({ type: 'brain' }))]),
		el('dt', {}, ['Decisions']),
		el('dd', {}, [state.memory.decisions ? button(String(state.memory.decisions), () => vscode.postMessage({ type: 'folder', path: '.my_editor/decisions' })) : el('span', { class: 'empty' }, ['none yet'])]),
		el('dt', {}, ['Chat history']),
		el('dd', {}, [state.memory.chatDays ? button(`${state.memory.chatDays} day${state.memory.chatDays === 1 ? '' : 's'}`, () => vscode.postMessage({ type: 'folder', path: '.my_editor/chats' })) : el('span', { class: 'empty' }, ['none yet'])]),
		el('dt', {}, ['Investigations']),
		el('dd', {}, [button('Open records', () => vscode.postMessage({ type: 'folder', path: '.my_editor/investigations' }))]),
		el('dt', {}, ['Reviewed changes']),
		el('dd', {}, [button('Open records', () => vscode.postMessage({ type: 'folder', path: '.my_editor/changes' }))]),
	]);
	root.append(el('section', {}, [el('p', { class: 'eyebrow' }, ['Memory']), memory]));
	if (project?.brainCommit && project?.head && !project.head.startsWith(project.brainCommit) && !project.brainCommit.startsWith(project.head)) {
		root.append(el('p', { class: 'status' }, [`Brain mapped at ${project.brainCommit}; local code is ${project.head}. `,
			button('Analyse again', () => vscode.postMessage({ type: 'brain' }))]));
	}
	root.append(el('section', {}, [
		el('p', { class: 'eyebrow' }, ['Live observations']),
		el('p', { class: 'status' }, ['Pair can run project checks you register here. You review each exact recipe before its first run.']),
		button('Configure checks', () => vscode.postMessage({ type: 'observations' })),
	]));

	root.append(el('section', { class: 'model' }, [
		el('span', {}, [el('span', { class: 'status' }, ['Model ']), model ?? 'none set up']),
		button(model ? 'Change' : 'Set up', () => vscode.postMessage({ type: 'models' })),
	]));
}

window.addEventListener('message', event => {
	if (event.data?.type === 'state') {
		render(event.data.state, event.data.model, event.data.sync, event.data.project);
	}
});
vscode.postMessage({ type: 'ready' });
