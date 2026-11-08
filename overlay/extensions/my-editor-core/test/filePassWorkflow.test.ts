import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existingImplementation, unchangedResults } from '../src/project/filePassWorkflow';
import { stubContent } from '../src/project/stubs';

test('existing implementations await QA without being called verified', () => {
	const file = { path: 'src/value.ts', role: 'Provide a value' };
	const result = existingImplementation(file, 'export const value = 42;\n', 'hash');
	assert.equal(result?.outcome, 'existing');
	assert.match(result!.note, /not been verified/);
	assert.equal(result?.hash, 'hash');
	for (const source of [undefined, '', stubContent(file), 'TODO', 'throw new Error("not implemented");', 'x\n'.repeat(601)]) {
		assert.equal(existingImplementation(file, source), undefined);
	}
	assert.equal(existingImplementation({ path: 'package.json' }, '{}\n'), undefined);
	assert.equal(existingImplementation({ path: 'package.json' }, '{invalid}'), undefined);
});

test('resuming keeps unchanged later files when an earlier file changed or disappeared', async () => {
	const results = [{ path: 'package.json', hash: 'old', note: 'manifest' }, { path: 'one.ts', hash: 'same', note: 'saved' },
		{ path: 'gone.ts', hash: 'gone', note: 'saved' }, { path: 'two.ts', hash: 'same2', note: 'saved' }];
	const hashes: Record<string, string> = { 'package.json': 'new', 'one.ts': 'same', 'two.ts': 'same2' };
	assert.deepEqual(await unchangedResults(results, async path => hashes[path]), [results[1], results[3]]);
	assert.equal(results.length, 4);
});

test('resume cannot treat an unreadable or dirty file as unchanged', async () => {
	await assert.rejects(unchangedResults([{ path: 'dirty.ts', hash: 'same', note: '' }], async () => { throw Error('Save edits first'); }), /Save edits first/);
});
