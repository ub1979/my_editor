import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { asksToPush, branchNameProblem, confirmText, pushArgs, pushFailure, type PushPlan, suggestedTarget, withoutLogin }
	from '../src/project/pushPlan';

const PLAN: PushPlan = { remote: 'origin', remoteUrl: 'https://github.com/lucky-ali/go-dialer.git', branch: 'codex/delivery-v1',
	commit: '972e30a1b2c3d4e5f60718293a4b5c6d7e8f9012', target: 'u_m_dialer' };

test('the push sends exactly the confirmed commit to the named branch, never forced', () => {
	assert.deepEqual(pushArgs(PLAN), ['push', 'origin', '972e30a1b2c3d4e5f60718293a4b5c6d7e8f9012:refs/heads/u_m_dialer']);
	assert.ok(!pushArgs(PLAN).some(arg => /force|^-f$|^\+/.test(arg)));
});

test('the confirmation names the commit, the branches and the remote, and shows the command', () => {
	const text = confirmText(PLAN);
	assert.ok(text.startsWith('Commit 972e30a (your branch codex/delivery-v1) goes to https://github.com/lucky-ali/go-dialer.git (origin) '
		+ 'as the branch u_m_dialer.'), text);
	assert.match(text, /git push origin 972e30a1b2c3d4e5f60718293a4b5c6d7e8f9012:refs\/heads\/u_m_dialer/);
	assert.match(text, /never forced/);
	assert.doesNotMatch(text, /ai_fix/);
	assert.match(confirmText({ ...PLAN, branch: 'ai_fix', target: 'ai_fix' }), /This is ai_fix, the branch the AI-ready fixer commits on/);
	assert.match(confirmText({ ...PLAN, branch: undefined }), /\(your detached HEAD\)/);
});

test('a login in a remote address is never shown', () => {
	assert.equal(withoutLogin('https://user:ghp_secret@github.com/a/b.git'), 'https://github.com/a/b.git');
	assert.equal(withoutLogin('git@github.com:a/b.git'), 'git@github.com:a/b.git');
});

test('branch names follow git\'s rules, so nothing odd reaches the command', () => {
	for (const good of ['u_m_dialer', 'release/1.2', 'feature-x']) { assert.equal(branchNameProblem(good), undefined, good); }
	for (const bad of ['', 'two words', '-f', '--force', 'a..b', 'x.lock', '.hidden', 'a/', 'a:b', 'a~1', 'a^', 'a@{1}', 'a.']) {
		assert.ok(branchNameProblem(bad), bad);
	}
});

test('failures say what happened in plain words and keep git\'s own line', () => {
	assert.match(pushFailure('! [rejected] main -> main (fetch first)'), /never force-pushes[\s\S]*fetch first/);
	assert.match(pushFailure('fatal: could not read Username for \'https://github.com\': terminal prompts disabled'), /refused the login/);
	assert.match(pushFailure('fatal: unable to access: Could not resolve host: github.com'), /could not be reached/);
	assert.equal(pushFailure('something else'), 'The push failed: something else');
});

test('a chat message that asks to push gets the button, with the branch name it gives', () => {
	assert.ok(asksToPush('push it to git as u_m_dialer'));
	assert.ok(asksToPush('can you push this branch to GitHub?'));
	assert.ok(!asksToPush('push the button to refresh'));
	assert.ok(!asksToPush('explain how git rebase works'));
	assert.equal(suggestedTarget('push it to github as u_m_dialer'), 'u_m_dialer');
	assert.equal(suggestedTarget('push to the branch release/2.'), 'release/2');
	assert.equal(suggestedTarget('push this to github'), undefined);
	assert.equal(suggestedTarget('push this branch to github'), undefined);
});
