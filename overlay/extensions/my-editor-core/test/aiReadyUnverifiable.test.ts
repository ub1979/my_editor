import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import type { CheckResult } from '../src/aiready/baseline';
import { isPickItem, pickFixes, type PickOptions } from '../src/aiready/fixPicker';
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

test('a run that does not recheck a blocked package carries it over; it drops out only when a baseline shows it compiling', () => {
	const first = checkCache('tip1', baseline);
	const storeOnly = { 'go build -o /dev/null ./internal/store': twice('go build -o /dev/null ./internal/store', 0) };
	const second = checkCache('tip2', storeOnly, first);
	const files = [split('internal/engine/a.go'), split('internal/store/b.go')];
	assert.deepEqual([...blockedFiles(files, goChecks, second, 'tip2').keys()], ['internal/engine/a.go']);
	const fixedEngine = { 'go build -o /dev/null ./internal/engine': twice('go build -o /dev/null ./internal/engine', 0) };
	assert.equal(blockedFiles(files, goChecks, checkCache('tip3', fixedEngine, second), 'tip3').size, 0);
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
		async items => { rows = items.filter(isPickItem); return undefined; }, blocked);
	assert.deepEqual(rows.map(row => [row.label, row.picked, row.detail]), [
		['internal/engine/a.go', false, "can't be checked here: ./internal/engine build already fails"],
		['internal/store/b.go', true, undefined], ['c.go', false, undefined],
	]);
});

test('refactors come first under their own heading, and the search matches the row text', async () => {
	const refactor = { file: 'internal/store/plan.go', kind: 'refactor' as const, lines: 417, target: { name: 'buildPlan', lines: 401 } };
	const unticked = new Map([['internal/store/plan.go', 'no test here runs `buildPlan` yet']]);
	let labels: string[] = [];
	let options: PickOptions | undefined;
	await pickFixes([split('internal/store/b.go'), refactor, { file: 'c.go', kind: 'tests', lines: 300 }], async (items, shown) => {
		labels = items.map(item => (isPickItem(item) ? `${item.label} ${item.choice.kind}` : `# ${item.label}`));
		options = shown;
		return undefined;
	}, new Map(), unticked);
	assert.deepEqual(labels, ['# Refactors: long functions into helpers', 'internal/store/plan.go refactor', '# Splits and tests',
		'internal/store/b.go split', 'c.go tests']);
	assert.equal(options?.matchOnDescription, true);
	let plain: string[] = [];
	await pickFixes([split('internal/store/b.go')], async items => { plain = items.map(item => item.label); return undefined; });
	assert.deepEqual(plain, ['internal/store/b.go'], 'no headings without refactors');
});

test('the cache keeps why a check failed, says it in the reason, and forgets it once the check passes', () => {
	const header = '# github.com/acme/dialer/internal/vad';
	const missing = "silero_engine.c:6:10: fatal error: 'onnxruntime_c_api.h' file not found";
	const failed = (command: string) => ({ ...run(command, 1), tail: `${header}\n${missing}\n` });
	const engine = 'go build -o /dev/null ./internal/engine';
	const vet = 'go vet ./internal/engine';
	const cache = checkCache('tip1', { ...baseline, [engine]: [failed(engine), failed(engine)] as const, [vet]: [failed(vet), failed(vet)] as const });
	assert.equal(cache.errors?.[engine], missing);
	assert.deepEqual([...blockedFiles([split('internal/engine/a.go')], goChecks, cache, 'tip1').values()],
		[`can't be checked here: ./internal/engine build already fails (${missing})`]);
	const fixed = checkCache('tip2', { [engine]: twice(engine, 0) }, cache);
	assert.equal(fixed.errors?.[engine], undefined);
	assert.equal(fixed.errors?.[vet], missing, 'a check this run did not recheck keeps its error');
	assert.equal(cache.errors?.['go build ./...'], undefined, 'a failure with no output records no error');
});

test('the picker top line says why rows are unticked, or that nothing is ticked yet', async () => {
	let shown = '';
	const show = async (_: unknown, options: PickOptions) => { shown = options.placeHolder; return undefined; };
	const blocked = new Map([['internal/engine/a.go', "can't be checked here: ./internal/engine build already fails"]]);
	await pickFixes([split('internal/engine/a.go'), { file: 'internal/engine/a.go', kind: 'tests', lines: 500 }, split('internal/store/b.go')], show, blocked);
	assert.equal(shown, "1 left unticked: their packages didn't build here last time. Fixed the build? Tick them to check again.");
	await pickFixes([{ file: 'c.go', kind: 'tests', lines: 300 }], show);
	assert.equal(shown, 'Nothing is ticked yet: tick the fixes you want (tests are never ticked for you).');
	await pickFixes([split('internal/store/b.go')], show);
	assert.equal(shown, 'Each fix is checked and committed alone');
});
