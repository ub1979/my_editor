import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { neverSplitLines } from '../src/aiready/neverSplit';

const TESTS = 'test files are not split in this version';

test('files never split: common reasons are one line each with a count and three examples; specific ones are listed', () => {
	const skipped = [
		...Array.from({ length: 47 }, (_, i) => ({ file: `pkg/f${i}_test.go`, reason: TESTS, lines: 500 + i })),
		{ file: 'vendor/a.go', reason: 'vendored code', lines: 10 },
		{ file: 'gen/a.pb.go', reason: 'generated code', lines: 900 }, { file: 'gen/b.pb.go', reason: 'generated code', lines: 30 },
		{ file: 'tools/x.go', reason: 'inside the nested module tools/', lines: 450 },
		{ file: 'sys_linux.go', reason: 'its name ends in _linux, a build constraint', lines: 800 },
		{ file: 'cg.go', reason: 'it uses cgo', lines: 120 }, { file: 'crlf.go', reason: 'it has CRLF line endings' },
	];
	assert.deepEqual(neverSplitLines(skipped), [
		`- 47 test files (\`pkg/f0_test.go\`, \`pkg/f1_test.go\`, \`pkg/f2_test.go\`, …): ${TESTS}.`,
		'- 2 files (`gen/a.pb.go`, `gen/b.pb.go`): generated code.',
		'- 1 file (`vendor/a.go`): vendored code.',
		'- 1 file (`tools/x.go`): inside the nested module tools/.',
		'- `sys_linux.go`: its name ends in _linux, a build constraint.',
		'- `crlf.go`: it has CRLF line endings.',
		'- plus 1 file under 400 lines that needs no split. They have no tests and cannot be given any, so the picker does not offer them.',
	]);
});

test('TypeScript and Python reasons for tests, build output and declaration files group the same way', () => {
	const lines = neverSplitLines([
		{ file: 'a.test.ts', reason: 'a test or test-support file', lines: 40 }, { file: 'b.test.ts', reason: 'a test or test-support file', lines: 9 },
		{ file: 'dist/x.js', reason: 'build output or vendored code', lines: 2000 }, { file: 'x.d.ts', reason: 'a declaration file', lines: 600 },
	]);
	assert.deepEqual(lines, [
		'- 2 test files (`a.test.ts`, `b.test.ts`): a test or test-support file.',
		'- 1 file (`dist/x.js`): build output or vendored code.',
		'- 1 file (`x.d.ts`): a declaration file.',
	]);
	assert.deepEqual(neverSplitLines([]), []);
});
