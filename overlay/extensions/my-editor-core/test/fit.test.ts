import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { analyzeFit } from '../src/brain/fit';

const project = [
	{ path: 'src/a.ts', text: "import { b } from './b';\nimport { gone } from './missing';\nexport const a = b;\n" },
	{ path: 'src/b.ts', text: "import { a } from './a';\nexport const b = 1;\n" },
	{ path: 'src/c.ts', text: "export function lonely() {}\n" },
	{ path: 'src/index.ts', text: "import { a } from './a';\nexport { a };\n" },
];

test('analyzeFit finds broken imports, cycles, links and unused exports', () => {
	const report = analyzeFit(project.slice(0, 3), project);
	assert.deepEqual(report.brokenImports, [{ file: 'src/a.ts', spec: './missing' }]);
	assert.deepEqual(report.cycles, [['src/a.ts', 'src/b.ts']]);
	assert.deepEqual(report.links, [{ from: 'src/a.ts', to: 'src/b.ts' }, { from: 'src/b.ts', to: 'src/a.ts' }]);
	assert.deepEqual(report.unusedExports, [{ file: 'src/c.ts', names: ['lonely'] }]);
});

test('analyzeFit does not flag entry points as unused', () => {
	const report = analyzeFit([project[3]], project);
	assert.deepEqual(report.unusedExports, []);
});
