import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CoverageCache } from '../src/aiready/coverRecord';
import { countLeft, isFixLeft } from '../src/aiready/fixCount';
import type { FixChoice } from '../src/aiready/fixState';
import type { CheckCache } from '../src/aiready/fixUnverifiable';
import type { LanguageAdapter, RefactorHooks } from '../src/aiready/language';
import type { RefusedCache } from '../src/aiready/refusedRecord';

const split = (file: string): FixChoice => ({ file, kind: 'split', lines: 500 });
const offer = (file: string, name: string): FixChoice => ({ file, kind: 'refactor', lines: 460, target: { name, lines: 452 } });
const local = {
	checks: (file: string) => [{ label: 'build', command: `build ${file.split('/')[0]}`, verifies: true }],
	refactor: {} as RefactorHooks, fixes: ['split', 'tests', 'refactor'],
} as unknown as LanguageAdapter;
/** `engine` fails to build at this tip; `store` builds. */
const CHECKS: CheckCache = { tip: 't1', passed: { 'build engine': false, 'build store': true } } as CheckCache;

test('a click\'s refactors are every offer the picker ticks; refused and blocked ones are counted apart, untested ones noted', () => {
	const choices = [split('store/a.go'), split('engine/b.go'), offer('store/ran.go', 'Ran'), offer('store/new.go', 'New'),
		offer('store/old.go', 'Old'), offer('engine/big.go', 'Big')];
	const blobs = new Map([['store/ran.go', 'r1'], ['store/new.go', 'n1'], ['store/old.go', 'o1'], ['engine/big.go', 'b1']]);
	const coverage: CoverageCache = { files: { 'store/ran.go': { blob: 'r1', function: 'Ran', ran: true },
		'store/old.go': { blob: 'o1', function: 'Old', ran: true }, 'engine/big.go': { blob: 'b1', function: 'Big', ran: true } } };
	const refused: RefusedCache = { files: { 'store/old.go': { blob: 'o1', reason: 'The extract check failed: x.' } } };
	const unsplittable = [split('store/ran.go'), split('store/new.go'), split('store/old.go'), split('engine/big.go'), split('store/var.go')];
	const count = countLeft({ local, tip: 't1', choices, unsplittable, blobs }, { checks: CHECKS, coverage, refused });
	assert.deepEqual(count, { left: 1, offers: 2, uncovered: 1, unbuildable: 2, refactor: 2, refactors: true });
});

test('the dialer\'s case: both offers have no test, and a click refactors both', () => {
	const choices = [offer('a.go', 'A'), offer('b.go', 'B')];
	const count = countLeft({ local, tip: 't1', choices, unsplittable: [split('a.go'), split('b.go')], blobs: new Map() }, {});
	assert.deepEqual(count, { left: 0, offers: 2, uncovered: 2, unbuildable: 0, refactor: 0, refactors: true });
	const plain = { ...local, refactor: undefined, fixes: ['split', 'tests'] } as unknown as LanguageAdapter;
	assert.equal(countLeft({ local: plain, choices: [], unsplittable: [], blobs: new Map() }, {}).refactors, false);
});

test('a count saved by an older version is not trusted, so the card counts again', () => {
	assert.equal(isFixLeft({ left: 0, offers: 2, refactor: 0, unbuildable: 0 }), false, 'an older shape');
	assert.equal(isFixLeft({ left: 0, offers: 0, untested: 2, refactor: 0, unbuildable: 0, refactors: true }), false, 'untested ones were unticked then');
	assert.equal(isFixLeft(undefined), false);
	assert.equal(isFixLeft({ left: 0, offers: 2, uncovered: 2, refactor: 0, unbuildable: 0, refactors: true }), true);
});
