import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pendingAnalysis, pendingStart } from '../src/chat/chatPending';

test('a waiting analysis starts the analysis, with or without the AI-readiness check', () => {
	assert.deepEqual(pendingStart(pendingAnalysis(false)), { kind: 'analyse', aiReady: false });
	assert.deepEqual(pendingStart(pendingAnalysis(true)), { kind: 'analyse', aiReady: true });
});

test('the analysis markers win even when the request also says kickoff', () => {
	assert.deepEqual(pendingStart({ ...pendingAnalysis(true), kickoff: true }), { kind: 'analyse', aiReady: true });
});

test('a skill kickoff picks the skill; a kickoff without a skill sends the text', () => {
	assert.deepEqual(pendingStart({ text: '', mode: 'requirements', kickoff: true }), { kind: 'skill', id: 'requirements' });
	assert.deepEqual(pendingStart({ text: 'hi', kickoff: true }), { kind: 'send', text: 'hi' });
});

test('plain text is sent as typed, even with a mode but no kickoff', () => {
	assert.deepEqual(pendingStart({ text: 'Adapt a.ts' }), { kind: 'send', text: 'Adapt a.ts' });
	assert.deepEqual(pendingStart({ text: 'x', mode: 'review' }), { kind: 'send', text: 'x' });
});

test('a skill whose id looks like a marker without the # is a skill', () => {
	assert.deepEqual(pendingStart({ text: '', mode: 'analyse', kickoff: true }), { kind: 'skill', id: 'analyse' });
});
