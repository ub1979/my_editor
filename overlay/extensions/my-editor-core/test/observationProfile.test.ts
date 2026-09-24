import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { observationFingerprint, observationSummary, parseObservationProfile } from '../src/chat/observationProfile';

const profile = JSON.stringify({ version: 1, checks: [{
	id: 'cell_health', title: 'Cell health', description: 'Sample current launch and journal metrics',
	command: '/usr/bin/ssh', args: ['-o', 'BatchMode=yes', 'ops@example.test', 'bash -s'],
	stdin: 'date -u\n', timeoutSeconds: 25,
}] });

test('project observation recipes are fixed, bounded and described without revealing their command', () => {
	const checks = parseObservationProfile(profile);
	assert.equal(checks.length, 1);
	assert.match(observationSummary(checks), /cell_health: Cell health/);
	assert.doesNotMatch(observationSummary(checks), /ops@example/);
	assert.equal(checks[0].timeoutSeconds, 25);
});

test('approval is bound to the project and the exact recipe', () => {
	const check = parseObservationProfile(profile)[0];
	assert.notEqual(observationFingerprint('/projects/a', check), observationFingerprint('/projects/b', check));
	assert.notEqual(observationFingerprint('/projects/a', check), observationFingerprint('/projects/a', { ...check, stdin: 'echo changed' }));
});

test('invalid executable, duplicate ids and oversized input are rejected', () => {
	assert.throws(() => parseObservationProfile(profile.replace('/usr/bin/ssh', '/bin/sh')), /approved observation executable/);
	const item = JSON.parse(profile).checks[0];
	assert.throws(() => parseObservationProfile(JSON.stringify({ version: 1, checks: [item, item] })), /unique/);
	assert.throws(() => parseObservationProfile(JSON.stringify({ version: 1, checks: [{ ...item, stdin: 'x'.repeat(24_001) }] })), /invalid input/);
});
