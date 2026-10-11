import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { helperLine, refactorBody, refactorRunLine, refactorSubject } from '../src/aiready/refactorText';

const QUERY = { name: 'queryRows', params: ['ctx', 'staleAfter', 'tx', 'req', 'imageRef'], outputs: ['rows', 'err'], returns: false };
const SOURCE = { name: 'stepSource', params: ['stepCtx', 'tx', '*p', '*sourceAfter', 'err'], outputs: ['err'], returns: true };

test('helper lines mark pointer parameters and returns', () => {
	assert.equal(helperLine(QUERY), 'queryRows(ctx, staleAfter, tx, req, imageRef) → rows, err');
	assert.equal(helperLine(SOURCE), 'stepSource(stepCtx, tx, *p, *sourceAfter, err) → err; carries returns');
	assert.equal(helperLine({ name: 'logAll', params: ['s'], outputs: [], returns: false }), 'logAll(s)');
});

test('the subject counts helpers and the body says what the tests and the extract check showed', () => {
	assert.equal(refactorSubject('internal/store/x.go', 'Step', 7), 'my_editor: extract 7 helpers from Step (internal/store/x.go)');
	assert.equal(refactorSubject('a.go', 'build', 1), 'my_editor: extract 1 helper from build (a.go)');
	const ran = refactorBody([QUERY, SOURCE], 'build', true, '`go build ./x`: passed.');
	assert.equal(ran, 'Moved runs of statements of build into helpers, byte for byte apart from the extract rewrites '
		+ '(parameters, (*x) for shared variables, returns).\n\n'
		+ `- ${helperLine(QUERY)}\n- ${helperLine(SOURCE)}\n\n`
		+ 'Extract check: passed. Coverage: the package\'s tests ran build at baseline.\nChecks: `go build ./x`: passed.');
	assert.match(refactorBody([QUERY], 'build', false, 'x'),
		/Coverage: no passing test ran build at baseline; build, vet and the extract check are the net\.\nChecks: x$/);
	assert.match(refactorBody([QUERY], 'build', undefined, 'x'), /Extract check: passed\. Coverage: not recorded\.\n/);
	const step = { file: 'a.go', kind: 'refactor' as const, status: 'committed' as const, commit: 'abcdef123',
		refactor: { target: 'build', helpers: [QUERY, SOURCE], lines: 280 } };
	assert.equal(refactorRunLine(step), '- Refactor `build` in `a.go`: committed `abcdef1` (2 helpers).');
	assert.equal(refactorRunLine({ file: 'a.go', kind: 'refactor', status: 'refused', reason: 'The extract check failed: x.' }),
		'- Refactor `a.go`: refused. The extract check failed: x.');
});
