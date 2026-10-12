import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { renderChangeNote } from '../src/aiready/changeNote';
import { needingRefactor, screenFix, type Screener } from '../src/aiready/fixScreen';
import type { RunState } from '../src/aiready/fixState';
import { earlyText } from '../src/aiready/fixText';
import type { Declaration, FileInfo, LanguageAdapter, RefactorHooks, SplitPlan } from '../src/aiready/language';
import { planProblems } from '../src/aiready/splitPlan';
import { largestDeclaration, needsRefactor } from '../src/aiready/stillOver';

function decl(id: number, name: string, lines: number, movable = true): Declaration {
	return { id, kind: 'function', names: [name], span: { start: 0, end: 0 }, lines, doc: '', docText: '', uses: [], movable };
}

const text = (lines: number) => Buffer.from('x\n'.repeat(lines));

/** The second run's real case: one 452-line function and two small error variables, 467 lines in all. */
const STEP: FileInfo = { path: 'internal/store/verification.go', frame: [], imports: [],
	declarations: [decl(0, 'ErrBusy', 3), decl(1, 'errActivationBusy', 4), decl(2, 'StepVerification', 452)] };
const STEP_REASON = 'needs a real refactor: `StepVerification` is 452 lines by itself';

/** A 420-line function and 300 lines of other declarations. */
const MIXED: FileInfo = { path: 'mixed.go', frame: [], imports: [],
	declarations: [decl(0, 'Big', 420), ...Array.from({ length: 6 }, (_, i) => decl(i + 1, `f${i}`, 50))] };

test('a file over 400 lines only because of one declaration needs a real refactor, not a split', () => {
	assert.deepEqual(needsRefactor(STEP, 467), { file: STEP.path, lines: 467, reason: STEP_REASON });
	const alone: FileInfo = { ...STEP, path: 'onboarding_plan.go', declarations: [decl(0, 'buildOnboardingPlanTx', 401)] };
	assert.equal(needsRefactor(alone, 417)?.reason, 'needs a real refactor: `buildOnboardingPlanTx` is 401 lines by itself');
	const twoBig: FileInfo = { ...STEP, declarations: [decl(0, 'A', 450), decl(1, 'B', 430), decl(2, 'c', 10)] };
	assert.equal(needsRefactor(twoBig, 900)?.reason, 'needs a real refactor: `A` is 450 lines by itself');
});

test('a function under 400 lines that can\'t fit in a file with the other lines of its own needs a refactor', () => {
	const after: FileInfo = { ...STEP, path: 'onboarding_plan.go', declarations: [decl(0, 'buildOnboardingPlanTx', 387), decl(1, 'appendWarnings', 20)] };
	assert.equal(needsRefactor(after, 423)?.reason,
		'needs a real refactor: `buildOnboardingPlanTx` is 387 lines, too long for a file with its 15 other lines');
	const small = Array.from({ length: 99 }, (_, i) => decl(i + 1, `f${i}`, 20));
	const many: FileInfo = { ...STEP, path: 'engine.go', declarations: [decl(0, 'StartCampaign', 322), ...small] };
	assert.equal(needsRefactor(many, 2322 + 99 + 20), undefined, 'blank lines between declarations move with them');
	assert.equal(needsRefactor({ ...after, declarations: [decl(0, 'build', 300), decl(1, 'more', 110)] }, 426), undefined, 'room to split');
});

test('a big declaration with plenty that can move out still splits; so does a file with no oversized declaration', () => {
	assert.equal(needsRefactor(MIXED, 725), undefined);
	assert.equal(needsRefactor({ ...MIXED, declarations: MIXED.declarations.slice(1) }, 310), undefined);
	assert.equal(needsRefactor({ ...MIXED, declarations: [decl(0, 'a', 300), decl(1, 'b', 300)] }, 610), undefined);
	assert.equal(needsRefactor(STEP, 380), undefined);
});

test('screening settles a needs-refactor split before any model call or check, with its Still over entry', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-refactor-'));
	const target = (info: FileInfo) => ({ name: largestDeclaration(info)!.names[0], lines: largestDeclaration(info)!.lines });
	const adapter: Screener = { checks: () => [{ label: 'build', command: 'build ./internal/store', verifies: true }],
		parse: async () => STEP, testFileName: file => file, refactor: { target } as RefactorHooks };
	const early = await screenFix(adapter, root, {}, { file: STEP.path, kind: 'split', lines: 467 });
	assert.deepEqual(early?.step, { file: STEP.path, kind: 'split', status: 'skipped', early: true,
		reason: 'Needs a real refactor: `StepVerification` is 452 lines by itself.', over: [{ file: STEP.path, lines: 467, reason: STEP_REASON }],
		lasting: { big: { name: 'StepVerification', lines: 452 } } });
	assert.equal(early?.brief, STEP_REASON);
	assert.equal(early?.unchecked, false);
});

test('a split settled for a big declaration keeps it for later pickers only when the language can refactor it', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-refactor-'));
	const fix = { file: STEP.path, kind: 'split' as const, lines: 467 };
	const screener = (target?: RefactorHooks['target'], info = STEP): Screener =>
		({ checks: () => [], parse: async () => info, testFileName: file => file, ...(target ? { refactor: { target } as RefactorHooks } : {}) });
	const notFunction = await screenFix(screener(() => '`a` is a var, not a function'), root, {}, fix);
	assert.deepEqual([notFunction?.step.lasting, notFunction?.step.over?.length], [{}, 1], 'a var block is never offered as a refactor');
	assert.deepEqual((await screenFix(screener(), root, {}, fix))?.step.lasting, {}, 'no refactor in this language');
	const stuck: FileInfo = { ...STEP, declarations: STEP.declarations.map(d => ({ ...d, movable: false })) };
	const big = { name: 'StepVerification', receiver: 'Store', lines: 452 };
	const nothing = await screenFix(screener(() => big, stuck), root, {}, fix);
	assert.deepEqual([nothing?.step.reason, nothing?.step.lasting], ['Nothing in it may move.', { big }], 'the target as the language names it');
	const small: FileInfo = { ...STEP, declarations: [decl(0, 'a', 300, false), decl(1, 'b', 100, false)] };
	assert.deepEqual((await screenFix(screener(() => big, small), root, {}, { ...fix, lines: 410 }))?.step.lasting, {},
		'nothing over the limit, nothing to refactor');
});

test('of the fixes nobody picked, only the ones that need a real refactor are kept for the change note', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-refactor-'));
	const infos: Record<string, FileInfo> = { 'step.go': STEP, 'mixed.go': MIXED };
	const adapter: Screener = { checks: () => [], parse: async file => infos[file], testFileName: file => file };
	const fixes = [{ file: 'mixed.go', kind: 'split' as const, lines: 725 }, { file: 'step.go', kind: 'split' as const, lines: 467 }];
	const kept = await needingRefactor(fixes, fix => screenFix(adapter, root, {}, fix), () => false);
	assert.deepEqual(kept, [fixes[1]]);
	assert.deepEqual(await needingRefactor(fixes, fix => screenFix(adapter, root, {}, fix), () => true), []);
});

test('the change note lists a needs-refactor file under Still over 400 lines, not as skipped', () => {
	const state: RunState = {
		version: 1, root: '/p/shop', language: 'Go', worktree: { branch: 'ai_fix', path: '/p/w', base: '0123456789ab' }, startedAt: '',
		approved: [], fixes: [{ file: STEP.path, kind: 'split', lines: 467 }], next: 1, baseline: {}, skippedFiles: [],
		steps: [{ file: STEP.path, kind: 'split', status: 'skipped', early: true, reason: 'Needs a real refactor.',
			over: [{ file: STEP.path, lines: 467, reason: STEP_REASON }] }],
	};
	const note = renderChangeNote(state, new Date('2026-10-09T12:00:00Z'));
	assert.ok(note.includes(`## Still over 400 lines\n\n- \`${STEP.path}\`: 467 lines; ${STEP_REASON}.\n`), note);
	assert.doesNotMatch(note, /Skipped or refused/);
	assert.match(note, /No fix was committed\./);
});

/** An adapter whose split result has the given line counts: the original first, then each new file. */
function sized(original: number, files: readonly number[]): LanguageAdapter {
	const buildSplit = (_source: Buffer, _info: FileInfo, plan: SplitPlan) =>
		({ original: text(original), files: files.map((n, i) => ({ name: plan[i].file, text: text(n) })) });
	return { fileNameProblems: () => [], buildSplit } as unknown as LanguageAdapter;
}

test('a plan that only moves the big function out, leaving as much over the limit as before, is rejected', () => {
	const input = { source: text(467), info: STEP, existing: [] };
	const problems = planProblems(sized(14, [468]), input, [{ file: 'verification_step.go', declarations: [2] }]);
	assert.deepEqual(problems, ['The split would leave 1 file over 400 lines, 68 lines over in all; before it was 1 file, 67 lines over. '
		+ 'A split must leave fewer files or fewer lines over the limit.']);
});

test('moving the other declarations out of a file with a 420-line function is a useful split', () => {
	const input = { source: text(725), info: MIXED, existing: [] };
	assert.deepEqual(planProblems(sized(425, [155, 155]), input, [{ file: 'a.go', declarations: [1, 2, 3] }, { file: 'b.go', declarations: [4, 5, 6] }]), []);
});

test('an oversized declaration may go to its own file only when the original ends under the limit', () => {
	const input = { source: text(725), info: MIXED, existing: [] };
	assert.deepEqual(planProblems(sized(305, [425]), input, [{ file: 'big.go', declarations: [0] }]), []);
	const twoBig: FileInfo = { ...MIXED, declarations: [decl(0, 'A', 450), decl(1, 'B', 430), decl(2, 'c', 100, false)] };
	const problems = planProblems(sized(560, [435]), { source: text(990), info: twoBig, existing: [] }, [{ file: 'b.go', declarations: [1] }]);
	assert.deepEqual(problems, ['"b.go" would hold `B` (430 lines) on its own while mixed.go stays over the limit.']);
});

test('the run text says which files need a real refactor apart from the chosen fixes it skips', () => {
	const over = [{ file: STEP.path, lines: 467, reason: STEP_REASON }];
	const refactor = { step: { file: STEP.path, kind: 'split' as const, status: 'skipped' as const, early: true, over }, brief: STEP_REASON, unchecked: false };
	const other = { step: { file: 'gen.go', kind: 'split' as const, status: 'skipped' as const, early: true }, brief: 'never split: generated', unchecked: false };
	assert.equal(earlyText([refactor, other]), '1 chosen fix is skipped before any work: `gen.go`: never split: generated.\n'
		+ `1 file needs a real refactor, so it is not split (listed in the change note): \`${STEP.path}\`: ${STEP_REASON}.\n`);
	assert.doesNotMatch(earlyText([other]), /real refactor/);
});
