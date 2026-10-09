import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MODES, systemPrompt } from '../src/pair/prompts';

test('Pair knows the fixer and sends large restructuring there instead of splitting by hand', () => {
	const prompt = systemPrompt(MODES.chat, '', '', '/tmp/shop');
	assert.match(prompt, /Fix on a local\s+branch/);
	assert.match(prompt, /Project →\s+Health/);
	assert.match(prompt, /cannot run\s+git/i);
});
