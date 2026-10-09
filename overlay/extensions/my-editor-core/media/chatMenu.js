// @ts-check
// The "/" command menu above the composer. Loaded after chatCards.js, before chat.js, which owns the composer it opens in.

/** The commands the menu offers, as [name, description]. */
const COMMANDS = [
	['feature', 'Add a feature to this file'], ['change', 'Rewrite the selected lines'], ['next', 'Take the next small step'],
	['locate', 'Find files and lines to change'], ['file', 'Write the whole file'], ['explain', 'Explain the file or selection'],
	['review', 'Review without editing'], ['why', 'Why is this code like this?'], ['brainstorm', 'Explore approaches'],
	['requirements', 'Work out what to build'], ['architecture', 'Design the parts'], ['tree', 'Plan the files'],
	['impact', 'What does a change affect?'], ['changes', 'Git history and current edits'], ['skill', 'Run a skill by name'],
];

let menu = /** @type {HTMLElement | null} */ (null);
let menuIndex = 0;

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

/** Arrow keys move through an open menu, Enter or Tab picks, Escape closes; true when the key was the menu's. */
function menuKey(event) {
	if (!menu) {
		return false;
	}
	const count = menu.children.length;
	if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
		event.preventDefault();
		menuIndex = (menuIndex + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
		openMenu();
		return true;
	}
	if (event.key === 'Enter' || event.key === 'Tab') {
		event.preventDefault();
		const option = /** @type {HTMLElement} */ (menu.children[menuIndex]);
		pick(option.querySelector('.cmd')?.textContent?.slice(1) ?? '');
		return true;
	}
	if (event.key === 'Escape') {
		closeMenu();
		return true;
	}
	return false;
}
