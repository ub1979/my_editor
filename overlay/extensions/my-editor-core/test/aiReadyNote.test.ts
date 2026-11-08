import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CheckResult } from '../src/aiready/baseline';
import { noteFileName, renderChangeNote, reportWithRun } from '../src/aiready/changeNote';
import { fixChoices, pickFixes, skippedWithLines, isPickItem, type PickHeading, type PickItem } from '../src/aiready/fixPicker';
import { discardRest, type RunState } from '../src/aiready/fixState';
import { GO_LANGUAGE } from '../src/aiready/goAdapter';
import { fileStats } from '../src/aiready/health';
import { TS_LANGUAGE } from '../src/aiready/tsAdapter';

const fix = (file: string, kind: 'split' | 'tests', lines: number) => ({ file, kind, lines });
const testRun = (code: number, outcome: 'pass' | 'fail'): CheckResult =>
	({ command: 'go test -count=1 -json ./a', code, failures: [], tests: { tests: { 'm TestF': outcome }, packages: {} }, tail: '', log: '' });

test('fix choices: Go files only, never-split files left out, biggest first, splits pre-selected', async () => {
	const stats = [fileStats('a.go', 'x\n'.repeat(1200)), fileStats('b.go', 'x\n'.repeat(800)), fileStats('c.ts', 'x\n'.repeat(1000)),
		fileStats('gen.go', 'x\n'.repeat(1100))];
	const findings = [
		{ kind: 'too-long' as const, file: 'b.go', text: '' }, { kind: 'too-long' as const, file: 'a.go', text: '' },
		{ kind: 'untested' as const, file: 'b.go', text: '' }, { kind: 'too-long' as const, file: 'c.ts', text: '' },
		{ kind: 'too-long' as const, file: 'gen.go', text: '' }, { kind: 'design' as const, file: 'a.go', text: '' },
	];
	const choices = fixChoices(findings, stats, ['.go'], new Map([['gen.go', 'generated code']]));
	assert.deepEqual(choices, [fix('a.go', 'split', 1200), fix('b.go', 'split', 800), fix('b.go', 'tests', 800)]);
	let shown: { picked: boolean; description: string }[] = [];
	const picked = await pickFixes(choices, async items => { shown = items.filter(isPickItem); return shown.filter(item => item.picked) as PickItem[]; });
	assert.deepEqual(shown.map(item => item.picked), [true, true, false]);
	assert.equal(shown[0].description, '1200 lines · split into focused files');
	assert.deepEqual(picked, choices.slice(0, 2));
	assert.equal(await pickFixes(choices, async () => undefined), undefined);
});

test('the picker pre-selects every split, however many, and names no per-run limit', async () => {
	const many = Array.from({ length: 60 }, (_, i) => fix(`f${i}.go`, 'split', 1000 - i));
	let shown: { picked: boolean }[] = [];
	let options = { title: '', placeHolder: '' };
	await pickFixes(many, async (items, shownOptions) => { shown = items.filter(isPickItem); options = shownOptions; return undefined; });
	assert.equal(shown.filter(item => item.picked).length, 60);
	assert.doesNotMatch(options.title, /\d|per run/);
	assert.ok(options.placeHolder.length <= 50, options.placeHolder);
});

test('the change note shows plan attempts and lists only skipped files over 600 lines', () => {
	const run = state('/p/shop');
	run.steps[0] = { ...run.steps[0], plan: { attempts: 2, rejected: ['Declaration 9 does not exist.'] } };
	run.steps[2] = { ...run.steps[2], plan: { attempts: 2, rejected: ['a', 'b'] } };
	(run as { skippedFiles: unknown }).skippedFiles = [{ file: 'gen.go', reason: 'generated code', lines: 1200 },
		{ file: 'x.go', reason: 'cgo', lines: 120 }, { file: 'y.go', reason: 'cgo', lines: 50 }];
	const note = renderChangeNote(run, new Date('2026-10-09T12:34:00Z'));
	assert.match(note, /Plan: 2 attempts; rejected: Declaration 9 does not exist\./);
	assert.match(note, /`c\.go` \(split\): refused\. The move check failed: Rule 2\. Plan: 2 attempts; rejected: a \/ b/);
	assert.match(note, /## Files never split\n\n- 1 file \(`gen\.go`\): generated code\.\n- plus 2 files under 600 lines that need no split\. /);
	assert.match(note, /under 600 lines that need no split\. They have no tests and cannot be given any, so the picker does not offer them/);
	assert.doesNotMatch(note, /x\.go/);
});

function state(root: string): RunState {
	return {
		version: 1, root, language: 'Go', worktree: { branch: 'ai_fix', path: `${root}.ai-ready`, base: '0123456789abcdef' },
		startedAt: '2026-10-09T10:00:00Z', approved: ['go build ./...'], next: 3,
		fixes: [fix('a.go', 'split', 1200), fix('b.go', 'tests', 800), fix('c.go', 'split', 750), fix('d.go', 'split', 720)],
		steps: [
			{ file: 'a.go', kind: 'split', status: 'committed', commit: 'abcdef123', moved: [{ file: 'a_query.go', names: ['Find', 'List'] }],
				checks: '`go build ./...`: passed.', notes: ['a.go stays at 750 lines: func Big alone is 730 lines and needs a real refactor.'] },
			{ file: 'b.go', kind: 'tests', status: 'committed', commit: 'fedcba987', testFile: 'b_ai_test.go', dropped: ['TestAiSlow'] },
			{ file: 'c.go', kind: 'split', status: 'refused', reason: 'The move check failed: Rule 2.' },
		],
		baseline: { 'go test -count=1 -json ./a': [testRun(1, 'pass'), testRun(0, 'fail')] },
		skippedFiles: [{ file: 'gen.go', reason: 'generated code', lines: 1100 }],
	};
}

test('the change note lists commits, refusals, flaky tests, what is left and how to review', () => {
	const note = renderChangeNote(state('/p/shop'), new Date('2026-10-09T12:34:00Z'), GO_LANGUAGE.mayDiffer);
	for (const pattern of [/^# AI-ready changes: shop/, /`abcdef1` Split `a.go` into `a_query.go` \(Find, List\)/, /Checks: `go build/,
		/`fedcba9` Added tests for `b.go` in `b_ai_test.go`; dropped failing tests TestAiSlow/, /`c.go` \(split\): refused. The move check failed/,
		/## Not run yet\n\n- `d.go` \(split\)/, /1 file \(`gen.go`\): generated code/, /- m TestF/, /stays at 750 lines/, /glob\.\.funcN/,
		/already failed before the run[\s\S]*- `go test -count=1 -json \.\/a`/, /git diff 0123456789ab\.\.\.ai_fix/, /Nothing was pushed/]) {
		assert.match(note, pattern);
	}
	assert.match(noteFileName(new Date(2026, 9, 9, 7, 5)), /^\.my_editor\/changes\/ai-ready-2026-10-09-0705\.md$/);
	const report = reportWithRun('# Report\n\nBody\n\n## Fixes on a local branch\n\nOld run.\n', state('/p/shop'), 'x.md');
	assert.equal(report, '# Report\n\nBody\n\n## Fixes on a local branch\n\n'
		+ '2 fixes committed on `ai_fix`, 1 skipped or refused. Details: `x.md` on that branch.\n');
});

test('discarding the rest records each fix as discarded by the user, in the note and the report', () => {
	const run = state('/p/shop');
	discardRest(run);
	assert.equal(run.next, run.fixes.length);
	assert.deepEqual(run.steps.slice(3), [{ file: 'd.go', kind: 'split', status: 'discarded' }]);
	const note = renderChangeNote(run, new Date('2026-10-09T12:34:00Z'));
	assert.match(note, /## Discarded by you\n\n- `d\.go` \(split\)/);
	assert.doesNotMatch(note, /## Not run yet/);
	assert.doesNotMatch(note, /d\.go` \(split\): discarded/);
	assert.match(reportWithRun('# R\n', run, 'x.md'), /1 skipped or refused, 1 discarded by you/);
});

test('skipped files carry their line counts from the file stats, and the note says a failed check proves nothing', () => {
	const stats = [fileStats('big.go', 'x\n'.repeat(1200)), fileStats('small.go', 'x\n'.repeat(30))];
	assert.deepEqual(skippedWithLines(new Map([['big.go', 'generated'], ['small.go', 'cgo']]), stats),
		[{ file: 'big.go', reason: 'generated', lines: 1200 }, { file: 'small.go', reason: 'cgo', lines: 30 }]);
	assert.match(renderChangeNote(state('/p/shop'), new Date('2026-10-09T12:34:00Z')),
		/already failed before the run is marked "not a check" on its commit: it proves nothing about that commit/);
});

test('the change note names what may differ in the run\'s language, as its adapter says', () => {
	const ts = renderChangeNote({ ...state('/p/shop'), language: 'TypeScript/JavaScript' }, new Date('2026-10-09T12:34:00Z'), TS_LANGUAGE.mayDiffer);
	assert.match(ts, /stack traces, `console\.trace` and logger caller fields/);
	assert.doesNotMatch(ts, /runtime\.Caller/);
	assert.match(renderChangeNote(state('/p/shop'), new Date('2026-10-09T12:34:00Z'), GO_LANGUAGE.mayDiffer), /runtime\.Caller/);
});

test('a refactor fix reads as a refactor in the refused, not run and discarded lists', () => {
	const run: RunState = { ...state('/p/shop'), next: 1,
		fixes: [{ file: 'a.go', kind: 'refactor', lines: 750 }, { file: 'b.go', kind: 'refactor', lines: 730 }],
		steps: [{ file: 'a.go', kind: 'refactor', status: 'refused', reason: 'The extract check failed: x.' },
			{ file: 'c.go', kind: 'refactor', status: 'discarded' }] };
	const note = renderChangeNote(run, new Date('2026-10-09T12:34:00Z'));
	assert.ok(note.includes('- `a.go` (refactor): refused. The extract check failed: x.'), note);
	assert.ok(note.includes('## Not run yet\n\n- `b.go` (refactor)'), note);
	assert.ok(note.includes('## Discarded by you\n\n- `c.go` (refactor)'), note);
});

test('refactor rows say what they do and are ticked only when allowed', async () => {
	const target = (name: string) => ({ name, lines: 725 });
	const refactor = (file: string, lines: number, name: string) => ({ file, kind: 'refactor' as const, lines, target: target(name) });
	const choices = [refactor('a.go', 730, 'Run'), fix('a.go', 'tests', 730), refactor('b.go', 720, 'Step'), refactor('c.go', 710, 'Big')];
	const unticked = new Map([['a.go', 'no test here runs `Run` yet']]);
	const blocked = new Map([['c.go', 'can\'t be checked here']]);
	let shown: { picked: boolean; description: string; detail?: string }[] = [];
	const show = async (items: readonly (PickItem | PickHeading)[]) => {
		shown = items.filter(isPickItem);
		return shown.filter(item => item.picked) as PickItem[];
	};
	const picked = await pickFixes(choices, show, blocked, unticked);
	assert.equal(shown[0].description, '730 lines · refactor `Run` (725 lines) into helpers, then split');
	assert.deepEqual(shown.map(item => item.picked), [false, true, false, false], 'refactors first, then the tests row');
	assert.deepEqual(shown.map(item => item.detail), ['no test here runs `Run` yet', undefined, 'can\'t be checked here', undefined]);
	assert.deepEqual(picked, [choices[2]]);
});

/** A run that committed a refactor of `store/step.go` and the split that followed it. */
function refactored(ran?: boolean): RunState {
	const helpers = [
		{ name: 'queryRows', params: ['ctx', 'tx', 'req'], outputs: ['rows', 'err'], returns: false },
		{ name: 'stepSource', params: ['stepCtx', '*p', 'err'], outputs: ['err'], returns: true },
	];
	return { ...state('/p/shop'), next: 2, fixes: [{ file: 'store/step.go', kind: 'refactor', lines: 767 }, fix('store/step.go', 'split', 770)],
		steps: [{ file: 'store/step.go', kind: 'refactor', status: 'committed', commit: 'abc1234567', checks: '`go build ./store`: passed.',
			refactor: { target: 'Step', helpers, lines: 283, ...(ran === undefined ? {} : { ran }) } },
		{ file: 'store/step.go', kind: 'split', status: 'committed', commit: 'def7654321', moved: [{ file: 'store/step_source.go', names: ['stepSource'] }] }] };
}

test('the change note has a Refactored section with helpers, pointer parameters, the extract check and coverage', () => {
	const note = renderChangeNote(refactored(false), new Date('2026-10-09T12:34:00Z'), GO_LANGUAGE.mayDiffer);
	assert.match(note, /Each commit moves code into new files, extracts helpers from a long function, or adds tests;/);
	assert.ok(note.includes('- `abc1234` Refactored `Step` in `store/step.go` into 2 helpers.\n  Checks: `go build ./store`: passed.'), note);
	assert.ok(note.includes('## Refactored\n\n### `Step` (`store/step.go`)\n\n- queryRows(ctx, tx, req) → rows, err\n'
		+ '- stepSource(stepCtx, *p, err) → err; carries returns\n\nNow 283 lines. Extract check: passed. '
		+ 'Coverage: no passing test ran Step at baseline; build, vet and the extract check are the net.\n'), note);
	assert.ok(note.indexOf('## Commits') < note.indexOf('## Refactored'));
	assert.match(renderChangeNote(refactored(true), new Date(), undefined), /Coverage: the package's tests ran Step at baseline\./);
	assert.match(renderChangeNote(refactored(), new Date(), undefined), /Extract check: passed\. Coverage: not recorded\./);
	assert.doesNotMatch(renderChangeNote(state('/p/shop'), new Date()), /## Refactored/);
});

test('what may differ adds helper frames and inlining only when a refactor was committed', () => {
	const differ = 'Helper functions add frames to stack traces.';
	const note = renderChangeNote(refactored(true), new Date(), GO_LANGUAGE.mayDiffer, false, differ);
	assert.ok(note.includes(`- ${differ}\n`), note);
	assert.ok(note.indexOf(differ) > note.indexOf('## Left for you'));
	assert.doesNotMatch(renderChangeNote(state('/p/shop'), new Date(), GO_LANGUAGE.mayDiffer, false, differ), /Helper functions/);
	const refused: RunState = { ...state('/p/shop'), steps: [{ file: 'a.go', kind: 'refactor', status: 'refused', reason: 'x' }] };
	assert.doesNotMatch(renderChangeNote(refused, new Date(), undefined, false, differ), /Helper functions/);
});
