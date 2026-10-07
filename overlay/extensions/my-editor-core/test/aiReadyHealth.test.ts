import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { detectCommands } from '../src/aiready/commandDetect';
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
		{ languages: ['JavaScript/TypeScript'], checks: ['npx tsc --noEmit'], tests: ['npm test'] });
	assert.deepEqual(detectCommands({ names: ['package.json'], packageJson: '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }).tests, []);
	assert.deepEqual(detectCommands({ names: ['package.json'], packageJson: 'not json' }).tests, []);
	assert.deepEqual(detectCommands({ names: ['pyproject.toml'], pyproject: '[tool.pytest.ini_options]' }).tests, ['pytest -q -rA']);
	assert.deepEqual(detectCommands({ names: ['pyproject.toml'], pyproject: '[project]' }).tests, []);
	assert.deepEqual(detectCommands({ names: ['conftest.py'] }).tests, ['pytest -q -rA']);
	assert.deepEqual(detectCommands({ names: ['go.mod'] }), { languages: ['Go'], checks: ['go build ./...', 'go vet ./...'], tests: ['go test -json ./...'] });
	assert.deepEqual(detectCommands({ names: ['Cargo.toml'] }), { languages: ['Rust'], checks: ['cargo check'], tests: ['cargo test'] });
	assert.deepEqual(detectCommands({ names: ['README.md'] }), NO_COMMANDS);
});
