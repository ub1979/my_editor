import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { test } from 'node:test';
import { aiMarker, insertAiSnippet } from '../src/coding/inlineCode';
import { dedent, pythonCell, pythonSelectionCommand } from '../src/coding/pythonCode';

test('AI snippets insert only below their directive and retain the surrounding bytes and indentation', () => {
	const source = 'class A:\r\n    #Ai <make a method>\r\n    old = 1\r\n';
	const marker = aiMarker('    #Ai <make a method>', 1)!;
	assert.equal(marker.instruction, 'make a method');
	assert.equal(insertAiSnippet(source, marker, '```python\ndef value(self):\n    return 2\n```'),
		'class A:\r\n    #Ai <make a method>\r\n    def value(self):\r\n        return 2\r\n    old = 1\r\n');
	assert.equal(aiMarker('print("#Ai do something")', 0), undefined);
	assert.throws(() => insertAiSnippet(source, marker, '```py\nx = 1\n```\n```py\ny = 2\n```'), /exactly one/);
	assert.throws(() => insertAiSnippet(source, marker, '```py\n' + 'x\n'.repeat(601) + '```'), /601 lines.*room for/);
	assert.throws(() => insertAiSnippet('changed', marker, '```py\nx = 1\n```'), /directive changed/);
});

test('Python cells respect delimiters, and selected indented code is dedented without changing strings', () => {
	assert.equal(dedent('    x = "a\\nb"\n    print(x)\n'), 'x = "a\\nb"\nprint(x)\n');
	const source = 'x = 1\n# %% first\ny = x + 2\ny\n# %% next\nprint(y)';
	assert.equal(pythonCell(source, 1).code, 'y = x + 2\ny');
	assert.equal(pythonCell(source, 5).code, 'print(y)');
	assert.equal(pythonCell(source, 0).code, 'x = 1');
});

test('Python execution retains variables, displays expressions and safely quotes selected source', () => {
	const helper = path.resolve(__dirname, '../../resources/python/session.py');
	const program = `import sys; sys.path.insert(0, ${JSON.stringify(path.dirname(helper))})\n`
		+ `exec(compile(open(${JSON.stringify(helper)}).read(), ${JSON.stringify(helper)}, "exec"))\n`
		+ pythonSelectionCommand('answer = 40\nanswer + 2', 'example.py') + '\n'
		+ pythonSelectionCommand('print(answer)\ntext = "quoted \\\" value"\ntext', 'example.py');
	const output = execFileSync('python3', ['-c', program], { encoding: 'utf8' });
	assert.match(output, /^42\n40\n/);
	assert.match(output, /quoted/);
});
