import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { commentText, findDefinitions, formatComment, insertion, needsComment } from '../src/comments/detect';

test('needsComment sees comments above code, past decorators', () => {
	const ts = ['/** Adds two numbers. */', 'export function add(a: number, b: number) {', '}', '', '@Injectable()', 'class Store {}', '', '// Totals.', '@memo', 'function total() {}'];
	assert.equal(needsComment(ts, 1, 'typescript'), false);
	assert.equal(needsComment(ts, 5, 'typescript'), true);
	assert.equal(needsComment(ts, 9, 'typescript'), false);
});

test('needsComment accepts a Python docstring, even after a split signature', () => {
	const py = ['def a():', '    """Does a."""', '    pass', '', 'def b(', '    x: int,', ') -> int:', '    return x', '', '# Adds.', 'def c(): pass'];
	assert.equal(needsComment(py, 0, 'python'), false);
	assert.equal(needsComment(py, 4, 'python'), true);
	assert.equal(needsComment(py, 10, 'python'), false);
});

test('needsComment handles Rust attributes and doc comments', () => {
	const rs = ['/// Parses input.', '#[inline]', 'fn parse() {}', '', '#[derive(Debug)]', 'struct Point {}'];
	assert.equal(needsComment(rs, 2, 'rust'), false);
	assert.equal(needsComment(rs, 5, 'rust'), true);
});

test('commentText takes the sentence and drops markers, quotes and fences', () => {
	assert.equal(commentText('Calculates the median price.'), 'Calculates the median price.');
	assert.equal(commentText('"""Average of the prices."""'), 'Average of the prices.');
	assert.equal(commentText('```ts\n/**\n * Sums the prices,\n * in cents.\n */\n```'), 'Sums the prices, in cents.');
	assert.equal(commentText('function x() { return 1; }'), undefined);
	assert.equal(commentText('ok'), undefined);
});

test('formatComment writes each language in its own style', () => {
	assert.deepEqual(formatComment('Sums the prices', 'typescript', 'total'), ['/** Sums the prices. */']);
	assert.deepEqual(formatComment('Average of the prices.', 'python', 'avg'), ['"""Average of the prices."""']);
	assert.deepEqual(formatComment('Parses the input.', 'rust', 'parse'), ['/// Parses the input.']);
	assert.deepEqual(formatComment('Returns the total.', 'go', 'Total'), ['// Total returns the total.']);
	assert.deepEqual(formatComment('Total returns the total.', 'go', 'Total'), ['// Total returns the total.']);
	const long = formatComment('word '.repeat(30).trim(), 'python', 'f');
	assert.ok(long[0].startsWith('"""word'));
	assert.equal(long[long.length - 1], '"""');
});

test('insertion puts the comment above the code, or first in a Python body', () => {
	const ts = ['class A {', '    run() {}', '}'];
	assert.deepEqual(insertion(ts, 1, ['/**', '* Runs.', '*/'], 'typescript'), { line: 1, text: '    /**\n     * Runs.\n     */\n' });
	const py = ['def avg(xs):', '    return sum(xs) / len(xs)'];
	assert.deepEqual(insertion(py, 0, ['"""Average of xs."""'], 'python'), { line: 1, text: '    """Average of xs."""\n' });
});

test('findDefinitions finds Python definitions and where they end', () => {
	const py = ['def a(x):', '    return x', '', 'class B:', '    def c(self):', '        pass', 'y = 1'];
	assert.deepEqual(findDefinitions(py, 'python'), [
		{ name: 'a', line: 0, endLine: 1 }, { name: 'B', line: 3, endLine: 5 }, { name: 'c', line: 4, endLine: 5 },
	]);
});

test('findDefinitions balances braces for TypeScript, Rust and Go', () => {
	assert.deepEqual(findDefinitions(['export function f() {', '  if (x) { y(); }', '}', 'const z = 1;'], 'typescript'), [{ name: 'f', line: 0, endLine: 2 }]);
	assert.deepEqual(findDefinitions(['pub fn parse(s: &str) -> u8 {', '    0', '}'], 'rust'), [{ name: 'parse', line: 0, endLine: 2 }]);
	assert.deepEqual(findDefinitions(['func (c *Cart) Total() int {', '\treturn 0', '}'], 'go'), [{ name: 'Total', line: 0, endLine: 2 }]);
});
