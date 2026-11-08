import { strict as assert } from 'node:assert';
import { test } from 'node:test';

test('supporting repair files require exact approval and remain beside a selected module', async () => {
	const Module = require('node:module');
	const original = Module._load;
	const prompts: string[] = [];
	let choice: string | undefined;
	Module._load = (name: string, ...args: unknown[]) => name === 'vscode' ? { window: {
		showWarningMessage: async (_message: string, options: { detail: string }) => { prompts.push(options.detail); return choice; },
	} } : original(name, ...args);
	let helper: typeof import('../src/project/filePassRepairScope');
	try { helper = require('../src/project/filePassRepairScope'); } finally { Module._load = original; }
	const modules = [{ title: 'Database', files: ['db/001.sql'] }, { title: 'App', files: ['src/main.ts'] }];
	const planned = modules.flatMap(group => group.files);
	const request = { files: [{ path: 'db/002.sql', reason: 'Preserve existing rows.' }], decision: { source: 'developer' as const, quote: 'Use integer IDs.' } };
	const scope = helper.repairScope(request, modules, planned, []);
	assert.deepEqual(scope.modules[0].files, ['db/001.sql', 'db/002.sql']);
	assert.deepEqual(modules[0].files, ['db/001.sql'], 'Unapproved scope is only a proposal');
	const discovered = [...modules, { title: 'Other project source', files: ['db/legacy.sql'] }];
	const owned = helper.repairScope(request, discovered, planned, []);
	assert.deepEqual(owned.modules[0].files, ['db/001.sql', 'db/002.sql'], 'The saved-plan owner takes precedence over a QA inventory');
	assert.deepEqual(owned.additions, request.files, 'The new migration still requires exact scope approval');
	assert.deepEqual(owned.modules[2].files, ['db/legacy.sql']);
	assert.throws(() => helper.repairScope(request, discovered, [...planned, 'db/legacy.sql'], []), /selected module/, 'Two saved-plan owners remain ambiguous');
	assert.throws(() => helper.repairScope(request, [{ title: 'Only discovery A', files: ['db/a.sql'] }, { title: 'Only discovery B', files: ['db/b.sql'] }], [], []), /selected module/);
	assert.equal(await helper.approveRepairAdditions(scope.additions), false);
	choice = 'Add files and continue';
	assert.equal(await helper.approveRepairAdditions(scope.additions), true);
	assert.ok(prompts.every(prompt => prompt.includes('db/002.sql') && prompt.includes('Preserve existing rows.')));
	const resumed = helper.repairScope(request, scope.modules, planned, scope.additions);
	assert.deepEqual(resumed.additions, []);
	assert.equal(await helper.approveRepairAdditions(resumed.additions), true);
	assert.equal(prompts.length, 2, 'Approved exact paths do not request permission again');
	const companion = [{ path: 'src/event-schema.test.ts', reason: 'Run the reusable event suite.' }];
	choice = undefined;
	assert.equal(await helper.approveRepairAdditions(companion, true), true);
	assert.equal(prompts.length, 2, 'Existing companion-test permission covers new supporting tests');
	assert.equal(await helper.approveRepairAdditions(companion), false);
	assert.equal(await helper.approveRepairAdditions([...companion, ...scope.additions], true), false);
	assert.ok(prompts.at(-1)?.includes('db/002.sql'));
	assert.ok(!prompts.at(-1)?.includes('event-schema.test.ts'), 'Only scope not already authorized needs review');
	const lateTest = 'test/late.test.ts';
	const lateRequest = { ...request, files: [{ path: lateTest, reason: 'Repair a test created during QA.' }] };
	const refreshed = helper.repairScope(lateRequest, modules, planned, [], [lateTest]);
	assert.deepEqual(refreshed.additions, [], 'Discovered tests in whole-project QA need no new-file permission');
	assert.ok(refreshed.planned.includes(lateTest));
	assert.equal(refreshed.modules.flatMap(group => group.files).filter(path => path === lateTest).length, 1);
	const again = helper.repairScope(lateRequest, refreshed.modules, planned, []);
	assert.deepEqual(again.modules, refreshed.modules, 'Persisted QA scope survives resume without duplicate entries');
	assert.throws(() => helper.repairScope(lateRequest, modules, planned, []), /selected module/, 'Build cannot adopt arbitrary existing tests');
	assert.throws(() => helper.repairScope({ ...lateRequest, files: [{ path: 'other/code.ts', reason: 'production' }] }, modules, planned, [], ['other/code.ts']), /selected module/, 'Test discovery never expands production scope');
	for (const path of ['other/002.sql', '../outside.ts', '.env']) {
		assert.throws(() => helper.repairScope({ ...request, files: [{ path, reason: 'repair' }] }, modules, planned, []));
	}
});
