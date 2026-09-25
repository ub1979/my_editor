// Welcome and message cards. Called after chat.js initializes the view state.
/* Rendering */

function renderWelcome() {
	const chosen = activeCharacter();
	const groups = ['Plan', 'Build', 'Fix', 'Your skills'];
	const box = el('section', { class: 'welcome' }, [
		el('div', { class: 'hello' }, [avatar(false, chosen.id), el('div', { class: 'welcome-bubble' }, [
			el('h1', {}, [showSkills ? `What shall ${chosen.name} help with?` : chosen.greeting]),
			el('p', {}, [state.project ? `Working with ${state.project}` : 'Open a project and we can start.']),
		])]),
	]);
	if (state.project && !state.messages.length) {
		box.append(el('p', { class: 'group-note' }, ['This folder has its own Pair conversation. Open the earlier folder to see its chat.']));
	}
	if (state.offer) {
		box.append(renderOffer(state.offer));
	}
	if (!showSkills) {
		const shortcuts = el('div', { class: 'welcome-shortcuts' });
		for (const [label, id] of [['Find a change', 'locate'], ['Plan a change', 'architecture'], ['Review code', 'review'], ['Find a bug', 'skill:debug']]) {
			const button = el('button', { type: 'button', class: 'pill', title: label }, [label]);
			button.addEventListener('click', () => vscode.postMessage({ type: 'skill', id }));
			shortcuts.append(button);
		}
		box.append(shortcuts);
		return box;
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
		el('p', { class: 'offer-note' }, [`Uses ${state.models.find(m => m.key === state.model)?.label ?? 'the model picked below'}. Change it below first if you like.`]),
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
		const label = proposal.state === 'kept' ? [icon('check'), 'Kept and saved']
			: proposal.state === 'expired' ? [icon('undo'), 'Review expired after restart. Ask Pair to propose it again.']
			: [icon('undo'), 'Undone. The file was not changed.'];
		card.append(el('span', { class: `state ${proposal.state}` }, label));
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
	return el('div', { class: 'message assistant', 'data-id': message.id }, [avatar(false, message.characterId ?? 'bamboo'), body]);
}

function htmlFragment(html) {
	const template = document.createElement('template');
	template.innerHTML = html;
	return template.content;
}
