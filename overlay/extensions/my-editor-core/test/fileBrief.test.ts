import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileBuildBrief } from '../src/project/fileBrief';

const docs = {
	requirements: '# Requirements\n## Architecture constraints\nKeep every service independent.\n'
		+ '## FR-001 Save drafts\nAcceptance:\n- first\n- second\n- third\n- fourth\n- recover after restart\n'
		+ '## FR-002 Unrelated feature\nUNRELATED_FEATURE_BODY\n## NFR-001 Secrets\nNever log credentials.\n',
	architecture: '# Architecture\n## Store {#store}\nInterface: saveDraft and loadDraft.\n'
		+ '## Other {#other}\nUNRELATED_ARCHITECTURE_BODY\n',
	tree: JSON.stringify({ files: [
		{ path: 'src/draft.ts', role: 'Save a draft.', section: 'store', requirements: ['FR-001'] },
		{ path: 'src/dependency.ts', role: 'Draft storage interface.', section: 'store' },
		{ path: 'unrelated/large.ts', role: 'UNRELATED_TREE_BODY', section: 'other' },
	], buildPlan: { steps: [{ id: 'store', title: 'Draft storage', files: ['src/draft.ts'], tasks: ['Wire storage'], checks: ['Run draft tests'] }] } }),
};

test('one file receives complete linked acceptance criteria, shared constraints and dependency lookup paths', () => {
	const brief = fileBuildBrief(docs, 'src/draft.ts', 'import { save } from "./dependency.js";');
	for (const text of ['recover after restart', 'Never log credentials', 'Keep every service independent',
		'Interface: saveDraft and loadDraft', 'Run draft tests', 'src/dependency.ts']) { assert.ok(brief.includes(text), text); }
	for (const text of ['UNRELATED_FEATURE_BODY', 'UNRELATED_ARCHITECTURE_BODY', 'UNRELATED_TREE_BODY']) {
		assert.ok(!brief.includes(text), text);
	}
	assert.ok(brief.includes('other: lines'), 'Omitted architecture remains discoverable through its source index');
});

test('file briefs refresh from current plans, label missing links and stay bounded', () => {
	assert.match(fileBuildBrief({ ...docs, architecture: docs.architecture.replace('saveDraft', 'persistDraft') }, 'src/draft.ts', ''), /persistDraft/);
	const huge = fileBuildBrief({ ...docs, requirements: '## FR-001 Save\n' + 'long acceptance\n'.repeat(10000) }, 'src/draft.ts', '');
	assert.ok(huge.length < 32500); assert.match(huge, /Excerpt ends/);
	const unplanned = fileBuildBrief({}, 'new/file.py', '');
	assert.match(unplanned, /Unplanned file/); assert.match(unplanned, /No linked requirement text found/);
});

test('legacy requirement lists preserve continuation criteria without including the next feature', () => {
	const brief = fileBuildBrief({ ...docs, requirements: '## Requirements\n- FR-001 Save\n  - reopen\n  - keep all fields\n- FR-002 UNRELATED_FEATURE_BODY\n' }, 'src/draft.ts', '');
	assert.match(brief, /keep all fields/); assert.doesNotMatch(brief, /UNRELATED_FEATURE_BODY/);
});

test('configuration lookup hints prioritize inherited settings and do not list all module tests', () => {
	const paths = ['tsconfig.base.json', 'package.json', 'packages/contracts/package.json', 'packages/contracts/tsconfig.json',
		'packages/contracts/vitest.config.ts', 'packages/contracts/test/events.test.ts', 'services/other/tsconfig.json'];
	const brief = fileBuildBrief({ tree: JSON.stringify({ files: paths.map(path => ({ path, role: 'Own this file', section: 'contracts' })) }) },
		'packages/contracts/tsconfig.json', '{"extends":"../../tsconfig.base.json"}');
	for (const path of ['tsconfig.base.json', 'packages/contracts/package.json', 'packages/contracts/vitest.config.ts']) { assert.ok(brief.includes(path)); }
	assert.doesNotMatch(brief, /events\.test\.ts|services\/other/);
	assert.match(brief, /not a reading checklist/);
	assert.match(brief, /Read a specific source\/test only to resolve a concrete configuration question/);
});
