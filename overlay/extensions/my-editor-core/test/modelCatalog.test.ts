import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type * as vscode from 'vscode';

const Module = require('node:module') as { _load: (name: string, parent: unknown, main: boolean) => unknown };
const originalLoad = Module._load;
let ApiKeys: typeof import('../src/models/secrets').ApiKeys;
let loadCatalog: typeof import('../src/models/catalog').loadCatalog;
const settings: Record<string, unknown> = { 'claudeCli.enabled': false, 'codexCli.enabled': false,
	'ollama.enabled': false, 'lmstudio.enabled': false, 'anthropic.models': ['fixture'], 'openai.models': ['fixture'] };
try {
	Module._load = (name, parent, main) => name === 'vscode' ? {
		EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
		workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => settings[key] ?? fallback }) },
	} : originalLoad(name, parent, main);
	ApiKeys = require('../src/models/secrets').ApiKeys;
	loadCatalog = require('../src/models/catalog').loadCatalog;
} finally { Module._load = originalLoad; }

test('model discovery lists saved API providers without reading any encrypted value', async () => {
	let reads = 0;
	let names = ['myEditor.apiKey.anthropic', 'unrelated.extension.value'];
	const secrets = { keys: async () => names, get: async () => { reads++; return 'test-only-value'; },
		onDidChange: () => ({ dispose() {} }) } as unknown as vscode.SecretStorage;
	const keys = new ApiKeys(secrets);
	assert.deepEqual((await loadCatalog(keys)).map(entry => entry.key), ['anthropic:fixture']);
	assert.equal(reads, 0);
	names = ['myEditor.apiKey.openai'];
	assert.deepEqual((await loadCatalog(keys)).map(entry => entry.key), ['openai:fixture']);
	assert.equal(reads, 0, 'Refreshing models must not decrypt an unused provider key');
	assert.equal(await keys.get('openai'), 'test-only-value');
	assert.equal(reads, 1, 'An explicit API request still uses encrypted secret storage');
	keys.dispose();
});
