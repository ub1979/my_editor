import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { character, characterPrompt } from '../src/chat/characters';
import { routeCharacter } from '../src/chat/characterRouting';

test('UI design routes separately from architecture without overriding pins or explicit modes', () => {
	assert.equal(routeCharacter('Redesign the user interface', undefined, 'bamboo', false).id, 'iris');
	assert.equal(routeCharacter('Review responsive layout', undefined, 'bamboo', false).id, 'iris');
	assert.equal(routeCharacter('Design module boundaries', undefined, 'bamboo', false).id, 'lisko');
	assert.equal(routeCharacter('Redesign UI/UX', 'review', 'bamboo', false).id, 'diji');
	assert.equal(routeCharacter('Redesign UI/UX', undefined, 'ada', true).id, 'ada');
	assert.equal(routeCharacter('Where should I change the stylesheet?', undefined, 'bamboo', false).locateOnly, true);
});

test('design knowledge is isolated and preserves host authority and honest visual evidence', () => {
	assert.equal(character('iris').name, 'UI/UX agent');
	const prompt = characterPrompt('iris');
	assert.match(prompt, /Ground your designs in the subject matter/);
	assert.match(prompt, /Class names without loaded CSS are incomplete/);
	assert.match(prompt, /visual verification as unverified/);
	assert.match(prompt, /role grants no shell, browser, network/);
	assert.match(prompt, /Keep\/Undo/);
	assert.doesNotMatch(characterPrompt('ada'), /Ground your designs in the subject matter/);
});
