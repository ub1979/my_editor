import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { redactObservation, runObservationProcess } from '../src/chat/observationProcess';
import { ObservationCheck } from '../src/chat/observationProfile';

const gitVersion: ObservationCheck = {
	id: 'git_version', title: 'Git version', description: 'Read local Git version',
	command: '/usr/bin/git', args: ['--version'], timeoutSeconds: 5,
};

test('approved recipe runs without a shell and returns bounded output', async () => {
	const result = await runObservationProcess(gitVersion, process.cwd());
	assert.equal(result.status, 'completed');
	assert.match(result.output, /git version/);
});

test('cancellation prevents a command from starting', async () => {
	const controller = new AbortController();
	controller.abort();
	const result = await runObservationProcess(gitVersion, process.cwd(), controller.signal);
	assert.equal(result.status, 'stopped');
});

test('observation output removes common secrets and phone numbers', () => {
	const text = redactObservation('admin_key=supersecret123 phone +447700900123 token: abcdefgh1234567890');
	assert.doesNotMatch(text, /supersecret|447700900123|abcdefgh/);
	assert.match(text, /\[REDACTED\]/);
	assert.match(text, /\[PHONE\]/);
});
