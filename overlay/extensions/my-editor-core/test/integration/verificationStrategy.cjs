/* A source repair must rebuild the artifact the consumer actually imports and prove the failing test passed. */
const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.run = async ({ write, read, cmd, status, waitState, setResponder, setCadence }) => {
	const lib = 'verification/core', app = 'verification/api', source = `${lib}/index.js`, test = `${app}/route.test.js`;
	const paths = [source, test, `${lib}/build.cjs`, `${lib}/package.json`, `${app}/package.json`];
	const library = { name: 'verification-core', scripts: { build: 'node build.cjs' } };
	const client = { name: 'verification-api', dependencies: { 'verification-core': 'workspace:*' }, scripts: { test: 'node --test route.test.js' } };
	write(`${lib}/package.json`, JSON.stringify(library)); write(`${app}/package.json`, JSON.stringify(client));
	write(`${lib}/build.cjs`, 'const fs = require("node:fs"); const vm = require("node:vm"); const source = fs.readFileSync("index.js", "utf8");\n'
		+ 'new vm.Script(source); fs.mkdirSync("dist", {recursive:true}); fs.writeFileSync("dist/index.js", source);\n');
	write(source, 'exports.invalidStatus = () => 415;\n');
	write(`${lib}/dist/index.js`, 'exports.invalidStatus = () => 400;\n'); // A stale artifact would falsely pass.
	const regression = 'const { test } = require("node:test"); const assert = require("node:assert/strict");\n'
		+ 'test("invalid input returns 400", () => assert.equal(require("../core/dist/index.js").invalidStatus(), 400));\n';
	write(test, regression);
	write('package.json', JSON.stringify({ scripts: { test: 'node --test batch/api.test.js' } }));
	write('.my_editor/specs/tree.json', JSON.stringify({ files: paths.map(path => ({ path, role: 'Verify current compiled behavior', section: 'store', requirements: ['FR-001'], estimatedLines: 20 })),
		buildPlan: { version: 1, entryPoint: source, steps: [{ id: 'verify', title: 'Verification', files: paths,
			dependsOn: [], tasks: ['Reject invalid input'], checks: ['Build dependencies and execute regression'] }] } }));
	let diagnoses = 0, fix = true, reviews = [];
	setCadence('QA everything');
	setResponder(async (kind, name, request) => {
		if (kind === 'Diagnosis') {
			diagnoses++;
			assert.match(request, /invalid input returns 400/);
			assert.equal(read(`${lib}/dist/index.js`), read(source), 'Diagnosis uses a fresh compiled artifact');
			assert.equal(reviews.length, 0, 'Failure is reproduced before broad QA reviews begin');
			return [{ action: 'final', message: 'TEST_REPAIRS\n' + JSON.stringify({ files: [{ path: source,
				reason: 'Observed 415 instead of 400 from the rebuilt dependency. Preserve the regression and return 400.' }] }) }];
		}
		reviews.push(name);
		if (name === source && request.includes('Latest failed checkpoint evidence')) {
			return [{ action: 'tool', name: 'propose_file', arguments: { path: source,
				content: fix ? 'exports.invalidStatus = () => 400;\n' : read(source) + '// inspected again\n' } }];
		}
		return [];
	});
	try {
		await cmd('projectQA.start');
		let state = await waitState('complete');
		assert.equal(diagnoses, 1); assert.equal(state.testRepairs[0].verified, true);
		assert.ok(state.testRepairs[0].changedFiles.includes(source), 'Actual saved repair paths feed affected-package verification');
		assert.ok(state.testRepairs[0].verification.some(check => check.kind === 'build' && check.status === 'passed'));
		assert.ok(state.lastTestCommands.every(check => check.status === 'passed'));
		assert.equal(read(source), read(`${lib}/dist/index.js`)); assert.equal(read(test), regression);
		fix = false; reviews = []; diagnoses = 0; write(source, 'exports.invalidStatus = () => 415;\n');
		await cmd('projectQA.start');
		state = await waitState('checkpoint', state => /same demonstrated failure/.test(state.message));
		assert.equal(diagnoses, 1, 'Changed comments cannot earn another automatic diagnosis');
		assert.deepEqual(reviews, [source], 'A failed repair stops before unrelated QA');
		assert.equal(state.testRepairs[0].verified, false); assert.equal(state.lastTestStatus, 'failed');
		await cmd('projectBuild.pause');
		// Alternating behavioral failures cannot earn more rounds through cosmetic source changes.
		let cycleDiagnoses = 0;
		write(source, 'exports.invalidStatus = () => 415;\n// cycle baseline\n');
		setResponder(async (kind, name, request) => {
			if (kind === 'Diagnosis') {
				cycleDiagnoses++;
				return [{ action: 'final', message: 'TEST_REPAIRS\n' + JSON.stringify({ files: [{ path: source, reason: 'Observed wrong status in regression.' }] }) }];
			}
			if (name === source && request.includes('Latest failed checkpoint evidence')) {
				return [{ action: 'tool', name: 'propose_file', arguments: { path: source,
					content: `exports.invalidStatus = () => ${cycleDiagnoses === 1 ? 401 : 415};\n// cycle ${cycleDiagnoses}\n` } }];
			}
			return [];
		});
		await cmd('projectQA.start');
		state = await waitState('checkpoint', state => /previously repaired failure/.test(state.message));
		assert.equal(cycleDiagnoses, 2); assert.equal(state.lastTestStatus, 'failed');
		assert.equal(read(test), regression); await cmd('projectBuild.pause');
		// Old tests-only consent is not silently upgraded to execute builds.
		const { runCheckpointTest } = require('../../out-test/src/project/filePassTests');
		const token = new vscode.CancellationTokenSource();
		const root = vscode.workspace.workspaceFolders[0].uri;
		const refused = await runCheckpointTest(root, token.token, paths, () => true, () => {}, { checks: false });
		assert.equal(refused.status, 'unverified'); assert.match(refused.message, /not authorized/);
		// A broken build is a failure; consumers cannot report passing against old dist output.
		write(source, 'exports.invalidStatus = ( => 400;\n');
		const broken = await runCheckpointTest(root, token.token, paths, () => true, () => {}, { checks: true });
		assert.equal(broken.status, 'failed');
		assert.ok(broken.commands.some(check => check.directory === app && check.status === 'unverified' && /prerequisite/.test(check.message)));
		write(source, 'exports.invalidStatus = () => 400;\n');
		const buildRepair = await runCheckpointTest(root, token.token, paths, () => true, () => {},
			{ checks: true, focus: { ids: [`${lib}:npm run build`], files: [source] } });
		assert.equal(buildRepair.status, 'passed', 'A focused build repair can pass before the required full suite');
		assert.equal(buildRepair.commands.length, 1);
		const noTests = await runCheckpointTest(root, token.token, [source], () => true, () => {}, { checks: true, selected: true });
		assert.equal(noTests.status, 'unverified', 'Build-only selected scope cannot claim whole-run completion');
		assert.match(noTests.message, /No executable tests/);
		let changed = false;
		const started = vscode.tasks.onDidStartTaskProcess(() => {
			if (!changed) { changed = true; write(`${app}/package.json`, JSON.stringify({ ...client, scripts: { ...client.scripts, typecheck: 'node --check route.test.js' } })); }
		});
		try {
			const stalePlan = await runCheckpointTest(root, token.token, paths, () => true, () => {}, { checks: true });
			assert.equal(stalePlan.status, 'unverified'); assert.match(stalePlan.message, /dependencies changed/);
		} finally { started.dispose(); write(`${app}/package.json`, JSON.stringify(client)); }
		token.dispose();
	} finally {
		write(source, 'exports.invalidStatus = () => 400;\n'); write(`${lib}/dist/index.js`, read(source)); setResponder(undefined);
	}
};
