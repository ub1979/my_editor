import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classDeclarations } from '../src/quality/sourcePolicy';

test('classDeclarations reports names with one-based lines', () => {
	assert.deepEqual(classDeclarations('export class A {}\n\nclass B {}\n', 'src/a.ts'), [{ name: 'A', line: 1 }, { name: 'B', line: 3 }]);
	assert.deepEqual(classDeclarations('class A {}', 'src/a.go'), []);
});
