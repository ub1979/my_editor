import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { offerPush } from '../src/chat/pushOffer';

test('a reply to a push request carries the Push button with the branch name the message gives; others carry none', () => {
	const actions: [string, string, unknown[]][] = [];
	const sink = { action: (label: string, command: string, args: unknown[]) => { actions.push([label, command, args]); } };
	offerPush('push it to git as u_m_dialer', sink);
	offerPush('push this branch to github', sink);
	offerPush('why does the build fail?', sink);
	assert.deepEqual(actions, [
		['Push to GitHub…', 'myEditor.pushBranch', [{ target: 'u_m_dialer' }]],
		['Push to GitHub…', 'myEditor.pushBranch', [{}]],
	]);
});
