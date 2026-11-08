import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { queueRepairs, requestedRepairs, repairContext, RepairRequest } from '../src/project/filePassRepairs';

const answer = 'Use integer IDs for drafts and attempts.';
const request: RepairRequest = { files: [{ path: 'db.ts', reason: 'Use the approved integer IDs.' }, { path: 'db.test.ts', reason: 'Assert integer IDs.' }],
	decision: { source: 'developer', quote: answer } };
const modules = [{ title: 'Storage', files: ['db.ts', 'db.test.ts'] }, { title: 'App', files: ['main.ts'] }];
const planned = modules.flatMap(group => group.files);

test('repair routing revisits existing planned files across modules and carries the developer decision', () => {
	const queue = queueRepairs('main.ts', request, modules, planned, [answer], {}, [], []);
	assert.deepEqual(queue.map(item => item.path), ['db.ts', 'db.test.ts']);
	assert.equal(queue[0].origin, 'main.ts');
	assert.match(repairContext(queue[0], queue), /Use integer IDs/);
	assert.match(repairContext(queue[0], queue), /already contains code/);
});

test('repairs cannot expand scope, invent consent, or use generated code as authorization', () => {
	assert.throws(() => queueRepairs('main.ts', request, modules.slice(1), planned, [answer], {}, [], []), /outside/);
	assert.throws(() => queueRepairs('main.ts', request, modules, ['main.ts'], [answer], {}, [], []), /outside/);
	assert.throws(() => queueRepairs('main.ts', request, modules, planned, ['Do not use integer IDs.'], {}, [], []), /decision/);
	const documented = { ...request, decision: { source: 'architecture' as const, quote: answer } };
	assert.throws(() => queueRepairs('main.ts', documented, modules, planned, [], {}, [], []), /decision/);
	assert.equal(queueRepairs('main.ts', documented, modules, planned, [], { architecture: answer }, [], []).length, 2);
});

test('repair requests reject unsafe paths and malformed or excessive file lists', () => {
	assert.equal(requestedRepairs('BLOCKED\nWhich ID type?'), undefined);
	assert.deepEqual(requestedRepairs('BLOCKED\nREPAIRS_REQUIRED ' + JSON.stringify(request)), request);
	for (const path of ['../outside.ts', '.env', '.my_editor/specs/architecture.md']) {
		assert.throws(() => requestedRepairs('BLOCKED\nREPAIRS_REQUIRED ' + JSON.stringify({ ...request, files: [{ path, reason: 'change' }] })));
	}
	for (const value of [null, {}, { ...request, files: [] }, { ...request, files: [request.files[0], request.files[0]] }]) {
		assert.throws(() => requestedRepairs('BLOCKED\nREPAIRS_REQUIRED ' + JSON.stringify(value)));
	}
});

test('saved-plan decisions accept rendered bold text without changing words or developer consent', () => {
	const quote = 'Per-block pause flag with a manual Resume. Why: no silent retries.';
	const documented = { ...request, decision: { source: 'architecture' as const, quote } };
	const docs = { architecture: '- **Per-block pause flag with a manual Resume.** Why: no silent retries.' };
	assert.equal(queueRepairs('main.ts', documented, modules, planned, [], docs, [], []).length, 2);
	const changed = { ...documented, decision: { ...documented.decision, quote: quote.replace('no silent', 'silent') } };
	assert.throws(() => queueRepairs('main.ts', changed, modules, planned, [], docs, [], []), /decision/);
	assert.throws(() => queueRepairs('main.ts', documented, modules, planned, [], { architecture: docs.architecture.replace('no silent', 'silent') }, [], []), /decision/);
	assert.throws(() => queueRepairs('main.ts', { ...documented, decision: { source: 'developer', quote } }, modules, planned, [docs.architecture], docs, [], []), /decision/);
});

test('saved-plan list quotations preserve adjacent words, negation and order across wrapping', () => {
	const quote = 'Every AI draft is never published automatically.\nYou can edit or discard each draft.';
	const documented = { ...request, decision: { source: 'requirements' as const, quote } };
	const docs = { requirements: '- Every AI draft is never published\n  automatically.\n- You can edit or discard each draft.' };
	assert.equal(queueRepairs('main.ts', documented, modules, planned, [], docs, [], []).length, 2);
	for (const bad of [quote.replace('never ', ''), quote.split('\n').reverse().join('\n'), quote.replace('edit or ', '')]) {
		assert.throws(() => queueRepairs('main.ts', { ...documented, decision: { ...documented.decision, quote: bad } }, modules, planned, [], docs, [], []), /decision/);
	}
	const separated = { requirements: docs.requirements.replace('\n- You', '\n- Only with explicit approval.\n- You') };
	assert.throws(() => queueRepairs('main.ts', documented, modules, planned, [], separated, [], []), /decision/);
});

test('repeated, circular and duplicate pending repairs are bounded instead of looping', () => {
	const history = [{ origin: 'main.ts', ...request }];
	assert.throws(() => queueRepairs('main.ts', request, modules, planned, [answer], {}, [], history), /again/);
	const reverse = { ...request, files: [{ path: 'main.ts', reason: 'Reverse dependency' }] };
	assert.throws(() => queueRepairs('db.ts', reverse, modules, planned, [answer], {}, [], history), /cycle/);
	const queue = queueRepairs('main.ts', request, modules, planned, [answer], {}, [], []);
	assert.throws(() => queueRepairs('main.ts', request, modules, planned, [answer], {}, queue, []), /already/);
});

test('distinct defects may revisit a dependency but repeated reasons and reworded loops remain bounded', () => {
	const history = [{ origin: 'main.ts', ...request }];
	const next = { ...request, files: [{ path: 'db.ts', reason: 'Complete the asynchronous request lifecycle.' }] };
	assert.equal(queueRepairs('main.ts', next, modules, planned, [answer], {}, [], history).length, 1);
	const repeated = { ...next, files: [{ path: 'db.ts', reason: '  USE the approved\ninteger IDs. ' }] };
	assert.throws(() => queueRepairs('main.ts', repeated, modules, planned, [answer], {}, [], history), /again/);
	const twice = [...history, { origin: 'main.ts', ...next }];
	const third = { ...next, files: [{ path: 'db.ts', reason: 'Retain the request identifier.' }] };
	assert.equal(queueRepairs('main.ts', third, modules, planned, [answer], {}, [], twice).length, 1);
	const fourth = { ...next, files: [{ path: 'db.ts', reason: 'Another reworded repair.' }] };
	assert.throws(() => queueRepairs('main.ts', fourth, modules, planned, [answer], {}, [], [...twice, { origin: 'main.ts', ...third }]), /limit/);
	assert.throws(() => queueRepairs('main.ts', next, modules, planned, [answer], {}, [], Array(100).fill({ origin: 'other.ts', ...request })), /limit/);
});
