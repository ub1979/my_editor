import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CoverageCache } from '../src/aiready/coverRecord';
import type { FixChoice } from '../src/aiready/fixState';
import { measurable, refactorUnticked } from '../src/aiready/refactorOffers';
import type { RefusedCache } from '../src/aiready/refusedRecord';

const offer = (file: string, name: string): FixChoice => ({ file, kind: 'refactor', lines: 460, target: { name, lines: 452 } });
const OFFERS = [offer('store/plan.go', 'buildPlan'), offer('store/step.go', 'Step')];
const BLOBS = new Map([['store/plan.go', 'p1'], ['store/step.go', 's1']]);
const NO_TEST = (name: string) => `no test here runs \`${name}\` yet; build, vet and the extract check still apply`;

test('a refactor is ticked only when the last coverage of this content shows its tests running the function', () => {
	const coverage: CoverageCache = { files: {
		'store/plan.go': { blob: 'p1', function: 'buildPlan', ran: true },
		'store/step.go': { blob: 's1', function: 'Step', ran: false },
	} };
	const unticked = refactorUnticked(OFFERS, BLOBS, coverage, undefined, new Map());
	assert.deepEqual([...unticked], [['store/step.go', NO_TEST('Step')]]);
	const changed = refactorUnticked(OFFERS, new Map([['store/plan.go', 'p2'], ['store/step.go', 's1']]), coverage, undefined, new Map());
	assert.equal(changed.get('store/plan.go'), NO_TEST('buildPlan'), 'coverage of older content does not count');
});

test('a refactor refused for this content is unticked with the earlier reason, and a blocked package wins', () => {
	const coverage: CoverageCache = { files: {
		'store/plan.go': { blob: 'p1', function: 'buildPlan', ran: true },
		'store/step.go': { blob: 's1', function: 'Step', ran: true },
	} };
	const refused: RefusedCache = { files: {
		'store/plan.go': { blob: 'p1', reason: 'The extract check failed: x.' },
		'store/step.go': { blob: 's0', reason: 'older content' },
	} };
	assert.deepEqual([...refactorUnticked(OFFERS, BLOBS, coverage, refused, new Map())],
		[['store/plan.go', 'an earlier run could not refactor it: The extract check failed: x.']]);
	const blocked = new Map([['store/plan.go', 'can\'t be checked here: ./store build already fails']]);
	assert.equal(refactorUnticked(OFFERS, BLOBS, coverage, refused, blocked).get('store/plan.go'), blocked.get('store/plan.go'));
});

test('with no coverage record yet a refactor is unticked and says why', () => {
	const unticked = refactorUnticked(OFFERS, BLOBS, undefined, undefined, new Map());
	assert.deepEqual([...unticked], [['store/plan.go', NO_TEST('buildPlan')], ['store/step.go', NO_TEST('Step')]]);
	assert.deepEqual([...refactorUnticked([], BLOBS, undefined, undefined, new Map())], []);
});

test('coverage measures only offers it could tick: not refused for this content, not in a blocked package', () => {
	const refused: RefusedCache = { files: { 'store/plan.go': { blob: 'p1', reason: 'x' } } };
	assert.deepEqual(measurable(OFFERS, BLOBS, refused, new Map()).map(o => o.file), ['store/step.go']);
	assert.deepEqual(measurable(OFFERS, BLOBS, undefined, new Map([['store/step.go', 'blocked']])).map(o => o.file), ['store/plan.go']);
	assert.deepEqual(measurable(OFFERS, new Map([['store/plan.go', 'p2']]), refused, new Map()).map(o => o.file),
		['store/plan.go', 'store/step.go'], 'a refusal of older content no longer holds');
	assert.deepEqual(measurable([{ file: 'a.go', kind: 'split', lines: 500 }], BLOBS, undefined, new Map()), []);
});
