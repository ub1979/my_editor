import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { planningIntent } from '../src/chat/planningIntent';
import { documentFromReply, lastCodeBlock } from '../src/pair/codeBlock';
import { planningReplyPreview } from '../src/pair/fencedBlocks';
import { architectureComponents, documentProblems, planningError, planningProblems } from '../src/project/planning';
import { sectionAt } from '../src/project/impactSubject';
import { projectVisuals } from '../src/project/visualPlan';
import { requirements, architecture, tree } from './planningFixture';

test('typed planning requests and choice descriptions select their intended document', () => {
	for (const request of ['Regenerate architecture.md', 'Please rewrite the full `architecture.md`',
		'Could you restore architecture.md?', 'Write it now: produce the full architecture.md with our sections.',
		'/architecture Finish it', 'Now fix architecture']) {
		assert.equal(planningIntent(request), 'architecture', request);
	}
	assert.equal(planningIntent('Finalize requirements'), 'requirements');
	assert.equal(planningIntent('Rebuild the file tree'), 'tree');
	for (const request of ['Explain architecture.md', 'Review requirements first', '/chat Regenerate architecture.md',
		'What does regenerate architecture mean?', 'Please do not rewrite architecture.md']) {
		assert.equal(planningIntent(request), undefined, request);
	}
});

test('wrong-document replies cannot replace requirements and errors distinguish saved prerequisites', () => {
	const saved = { requirements, architecture, tree };
	assert.equal(planningError('architecture', saved, architecture), undefined);
	assert.match(planningError('requirements', saved, architecture)!, /contains architecture.*targets requirements.*Use \/architecture/);
	assert.match(planningError('architecture', { requirements: '' }, architecture)!, /Saved requirements:/);
	assert.match(planningError('architecture', saved, architecture.replace('system flow', 'overview'))!, /Proposed architecture:/);
});

test('nested HTML anchors work consistently for validation, project maps and impact lookup', () => {
	const doc = architecture.replace('## Composer {#composer}', '## Components\n<a id="composer"></a>\n### Composer')
		.replace('## Store {#store}', '<a name=\'store\'></a>\n\n### Store');
	assert.deepEqual(planningProblems('tree', { requirements, architecture: doc, tree }), []);
	assert.deepEqual([...architectureComponents(doc).keys()], ['composer', 'store']);
	assert.deepEqual(projectVisuals(doc, tree).parts.map(part => [part.id, part.fileCount]), [['composer', 0], ['store', 2]]);
	const lines = doc.split('\n');
	assert.equal(sectionAt(lines, lines.findIndex(line => line.startsWith('Persists'))), 'store');
	assert.equal(sectionAt(lines, lines.length - 2), undefined, 'Decisions must not inherit the last component');
	assert.match(documentProblems('architecture', doc.replace("name='store'", 'id="composer"')).join(' '), /anchors must be unique/);
});

test('fenced examples cannot manufacture components and adjacent components cannot lend missing interfaces', () => {
	const doc = architecture.replace('Interface: saveDraft(text) and loadDraft(id).', 'Saves drafts.')
		+ '\n```md\n## Example {#example}\nFR-001 Interface: example\n```';
	assert.deepEqual([...architectureComponents(doc).keys()], ['composer', 'store']);
	assert.match(documentProblems('architecture', doc).join(' '), /#composer needs requirement links and an interface/);
});

test('concrete routes, configuration and callable signatures count as component interfaces', () => {
	for (const detail of ['Routes: POST /v1/publish.', 'Config: blocks.config.json sets ports and start commands.',
		'Exports `platformConnectorSuite(makeConnector)` for each connector.', 'An HTTP health server.']) {
		assert.deepEqual(documentProblems('architecture', architecture.replace('Interface: saveDraft(text) and loadDraft(id).', detail)), []);
	}
});

test('complete documents keep embedded code fences and post-document warnings', () => {
	const doc = architecture + '\n```mermaid\ngraph LR\nA --> B\n```';
	for (const fence of ['````', '~~~~']) {
		const reply = 'Ready for Keep.\n' + fence + 'markdown\n' + doc + '\n' + fence + '\nCheck the service configuration before building.';
		const extracted = documentFromReply(reply, 'architecture.md');
		assert.equal(extracted, doc);
		assert.equal(planningReplyPreview(reply, extracted), 'Ready for Keep.\n\nCheck the service configuration before building.');
	}
	assert.equal(documentFromReply(doc, 'architecture.md'), doc);
	assert.equal(planningReplyPreview(doc, doc), doc, 'An internal example is not the whole proposed document');
	assert.equal(documentFromReply('```md\r\n# Requirements\r\n## Goal\r\nDone\r\n```', 'requirements.md'), '# Requirements\r\n## Goal\r\nDone');
});

test('truncated planning fences are rejected instead of preparing partial documents', () => {
	assert.throws(() => documentFromReply('```md\n' + architecture, 'architecture.md'), /unfinished code fence/);
	assert.equal(lastCodeBlock('```js\nconst a = 1;\n'), 'const a = 1;\n', 'Existing streaming code extraction is retained');
});
