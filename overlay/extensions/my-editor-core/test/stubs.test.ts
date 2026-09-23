import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { nextFile, parseTree, stubContent } from '../src/project/stubs';

test('parseTree accepts an array or an object with files', () => {
	assert.equal(parseTree('[{"path":"a.ts"},{"role":"no path"}]').length, 1);
	assert.equal(parseTree('{"files":[{"path":"a.ts"},{"path":"b.py"}]}').length, 2);
});

test('stubContent writes a TypeScript header that keeps the module compiling', () => {
	const stub = stubContent({ path: 'src/habits.ts', role: 'Stores habits.', requirements: ['FR-001', 'FR-002'], section: 'store' });
	assert.equal(stub, '/**\n * Stores habits.\n * Requirements: FR-001, FR-002.\n * Architecture: #store.\n */\n\nexport {};\n');
});

test('stubContent writes a Python module docstring', () => {
	assert.equal(stubContent({ path: 'app/store.py', role: 'Stores habits.' }), '"""Stores habits.\n"""\n');
});

test('nextFile prefers work in progress, then stubs, then anything not done', () => {
	const files = [{ path: 'a', status: 'done' }, { path: 'b', status: 'planned' }, { path: 'c', status: 'stub' }];
	assert.equal(nextFile(files)?.path, 'c');
	assert.equal(nextFile([...files, { path: 'd', status: 'in-progress' }])?.path, 'd');
	assert.equal(nextFile([{ path: 'a', status: 'done' }]), undefined);
});
