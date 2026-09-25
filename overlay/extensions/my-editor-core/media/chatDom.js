// Chat DOM primitives and icon vocabulary. Loaded before chatCards.js and chat.js.
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
	expand: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
	sidebar: 'M3 4h18v16H3zM15 4v16',
	link: 'M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1',
};

const COMMANDS = [
	['feature', 'Add a feature to this file'], ['change', 'Rewrite the selected lines'], ['next', 'Take the next small step'], ['locate', 'Find files and lines to change'],
	['file', 'Write the whole file'], ['explain', 'Explain the file or selection'], ['review', 'Review without editing'],
	['why', 'Why is this code like this?'], ['brainstorm', 'Explore approaches'], ['requirements', 'Work out what to build'],
	['architecture', 'Design the parts'], ['tree', 'Plan the files'], ['impact', 'What does a change affect?'], ['changes', 'Git history and current edits'], ['skill', 'Run a skill by name'],
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

/** Friendly faces drawn here so every character stays crisp in either theme. */
const FACES = {
	bamboo: '<circle cx="16" cy="16" r="16" fill="#273243"/><circle cx="8" cy="8" r="4" fill="#1b2432"/><circle cx="24" cy="8" r="4" fill="#1b2432"/><ellipse cx="16" cy="18" rx="11" ry="10" fill="#f9faf7"/><ellipse cx="11" cy="16" rx="3" ry="4" fill="#263143" transform="rotate(18 11 16)"/><ellipse cx="21" cy="16" rx="3" ry="4" fill="#263143" transform="rotate(-18 21 16)"/><g class="eyes" fill="#fff"><circle cx="11" cy="16" r="1.2"/><circle cx="21" cy="16" r="1.2"/></g><ellipse cx="16" cy="21" rx="1.5" ry="1" fill="#253043"/><path d="M13.5 23q2.5 2 5 0" fill="none" stroke="#253043" stroke-width="1.2" stroke-linecap="round"/>',
	soki: '<circle cx="16" cy="16" r="16" fill="#eee9ff"/><path d="M5 10 8 4l5 4h6l5-4 3 6v11q-2 8-11 8T5 21Z" fill="#a99ace"/><path d="M8 9 10 7l2 3m8 0 2-3 2 2" fill="#f7d58c"/><circle cx="11" cy="17" r="5" fill="#fffaf1"/><circle cx="21" cy="17" r="5" fill="#fffaf1"/><g class="eyes" fill="#414060"><circle cx="11" cy="17" r="1.6"/><circle cx="21" cy="17" r="1.6"/></g><path d="m14 22 2 3 2-3Z" fill="#e9a874"/>',
	ada: '<circle cx="16" cy="16" r="16" fill="#e9f4fa"/><path d="M12 15Q2 3 3 20q4 9 11 0M20 15Q30 3 29 20q-4 9-11 0" fill="#a8d4e6"/><path d="M14 14Q5 8 6 22q4 3 9-3m3-5q9-6 8 8-4 3-9-3" fill="#fff0c8"/><ellipse cx="16" cy="18" rx="7" ry="10" fill="#f8f1e6"/><path d="M13 10q3-3 6 0" fill="none" stroke="#506172" stroke-width="1.5"/><g class="eyes" fill="#405166"><circle cx="13" cy="17" r="1.2"/><circle cx="19" cy="17" r="1.2"/></g><path d="M14 22q2 2 4 0" fill="none" stroke="#405166" stroke-width="1.2" stroke-linecap="round"/>',
	lisko: '<circle cx="16" cy="16" r="16" fill="#e8f5f0"/><path d="M5 11 9 3l5 5h4l5-5 4 8v10q-2 8-11 8T5 21Z" fill="#b7a987"/><path d="m8 9 2-4 3 4m6 0 3-4 2 4" fill="#e6d7b4"/><path d="M8 18q8-6 16 0l-2 8q-6 5-12 0Z" fill="#fbf5df"/><g class="eyes" fill="#384f50"><circle cx="11" cy="17" r="1.4"/><circle cx="21" cy="17" r="1.4"/></g><path d="m14 22 2 1 2-1m-4 3q2 1 4 0" fill="none" stroke="#384f50" stroke-width="1.2" stroke-linecap="round"/>',
	diji: '<circle cx="16" cy="16" r="16" fill="#fff0df"/><path d="M3 19 6 9l4 3 3-7 3 6 4-6 2 7 4-3 3 10-5 7H8Z" fill="#b88e6e"/><ellipse cx="16" cy="20" rx="10" ry="8" fill="#f7e8cf"/><circle cx="11" cy="18" r="1.4" fill="#483d3b"/><circle cx="21" cy="18" r="1.4" fill="#483d3b"/><path d="m14 22 2 1.5 2-1.5m-2 2q-2 2-4 0m4 0q2 2 4 0" fill="none" stroke="#483d3b" stroke-width="1.1" stroke-linecap="round"/>',
	poppy: '<circle cx="16" cy="16" r="16" fill="#d8ecf5"/><path d="M7 13q0-10 9-10t9 10v11q-3 6-9 6t-9-6Z" fill="#34485b"/><ellipse cx="16" cy="19" rx="8" ry="10" fill="#fff9ed"/><path d="m12 8 4-3 4 3" fill="none" stroke="#34485b" stroke-width="2"/><g class="eyes" fill="#34485b"><circle cx="12" cy="17" r="1.5"/><circle cx="20" cy="17" r="1.5"/></g><path d="m12 22 4 2 4-2-4-1Z" fill="#efaa79"/><ellipse cx="16" cy="26" rx="3" ry="1" fill="#f4d4b5"/>',
	hopper: '<circle cx="16" cy="16" r="16" fill="#e6f4e6"/><circle cx="8" cy="11" r="6" fill="#75aa80"/><circle cx="24" cy="11" r="6" fill="#75aa80"/><ellipse cx="16" cy="19" rx="12" ry="10" fill="#8dc394"/><circle cx="10" cy="10" r="3.6" fill="#fff"/><circle cx="22" cy="10" r="3.6" fill="#fff"/><g class="eyes" fill="#324b43"><circle cx="11" cy="10" r="1.5"/><circle cx="21" cy="10" r="1.5"/></g><circle cx="12" cy="20" r="1" fill="#4a7662"/><circle cx="20" cy="20" r="1" fill="#4a7662"/><path d="M11 23q5 5 10 0" fill="none" stroke="#4a7662" stroke-width="1.3" stroke-linecap="round"/>',
	pip: '<circle cx="16" cy="16" r="16" fill="#fff0da"/><path d="M5 5l9 5-7 8zM27 5l-9 5 7 8z" fill="#d88857"/><path d="M9 9q7-5 14 0l3 10q-2 9-10 9T6 19z" fill="#e9a267"/><path d="M7 20q9 3 18 0-2 8-9 8t-9-8" fill="#fff9ef"/><g class="eyes" fill="#533a36"><circle cx="11" cy="17" r="1.3"/><circle cx="21" cy="17" r="1.3"/></g><path d="M14 22l2 1.5 2-1.5z" fill="#533a36"/>',
	olive: '<circle cx="16" cy="16" r="16" fill="#eee9ff"/><path d="M6 9l2-7 6 5h4l6-5 2 7v9q0 10-10 11Q6 28 6 18z" fill="#b6a5db"/><circle cx="11" cy="17" r="5" fill="#faf7ff"/><circle cx="21" cy="17" r="5" fill="#faf7ff"/><g class="eyes" fill="#4b456c"><circle cx="11" cy="17" r="1.5"/><circle cx="21" cy="17" r="1.5"/></g><path d="M14 22l2 3 2-3z" fill="#e7a96f"/>',
	mochi: '<circle cx="16" cy="16" r="16" fill="#fff0ed"/><path d="M5 12L7 4l7 5h4l7-5 2 8v8q-2 8-11 8T5 20z" fill="#f2b8aa"/><path d="M8 7l4 3-5 2zM24 7l-4 3 5 2z" fill="#e98d92"/><ellipse cx="16" cy="22" rx="8" ry="5" fill="#fff9f5"/><g class="eyes" fill="#66505c"><circle cx="11" cy="17" r="1.4"/><circle cx="21" cy="17" r="1.4"/></g><path d="M14 21l2 1 2-1m-2 1v2m0 0q-2 1-3 0m3 0q2 1 3 0" fill="none" stroke="#66505c" stroke-width="1" stroke-linecap="round"/>',
	bolt: '<circle cx="16" cy="16" r="16" fill="#e9f0f4"/><path d="M16 4v4M14 4h4" stroke="#e2939f" stroke-width="1.5"/><rect x="5" y="9" width="22" height="17" rx="6" fill="#aabcc5"/><rect x="7" y="11" width="18" height="12" rx="4" fill="#f8fbfc"/><g class="eyes" fill="#55717d"><circle cx="11" cy="17" r="1.6"/><circle cx="21" cy="17" r="1.6"/></g><path d="M13 21q3 2 6 0" fill="none" stroke="#55717d" stroke-width="1.2" stroke-linecap="round"/><circle cx="3" cy="17" r="2" fill="#90a7b3"/><circle cx="29" cy="17" r="2" fill="#90a7b3"/>',
};

function avatar(big = false, characterId = 'bamboo') {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 32 32');
	svg.setAttribute('class', `avatar face-${characterId}${big ? ' big' : ''}`);
	svg.setAttribute('aria-hidden', 'true');
	svg.innerHTML = FACES[characterId] ?? FACES.bamboo;
	return svg;
}
