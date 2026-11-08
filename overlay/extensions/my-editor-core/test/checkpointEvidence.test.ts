import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkpointEvidence, CheckCommandEvidence } from '../src/project/checkpointEvidence';

test('an early failed command survives many later passing summaries with every log link', () => {
	const commands: CheckCommandEvidence[] = [{ name: 'npm test · contracts', status: 'failed', output: 'first.log',
		message: 'Actual assertion: expected full reason, received truncated reason.' }, ...Array.from({ length: 60 }, (_, i) => ({
		name: `npm test · service-${i}`, status: 'passed' as const, output: `${i}.log`, message: 'passing output '.repeat(4000) }))];
	const evidence = checkpointEvidence(commands);
	assert.match(evidence, /Actual assertion: expected full reason/); assert.ok(evidence.length <= 36000);
	for (const command of commands) { assert.ok(evidence.includes(`Test output: ${command.output}`)); }
	assert.doesNotMatch(evidence, /passing output/);
});

test('multiple failures receive bounded evidence shares instead of silently losing the first', () => {
	const commands = Array.from({ length: 30 }, (_, i) => ({ name: `command-${i}`, status: 'failed' as const,
		output: `${i}.log`, message: 'noisy '.repeat(10000) + ` FAILURE-${i}` }));
	const evidence = checkpointEvidence(commands, '', 10000);
	assert.ok(evidence.length <= 10000);
	for (let i = 0; i < 30; i++) { assert.ok(evidence.includes(`FAILURE-${i}`)); }
	assert.match(checkpointEvidence([], 'legacy '.repeat(10000), 1000), /Legacy evidence truncated/);
});
