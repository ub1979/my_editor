import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fixRunning, onFixStatus, setFixRunning } from '../src/aiready/fixStatus';

test('the running state notifies listeners once per change and stops after dispose', () => {
	let calls = 0;
	const sub = onFixStatus(() => { calls++; });
	setFixRunning(true); setFixRunning(true);
	assert.equal(fixRunning(), true);
	setFixRunning(false);
	assert.equal(calls, 2);
	sub.dispose();
	setFixRunning(true); setFixRunning(false);
	assert.equal(calls, 2);
});
