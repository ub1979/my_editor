import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { describeProjectStatus } from '../src/project/contextStatusText';

test('Pair sees the actual folder, branch, stale brain and local-only upstream state', () => {
	const text = describeProjectStatus({
		name: 'm_dialer', path: '/projects/m_dialer', head: 'a1c9228',
		git: { kind: 'tracked', branch: 'codex/production-predictdial-delivery-v1',
			upstream: 'origin/codex/production-predictdial-delivery-v1', behind: 10, ahead: 0,
			localEdits: true },
		brainCommit: '69f5b1a', brainFiles: 731, summarizedFiles: 700,
	});
	assert.match(text, /Open project: m_dialer/);
	assert.match(text, /10 behind/);
	assert.match(text, /brain was built from a different commit/);
	assert.match(text, /not proof of the source running in production/);
});

test('Pair does not invent a project when no folder is open', () => {
	assert.match(describeProjectStatus(undefined), /No local project folder/);
});
