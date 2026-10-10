import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import type { CheckResult } from '../src/aiready/baseline';
import { pickFixes } from '../src/aiready/fixPicker';
import { blockedFiles, checkCache, loadChecks, saveChecks } from '../src/aiready/fixUnverifiable';
import type { CheckCommand } from '../src/aiready/language';

const run = (command: string, code: number): CheckResult => ({ command, label: 'build', code, failures: [], tail: '', log: '' });
const twice = (command: string, first: number, second = first) => [run(command, first), run(command, second)] as const;
const goChecks = (file: string): CheckCommand[] => {
	const pkg = `./${path.posix.dirname(file)}`;
	return [{ label: 'build', command: 'go build ./...' }, { label: 'build', command: `go build -o /dev/null ${pkg}`, verifies: true },
		{ label: 'vet', command: `go vet ${pkg}`, verifies: true }];
};
const baseline = {
	'go build ./...': twice('go build ./...', 1),
	'go build -o /dev/null ./internal/engine': twice('go build -o /dev/null ./internal/engine', 1),
	'go vet ./internal/engine': twice('go vet ./internal/engine', 1),
	'go build -o /dev/null ./internal/store': twice('go build -o /dev/null ./internal/store', 0),
	'go vet ./internal/store': twice('go vet ./internal/store', 0, 1),
};
const split = (file: string) => ({ file, kind: 'split' as const, lines: 500 });

test('a package whose recorded compile checks all failed last run is unverifiable; an unrecorded one is unknown, not unverifiable', () => {
	const cache = checkCache('tip1', baseline);
	const blocked = blockedFiles([split('internal/engine/a.go'), split('internal/store/b.go'), split('cmd/tool/main.go')], goChecks, cache, 'tip1');
	assert.deepEqual([...blocked], [['internal/engine/a.go', "can't be checked here: ./internal/engine build already fails"]]);
});

test('the cache counts only for the ai_fix tip it was saved at', () => {
	const cache = checkCache('tip1', baseline);
	assert.equal(blockedFiles([split('internal/engine/a.go')], goChecks, cache, 'tip2').size, 0);
	assert.equal(blockedFiles([split('internal/engine/a.go')], goChecks, cache, undefined).size, 0);
	assert.equal(blockedFiles([split('internal/engine/a.go')], goChecks, undefined, 'tip1').size, 0);
});

test('the cache is saved per project and read back', () => {
	const storage = mkdtempSync(path.join(os.tmpdir(), 'unverifiable-'));
	assert.equal(loadChecks(storage, '/p/shop'), undefined);
	saveChecks(storage, '/p/shop', checkCache('tip1', baseline));
	assert.deepEqual(loadChecks(storage, '/p/shop'), checkCache('tip1', baseline));
	assert.equal(loadChecks(storage, '/p/other'), undefined);
});

test('the picker leaves unverifiable splits unticked with the reason in the row detail, and ticks the rest', async () => {
	const blocked = new Map([['internal/engine/a.go', "can't be checked here: ./internal/engine build already fails"]]);
	let rows: { label: string; picked: boolean; detail?: string }[] = [];
	await pickFixes([split('internal/engine/a.go'), split('internal/store/b.go'), { file: 'c.go', kind: 'tests', lines: 300 }],
		async items => { rows = items; return undefined; }, blocked);
	assert.deepEqual(rows.map(row => [row.label, row.picked, row.detail]), [
		['internal/engine/a.go', false, "can't be checked here: ./internal/engine build already fails"],
		['internal/store/b.go', true, undefined], ['c.go', false, undefined],
	]);
});
