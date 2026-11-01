import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { architectureComponents, documentProblems, planningProblems, savedTreeSections } from '../src/project/planning';
import { architectureAnchors } from '../src/project/architectureSections';
import { sectionAt } from '../src/project/impactSubject';
import { projectVisuals } from '../src/project/visualPlan';
import { architecture, requirements, tree } from './planningFixture';

const overview = '# Architecture\n## 1. Overview {#overview}\nThe system as a whole.\n## 2. Stack {#stack}\nTypeScript.\n'
	+ '## 3. Main system flow {#flow}\nComposer saves a draft.\n## 4. APIs {#apis}\nShared HTTP rules.\n'
	+ '## 5. Components {#components}\n';
const components = '### Composer {#composer}\nServes FR-001. Interface: saveDraft(text).\n'
	+ '### Store {#store}\nServes FR-001 and NFR-001. Interface: putDraft and getDraft.\n';
const general = '## 6. Data models {#data-models}\nDraft storage layout.\n## 7. Events {#events}\nEvent delivery rules.\n'
	+ '## 8. Operational playbook {#operations}\nRunbook.\n## 9. Decisions {#decisions}\nUse local storage.\n';

test('anchored overview topics are not components when the document has a Components group', () => {
	const doc = overview + components + general;
	assert.deepEqual([...architectureComponents(doc).keys()], ['composer', 'store']);
	assert.deepEqual(planningProblems('tree', { requirements, architecture: doc, tree }), []);
	assert.deepEqual(projectVisuals(doc, tree).parts.map(part => part.id), ['composer', 'store']);
	assert.ok(architectureAnchors(doc).has('data-models'), 'Overview anchors are still link destinations');
});

test('real components still need their own interface and requirement IDs', () => {
	const doc = overview + components.replace('Interface: saveDraft(text).', 'Saves drafts.') + general;
	assert.match(documentProblems('architecture', doc).join(' '), /#composer needs requirement links and an interface/);
	assert.match(documentProblems('architecture', overview + components.replace('FR-001. Interface', 'drafts. Interface') + general).join(' '), /#composer/);
	assert.match(documentProblems('architecture', overview + components + general.replace('{#events}', '{#overview}')).join(' '), /anchors must be unique/);
	assert.ok(planningProblems('tree', { requirements, architecture: overview + components.replace('FR-001', 'FR-999') + general, tree })
		.some(problem => problem.reason.includes('unknown requirement FR-999')));
});

test('a component owns its nested interface sections while impact lookup chooses the deepest anchor', () => {
	const doc = overview + '### Composer {#composer}\nOwns FR-001.\n#### API {#composer-api}\nInterface: saveDraft(text).\n' + general;
	assert.deepEqual(documentProblems('architecture', doc), []);
	assert.deepEqual([...architectureComponents(doc).keys()], ['composer']);
	const lines = doc.split('\n');
	assert.equal(sectionAt(lines, lines.findIndex(line => line.includes('saveDraft'))), 'composer-api');
});

test('flat documents may anchor their general topics without making them components', () => {
	const doc = architecture.replace('## Overview and system flow', '## Main system flow {#flow}')
		.replace('## Decisions', '## Decisions {#decisions}');
	assert.deepEqual([...architectureComponents(doc).keys()], ['composer', 'store']);
	assert.deepEqual(documentProblems('architecture', doc), []);
});

test('flat components named Storage or API remain components when they define their contract', () => {
	const doc = architecture.replace('Composer {#composer}', 'API {#api}').replace('Store {#store}', 'Storage {#storage}');
	assert.deepEqual([...architectureComponents(doc).keys()], ['api', 'storage']);
	assert.deepEqual(documentProblems('architecture', doc), []);
});

test('the prompt receives every distinct saved tree section, including entries beyond file-read pages', () => {
	const files = Array.from({ length: 200 }, (_, i) => ({ path: `src/${i}.ts`, section: `#component-${i % 14}` }));
	assert.deepEqual(savedTreeSections(JSON.stringify(files)), Array.from({ length: 14 }, (_, i) => `component-${i}`));
	assert.deepEqual(savedTreeSections('invalid'), []);
});
