import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { goSplitPrompt, goTestPrompt } from '../src/aiready/goPrompts';
import type { GoFileInfo } from '../src/aiready/goRules';
import type { Declaration } from '../src/aiready/language';

/** A declaration with only what the prompts read; the rest is neutral. */
function decl(over: Partial<Declaration> & Pick<Declaration, 'id' | 'names'>): Declaration {
	return { kind: 'func', span: { start: 0, end: 0 }, lines: 10, doc: '', docText: '', uses: [], movable: true, ...over };
}

/** A Go file view with only what the prompts read. */
function info(file: string, declarations: Declaration[], pkg = 'shop'): GoFileInfo {
	return { path: file, declarations, frame: [], imports: [], go: { package: pkg } } as unknown as GoFileInfo;
}

/** The JSON object on each declaration line of a split prompt. */
function declarationLines(text: string): Record<string, unknown>[] {
	const block = text.split('Declarations:\n')[1].split('\n\n')[0];
	return block.split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
}

test('a Go split prompt names the file, its package and length, and asks for files of at most 400 lines', () => {
	const prompt = goSplitPrompt(info('internal/shop/store.go', [decl({ id: 0, names: ['Store'] })]), 812);
	assert.match(prompt.text, /^File: internal\/shop\/store\.go \(package shop, 812 lines\)\n/);
	assert.match(prompt.text, /Plan new files so store\.go and every new file are at most 400 lines\.$/);
	assert.match(prompt.system, /Refer to declarations only by their numeric "id"/);
	assert.match(prompt.system, /Never end a name in _test\.go or in a GOOS or GOARCH name/);
	assert.match(prompt.system, /Reply with only a JSON array/);
});

test('each declaration is one JSON line: id, kind, names, lines and imports in that order', () => {
	const prompt = goSplitPrompt(info('a.go', [
		decl({ id: 0, kind: 'type', names: ['Store'], lines: 4, uses: [] }),
		decl({ id: 1, kind: 'func', names: ['Open'], lines: 12, uses: ['fmt fmt', 'yaml gopkg.in/yaml.v3'] }),
	]), 500);
	const lines = declarationLines(prompt.text);
	assert.deepEqual(lines, [
		{ id: 0, kind: 'type', names: ['Store'], lines: 4, imports: [] },
		{ id: 1, kind: 'func', names: ['Open'], lines: 12, imports: ['fmt fmt', 'yaml gopkg.in/yaml.v3'] },
	]);
	assert.deepEqual(Object.keys(lines[1]), ['id', 'kind', 'names', 'lines', 'imports']);
});

test('receiver and first doc line appear only when the declaration has them', () => {
	const lines = declarationLines(goSplitPrompt(info('a.go', [
		decl({ id: 0, kind: 'method', names: ['Get'], receiver: 'Store', doc: 'Get reads one row.' }),
		decl({ id: 1, names: ['plain'], receiver: '', doc: '' }),
	]), 450).text);
	assert.equal(lines[0].receiver, 'Store');
	assert.equal(lines[0].firstDocLine, 'Get reads one row.');
	assert.ok(!('receiver' in lines[1]));
	assert.ok(!('firstDocLine' in lines[1]));
});

test('an unmovable declaration is marked with movable false and its reason; movable ones carry neither', () => {
	const lines = declarationLines(goSplitPrompt(info('a.go', [
		decl({ id: 0, names: ['init'], movable: false, reason: 'init runs in file order' }),
		decl({ id: 1, names: ['Run'], movable: true, reason: 'ignored while movable' }),
	]), 450).text);
	assert.equal(lines[0].movable, false);
	assert.equal(lines[0].reason, 'init runs in file order');
	assert.ok(!('movable' in lines[1]));
	assert.ok(!('reason' in lines[1]));
});

test('a file with no declarations still yields a well-formed prompt', () => {
	const prompt = goSplitPrompt(info('empty.go', []), 0);
	assert.match(prompt.text, /^File: empty\.go \(package shop, 0 lines\)\nDeclarations:\n\n\n/);
});

test('a Go test prompt names the test file, the source file and its package, then the source', () => {
	const source = 'package shop\n\nfunc Add(a, b int) int { return a + b }\n';
	const prompt = goTestPrompt('shop/add.go', source, info('shop/add.go', []), 'shop/add_ai_test.go');
	assert.equal(prompt.text, `Write shop/add_ai_test.go for shop/add.go (package shop).\n\n=== shop/add.go ===\n${source}`);
	assert.match(prompt.system, /Same package as the file under test/);
	assert.match(prompt.system, /Name tests TestAi<Something>/);
	assert.match(prompt.system, /```go code block/);
});

test('a Go test prompt redacts secrets in the source', () => {
	const source = 'package shop\n\nconst key = "sk-ant-abcdefghijklmnop"\nvar token = "ghp_abcdefghijklmnopqrstuvwx"\n';
	const prompt = goTestPrompt('k.go', source, info('k.go', []), 'k_ai_test.go');
	assert.doesNotMatch(prompt.text, /sk-ant-abcdefghijklmnop|ghp_abcdefghijklmnopqrstuvwx/);
	assert.match(prompt.text, /\[REDACTED\]/);
});

test('a Go test prompt keeps at most 60,000 characters of source', () => {
	const source = `package shop\n${'x'.repeat(70_000)}`;
	const prompt = goTestPrompt('big.go', source, info('big.go', []), 'big_ai_test.go');
	const body = prompt.text.split('=== big.go ===\n')[1];
	assert.equal(body.length, 60_000);
	assert.ok(source.startsWith(body));
});
