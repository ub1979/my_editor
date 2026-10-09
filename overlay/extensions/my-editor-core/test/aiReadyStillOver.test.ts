import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderChangeNote } from '../src/aiready/changeNote';
import type { RunState } from '../src/aiready/fixState';
import { closingText } from '../src/aiready/fixText';
import type { Declaration, FileInfo } from '../src/aiready/language';
import { stillOver, stillOverLines } from '../src/aiready/stillOver';

function decl(id: number, name: string, lines: number, movable = true, reason?: string): Declaration {
	return { id, kind: 'function', names: [name], span: { start: 0, end: 0 }, lines, doc: '', docText: '', uses: [], movable, reason };
}

const BIG_REASON = 'one declaration (`buildOnboardingPlanTx`, 401 lines) is longer than the limit; '
	+ 'it needs a real refactor, which this fixer doesn\'t do';

test('a split that leaves one declaration over 400 lines names the file, its size and why, with repository paths', () => {
	const info: FileInfo = { path: 'internal/store/onboarding.go', frame: [], imports: [],
		declarations: [decl(0, 'small', 10), decl(1, 'buildOnboardingPlanTx', 401), decl(2, 'other', 30)] };
	const result = { original: Buffer.from('x\n'.repeat(40)), files: [{ name: 'onboarding_plan.go', text: Buffer.from('x\n'.repeat(410)) }] };
	const over = stillOver(result, info, [{ file: 'onboarding_plan.go', declarations: [1] }], ['internal/store/onboarding_plan.go']);
	assert.deepEqual(over, [{ file: 'internal/store/onboarding_plan.go', lines: 410, reason: BIG_REASON }]);
	assert.deepEqual(stillOverLines(over), [`- \`internal/store/onboarding_plan.go\`: 410 lines; ${BIG_REASON}.`]);
	assert.deepEqual(stillOver({ original: Buffer.from('x\n'), files: [] }, info, [], []), []);
});

test('code that may not move, or anything else over 400 lines, is also named', () => {
	const stuck: FileInfo = { path: 'big.ts', frame: [], imports: [], declarations: [decl(0, 'T', 3), decl(1, 'run', 2, false, 'types only')] };
	const original = Buffer.from('x\n'.repeat(450));
	assert.deepEqual(stillOver({ original, files: [] }, stuck, [], []),
		[{ file: 'big.ts', lines: 450, reason: 'the rest may not move (types only)' }]);
	const plain: FileInfo = { ...stuck, declarations: [decl(0, 'T', 3)] };
	assert.deepEqual(stillOver({ original, files: [] }, plain, [], []), [{ file: 'big.ts', lines: 450, reason: 'nothing more in it could move out' }]);
});

function state(): RunState {
	return {
		version: 1, root: '/p/shop', language: 'Go', worktree: { branch: 'ai_fix', path: '/p/w', base: '0123456789ab' },
		startedAt: '', approved: [], fixes: [{ file: 'a.go', kind: 'split', lines: 900 }], next: 1, baseline: {}, skippedFiles: [],
		steps: [{ file: 'a.go', kind: 'split', status: 'committed', commit: 'abcdef12', moved: [{ file: 'a_big.go', names: ['buildOnboardingPlanTx'] }],
			over: [{ file: 'a_big.go', lines: 410, reason: BIG_REASON }] }],
	};
}

test('the change note has a Still over 400 lines section, and the closing text gives the count', () => {
	const note = renderChangeNote(state(), new Date('2026-10-09T12:00:00Z'));
	assert.ok(note.includes(`## Still over 400 lines\n\n- \`a_big.go\`: 410 lines; ${BIG_REASON}.\n`), note);
	assert.doesNotMatch(renderChangeNote({ ...state(), steps: [] }, new Date()), /Still over/);
	const close = { committed: 1, branch: 'b', base: 'c', note: 'n', removed: true, worktree: '/w', reportUpdated: false };
	assert.match(closingText({ ...close, stillOver: 2 }), /2 files are still over 400 lines; the change note says why\./);
	assert.match(closingText({ ...close, stillOver: 1 }), /1 file is still over 400 lines/);
	assert.doesNotMatch(closingText(close), /still over/);
});
