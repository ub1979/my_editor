// Human portraits share proportions and lighting, with individual hair, clothing and accessories.
const PEOPLE = {
	iris: { skin: '#ba7f60', shade: '#985c48', hair: '#302e36', light: '#5b4a4b', bg: '#e0e8f6', shirt: '#617daa', style: 'bob', glasses: true },
	bamboo: { skin: '#efbc95', shade: '#d59474', hair: '#45342f', light: '#735044', bg: '#d9eee4', shirt: '#538779', style: 'wave', glasses: true },
	soki: { skin: '#a86849', shade: '#884c3b', hair: '#342c39', light: '#544052', bg: '#eee2fa', shirt: '#9675bd', style: 'curls' },
	lisko: { skin: '#dba782', shade: '#bc8067', hair: '#424653', light: '#9297a5', bg: '#dcebf4', shirt: '#536f95', style: 'sweep', glasses: true, beard: true },
	flow: { skin: '#f2c7a2', shade: '#dba488', hair: '#374864', light: '#667c9b', bg: '#dceff1', shirt: '#4b929c', style: 'crop' },
	ada: { skin: '#f2bd9d', shade: '#d5957c', hair: '#633a32', light: '#995d45', bg: '#ffe7d8', shirt: '#bc6e66', style: 'bob', clip: true },
	diji: { skin: '#ba7f60', shade: '#985c48', hair: '#302e36', light: '#5b4a4b', bg: '#eee9d9', shirt: '#8d8654', style: 'wave', glasses: true },
	poppy: { skin: '#f3c5ad', shade: '#d99b8c', hair: '#8b4a3d', light: '#bd7860', bg: '#f8dfeb', shirt: '#a56e98', style: 'buns', freckles: true },
	hopper: { skin: '#e7b293', shade: '#c98d75', hair: '#a15a36', light: '#d68b4f', bg: '#e2ebd9', shirt: '#648874', style: 'sweep', freckles: true },
};

function portraitHair(person, front) {
	const { hair, light, style } = person;
	if (!front) {
		const extra = style === 'buns' ? '<circle cx="17" cy="15" r="9"/><circle cx="47" cy="15" r="9"/>'
			: style === 'curls' ? '<circle cx="15" cy="25" r="9"/><circle cx="49" cy="25" r="9"/><circle cx="19" cy="13" r="9"/><circle cx="32" cy="10" r="10"/><circle cx="45" cy="13" r="9"/>' : '';
		return `<g fill="${hair}">${extra}<path d="M13 30V23C13 9 22 5 32 5S51 12 51 24v21c-9 9-30 9-38 0Z"/></g>`;
	}
	const shape = {
		bob: 'M13 29C11 14 20 6 32 6c15 0 23 12 19 27l-6-8-3-10c-6 8-18 9-24 7l-2 10Z',
		wave: 'M13 29C8 20 14 14 17 13c-2-8 8-12 13-8 8-6 17-2 18 5 10 4 8 15 2 21l-5-9c-7 2-15-2-18-5-1 7-8 5-10 8l-1 7Z',
		sweep: 'M13 30C10 17 17 5 32 5c11 0 19 5 20 16l-4 11-4-11c-8 0-17-5-18-8-2 8-5 10-10 10l1 9Z',
		crop: 'M13 31C9 18 18 7 31 6c12-2 22 6 22 17l-5 10-3-12c-9 4-19 0-23-5l-4 10-2 7Z',
		buns: 'M13 29C11 13 21 7 32 7s21 6 19 23l-5 1-3-12c-4 5-7 5-11 1-3 6-12 5-14 3l-2 9Z',
		curls: 'M13 29C7 20 15 10 22 13c1-8 11-10 15-4 8-3 16 4 13 11 6 3 5 8 0 12l-5-8c-3 3-8 0-9-2-4 4-11 3-13-1-2 4-5 4-7 4v7Z',
	}[style];
	return `<path d="${shape}" fill="${hair}"/><path d="M19 16c3-6 10-8 16-6" fill="none" stroke="${light}" stroke-width="2.5" stroke-linecap="round"/>`;
}

/** Rounded human faces, expressive eyes and soft cheek shading stay legible at sidebar size. */
function humanPortrait(person) {
	const { skin, shade, hair, bg, shirt } = person;
	return `<rect width="64" height="64" rx="22" fill="${bg}"/>
<ellipse cx="32" cy="64" rx="25" ry="17" fill="${shirt}"/>
${portraitHair(person, false)}
<path d="M26 43h12v10q-6 7-12 0Z" fill="${skin}"/>
<path d="M26 44h12v6q-7 3-12-1Z" fill="${shade}"/>
<ellipse cx="15" cy="32" rx="4" ry="5" fill="${skin}"/><ellipse cx="49" cy="32" rx="4" ry="5" fill="${skin}"/>
<ellipse cx="15" cy="33" rx="1.5" ry="2.5" fill="${shade}"/><ellipse cx="49" cy="33" rx="1.5" ry="2.5" fill="${shade}"/>
<path d="M16 24q0-13 16-13t16 13v10c0 10-7 16-16 16s-16-6-16-16Z" fill="${skin}"/>
<path d="M17 33c0 9 6 15 15 15s15-6 15-15c2 11-5 19-15 19S15 44 17 33Z" fill="${shade}" opacity=".3"/>
${portraitHair(person, true)}
<path d="M22 28q3-2 6 0m8 0q3-2 6 0" stroke="${hair}" stroke-width="1.5" stroke-linecap="round" fill="none"/>
<g class="eyes"><ellipse cx="25" cy="33" rx="2.2" ry="2.8" fill="#342d38"/><ellipse cx="39" cy="33" rx="2.2" ry="2.8" fill="#342d38"/>
<circle cx="25.7" cy="32" r=".8" fill="#fff"/><circle cx="39.7" cy="32" r=".8" fill="#fff"/></g>
<ellipse cx="21" cy="38" rx="3.4" ry="1.8" fill="#d77f7f" opacity=".38"/><ellipse cx="43" cy="38" rx="3.4" ry="1.8" fill="#d77f7f" opacity=".38"/>
<path d="m32 34-1 4h2" fill="none" stroke="${shade}" stroke-width="1.3" stroke-linecap="round"/>
${person.beard ? `<path d="M20 40q5 3 7 0h10q2 3 7 0-3 10-12 10T20 40Z" fill="${hair}" opacity=".65"/>` : ''}
<path d="M27 41q5 6 10 0" fill="#a95d5c" stroke="#884d4c" stroke-width=".7" stroke-linejoin="round"/><path d="M28 41h8q-4 3-8 0" fill="#fff6eb"/>
${person.glasses ? '<g fill="none" stroke="#455567" stroke-width="1.5"><rect x="18.5" y="29" width="12" height="9" rx="4"/><rect x="33.5" y="29" width="12" height="9" rx="4"/><path d="M30.5 32h3M16 31h2m27 0h3"/></g>' : ''}
${person.clip ? '<path d="m43 19 5 3" stroke="#f9ce70" stroke-width="3" stroke-linecap="round"/>' : ''}
${person.freckles ? '<g fill="#b37b68"><circle cx="21" cy="37" r=".65"/><circle cx="24" cy="38" r=".65"/><circle cx="40" cy="38" r=".65"/><circle cx="43" cy="37" r=".65"/></g>' : ''}
<path d="m24 53 8 5 8-5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>
<path d="M17 59v5m30-5v5" stroke="#1d3445" stroke-opacity=".18" stroke-width="2"/>
`;
}

const FACES = Object.fromEntries(Object.entries(PEOPLE).map(([id, person]) => [id, humanPortrait(person)]));
Object.assign(FACES, { pip: FACES.ada, olive: FACES.lisko, mochi: FACES.diji, bolt: FACES.hopper });

function avatar(big = false, characterId = 'bamboo') {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 64 64');
	svg.setAttribute('class', `avatar face-${characterId}${big ? ' big' : ''}`);
	svg.setAttribute('aria-hidden', 'true');
	svg.innerHTML = FACES[characterId] ?? FACES.bamboo;
	return svg;
}
