import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeModelEntries, listClaudeModels, parseClaudeModels } from '../src/models/claudeModels';

test('Claude aliases show discovered versions and offer explicit version selections', () => {
	const discovered = parseClaudeModels([
		{ value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus' },
		{ value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet' },
		{ value: 'claude-fable-5-1[1m]', resolvedModel: 'claude-fable-5-1', displayName: 'Fable' },
	]);
	const entries = claudeModelEntries(['opus', 'sonnet', 'haiku', '', 'claude-opus-5-5'], discovered);
	assert.equal(entries.find(e => e.model === 'opus')?.label, 'Claude Opus 5.5 (opus alias)');
	assert.equal(entries.find(e => e.model === 'sonnet')?.label, 'Claude Sonnet 5.5 (sonnet alias)');
	assert.equal(entries.find(e => e.model === 'claude-fable-5-1[1m]')?.label, 'Claude Fable 5.1 (1M context)');
	assert.equal(entries.filter(e => e.key === 'claude-cli:claude-opus-5-5').length, 1);
	assert.match(entries.find(e => e.model === 'haiku')!.detail, /version unavailable/);
	assert.ok(entries.every(e => e.model));
});

test('Claude discovery failure preserves custom IDs and aliases without inventing versions', () => {
	assert.deepEqual(parseClaudeModels(null), []);
	assert.deepEqual(parseClaudeModels([null, {}, { value: 2 }, { value: '' }]), []);
	const entries = claudeModelEntries(['opus', 'claude-sonnet-4-5-20250929', 'default'], []);
	assert.equal(entries[0].label, 'Claude Opus');
	assert.match(entries[0].detail, /version unavailable/);
	assert.equal(entries[1].label, 'Claude Sonnet 4.5 (20250929)');
	assert.equal(entries[2].model, 'default');
});

test('Claude metadata handshake handles split output, ignores unrelated events, and caches concurrent requests', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'my-editor-claude-test-'));
	const cli = join(dir, 'claude');
	writeFileSync(cli, `#!${process.execPath}
const assert = require('node:assert/strict');
assert.ok(process.argv.includes('--no-session-persistence'));
assert.ok(process.argv.includes('--setting-sources='));
assert.equal(process.argv[process.argv.indexOf('--tools') + 1], '');
require('node:readline').createInterface({ input: process.stdin }).once('line', line => {
 const request = JSON.parse(line);
 assert.equal(request.type, 'control_request');
 assert.equal(request.request.subtype, 'initialize');
 const response = JSON.stringify({ type: 'control_response', response: { request_id: request.request_id,
 subtype: 'success', response: { models: [{ value: 'opus', resolvedModel: 'claude-opus-5-5' }] } } });
 process.stdout.write('diagnostic\\n' + response.slice(0, 30));
 setTimeout(() => process.stdout.write(response.slice(30) + '\\n'), 10);
});
`, { mode: 0o755 });
	try {
		const first = listClaudeModels(cli);
		assert.equal(listClaudeModels(cli), first);
		const models = await first;
		assert.equal(models[0]?.resolvedModel, 'claude-opus-5-5');
		assert.equal(listClaudeModels(cli), first);
		assert.deepEqual(await listClaudeModels(join(dir, 'missing')), []);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
