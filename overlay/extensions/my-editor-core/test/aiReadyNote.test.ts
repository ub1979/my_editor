import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CheckResult } from '../src/aiready/baseline';
import { noteFileName, renderChangeNote, reportWithRun } from '../src/aiready/changeNote';
import { fixChoices, pickFixes } from '../src/aiready/fixPicker';
import type { RunState } from '../src/aiready/fixState';
import { fileStats } from '../src/aiready/health';

const fix = (file: string, kind: 'split' | 'tests', lines: number) => ({ file, kind, lines });
const testRun = (code: number, outcome: 'pass' | 'fail'): CheckResult =>
	({ command: 'go test -count=1 -json ./a', code, failures: [], tests: { tests: { 'm TestF': outcome }, packages: {} }, tail: '', log: '' });

test('fix choices: Go files only, never-split files left out, biggest first, splits pre-selected', async () => {
	const stats = [fileStats('a.go', 'x\n'.repeat(900)), fileStats('b.go', 'x\n'.repeat(500)), fileStats('c.ts', 'x\n'.repeat(700)), fileStats('gen.go', 'x\n'.repeat(800))];
	const findings = [
		{ kind: 'too-long' as const, file: 'b.go', text: '' }, { kind: 'too-long' as const, file: 'a.go', text: '' },
		{ kind: 'untested' as const, file: 'b.go', text: '' }, { kind: 'too-long' as const, file: 'c.ts', text: '' },
		{ kind: 'too-long' as const, file: 'gen.go', text: '' }, { kind: 'design' as const, file: 'a.go', text: '' },
	];
	const choices = fixChoices(findings, stats, ['.go'], new Map([['gen.go', 'generated code']]));
	assert.deepEqual(choices, [fix('a.go', 'split', 900), fix('b.go', 'split', 500), fix('b.go', 'tests', 500)]);
	let shown: { picked: boolean; description: string }[] = [];
	const picked = await pickFixes(choices, async items => { shown = items; return items.filter(item => item.picked); });
	assert.deepEqual(shown.map(item => item.picked), [true, true, false]);
	assert.equal(shown[0].description, '900 lines · split into focused files');
	assert.deepEqual(picked, choices.slice(0, 2));
	assert.equal(await pickFixes(choices, async () => undefined), undefined);
});

function state(root: string): RunState {
	return {
		version: 1, root, language: 'Go', worktree: { branch: 'my_editor/ai-ready', path: `${root}.ai-ready`, base: '0123456789abcdef' },
		startedAt: '2026-10-09T10:00:00Z', approved: ['go build ./...'], next: 3,
		fixes: [fix('a.go', 'split', 900), fix('b.go', 'tests', 500), fix('c.go', 'split', 450), fix('d.go', 'split', 420)],
		steps: [
			{ file: 'a.go', kind: 'split', status: 'committed', commit: 'abcdef123', moved: [{ file: 'a_query.go', names: ['Find', 'List'] }],
				checks: '`go build ./...`: same as before.', notes: ['a.go stays at 450 lines: func Big alone is 430 lines and needs a real refactor.'] },
			{ file: 'b.go', kind: 'tests', status: 'committed', commit: 'fedcba987', testFile: 'b_ai_test.go', dropped: ['TestAiSlow'] },
			{ file: 'c.go', kind: 'split', status: 'refused', reason: 'The move check failed: Rule 2.' },
		],
		baseline: { 'go test -count=1 -json ./a': [testRun(1, 'pass'), testRun(0, 'fail')] },
		skippedFiles: [{ file: 'gen.go', reason: 'generated code' }],
	};
}

test('the change note lists commits, refusals, flaky tests, what is left and how to review', () => {
	const note = renderChangeNote(state('/p/shop'), new Date('2026-10-09T12:34:00Z'));
	for (const pattern of [/^# AI-ready changes: shop/, /`abcdef1` Split `a.go` into `a_query.go` \(Find, List\)/, /Checks: `go build/,
		/`fedcba9` Added tests for `b.go` in `b_ai_test.go`; dropped failing tests TestAiSlow/, /`c.go` \(split\): refused. The move check failed/,
		/## Not run yet\n\n- `d.go` \(split\)/, /`gen.go`: generated code/, /- m TestF/, /stays at 450 lines/, /glob\.\.funcN/,
		/already failed before the run[\s\S]*- `go test -count=1 -json \.\/a`/, /git diff 0123456789ab\.\.my_editor\/ai-ready/, /Nothing was pushed/]) {
		assert.match(note, pattern);
	}
	assert.match(noteFileName(new Date(2026, 9, 9, 7, 5)), /^\.my_editor\/changes\/ai-ready-2026-10-09-0705\.md$/);
	const report = reportWithRun('# Report\n\nBody\n\n## Fixes on a local branch\n\nOld run.\n', state('/p/shop'), 'x.md');
	assert.equal(report, '# Report\n\nBody\n\n## Fixes on a local branch\n\n2 fixes committed on `my_editor/ai-ready`, 1 skipped or refused. Details: `x.md` on that branch.\n');
});
