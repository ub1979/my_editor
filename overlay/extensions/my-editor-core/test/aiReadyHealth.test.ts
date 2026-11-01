import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { detectCommands } from '../src/aiready/commandDetect';
import { fileStats, needsTests, scanHealth, testSubject } from '../src/aiready/health';
import { offerKind } from '../src/aiready/offer';
import { classDeclarations } from '../src/quality/sourcePolicy';

test('classDeclarations reports names with one-based lines', () => {
	assert.deepEqual(classDeclarations('export class A {}\n\nclass B {}\n', 'src/a.ts'), [{ name: 'A', line: 1 }, { name: 'B', line: 3 }]);
	assert.deepEqual(classDeclarations('class A {}', 'src/a.go'), []);
});

const NO_COMMANDS = { languages: [], checks: [], tests: [] };

test('a folder my_editor did not create gets the AI-ready offer; a brain means no offer', () => {
	assert.equal(offerKind(false, false), 'ai-ready');
	assert.equal(offerKind(true, false), 'analyse');
	assert.equal(offerKind(true, true), undefined);
	assert.equal(offerKind(false, true), undefined);
});

test('detectCommands reads build files and ignores the npm placeholder test script', () => {
	assert.deepEqual(detectCommands({ names: ['package.json', 'tsconfig.json'], packageJson: '{"scripts":{"test":"node --test"}}' }),
		{ languages: ['JavaScript/TypeScript'], checks: ['npx --no tsc --noEmit'], tests: ['npm test'] });
	assert.deepEqual(detectCommands({ names: ['package.json'], packageJson: '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }).tests, []);
	assert.deepEqual(detectCommands({ names: ['package.json'], packageJson: 'not json' }).tests, []);
	assert.deepEqual(detectCommands({ names: ['pyproject.toml'], pyproject: '[tool.pytest.ini_options]' }).tests, ['pytest -q -rA']);
	assert.deepEqual(detectCommands({ names: ['pyproject.toml'], pyproject: '[project]' }).tests, []);
	assert.deepEqual(detectCommands({ names: ['setup.py'] }).checks, ['python -m compileall -q .']);
	assert.deepEqual(detectCommands({ names: ['conftest.py'] }).tests, ['pytest -q -rA']);
	assert.deepEqual(detectCommands({ names: ['go.mod'] }), { languages: ['Go'], checks: ['go build ./...', 'go vet ./...'], tests: ['go test -json ./...'] });
	assert.deepEqual(detectCommands({ names: ['Cargo.toml'] }), { languages: ['Rust'], checks: ['cargo check'], tests: ['cargo test'] });
	assert.deepEqual(detectCommands({ names: ['README.md'] }), NO_COMMANDS);
});

test('testSubject names what a test file is about, by language convention', () => {
	assert.equal(testSubject('src/cart.test.ts'), 'cart');
	assert.equal(testSubject('web/cart.spec.jsx'), 'cart');
	assert.equal(testSubject('src/__tests__/cart.ts'), 'cart');
	assert.equal(testSubject('tests/test_cart.py'), 'cart');
	assert.equal(testSubject('cart_test.py'), 'cart');
	assert.equal(testSubject('pkg/cart_test.go'), 'cart');
	assert.equal(testSubject('src/cart.ts'), undefined);
});

test('needsTests checks TS/JS, Python, Go and Rust source only', () => {
	assert.equal(needsTests('src/cart.ts'), true);
	assert.equal(needsTests('app/cart.py'), true);
	assert.equal(needsTests('src/lib.rs'), true);
	for (const path of ['src/cart.test.ts', 'src/types.d.ts', 'vite.config.ts', 'setup.py', 'conftest.py', 'pkg/__init__.py',
		'tests/helpers.py', 'tests/it.rs', 'styles/a.css', 'src/a.c', 'src/types.d.mts', 'cmd/main.go', 'app/__main__.py', '.eslintrc.js']) {
		assert.equal(needsTests(path), false, path);
	}
});

test('scanHealth flags long files, extra classes and untested files', () => {
	const stats = [
		fileStats('src/big.ts', 'x\n'.repeat(450)),
		fileStats('src/near.ts', 'x\n'.repeat(280)),
		fileStats('src/two.ts', 'class A {}\nclass B {}\n'),
		fileStats('src/cart.ts', 'export const total = 1;\n'),
		fileStats('src/lib.rs', 'fn a() {}\n#[cfg(test)]\nmod tests {}\n'),
	];
	const paths = ['src/cart.ts', 'src/cart.test.ts', 'src/big.ts', 'src/near.ts', 'src/two.ts', 'src/lib.rs'];
	const findings = scanHealth(stats, paths, { languages: ['TS'], checks: [], tests: ['npm test'] }, ['vendor/huge.js is too large to read.']);
	const kinds = findings.map(f => `${f.kind}:${f.file ?? ''}`);
	assert.ok(kinds.includes('too-long:src/big.ts'));
	assert.ok(kinds.includes('near-limit:src/near.ts'));
	assert.ok(kinds.includes('many-classes:src/two.ts'));
	assert.equal(findings.find(f => f.kind === 'many-classes')?.line, 2);
	assert.ok(kinds.includes('untested:src/big.ts'));
	assert.ok(!kinds.includes('untested:src/cart.ts'));
	assert.ok(!kinds.includes('untested:src/lib.rs'));
	assert.ok(kinds.includes('not-covered:'));
	assert.ok(!kinds.includes('no-test-runner:'));
	assert.ok(scanHealth([], [], NO_COMMANDS, []).some(f => f.kind === 'no-test-runner'));
});
