import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { approvalNote } from '../src/aiready/approvalNote';
import { approvalDetail } from '../src/aiready/fixText';

const REFACTOR = 'For refactors, my_editor also runs go list -export on those packages.';

test('with no refactor picked the modal says nothing of refactors, and nothing at all when no part applies', () => {
	assert.equal(approvalNote({ coverage: 0 }), '');
	assert.equal(approvalNote({ language: 'Python: /v/bin/python.', coverage: 0 }), 'Python: /v/bin/python.');
	const detail = approvalDetail('/p/w', ['go build ./...'], 'Go', false, approvalNote({ coverage: 0 }));
	assert.match(detail, /local git commands there\. Your files and your branch/, 'one space, no gap');
	assert.doesNotMatch(detail, /refactor|cover/i);
});

test('the parts are joined in the core with single spaces, whatever spaces each ends with', () => {
	assert.equal(approvalNote({ language: 'Python: x. ', refactor: `${REFACTOR} `, coverage: 0 }), `Python: x. ${REFACTOR}`);
	const detail = approvalDetail('/p/w', ['go build ./...'], 'Go', false, approvalNote({ refactor: REFACTOR, coverage: 0 }));
	assert.ok(detail.includes(`local git commands there. ${REFACTOR} Your files`), detail);
});

test('coverage commands are explained in plain text whenever they are approved, picked refactor or not', () => {
	const one = approvalNote({ coverage: 1 });
	assert.equal(one, 'The last command records which long functions its package\'s tests run, so a later run can tick their refactors; '
		+ 'the profile file it writes is deleted right after.');
	const two = approvalNote({ refactor: REFACTOR, coverage: 2 });
	assert.ok(two.startsWith(`${REFACTOR} The last 2 commands record which long functions their packages' tests run`), two);
	assert.match(two, /each profile file they write is deleted right after\.$/);
	assert.doesNotMatch(two, /`/, 'the approval modal is plain text');
});
