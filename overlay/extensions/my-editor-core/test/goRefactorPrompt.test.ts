import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ExtractOutline } from '../src/aiready/goExtract';
import { goRefactorPrompt, MAX_FUNCTION_CHARS } from '../src/aiready/goRefactorPrompt';

const outline = (startLine: number, endLine: number, receiver = ''): ExtractOutline => ({
	function: { name: 'build', receiver, startLine, endLine, lines: endLine - startLine + 1, budget: 383 },
	blocks: [{ line: 17, depth: 1, statements: [{ from: 18, to: 18, kind: 'define', declares: ['n'] },
		{ from: 19, to: 19, kind: 'return', declares: [] }], live: [[], ['n'], []] }],
});

const SOURCE = `${Array.from({ length: 16 }, (_, i) => `// line ${i + 1}`).join('\n')}\nfunc build(token string) int {\n\tn := 1\n\treturn n\n}\n`;

test('the prompt numbers the function\'s lines and gives the outline, the limits and the reply shape', () => {
	const prompt = goRefactorPrompt('internal/store/plan.go', SOURCE, outline(17, 20, '*Store'));
	assert.ok(typeof prompt !== 'string');
	if (typeof prompt === 'string') { return; }
	for (const part of ['at most 6 parameters', '"from":177', 'at most 3', 'refused', 'lowerCamelCase', 'line budget', 'under 200 lines', '400 lines']) {
		assert.ok(prompt.system.includes(part), part);
	}
	assert.ok(prompt.text.startsWith('File: internal/store/plan.go\nFunction: build (*Store), lines 17–20 (4 lines); it must end at 383 lines or fewer.\n'));
	assert.ok(prompt.text.includes('\nOutline:\n{"line":17,"depth":1,"statements":[{"from":18'), prompt.text);
	assert.ok(prompt.text.endsWith('Source with line numbers:\n17\tfunc build(token string) int {\n18\t\tn := 1\n19\t\treturn n\n20\t}'), prompt.text);
	assert.doesNotMatch(prompt.text, /line 16/);
	const plain = goRefactorPrompt('a.go', SOURCE, outline(17, 20));
	assert.ok(typeof plain !== 'string' && plain.text.includes('Function: build, lines 17–20 (4 lines)'));
});

test('a function too long to show the model is refused before any call', () => {
	const body = Array.from({ length: 3000 }, () => `\tn += ${'1'.repeat(40)}`).join('\n');
	const source = `package m\n\nfunc build() int {\n\tn := 0\n${body}\n\treturn n\n}\n`;
	const refused = goRefactorPrompt('a.go', source, outline(3, 3006));
	assert.match(String(refused), /^`build` is \d+ characters with line numbers, more than the 120000 a refactor prompt shows\.$/);
	assert.equal(MAX_FUNCTION_CHARS, 120_000);
});
