import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { coverageCache, loadCoverage, ranBefore, saveCoverage, type CoverageEntry } from '../src/aiready/coverRecord';

const ran: CoverageEntry = { blob: 's1', function: 'StepVerification', ran: true };
const notRan: CoverageEntry = { blob: 'o1', function: 'buildOnboardingPlanTx', ran: false };

test('coverage is kept by file and blob and read back per project', () => {
	const storage = mkdtempSync(path.join(os.tmpdir(), 'coverage-'));
	assert.equal(loadCoverage(storage, '/p/shop'), undefined);
	const cache = coverageCache(new Map([['solo.go', ran], ['plan.go', notRan]]));
	assert.deepEqual(cache, { files: { 'solo.go': ran, 'plan.go': notRan } });
	saveCoverage(storage, '/p/shop', cache);
	assert.deepEqual(loadCoverage(storage, '/p/shop'), cache);
	assert.equal(loadCoverage(storage, '/p/other'), undefined);
	assert.equal(ranBefore(cache, 'solo.go', 's1'), true);
	assert.equal(ranBefore(cache, 'plan.go', 'o1'), false);
});

test('a changed blob or another file is unknown, and a new run\'s entries replace older ones', () => {
	const cache = coverageCache(new Map([['solo.go', ran], ['plan.go', notRan]]));
	assert.equal(ranBefore(cache, 'solo.go', 's2'), undefined, 'the file changed since');
	assert.equal(ranBefore(cache, 'solo.go', undefined), undefined);
	assert.equal(ranBefore(cache, 'other.go', 's1'), undefined);
	assert.equal(ranBefore(undefined, 'solo.go', 's1'), undefined);
	const next = coverageCache(new Map([['plan.go', { ...notRan, blob: 'o2', ran: true }]]), cache);
	assert.deepEqual(next.files, { 'solo.go': ran, 'plan.go': { blob: 'o2', function: 'buildOnboardingPlanTx', ran: true } });
	assert.equal(ranBefore(next, 'plan.go', 'o1'), undefined);
	assert.equal(ranBefore(next, 'plan.go', 'o2'), true);
});
