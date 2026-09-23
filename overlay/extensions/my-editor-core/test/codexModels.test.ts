import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseCodexModels } from '../src/models/codexModels';

test('Codex picker uses visible CLI models in CLI priority order', () => {
	assert.deepEqual(parseCodexModels({ models: [
		{ slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', visibility: 'list', priority: 2 },
		{ slug: 'gpt-reserve', display_name: 'Reserve', visibility: 'hide', priority: 1 },
		{ slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', description: 'Frontier model', visibility: 'list', priority: 1 },
		{ slug: '../../bad', visibility: 'list' },
	] }), [
		{ slug: 'gpt-6-astra', displayName: 'GPT-6-Astra', description: 'Frontier model' },
		{ slug: 'gpt-6-sol', displayName: 'GPT-6-Sol' },
	]);
	assert.deepEqual(parseCodexModels({ models: [] }), []);
	assert.deepEqual(parseCodexModels(null), []);
});
