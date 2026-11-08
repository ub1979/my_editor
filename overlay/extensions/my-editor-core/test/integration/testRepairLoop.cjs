/* Real saved source, a real failing process, model-directed repairs and a real passing rerun. */
const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.run = async ({ write, read, cmd, status, waitState, setResponder, setCadence }) => {
	const source = 'repair-loop/service.js', test = 'repair-loop/service.test.js';
	const late = 'repair-loop/late.test.js';
	const paths = [source, test];
	write('.my_editor/specs/tree.json', JSON.stringify({ files: paths.map(path => ({ path, role: 'Preserve a reason', section: 'store', requirements: ['FR-001'], estimatedLines: 20 })),
		buildPlan: { version: 1, entryPoint: source, steps: [{ id: 'service', title: 'Service', files: paths,
			dependsOn: [], tasks: ['Preserve the complete reason'], checks: ['Run the regression test'] }] } }));
	const regression = 'const {test} = require("node:test"); const assert = require("node:assert/strict");\n'
		+ 'test("preserve long reason", () => assert.equal(require("./service").reason("complete reason"), "complete reason"));\n';
	const existingRegression = regression.replace('preserve long reason', 'preserve short reason').replaceAll('complete reason', 'com');
	write(source, 'exports.reason = value => value.slice(0, 3);\n'); write(test, existingRegression);
	write('repair-loop/package.json', JSON.stringify({ scripts: { test: 'node --test *.test.js' } }));
	write('package.json', JSON.stringify({ scripts: { test: 'node --test batch/api.test.js' } }));
	let diagnoses = 0, fix = true;
	setCadence('QA everything');
	setResponder(async (kind, name, request) => {
		if (kind === 'Diagnosis') {
			diagnoses++;
			assert.ok(request.includes(late), 'Late companion tests are present in the authorized diagnosis scope');
			const saved = await status();
			assert.equal(saved.lastTestStatus, 'failed');
			assert.ok(saved.lastTestCommands.length > 1, 'Command evidence is available before diagnosis completes');
			assert.match(request, /preserve long reason/);
			assert.match(request, /Test output: \.my_editor\/test-runs\//);
			assert.match(request, /do not delete assertions/i);
			assert.match(request, /Select 1–20 unique existing run files/);
			if (diagnoses === 1) {
				return [{ action: 'final', message: 'TEST_REPAIRS\n' + JSON.stringify({ files: Array.from({ length: 21 }, () => ({ path: source, reason: 'Observed truncation.' })) }) }];
			}
			if (diagnoses === 2) { assert.match(request, /previous TEST_REPAIRS response was rejected:.*received 21/); }
			return [{ action: 'final', message: 'TEST_REPAIRS\n' + JSON.stringify({ files: [...paths, late].map(path => ({ path,
				reason: 'Actual assertion shows truncation to com instead of complete reason. Preserve the full input and regression.' })) }) }];
		}
		if (name === test) {
			try { read(late); } catch {
				return [{ action: 'tool', name: 'propose_file', arguments: { path: late, content: regression } }];
			}
		}
		if (request.includes('Latest failed checkpoint evidence') && name === source && fix) {
			assert.match(request, /Fresh dependency evidence/);
			assert.ok(request.includes(existingRegression.trim()), 'Current regression source is automatically available to the repair worker');
			return [{ action: 'tool', name: 'propose_file', arguments: { path: source, content: 'exports.reason = value => value;\n' } }];
		}
		return [];
	});
	try {
		await cmd('projectQA.start'); assert.equal((await status()).options.kind, 'QA');
		let state = await waitState('complete');
		assert.equal(diagnoses, 2); assert.equal(state.testRepairs.length, 1);
		assert.equal(state.lastTestStatus, 'passed'); assert.match(state.testHistory.join('\n'), /exited with code 1/);
		assert.ok(state.lastTestCommands.length > 1, 'The final checkpoint retains structured evidence from multiple commands');
		assert.ok(state.testRepairEvidence.includes('failed: npm test · repair-loop'));
		assert.ok(state.testHistory.some(entry => entry.includes('npm test exited with code 0')), 'Full checkpoints retain later passing commands separately from focused failure evidence');
		assert.match(state.lastTest, /exited with code 0/); assert.match(state.lastTest, /Runner summary/);
		assert.equal(read(source), 'exports.reason = value => value;\n'); assert.equal(read(test), existingRegression);
		assert.equal(new Set(state.results.map(row => row.path)).size, state.total);
		assert.equal(state.results.filter(row => row.path === late).length, 1, 'Late tests are reviewed exactly once in the repaired queue');
		assert.match(read(state.reportPath), /Test-driven repair rounds/);
		// Repeating summaries without a source change cannot spin or become success.
		fix = false; write(source, 'exports.reason = value => value.slice(0, 3);\n');
		await cmd('projectQA.start'); state = await waitState('checkpoint', state => /No source progress|same demonstrated failure/.test(state.message));
		assert.equal(state.lastTestStatus, 'failed'); assert.equal(state.testRepairs.length, 1); assert.equal(diagnoses, 3);
		await cmd('projectBuild.pause');
		// A malformed response cannot retry indefinitely or schedule unauthorized repairs.
		let invalidCalls = 0;
		setResponder(async kind => kind === 'Diagnosis' ? (++invalidCalls, [{ action: 'final', message: 'TEST_REPAIRS\n{"files":[{"path":"outside.js","reason":"Unsupported target"}]}' }]) : []);
		await cmd('projectQA.start'); state = await waitState('checkpoint', state => /unauthorized file/.test(state.message));
		assert.equal(invalidCalls, 2); assert.equal(state.lastTestStatus, 'failed'); assert.equal(state.testRepairs?.length ?? 0, 0);
		await cmd('projectBuild.pause');
		// Prose-only replies get one correction, never an unlimited retry.
		let proseCalls = 0;
		setResponder(async kind => kind === 'Diagnosis' ? (++proseCalls, [{ action: 'final', message: 'I inspected the failure.' }]) : []);
		await cmd('projectQA.start'); state = await waitState('checkpoint', state => /actionable repair set/.test(state.message));
		assert.equal(proseCalls, 2); assert.equal(state.lastTestStatus, 'failed');
		assert.equal(state.testRepairs?.length ?? 0, 0); await cmd('projectBuild.pause');
		// Genuine unresolved decisions stop immediately, without a correction request.
		let blockedCalls = 0;
		setResponder(async kind => kind === 'Diagnosis' ? (++blockedCalls, [{ action: 'final', message: 'BLOCKED: required environment is unavailable.' }]) : []);
		await cmd('projectQA.start'); state = await waitState('checkpoint', state => /required environment/.test(state.message));
		assert.equal(blockedCalls, 1); assert.equal(state.lastTestStatus, 'failed');
		await cmd('projectBuild.pause');
		// A dependency modified during generation invalidates an otherwise valid proposal.
		write('repair-loop/dependency.js', 'exports.value = 1;\n');
		write(source, 'exports.reason = value => value + require("./dependency").value;\n');
		setResponder(async (kind, name, request) => {
			assert.ok(request.includes('exports.value = 1;'), 'Source dependency loaded before model invocation');
			write('repair-loop/dependency.js', 'exports.value = 2;\n');
			return [{ action: 'tool', name: 'propose_file', arguments: { path: source, content: 'exports.reason = value => value;\n' } }];
		});
		await cmd('projectQA.file', vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, source));
		state = await waitState('error'); assert.match(state.message, /changed after dependency context/);
		assert.match(read(source), /require/); assert.equal(state.pending.length, 0);
	} finally { setResponder(undefined); }
};
