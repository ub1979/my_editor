/* Runs inside the projectBuild fixture's real editor and deterministic model server. */
const assert = require('node:assert/strict');
const vscode = require('vscode');
const { stubContent } = require('../../out-test/src/project/stubs');
const { decisionReference, decisionReferences } = require('../../out-test/src/project/decisionReferences');

exports.run = async ({ write, read, cmd, status, waitState, until, setResponder, setAnswer, calls }) => {
	const ids = 'coord/ids.js', tests = 'coord/ids.test.js', main = 'coord/app/main.js', migration = 'coord/002_ids.sql';
	const routes = 'coord/app/routes.js';
	const companion = 'coord/app/main.test.js';
	const lateTest = 'coord/app/late.test.js';
	const qaMigration = 'coord/003_regression.sql';
	const originalWarning = vscode.window.showWarningMessage;
	let approveScope = false, scopePrompts = 0;
	vscode.window.showWarningMessage = (message, ...args) => {
		if (message === 'Add supporting files to this repair run?') {
			scopePrompts++; assert.ok(args[0].detail.includes(migration) || args[0].detail.includes(qaMigration));
			return Promise.resolve(approveScope ? 'Add files and continue' : undefined);
		}
		return originalWarning(message, ...args);
	};
	const answer = 'Use integer IDs for drafts and attempts.';
	const planDecision = 'Verify every supporting regression.\nWhy: protect the agreed interface.';
	write('.my_editor/specs/architecture.md', read('.my_editor/specs/architecture.md')
		+ '\n- **Verify every supporting regression.**\n- Why: protect the agreed\n  interface.\n');
	const sectionDecision = decisionReferences({ architecture: read('.my_editor/specs/architecture.md') })
		.find(entry => entry.quote.includes('Verify every supporting regression.'));
	assert.ok(sectionDecision);
	const files = [ids, tests, main, routes].map(path => ({ path, role: 'Coordinate integer IDs', section: 'store', requirements: ['FR-001'], estimatedLines: 20, status: 'stub' }));
	write('.my_editor/specs/tree.json', JSON.stringify({ files, buildPlan: { version: 1, entryPoint: main, steps: [
		{ id: 'storage', title: 'Storage', files: [ids, tests], dependsOn: [], tasks: ['Provide IDs'], checks: ['Run npm test'] },
		{ id: 'app', title: 'App', files: [main, routes], dependsOn: ['storage'], tasks: ['Publish the ID'], checks: ['Run npm test'] },
	] } }));
	write(ids, 'exports.id = "uuid-old";\n');
	write(tests, 'const {test} = require("node:test"); const assert = require("node:assert/strict");\ntest("ID", () => assert.equal(typeof require("./ids").id, "string"));\n');
	write(main, stubContent(files[2]));
	write(routes, stubContent(files[3]));
	write('coord/001_existing.sql', 'CREATE TABLE existing_state (id INTEGER PRIMARY KEY);\n');
	write('package.json', JSON.stringify({ scripts: { test: 'node --test coord/ids.test.js' } }));
	const final = message => ({ action: 'final', message });
	const propose = (path, content) => ({ action: 'tool', name: 'propose_file', arguments: { path, content } });
	let release, held = false, citationRejected = false, citationCorrected = false;
	setResponder(async (kind, name, request) => {
		if (kind === 'QA') {
			if (name === qaMigration) { return [propose(qaMigration, 'CREATE INDEX ids_lookup ON ids(id);\n')]; }
			if ([ids, tests, main, migration, routes].includes(name)) { assert.ok(request.includes(answer), 'QA must retain the developer decision after repairs finish'); }
			if (name === companion) { return [
				propose(companion, 'const {test} = require("node:test"); const assert = require("node:assert/strict");\ntest("publish", () => assert.equal(require("./main").publish(), 42));\n'),
				propose(lateTest, 'exports.checked = false;\n'),
			]; }
			if (name === routes && read(lateTest).includes('false')) {
				return [final('BLOCKED\nREPAIRS_REQUIRED ' + JSON.stringify({ files: [
					{ path: lateTest, reason: 'Repair an existing companion test created after QA discovery.' },
					{ path: qaMigration, reason: 'Add the approved supporting migration beside both planned and QA-discovered migrations.' },
				], decision: { source: 'developer', quote: answer } }))];
			}
			if (name === routes && !read(lateTest).includes('verified')) {
				if (citationRejected) {
					assert.match(request, /Repair citation rejected/);
					assert.match(request, /not an approved decision/);
					citationCorrected = true;
				}
				const source = citationRejected ? 'architecture' : 'requirements';
				citationRejected = true;
				return [final('BLOCKED\nREPAIRS_REQUIRED ' + JSON.stringify({ files: [
					{ path: lateTest, reason: 'Address a separate regression in the same supporting test.' },
				], decision: source === 'architecture'
					? { source, reference: sectionDecision.reference, quote: 'Verify every supporting regression.' }
					: { source, quote: planDecision } }))];
			}
			if (name === lateTest) { return [propose(lateTest, read(lateTest).includes('false')
				? 'exports.checked = true;\n' : 'exports.checked = true;\nexports.verified = true;\n')]; }
			if (name === main) {
				try { read(companion); } catch {
					return [final('BLOCKED\nREPAIRS_REQUIRED ' + JSON.stringify({ files: [
						{ path: companion, reason: 'Verify the repaired public interface.' },
					], decision: { source: 'developer', quote: answer } }))];
				}
			}
			return [];
		}
		if (name === main && !request.includes(answer)) {
			return [final('BLOCKED\nEvidence: .my_editor/specs/requirements.md describes drafts; .my_editor/specs/architecture.md describes storage.\n'
				+ 'Missing or conflicting: ID representation is unspecified.\nRecommendation: Use integers to match the shared contracts.\nOptions:\n'
				+ '1. Integers: align contracts, update storage.\n2. Strings: retain storage, update contracts.\nQuestion: Which ID representation should be used?')];
		}
		if (name === main && read(ids).includes('uuid-old')) {
			assert.ok(request.includes(decisionReference('developer', answer)), 'The worker receives a reusable approved decision reference');
			return [final('BLOCKED\nREPAIRS_REQUIRED ' + JSON.stringify({ files: [
				{ path: migration, reason: 'Preserve existing data with a forward migration.' },
				{ path: ids, reason: 'Use the approved integer ID.' }, { path: tests, reason: 'Test integer ID behavior.' },
				{ path: routes, reason: 'Expose the integer-ID service.' },
			], decision: { source: 'developer', reference: decisionReference('developer', answer) } }))];
		}
		if (name === migration) { return [propose(migration, 'CREATE TABLE ids (id INTEGER PRIMARY KEY);\n')]; }
		if (name === routes) {
			if (read(main) === stubContent(files[2])) { return [final('BLOCKED\nDEPENDENCIES_REQUIRED ' + JSON.stringify([main]))]; }
			return [propose(routes, 'exports.route = require("./main").publish;\n')];
		}
		if (name === ids) {
			assert.match(request, /Coordinated repair/); assert.ok(request.includes(answer));
			if (!held) { held = true; await new Promise(resolve => { release = resolve; }); }
			return [propose(ids, 'exports.id = 42;\n')];
		}
		if (name === tests) {
			assert.match(request, /Coordinated repair/); assert.ok(request.includes(answer));
			return [propose(tests, 'const {test} = require("node:test"); const assert = require("node:assert/strict");\ntest("ID", () => assert.equal(require("./ids").id, 42));\n')];
		}
		return [propose(main, 'exports.publish = () => require("../ids").id;\n')];
	});
	try {
		await cmd('projectBuild.start'); await waitState('error', state => state.needsAnswer);
		setAnswer(answer); const before = calls.length;
		await cmd('projectBuild.answer'); await waitState('paused');
		assert.throws(() => read(migration), /ENOENT/, 'Declining scope must not create the new migration');
		assert.equal((await status()).total, 4);
		approveScope = true; await cmd('projectBuild.resume'); await until(() => release, 'Repair did not revisit the completed source');
		let state = await status();
		assert.deepEqual(state.repairQueue.map(item => item.path), [ids, tests, routes]);
		assert.equal(state.results.length, 3, 'Completed file counts remain unique during repair');
		assert.equal(state.total, 5); assert.equal(state.repairAdditions[0].path, migration);
		await cmd('projectBuild.pause'); release(); release = undefined;
		assert.match(read(ids), /uuid-old/, 'A late cancelled repair must not write');
		await cmd('projectBuild.resume'); state = await waitState('complete');
		assert.deepEqual(calls.slice(before).filter(call => call.kind === 'Build').map(call => call.name), [main, main, migration, ids, ids, tests, routes, main, routes]);
		assert.equal(read(ids), 'exports.id = 42;\n'); assert.equal(state.lastTestStatus, 'passed');
		assert.equal(state.repairQueue.length, 0); assert.equal(state.repairHistory.length, 4);
		assert.equal(new Set(state.buildResults.map(result => result.path)).size, 5);
		assert.equal(state.buildResults.length, 5); assert.ok(read(main).includes('require("../ids")'));
		assert.deepEqual(state.repairDependencyRequests, [{ path: routes, dependencies: [main] }]);
		assert.equal(state.phase, 'qa', 'A repair that finishes the build must still trigger tests and QA');
		assert.equal(scopePrompts, 3, 'One cancelled, one accepted build addition and one explicit QA migration review');
		assert.match(read(qaMigration), /CREATE INDEX/);
		assert.ok(state.modules.find(group => group.title === 'Storage').files.includes(qaMigration), 'The saved-plan owner retains the new migration');
		assert.ok(state.results.some(result => result.path === migration), 'QA includes the approved supporting migration');
		assert.ok(state.results.some(result => result.path === companion), 'QA builds supporting tests under existing companion-test approval');
		assert.match(read(companion), /assert.equal/);
		assert.equal(read(lateTest), 'exports.checked = true;\nexports.verified = true;\n');
		assert.ok(citationCorrected, 'A wrong saved-plan source receives one correction attempt before queueing');
		assert.equal(state.repairHistory.at(-1).decision.quote, sectionDecision.quote, 'A referenced excerpt retains the full section through worker and controller');
		assert.equal(state.results.filter(result => result.path === lateTest).length, 1, 'Late companion repair joins QA exactly once');
		assert.match(read(state.reportPath), /Coordinated repairs/);
		assert.deepEqual(JSON.parse(read('.my_editor/specs/tree.json')).buildPlan.steps[0].files, [ids, tests]);
	} finally { release?.(); setResponder(undefined); vscode.window.showWarningMessage = originalWarning; }
};
