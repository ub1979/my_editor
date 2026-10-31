// Character faces and the avatar that draws them. Loaded after chatDom.js, before chatCards.js.

/** Friendly faces drawn here so every character stays crisp in either theme. */
const FACES = {
	bamboo: '<circle cx="16" cy="16" r="16" fill="#273243"/><circle cx="8" cy="8" r="4" fill="#1b2432"/>'
		+ '<circle cx="24" cy="8" r="4" fill="#1b2432"/><ellipse cx="16" cy="18" rx="11" ry="10" fill="#f9faf7"/>'
		+ '<ellipse cx="11" cy="16" rx="3" ry="4" fill="#263143" transform="rotate(18 11 16)"/>'
		+ '<ellipse cx="21" cy="16" rx="3" ry="4" fill="#263143" transform="rotate(-18 21 16)"/>'
		+ '<g class="eyes" fill="#fff"><circle cx="11" cy="16" r="1.2"/><circle cx="21" cy="16" r="1.2"/>'
		+ '</g><ellipse cx="16" cy="21" rx="1.5" ry="1" fill="#253043"/>'
		+ '<path d="M13.5 23q2.5 2 5 0" fill="none" stroke="#253043" stroke-width="1.2" stroke-linecap="round"/>',
	soki: '<circle cx="16" cy="16" r="16" fill="#eee9ff"/>'
		+ '<path d="M5 10 8 4l5 4h6l5-4 3 6v11q-2 8-11 8T5 21Z" fill="#a99ace"/>'
		+ '<path d="M8 9 10 7l2 3m8 0 2-3 2 2" fill="#f7d58c"/><circle cx="11" cy="17" r="5" fill="#fffaf1"/>'
		+ '<circle cx="21" cy="17" r="5" fill="#fffaf1"/><g class="eyes" fill="#414060"><circle cx="11" cy="17" r="1.6"/>'
		+ '<circle cx="21" cy="17" r="1.6"/></g><path d="m14 22 2 3 2-3Z" fill="#e9a874"/>',
	ada: '<circle cx="16" cy="16" r="16" fill="#e9f4fa"/>'
		+ '<path d="M12 15Q2 3 3 20q4 9 11 0M20 15Q30 3 29 20q-4 9-11 0" fill="#a8d4e6"/>'
		+ '<path d="M14 14Q5 8 6 22q4 3 9-3m3-5q9-6 8 8-4 3-9-3" fill="#fff0c8"/>'
		+ '<ellipse cx="16" cy="18" rx="7" ry="10" fill="#f8f1e6"/>'
		+ '<path d="M13 10q3-3 6 0" fill="none" stroke="#506172" stroke-width="1.5"/>'
		+ '<g class="eyes" fill="#405166"><circle cx="13" cy="17" r="1.2"/><circle cx="19" cy="17" r="1.2"/>'
		+ '</g><path d="M14 22q2 2 4 0" fill="none" stroke="#405166" stroke-width="1.2" stroke-linecap="round"/>',
	lisko: '<circle cx="16" cy="16" r="16" fill="#e8f5f0"/>'
		+ '<path d="M5 11 9 3l5 5h4l5-5 4 8v10q-2 8-11 8T5 21Z" fill="#b7a987"/>'
		+ '<path d="m8 9 2-4 3 4m6 0 3-4 2 4" fill="#e6d7b4"/><path d="M8 18q8-6 16 0l-2 8q-6 5-12 0Z" fill="#fbf5df"/>'
		+ '<g class="eyes" fill="#384f50"><circle cx="11" cy="17" r="1.4"/><circle cx="21" cy="17" r="1.4"/>'
		+ '</g><path d="m14 22 2 1 2-1m-4 3q2 1 4 0" fill="none" stroke="#384f50" stroke-width="1.2" stroke-linecap="round"/>',
	flow: '<circle cx="16" cy="16" r="16" fill="#e7f1fb"/>'
		+ '<circle cx="8" cy="9" r="5" fill="#9b785b"/><circle cx="24" cy="9" r="5" fill="#9b785b"/>'
		+ '<circle cx="8" cy="9" r="2.5" fill="#e7c5a0"/><circle cx="24" cy="9" r="2.5" fill="#e7c5a0"/>'
		+ '<ellipse cx="16" cy="18" rx="12" ry="11" fill="#b8916c"/><ellipse cx="16" cy="22" rx="8" ry="6" fill="#f7e8cf"/>'
		+ '<g class="eyes" fill="#493f39"><circle cx="11" cy="16" r="1.5"/><circle cx="21" cy="16" r="1.5"/></g>'
		+ '<ellipse cx="16" cy="20" rx="2.5" ry="1.7" fill="#493f39"/><rect x="13" y="23" width="6" height="5" rx="1" fill="#fffaf1"/>'
		+ '<path d="M16 23v5m-5-6q5 4 10 0" fill="none" stroke="#493f39" stroke-width="1.1" stroke-linecap="round"/>',
	diji: '<circle cx="16" cy="16" r="16" fill="#fff0df"/>'
		+ '<path d="M3 19 6 9l4 3 3-7 3 6 4-6 2 7 4-3 3 10-5 7H8Z" fill="#b88e6e"/>'
		+ '<ellipse cx="16" cy="20" rx="10" ry="8" fill="#f7e8cf"/><circle cx="11" cy="18" r="1.4" fill="#483d3b"/>'
		+ '<circle cx="21" cy="18" r="1.4" fill="#483d3b"/>'
		+ '<path d="m14 22 2 1.5 2-1.5m-2 2q-2 2-4 0m4 0q2 2 4 0" fill="none" stroke="#483d3b" stroke-width="1.1" stroke-linecap="round"/>',
	poppy: '<circle cx="16" cy="16" r="16" fill="#d8ecf5"/>'
		+ '<path d="M7 13q0-10 9-10t9 10v11q-3 6-9 6t-9-6Z" fill="#34485b"/>'
		+ '<ellipse cx="16" cy="19" rx="8" ry="10" fill="#fff9ed"/>'
		+ '<path d="m12 8 4-3 4 3" fill="none" stroke="#34485b" stroke-width="2"/>'
		+ '<g class="eyes" fill="#34485b"><circle cx="12" cy="17" r="1.5"/><circle cx="20" cy="17" r="1.5"/>'
		+ '</g><path d="m12 22 4 2 4-2-4-1Z" fill="#efaa79"/><ellipse cx="16" cy="26" rx="3" ry="1" fill="#f4d4b5"/>',
	hopper: '<circle cx="16" cy="16" r="16" fill="#e6f4e6"/><circle cx="8" cy="11" r="6" fill="#75aa80"/>'
		+ '<circle cx="24" cy="11" r="6" fill="#75aa80"/><ellipse cx="16" cy="19" rx="12" ry="10" fill="#8dc394"/>'
		+ '<circle cx="10" cy="10" r="3.6" fill="#fff"/><circle cx="22" cy="10" r="3.6" fill="#fff"/>'
		+ '<g class="eyes" fill="#324b43"><circle cx="11" cy="10" r="1.5"/><circle cx="21" cy="10" r="1.5"/>'
		+ '</g><circle cx="12" cy="20" r="1" fill="#4a7662"/><circle cx="20" cy="20" r="1" fill="#4a7662"/>'
		+ '<path d="M11 23q5 5 10 0" fill="none" stroke="#4a7662" stroke-width="1.3" stroke-linecap="round"/>',
	pip: '<circle cx="16" cy="16" r="16" fill="#fff0da"/><path d="M5 5l9 5-7 8zM27 5l-9 5 7 8z" fill="#d88857"/>'
		+ '<path d="M9 9q7-5 14 0l3 10q-2 9-10 9T6 19z" fill="#e9a267"/>'
		+ '<path d="M7 20q9 3 18 0-2 8-9 8t-9-8" fill="#fff9ef"/>'
		+ '<g class="eyes" fill="#533a36"><circle cx="11" cy="17" r="1.3"/><circle cx="21" cy="17" r="1.3"/>'
		+ '</g><path d="M14 22l2 1.5 2-1.5z" fill="#533a36"/>',
	olive: '<circle cx="16" cy="16" r="16" fill="#eee9ff"/>'
		+ '<path d="M6 9l2-7 6 5h4l6-5 2 7v9q0 10-10 11Q6 28 6 18z" fill="#b6a5db"/>'
		+ '<circle cx="11" cy="17" r="5" fill="#faf7ff"/><circle cx="21" cy="17" r="5" fill="#faf7ff"/>'
		+ '<g class="eyes" fill="#4b456c"><circle cx="11" cy="17" r="1.5"/><circle cx="21" cy="17" r="1.5"/>'
		+ '</g><path d="M14 22l2 3 2-3z" fill="#e7a96f"/>',
	mochi: '<circle cx="16" cy="16" r="16" fill="#fff0ed"/>'
		+ '<path d="M5 12L7 4l7 5h4l7-5 2 8v8q-2 8-11 8T5 20z" fill="#f2b8aa"/>'
		+ '<path d="M8 7l4 3-5 2zM24 7l-4 3 5 2z" fill="#e98d92"/><ellipse cx="16" cy="22" rx="8" ry="5" fill="#fff9f5"/>'
		+ '<g class="eyes" fill="#66505c"><circle cx="11" cy="17" r="1.4"/><circle cx="21" cy="17" r="1.4"/>'
		+ '</g><path d="M14 21l2 1 2-1m-2 1v2m0 0q-2 1-3 0m3 0q2 1 3 0" fill="none" stroke="#66505c" stroke-width="1" stroke-linecap="round"/>',
	bolt: '<circle cx="16" cy="16" r="16" fill="#e9f0f4"/><path d="M16 4v4M14 4h4" stroke="#e2939f" stroke-width="1.5"/>'
		+ '<rect x="5" y="9" width="22" height="17" rx="6" fill="#aabcc5"/>'
		+ '<rect x="7" y="11" width="18" height="12" rx="4" fill="#f8fbfc"/>'
		+ '<g class="eyes" fill="#55717d"><circle cx="11" cy="17" r="1.6"/><circle cx="21" cy="17" r="1.6"/>'
		+ '</g><path d="M13 21q3 2 6 0" fill="none" stroke="#55717d" stroke-width="1.2" stroke-linecap="round"/>'
		+ '<circle cx="3" cy="17" r="2" fill="#90a7b3"/><circle cx="29" cy="17" r="2" fill="#90a7b3"/>',
};

function avatar(big = false, characterId = 'bamboo') {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 32 32');
	svg.setAttribute('class', `avatar face-${characterId}${big ? ' big' : ''}`);
	svg.setAttribute('aria-hidden', 'true');
	svg.innerHTML = FACES[characterId] ?? FACES.bamboo;
	return svg;
}
