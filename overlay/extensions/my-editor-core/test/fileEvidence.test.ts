import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { gatherFileEvidence } from '../src/project/fileEvidence';

test('context follows current imports, workspace exports, transitive contracts, caller leads and regression tests', async () => {
	const sources: Record<string, string> = {
		'package.json': '{"name":"app"}',
		'packages/contracts/package.json': '{"name":"@app/contracts","exports":{"./http":{"types":"./src/http.ts"}}}',
		'packages/contracts/src/http.ts': 'export { Reason } from "./events.js";',
		'packages/contracts/src/events.ts': 'export type Reason = string;',
		'src/service.ts': 'export const send = (reason: string) => reason;',
		'src/notify.test.ts': 'test("long reasons are preserved", () => {});',
		'src/caller.ts': 'import { notify } from "./notify.js";',
		'unrelated.ts': 'DO_NOT_LOAD_UNRELATED_SOURCE',
	};
	const evidence = await gatherFileEvidence('src/notify.ts', 'import { Reason } from "@app/contracts/http";\nimport { send } from "./service.js";',
		new Set(Object.keys(sources)), ['src/caller.ts'], async path => ({ source: sources[path], hash: 'fresh-' + path }));
	for (const name of ['events.ts', 'http.ts', 'service.ts', 'caller.ts', 'notify.test.ts', 'package.json']) { assert.ok(evidence.text.includes(name), name); }
	assert.match(evidence.text, /Reason = string/);
	assert.doesNotMatch(evidence.text, /DO_NOT_LOAD_UNRELATED_SOURCE/);
	assert.equal(evidence.snapshots['packages/contracts/src/events.ts'], 'fresh-packages/contracts/src/events.ts');
});

test('context labels missing and omitted sources and does not claim excerpts are complete', async () => {
	const sources: Record<string, string> = { 'src/large.ts': 'export const value = 1;\n'.repeat(1000), 'src/other.ts': 'extra' };
	const evidence = await gatherFileEvidence('src/main.ts', 'import "./missing"; import "./large";', new Set(Object.keys(sources)),
		['src/large.ts', 'src/other.ts'], async path => ({ source: sources[path], hash: path }), 600);
	assert.match(evidence.text, /EXCERPT/); assert.match(evidence.text, /imports \.\/missing/);
	assert.match(evidence.text, /Additional lookup paths/); assert.ok(evidence.text.length < 2400);
	assert.equal(evidence.snapshots['src/other.ts'], undefined);
});

test('each bundle rereads current dependency bodies rather than trusting old brain descriptions', async () => {
	let version = 'old';
	const collect = () => gatherFileEvidence('main.ts', 'import "./dependency";', new Set(['dependency.ts']), [],
		async () => ({ source: version, hash: version }));
	assert.match((await collect()).text, /old/);
	version = 'new contract'; const latest = await collect();
	assert.match(latest.text, /new contract/); assert.equal(latest.snapshots['dependency.ts'], version);
});

test('workspace wildcard exports resolve and unrelated same-named tests do not consume context', async () => {
	const sources: Record<string, string> = {
		'app/package.json': '{"name":"app"}', 'other/package.json': '{"name":"other"}',
		'contracts/package.json': '{"name":"@app/contracts","exports":{"./http/*":"./src/http/*.ts"}}',
		'contracts/src/http/reason.ts': 'export type Reason = string;',
		'app/service.test.ts': 'OWNING_PACKAGE_REGRESSION', 'other/service.test.ts': 'UNRELATED_PACKAGE_REGRESSION',
	};
	const evidence = await gatherFileEvidence('app/service.ts', 'import { Reason } from "@app/contracts/http/reason";',
		new Set(Object.keys(sources)), [], async path => ({ source: sources[path], hash: path }));
	assert.match(evidence.text, /Reason = string/); assert.match(evidence.text, /OWNING_PACKAGE_REGRESSION/);
	assert.doesNotMatch(evidence.text, /UNRELATED_PACKAGE_REGRESSION/);
});

test('a package with only subpath exports does not invent a root public contract', async () => {
	const sources: Record<string, string> = { 'pkg/package.json': '{"name":"@app/pkg","exports":{"./feature":"./feature.ts"}}',
		'pkg/feature.ts': 'NOT_A_ROOT_EXPORT' };
	const evidence = await gatherFileEvidence('main.ts', 'import { feature } from "@app/pkg";', new Set(Object.keys(sources)), [],
		async path => ({ source: sources[path], hash: path }));
	assert.match(evidence.text, /Unresolved source links/); assert.doesNotMatch(evidence.text, /NOT_A_ROOT_EXPORT/);
});
