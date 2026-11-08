import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { character, characterPrompt } from '../src/chat/characters';
import { projectCharacter, routeCharacter, wantsChangeMap } from '../src/chat/characterRouting';
import type { ProjectState } from '../src/project/state';
import { classNames, sourceLines, sourcePolicyError } from '../src/quality/sourcePolicy';

test('source policy allows 600 lines and rejects 601, including an edited proposal at Keep', () => {
	assert.equal(sourceLines('a\nb\n'), 2);
	assert.equal(sourcePolicyError('src/a.ts', 'x\n'.repeat(600)), undefined);
	assert.match(sourcePolicyError('src/a.ts', 'x\n'.repeat(601)) ?? '', /601 lines/);
	assert.equal(sourcePolicyError('src/a.md', 'x\n'.repeat(601)), undefined);
});

test('source policy rejects two classes in one file and ignores CSS selectors', () => {
	assert.deepEqual(classNames('export class A {}\nclass B {}\n', 'src/a.ts'), ['A', 'B']);
	assert.match(sourcePolicyError('src/a.ts', 'export class A {}\nclass B {}\n') ?? '', /2 classes/);
	assert.equal(sourcePolicyError('styles/a.css', '.a {}\n.b {}\n'), undefined);
});

test('a model failure explanation cannot replace source code', () => {
	assert.match(sourcePolicyError('test/automation.test.ts', 'ERROR: Unable to safely reconstruct the complete 492-line file.') ?? '', /failure message/);
	assert.equal(sourcePolicyError('src/a.ts', 'const message = "ERROR: Unable to connect";\n'), undefined);
	assert.equal(sourcePolicyError('src/a.ts', '// ERROR: Unable to connect\nexport const retry = true;\n'), undefined);
	assert.equal(sourcePolicyError('src/a.ts', 'ERROR: failed();\n'), undefined);
});

test('a bare placeholder cannot replace a source file, while placeholder names and strings remain valid', () => {
	for (const value of ['placeholder', 'PLACEHOLDER\n', '// TODO', '# not implemented', 'TBD.']) {
		assert.match(sourcePolicyError('src/main.ts', value) ?? '', /placeholder/);
	}
	for (const value of ['const placeholder = "Type here";', 'export const text = "placeholder";', '// TODO: improve caching\nexport const ready = true;']) {
		assert.equal(sourcePolicyError('src/main.ts', value), undefined);
	}
	assert.equal(sourcePolicyError('notes.md', 'placeholder'), undefined);
});

test('characters change presentation while preserving the review rules', () => {
	assert.equal(character('unknown').id, 'bamboo');
	assert.equal(character('olive').role, 'Architecture');
	assert.match(characterPrompt('pip'), /Keep\/Undo rules/);
});

test('task routing switches specialists, while manual choice stays pinned', () => {
	assert.equal(routeCharacter('Please review this code', undefined, 'bamboo', false).id, 'diji');
	assert.equal(routeCharacter('The app crashes on save', undefined, 'bamboo', false).id, 'hopper');
	assert.equal(routeCharacter('', 'requirements', 'bamboo', false).id, 'soki');
	assert.equal(routeCharacter('', 'tree', 'hopper', false).id, 'flow');
	assert.equal(routeCharacter('/tree', undefined, 'hopper', false).id, 'flow');
	assert.equal(routeCharacter('', 'tree', 'hopper', true).id, 'hopper');
	assert.equal(routeCharacter('Please review this code', undefined, 'ada', true).id, 'ada');
	assert.equal(routeCharacter('I want to change the header', undefined, 'ada', false).locateOnly, false);
	assert.equal(routeCharacter('/locate the header', undefined, 'ada', false).id, 'bamboo');
	assert.equal(wantsChangeMap('I want to change the header', 'review'), false);
	assert.equal(wantsChangeMap('I want to change the header'), false);
	assert.equal(wantsChangeMap('Where should I change the header?'), true);
});

test('a new project starts with its next useful specialist', () => {
	const project: ProjectState = { name: 'demo', summary: '', hasWorkspace: true, memory: { brain: false, brainFiles: 0, conventions: false, decisions: 0, chatDays: 0 }, stages: [
		{ id: 'requirements', title: '', status: '', state: 'empty' },
		{ id: 'architecture', title: '', status: '', state: 'empty' },
		{ id: 'build', title: '', status: '', state: 'empty' },
		{ id: 'qa', title: '', status: '', state: 'empty' },
	] };
	assert.equal(projectCharacter(project), 'soki');
	assert.equal(projectCharacter({ ...project, stages: project.stages.map(stage => stage.id === 'requirements' ? { ...stage, state: 'done' } : stage) }), 'lisko');
	assert.equal(projectCharacter({ ...project, stages: project.stages.map(stage => stage.id === 'architecture' || stage.id === 'requirements'
		? { ...stage, state: 'done' as const } : stage)
		.concat({ id: 'tree' as const, title: '', status: '', state: 'empty' as const }) }), 'flow');
	assert.equal(projectCharacter({ ...project, stages: project.stages.map(stage => stage.id === 'build' ? { ...stage, state: 'started' } : stage), memory: { ...project.memory, brain: true } }), 'ada');
});
