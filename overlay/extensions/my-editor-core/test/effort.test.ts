import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { claudeModelEntries, parseClaudeModels } from '../src/models/claudeModels';
import { claudeEffortArgs, effortSetting, supportedEffort } from '../src/models/effort';

test('Claude aliases and pinned versions inherit supported effort levels', () => {
	const entries = claudeModelEntries(['opus'], parseClaudeModels([{ value: 'opus', resolvedModel: 'claude-opus-5-5',
		supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'invalid'] }]));
	for (const entry of entries) {
		assert.deepEqual(entry.supportedEffortLevels, ['low', 'medium', 'high', 'xhigh', 'max']);
		assert.deepEqual(claudeEffortArgs(entry, 'low'), ['--effort', 'low']);
		assert.deepEqual(claudeEffortArgs(entry, 'max'), ['--effort', 'max']);
		assert.deepEqual(claudeEffortArgs(entry, 'default'), []);
	}
});

test('unsupported effort falls back to model default, and providers keep separate preferences', () => {
	const [entry] = claudeModelEntries([], parseClaudeModels([{ value: 'sonnet', supportedEffortLevels: ['low', 'medium', 'high'] }]));
	assert.equal(supportedEffort(entry, 'max'), undefined);
	assert.deepEqual(claudeEffortArgs(entry, 'max'), []);
	const [legacy] = claudeModelEntries([], parseClaudeModels([{ value: 'legacy', supportsEffort: false, supportedEffortLevels: ['high'] }]));
	assert.deepEqual(claudeEffortArgs(legacy, 'high'), []);
	assert.equal(effortSetting('claude-cli'), 'claudeCli.reasoningEffort');
	assert.equal(effortSetting('codex-cli'), 'codexCli.reasoningEffort');
	assert.equal(effortSetting('ollama'), undefined);
});
