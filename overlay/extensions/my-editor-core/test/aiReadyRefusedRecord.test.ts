import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import type { StepRecord } from '../src/aiready/fixState';
import { loadRefused, refusedBefore, refusedCache, rememberRefused, saveRefused } from '../src/aiready/refusedRecord';

const refused: StepRecord = { file: 'solo.go', kind: 'refactor', status: 'refused', reason: 'The extract check failed: x.' };
const committed: StepRecord = { file: 'plan.go', kind: 'refactor', status: 'committed', commit: 'abc' };
const split: StepRecord = { file: 'big.go', kind: 'split', status: 'refused', reason: 'The move check failed: Rule 2.' };

test('refused refactors are kept by blob with their reason; a committed one drops the entry, splits are ignored', () => {
	const blobs = new Map([['solo.go', 's1'], ['plan.go', 'p2'], ['big.go', 'b1']]);
	const previous = { files: { 'plan.go': { blob: 'p1', reason: 'Refused before.' }, 'old.go': { blob: 'o1', reason: 'Kept.' } } };
	assert.deepEqual(refusedCache([refused, committed, split], blobs, previous), { files: {
		'old.go': { blob: 'o1', reason: 'Kept.' }, 'solo.go': { blob: 's1', reason: 'The extract check failed: x.' } } });
	assert.deepEqual(refusedCache([refused], new Map()), { files: {} }, 'no blob, no entry');
	assert.deepEqual(refusedCache([{ ...refused, status: 'skipped' }, { ...refused, status: 'discarded' }], blobs), { files: {} });
});

test('the record is saved per project and read back; a changed file is unknown', async () => {
	const storage = mkdtempSync(path.join(os.tmpdir(), 'refused-'));
	assert.equal(loadRefused(storage, '/p/shop'), undefined);
	const cache = refusedCache([refused], new Map([['solo.go', 's1']]));
	saveRefused(storage, '/p/shop', cache);
	assert.deepEqual(loadRefused(storage, '/p/shop'), cache);
	assert.equal(loadRefused(storage, '/p/other'), undefined);
	assert.equal(refusedBefore(cache, 'solo.go', 's1'), 'The extract check failed: x.');
	assert.equal(refusedBefore(cache, 'solo.go', 's2'), undefined);
	assert.equal(refusedBefore(cache, 'solo.go', undefined), undefined);
	assert.equal(refusedBefore(undefined, 'solo.go', 's1'), undefined);
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-refused-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	git('init', '--quiet', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	writeFileSync(path.join(root, 'solo.go'), 'package solo\n');
	git('add', '.');
	git('commit', '--quiet', '-m', 'first');
	await rememberRefused(storage, root, root, [refused, { ...refused, file: 'gone.go' }]);
	assert.deepEqual(loadRefused(storage, root)?.files, { 'solo.go': { blob: git('rev-parse', 'HEAD:solo.go'), reason: 'The extract check failed: x.' } });
	rmSync(root, { recursive: true, force: true });
});
