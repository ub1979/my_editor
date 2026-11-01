import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { test } from 'node:test';
import { MAX_SOURCE_LINES, sourceLines } from '../src/quality/sourcePolicy';
import * as ts from 'typescript';

test('all maintained extension source, helper and test files stay within the source limit', () => {
	const root = path.resolve(__dirname, '../..');
	const oversized: string[] = [];
	const manyClasses: string[] = [], python: string[] = [];
	const scan = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const file = path.join(dir, entry.name);
			if (entry.isDirectory() && entry.name !== 'testdata' && entry.name !== '__pycache__') { scan(file); }
			else if (entry.isFile() && /\.(?:ts|go|py|js|cjs|css|sh)$/.test(file)) {
				const lines = sourceLines(readFileSync(file, 'utf8'));
				if (lines > MAX_SOURCE_LINES) { oversized.push(`${path.relative(root, file)}: ${lines}`); }
				if (file.endsWith('.ts')) {
					const parsed = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
					if (parsed.statements.filter(ts.isClassDeclaration).length > 1) { manyClasses.push(file); }
				}
				if (file.endsWith('.py')) { python.push(file); }
			}
		}
	};
	for (const folder of ['src', 'resources', 'test', 'media']) { scan(path.join(root, folder)); }
	const repo = path.resolve(root, '../../..');
	scan(path.join(repo, 'scripts'));
	scan(path.join(repo, 'overlay/src'));
	assert.deepEqual(oversized, [], `Split files by responsibility before growing them:\n${oversized.join('\n')}`);
	const pythonClasses = execFileSync('python3', ['-c', 'import ast,sys,json; print(json.dumps([p for p in sys.argv[1:] if sum(isinstance(n,ast.ClassDef) for n in ast.parse(open(p).read()).body)>1]))', ...python], { encoding: 'utf8' });
	assert.deepEqual([...manyClasses, ...JSON.parse(pythonClasses)], [], 'Keep each class in its own source or test file.');
});
