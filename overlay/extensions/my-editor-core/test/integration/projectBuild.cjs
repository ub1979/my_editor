/* Exercise the public commands in a real editor with a deterministic model and actual Node tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');
const { stubContent } = require('../../out-test/src/project/stubs');
const { requirements, architecture } = require('../../out-test/test/planningFixture');

async function until(check, message) {
	// The OpenCode variant starts a private native process for each file turn.
	const budget = Number(process.env.MY_EDITOR_FIXTURE_TIMEOUT_MS || (process.env.MY_EDITOR_INTEGRATION_SUITE === 'openCode' ? 120000 : 30000));
	assert.ok(Number.isInteger(budget) && budget >= 30000 && budget <= 300000, 'Invalid bounded fixture timeout');
	const deadline = Date.now() + budget;
	while (Date.now() < deadline) {
		const value = await check(); if (value) { return value; }
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	throw Error(message + '\nVisible editors: ' + vscode.window.visibleTextEditors.map(editor => editor.document.uri.fsPath).join(', ')
		+ '\nTabs: ' + JSON.stringify(vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => ({ label: tab.label, active: tab.isActive }))));
}

exports.run = async function () {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const uri = name => vscode.Uri.file(path.join(root, name));
	const write = (name, text) => { fs.mkdirSync(path.dirname(uri(name).fsPath), { recursive: true }); fs.writeFileSync(uri(name).fsPath, text); };
	const read = name => fs.readFileSync(uri(name).fsPath, 'utf8');
	const cmd = (name, ...args) => vscode.commands.executeCommand('myEditor.' + name, ...args);
	const status = () => cmd('projectBuild.status');
	const calls = [], pickTitles = [], rejections = [], chatStates = [];
	const originalPanel = vscode.window.createWebviewPanel;
	const originalProvider = vscode.window.registerWebviewViewProvider;
	let sidebar, fileSidebar, chatHost;
	vscode.window.registerWebviewViewProvider = (id, provider, options) => {
		if (id === 'myEditor.chat' || id === 'myEditor.fileChat') {
			if (id === 'myEditor.chat') { chatHost = provider; }
			const resolve = provider.resolveWebviewView.bind(provider);
			provider.resolveWebviewView = view => {
				if (id === 'myEditor.chat') {
					sidebar = view;
					const post = view.webview.postMessage.bind(view.webview);
					view.webview.postMessage = message => { chatStates.push(structuredClone(message)); return post(message); };
				} else { fileSidebar = view; }
				return resolve(view);
			};
		}
		return originalProvider(id, provider, options);
	};
	vscode.window.createWebviewPanel = (...args) => {
		const panel = originalPanel(...args);
		const post = panel.webview.postMessage.bind(panel.webview);
		panel.webview.postMessage = message => { chatStates.push(structuredClone(message)); return post(message); };
		return panel;
	};
	const store = 'lib/store.js', test = 'test/store.test.js', main = 'src/main.js';
	const files = [store, test, main].map(name => ({ path: name, role: 'Own ' + name, section: 'store',
		requirements: ['FR-001'], estimatedLines: 40, status: 'stub' }));
	const buildPlan = { version: 1, entryPoint: main, steps: [
		{ id: 'store', title: 'Store', files: [store, test], dependsOn: [], tasks: ['Implement and test the store.'], checks: ['Run npm test.'] },
		{ id: 'app', title: 'App', files: [main], dependsOn: ['store'], tasks: ['Wire the store.'], checks: ['Run startup.'] },
	] };
	const code = {
		[store]: 'const fixture = { value: "tok123" }; const data = { token: fixture.value };\n'
			+ 'exports.save = value => { if (!value) throw Error("Empty"); return value; };\n',
		[test]: 'const { test } = require("node:test");\nconst assert = require("node:assert/strict");\nconst { save } = require("../lib/store");\n'
			+ 'test("save draft", () => assert.equal(save("draft"), "draft"));\ntest("reject empty", () => assert.throws(() => save(""), /Empty/));\n',
		[main]: 'console.log(require("../lib/store").save("draft"));\n',
	};
	let phase = 'normal', cadence = 'One module at a time', auto = true, queued = [], release, largerBatchObserved = false, cancelTests = false;
	let allowTests = false, allowTestPrompt = false, companionPrefix = 'auto', resumeSaved = false, releaseTest;
	let unattended = false, approveUnattended = true, repairResponder, answerText = 'Use the existing local contract.', batchSize = 1;
	const checkpointSnapshots = [];
	const batchPaths = [store, test, main, 'extra.py', 'package.json', '.my_editor/specs/architecture.md'];
	const originalPick = vscode.window.showQuickPick, originalInput = vscode.window.showInputBox, originalInfo = vscode.window.showInformationMessage;
	const permissionRequests = [];
	vscode.window.showQuickPick = async (choices, options) => {
		pickTitles.push(options?.title);
		if (options?.title === 'Build speed') { return choices.find(item => item.size === batchSize); }
		if (options?.title === 'Authorize unattended run') { return approveUnattended ? choices[0] : undefined; }
		if (options?.title === 'An unfinished run already exists') { return resumeSaved ? 'Resume saved run' : 'Start a new run'; }
		if (options?.title === 'Saving permissions for this run') { return choices.find(item => item.automatic === auto && (item.companionTests === 'automatic') === allowTests && item.unattended === unattended); }
		if (options?.title === 'Build or QA run model') {
			return phase === 'cancelModel' ? undefined : choices.find(item => item.key === 'ollama:queue-alt');
		}
		if (options?.title?.startsWith('Run a test')) {
			checkpointSnapshots.push(await status());
			if (phase === 'holdBuildTest') { await new Promise(resolve => { releaseTest = resolve; }); return undefined; }
			if (cancelTests) { return undefined; }
			return choices.find(item => item.label === (phase === 'scopedTest' ? 'npm test · modules/example' : 'Run all required checks'))
				?? choices.find(item => item.label === 'npm test');
		}
		if (options?.placeHolder?.startsWith('Choose how much')) { return choices.find(item => item.label === cadence); }
		if (options?.placeHolder?.includes('apply changes')) { return choices.find(item => item.automatic === auto && (item.companionTests === 'automatic') === allowTests && item.unattended === unattended); }
		return undefined;
	};
	vscode.window.showInputBox = async options => options.title.startsWith('Clarify') ? answerText : 'Implement the dedicated helper.';
	vscode.window.showInformationMessage = (message, ...args) => {
		if (message.startsWith('Review a new test')) { permissionRequests.push(args[0].detail); return Promise.resolve(allowTestPrompt ? 'Allow tests for this run' : 'Review test'); }
		return originalInfo(message, ...args);
	};
	const propose = (name, content) => ({ action: 'tool', name: 'propose_file', arguments: { path: name, content } });
	const final = note => ({ action: 'final', message: 'FILE_REVIEWED\n' + note });
	const designQuestion = question => ({ action: 'final', message: 'BLOCKED\n'
		+ 'Evidence: .my_editor/specs/requirements.md lists draft behavior; .my_editor/specs/architecture.md describes the store interface.\n'
		+ 'Missing or conflicting: The requested external contract is not specified in either saved document.\n'
		+ 'Recommendation: Use the existing local contract to preserve callers.\nOptions:\n'
		+ '1. Keep the local contract: fewer changes, but no new external integration.\n'
		+ '2. Define a new external contract: supports the integration, but requires adapters and tests.\nQuestion: ' + question });

	let fixtureError;
	const server = http.createServer(async (req, res) => {
		try {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'queue' }, { name: 'queue-alt' }] })); return; }
		let body = ''; for await (const chunk of req) { body += chunk; }
		const payload = JSON.parse(body), messages = payload.messages;
		if (!messages.some(m => m.role === 'assistant')) {
			const request = messages.find(m => m.role === 'user').content;
			const match = /Implement the requested (Build|QA) pass for "([^"]+)"/.exec(request);
			if (!match) {
				const diagnostic = repairResponder && request.includes('Diagnose failed checkpoint tests')
					? (await repairResponder('Diagnosis', '', request))[0] : undefined;
				res.end(JSON.stringify({ message: { content: diagnostic ? JSON.stringify(diagnostic) : 'Hello' }, done: true })); return;
			}
			const [, kind, name] = match; calls.push({ kind, name });
			assert.ok(request.includes('File implementation brief for ' + name));
			if ([store, test, main].includes(name) && JSON.parse(read('.my_editor/specs/tree.json')).files.some(file => file.path === name)) {
				assert.ok(request.includes('save and reopen a draft without losing its text'));
				assert.ok(request.includes('Interface: putDraft and getDraft.'));
			}
			if (!request.includes('The host is checking this blocker') && !request.includes('Repair citation rejected:')) {
				assert.ok(!request.includes('Team accounts.'), 'Unrelated requirement bodies must not fill the ordinary file context');
			}
			assert.ok(messages[0].content.includes('project brain fixture') && messages[0].content.includes('project convention fixture'));
			queued = [];
			if (phase === 'plainFileReview') { queued.push({ action: 'tools', calls: batchPaths.map(path => ({ name: 'read_file', arguments: { path, start: 1, lines: 10 } })) }); }
			if (repairResponder) { queued.push(...await repairResponder(kind, name, request)); }
			else if (phase === 'nativeFilePass') { queued.push(final('The store is implemented.')); }
			if (repairResponder) { /* The coordinated-repair fixture owns this turn. */ }
			else if (phase === 'dependencyOrder' && name === main && read(store) === stubContent(files[0])) {
				queued.push({ action: 'final', message: 'BLOCKED\nDEPENDENCIES_REQUIRED ' + JSON.stringify([store]) });
			} else if (phase === 'dependencyOrder' && name === main) { queued.push(propose(name, code[main])); }
			else if (phase === 'invalid') { queued.push(propose(name, 'x\n'.repeat(601))); }
			else if (phase === 'credentialLike') { queued.push(propose(name, 'token = "fixture-credential-value"\n')); }
			else if (phase === 'binary') { queued.push(propose(name, 'x = 1\0')); }
			else if (phase === 'failureMessage') { queued.push(propose(name, 'ERROR: Unable to safely reconstruct the complete file.')); }
			else if (phase === 'placeholder') { queued.push(propose(name, 'placeholder')); }
			else if (phase === 'rejectedBlocked') {
				queued.push(propose(name, 'x\n'.repeat(601)));
				queued.push(request.includes('The host is checking this blocker') ? designQuestion('May I split the responsibility into a new file?') : { action: 'final', message: 'BLOCKED\nMay I split the responsibility into a new file?' });
			}
			else if (phase === 'companion') { queued.push(propose('test/extra.test.js', code[test])); }
			else if (phase === 'autoCompanions' || phase === 'overnight' && kind === 'Build') {
				queued.push(propose(name, `exports.value = 1; // ${companionPrefix}\n`));
				queued.push(propose(`test/${companionPrefix}-${path.basename(name, '.js')}.test.js`, code[test]));
			}
			else if (phase === 'blocked' && !request.includes('Use the existing local contract.')) { queued.push(request.includes('The host is checking this blocker') ? designQuestion('Which external contract should be used?') : { action: 'final', message: 'BLOCKED\nWhich external contract should be used?' }); }
			else if (phase === 'planResolution') {
				if (!request.includes('The host is checking this blocker')) {
					queued.push({ action: 'final', message: 'BLOCKED\nShould draftId be a string or an integer?' });
				} else {
					assert.ok(request.includes('draftId must be an opaque string'), 'Recovery must retrieve the saved answer');
					assert.match(request, /requirements\.md:\d+:.*draftId must be an opaque string/);
					queued.push(propose(name, '// Followed the saved draftId contract.\n' + code[name]));
				}
			}
			else if (kind === 'Build' && name !== main) {
				if (name === store) { queued.push(propose('.my_editor/specs/requirements.md', 'wrong')); }
				queued.push(propose(name, code[name] ?? 'exports.helper = () => 1;\n'));
			} else if (phase === 'qaFix') {
				queued.push({ action: 'tool', name: 'propose_edit', arguments: { path: '.my_editor/specs/requirements.md',
					edits: [{ oldText: read('.my_editor/specs/requirements.md'), newText: 'wrong' }] } });
				queued.push({ action: 'tool', name: 'propose_edit', arguments: { path: name,
					edits: [{ oldText: read(name), newText: '// Reviewed contract\n' + read(name) }] } });
			}
			else if (phase === 'followPreview') { queued.push(propose(name, code[name])); }
			else if (phase === 'slow') { queued.push(propose(name, '// Reviewed contract\n' + read(name))); }
			if (phase === 'slow' || phase === 'followPreview') { await new Promise(resolve => { release = resolve; }); }
			queued.push(final(phase === 'qaFix'
				? 'I updated the proposed source to match FR-001 and its interface. Test execution is separate.'
				: 'Compared with FR-001 and the saved store interface. Test execution is separate.'));
		} else {
			rejections.push(messages.at(-1).content);
			if (phase === 'plainFileReview') { largerBatchObserved ||= batchPaths.every(name => messages.some(m => m.content.includes(`Host tool result for read_file(${name}:1)`))); }
		}
		const response = queued.shift();
		if (phase === 'nativeFilePass' && response.action === 'tool') {
			res.end(JSON.stringify({ message: { content: '', tool_calls: [{ function: {
				name: response.name, arguments: { arguments: response.arguments },
			} }] }, done: true }) + '\n'); return;
		}
		res.end(JSON.stringify({ message: { content: typeof response === 'string' ? response : phase === 'plainFileReview' && response.action === 'final'
			? response.message : JSON.stringify(response) }, done: true }) + '\n');
		} catch (error) { fixtureError = error; res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const waitState = (stage, predicate = () => true) => until(async () => {
		if (fixtureError) { throw fixtureError; }
		const s = await status();
		fs.writeFileSync(path.join(root, 'fixture-state.json'), JSON.stringify(s));
		if (s?.status === 'error' && stage !== 'error') { throw Error(s.message); }
		return s?.status === stage && predicate(s) ? s : false;
	}, 'Did not reach ' + stage);
	try {
		write('.my_editor/specs/requirements.md', requirements); write('.my_editor/specs/architecture.md', architecture);
		write('.my_editor/specs/tree.json', JSON.stringify({ files, buildPlan }));
		write('.my_editor/brain/index.md', 'project brain fixture'); write('.my_editor/conventions.md', 'project convention fixture');
		write('package.json', '{"scripts":{"test":"node --test test/store.test.js"}}');
		files.forEach(file => write(file.path, stubContent(file))); write(main, code[main]);
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': 'http://127.0.0.1:' + server.address().port,
			'models.default': 'ollama:queue', 'claudeCli.enabled': false, 'codexCli.enabled': false, 'lmstudio.enabled': false,
			'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false, 'fileChat.followEditor': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await cmd('nextFile'); assert.equal(calls.length, 0);
		cadence = 'Cancel picker'; await cmd('projectBuild.start'); assert.equal(calls.length, 0);
		cadence = 'One module at a time'; await cmd('chat.ask', '/chat build everything');
		let state = await waitState('checkpoint', s => !!s.lastTest);
		assert.ok(pickTitles.includes('Build · 2 modules, 3 files'));
		await until(() => chatStates.some(m => m.type === 'filePass' && m.agent === 'ada' && m.run?.status === 'checkpoint'),
			'Build checkpoint did not reach agent chat');
		assert.ok(chatStates.some(m => m.type === 'filePass' && m.counts === '2 modules · 3 files'));
		assert.equal(state.currentFile.path, test); assert.equal(state.currentFile.role, 'Own ' + test);
		assert.equal(state.results[0].outcome, 'saved');
		assert.ok(chatStates.some(m => m.type === 'filePass' && m.run?.activity === 'Writing proposed code…'),
			'Code generation must not remain labelled as reading context');
		const records = fs.readdirSync(path.join(root, '.my_editor/investigations'), { recursive: true })
			.filter(name => name.endsWith('.json')).map(name => JSON.parse(read('.my_editor/investigations/' + name)));
		assert.ok(records.some(record => record.answer.startsWith('FILE_REVIEWED')
			&& record.evidence.some(item => item.tool === 'propose_file' && item.subject === store)),
			'File passes must retain the model conclusion and host evidence for diagnosis');
		assert.ok(chatStates.some(m => m.type === 'filePass' && m.run?.results?.some(r => r.path === store && r.note.includes('FR-001'))));
		assert.ok(vscode.window.tabGroups.all.flatMap(g => g.tabs).some(t => t.label === 'Build agent'));
		await config.update('fileChat.followEditor', true, vscode.ConfigurationTarget.Global);
		await cmd('chat.openSidebar');
		await until(() => sidebar?.visible && vscode.window.visibleTextEditors.some(e => e.document.uri.fsPath === uri(test).fsPath), 'Columns did not reveal current file');
		await until(() => !vscode.window.tabGroups.all.flatMap(g => g.tabs).some(t => t.input instanceof vscode.TabInputWebview && t.label === 'Build agent'), 'Expanded chat tab stayed behind columns');
		await chatHost.filePassAction('open', 'ada', vscode.workspace.workspaceFolders[0].uri.toString(), store);
		await until(() => vscode.window.visibleTextEditors.some(e => e.document.uri.fsPath === uri(store).fsPath), 'Completed file did not open');
		assert.ok(sidebar.visible && !fileSidebar?.visible, 'File chat must not replace the agent');
		await chatHost.filePassAction('open', 'ada', vscode.workspace.workspaceFolders[0].uri.toString(), '../outside.js');
		assert.ok(vscode.window.visibleTextEditors.some(e => e.document.uri.fsPath === uri(store).fsPath), 'Unrelated paths must be rejected');
		await cmd('chat.agent', 'ada'); assert.ok(sidebar.visible, 'Opening the same agent must preserve columns');
		assert.deepEqual(calls.map(c => c.name), [store, test]);
		// Recovering a run with another model must not change the default used by other chats.
		await cmd('projectBuild.model');
		assert.equal((await status()).modelKey, 'ollama:queue-alt');
		assert.equal(vscode.workspace.getConfiguration('myEditor').get('models.default'), 'ollama:queue');
		phase = 'cancelModel'; await cmd('projectBuild.model');
		assert.equal((await status()).modelKey, 'ollama:queue-alt');
		assert.deepEqual(calls.map(c => c.name), [store, test], 'Model selection must not resume the run');
		phase = 'normal';
		assert.equal(read(store), code[store]); assert.equal(read(test), code[test]); assert.match(state.lastTest, /code 0/);
		assert.ok(rejections.some(text => text.includes('Only the current file')));
		await chatHost.filePassAction('follow', 'ada', vscode.workspace.workspaceFolders[0].uri.toString());
		assert.ok(chatStates.some(m => m.type === 'filePass' && m.following));
		code[main] += '// Verified entry-point wiring.\n';
		phase = 'followPreview'; await cmd('projectBuild.resume'); await until(() => release, 'No preview request');
		await until(() => vscode.window.visibleTextEditors.some(e => e.document.uri.fsPath === uri(main).fsPath), 'Follow did not advance to the next file');
		if (process.env.MY_EDITOR_UI_REVIEW) { await new Promise(resolve => setTimeout(resolve, 50000)); }
		release(); release = undefined;
		await waitState('checkpoint', s => s.remaining === 0 && !!s.lastTest);
		await until(() => !vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.input instanceof vscode.TabInputText
			&& tab.input.uri.fsPath === uri(main).fsPath), 'The completed run preview must close');
		phase = 'normal';
		await chatHost.filePassAction('follow', 'ada', vscode.workspace.workspaceFolders[0].uri.toString());
		assert.equal(chatStates.filter(m => m.type === 'filePass').at(-1).following, false);
		await cmd('projectBuild.resume'); await waitState('complete');
		assert.equal(read(main), code[main]); assert.deepEqual(calls.map(c => c.name), [store, test, main]);
		assert.equal(fs.existsSync(uri('.my_editor/build-progress.json').fsPath), false);
		// A whole QA pass visits existing source, including eligible files outside the plan.
		write('extra.py', 'x = 1\n'); cadence = 'QA everything'; auto = false;
		await cmd('projectQA.start'); state = await waitState('checkpoint', s => s.options.kind === 'QA' && !!s.lastTest);
		assert.equal(state.remaining, 0); assert.equal(state.lastTestStatus, 'passed');
		await cmd('projectBuild.resume'); state = await waitState('complete');
		assert.deepEqual(state.results.map(r => r.path), [store, test, main, 'extra.py']);
		assert.match(read(state.reportPath), /extra.py/);
		// Selected-file review never writes before Keep. Undo stops the queue.
		phase = 'qaFix'; await cmd('projectQA.file', uri(store));
		state = await waitState('review'); assert.equal(read(store), code[store]);
		assert.equal(state.preview.path, store); assert.match(state.preview.content, /Reviewed contract/);
		await until(() => chatStates.some(m => m.type === 'filePass' && m.run?.preview?.path === store && m.run?.status === 'review'), 'Prepared code preview did not reach chat');
		await cmd('projectBuild.review', state.pending[0].id);
		const diff = vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof vscode.TabInputTextDiff);
		await cmd('proposal.undo', diff.input.modified); await waitState('paused');
		await cmd('projectBuild.resume'); await waitState('review'); await cmd('projectBuild.keep');
		await waitState('checkpoint', s => !!s.lastTest); await cmd('projectBuild.resume'); await waitState('complete');
		assert.match(read(store), /^\/\/ Reviewed contract/);
		// All-file line guard applies to an unplanned selected file as well.
		phase = 'invalid'; auto = true;
		await cmd('projectBuild.file', uri('extra.py')); state = await waitState('error');
		assert.match(state.message, /600 lines/);
		await until(() => chatStates.some(m => m.type === 'filePass' && m.run?.status === 'error' && /600 lines/.test(m.run.message)),
			'Run failure did not reach chat'); assert.equal(read('extra.py'), 'x = 1\n');
		// Unsafe model output must be rejected before auto-save, not when reading it back.
		for (const [unsafePhase, expected] of [['credentialLike', /look like credentials/], ['binary', /binary content/], ['failureMessage', /failure message/], ['placeholder', /placeholder/]]) {
			phase = unsafePhase; await cmd('projectBuild.resume'); state = await waitState('error');
			assert.match(state.message, expected);
			assert.equal(read('extra.py'), 'x = 1\n');
			assert.equal(state.pending.length, 0);
		}
		phase = 'rejectedBlocked'; await cmd('projectBuild.resume'); state = await waitState('error');
		assert.equal(state.needsAnswer, true); assert.match(state.message, /May I split/);
		phase = 'blocked'; await cmd('projectBuild.resume'); state = await waitState('error');
		assert.match(state.message, /external contract/);
		assert.match(state.message, /Recommendation:/); assert.match(state.message, /Options:/);
		await cmd('projectBuild.answer'); await waitState('checkpoint', s => !!s.lastTest);
		await cmd('projectBuild.resume'); await waitState('complete');
		write('extra.py', 'x = 1\n');
		// Even automatic QA needs an explicit decision and Keep for a new companion test.
		phase = 'companion'; await cmd('projectQA.file', uri('extra.py')); await waitState('review');
		assert.ok(permissionRequests.some(m => m.includes('test/extra.test.js')));
		assert.equal(fs.existsSync(uri('test/extra.test.js').fsPath), false);
		await cmd('projectBuild.keep'); await waitState('checkpoint', s => !!s.lastTest);
		assert.equal(read('test/extra.test.js'), code[test]);
		write('package.json', JSON.stringify({ scripts: { test: 'node missing-test.cjs' } }));
		await cmd('projectBuild.test'); state = await waitState('checkpoint'); assert.match(state.lastTest, /code 1/);
		assert.equal(state.lastTestStatus, 'failed');
		await cmd('projectBuild.resume'); assert.equal((await status()).status, 'checkpoint', 'Failed tests must block completion');
		cancelTests = true; await cmd('projectBuild.test');
		assert.equal((await status()).lastTestStatus, 'failed', 'Cancelling a retry must not erase the failure');
		await cmd('projectBuild.pause'); await cmd('projectBuild.resume');
		assert.equal((await status()).status, 'checkpoint', 'Stop and resume must not bypass a failed test');
		cancelTests = false;
		write('package.json', JSON.stringify({ scripts: { test: 'node --test test/store.test.js' } }));
		await cmd('projectBuild.test'); assert.equal((await status()).lastTestStatus, 'passed');
		await cmd('projectBuild.resume'); await waitState('complete');
		// A selected file in a workspace package offers and runs that package's tests.
		// The root command fails deliberately: passing proves the module cwd was used.
		phase = 'scopedTest'; auto = true;
		write('modules/example/package.json', JSON.stringify({ scripts: { test: 'node --test helper.test.cjs' } }));
		write('modules/example/helper.js', 'exports.helper = () => 0;\n');
		write('modules/example/helper.test.cjs', 'const { test } = require("node:test");\n'
			+ 'const assert = require("node:assert/strict");\n'
			+ 'test("module helper", () => assert.equal(require("./helper.js").helper(), 1));\n');
		write('package.json', JSON.stringify({ scripts: { test: 'node missing-root-test.cjs' } }));
		await cmd('projectBuild.file', uri('modules/example/helper.js'));
		state = await waitState('checkpoint', s => !!s.lastTest);
		assert.match(state.lastTest, /npm test · modules\/example exited with code 0/);
		await cmd('projectBuild.resume'); await waitState('complete');
		write('package.json', JSON.stringify({ scripts: { test: 'node --test test/store.test.js' } }));
		// A scoped file conclusion can be plain text; it must not fabricate a proposal or write.
		phase = 'plainFileReview';
		const beforePlainReview = read(store);
		await cmd('projectQA.file', uri(store));
		state = await waitState('checkpoint', s => !!s.lastTest);
		assert.equal(state.results[0].outcome, 'reviewed');
		assert.match(state.results[0].note, /FR-001/);
		assert.equal(read(store), beforePlainReview);
		assert.ok(largerBatchObserved, 'All six requested reads must execute and reach the file-review model');
		await cmd('projectBuild.resume'); await waitState('complete');
		// Dismissing tests cannot complete a run, even after every file review is done.
		cancelTests = true;
		await cmd('projectQA.file', uri(store)); state = await waitState('checkpoint', s => !!s.lastTest);
		assert.equal(state.lastTestStatus, 'unverified');
		await cmd('projectBuild.resume'); state = await waitState('checkpoint');
		assert.match(state.message, /unverified/);
		await cmd('projectBuild.pause');
		cancelTests = false;
		// Native provider requests use the same proposal guard, review settings and save path.
		phase = 'nativeFilePass';
		// Reset through the editor so its open document and disk revision agree before the run.
		const nativeDocument = await vscode.workspace.openTextDocument(uri(store));
		const nativeReset = new vscode.WorkspaceEdit();
		nativeReset.replace(uri(store), new vscode.Range(0, 0, nativeDocument.lineCount, 0), stubContent(files[0]));
		assert.ok(await vscode.workspace.applyEdit(nativeReset));
		assert.ok(await nativeDocument.save());
		await cmd('projectBuild.file', uri(store));
		state = await waitState('checkpoint', s => !!s.lastTest);
		assert.equal(read(store), code[store]);
		assert.equal(read('.my_editor/specs/requirements.md'), requirements);
		assert.equal(state.results[0].outcome, 'saved');
		await cmd('projectBuild.resume'); await waitState('complete');
		// Changed planning evidence invalidates an already-open proposal at Keep.
		phase = 'qaFix'; auto = false; await cmd('projectQA.file', uri(store)); state = await waitState('review');
		await cmd('projectBuild.review', state.pending[0].id);
		const stale = await until(() => vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof vscode.TabInputTextDiff), 'No review diff for the stale-plan check');
		const saved = read(store); write('.my_editor/specs/architecture.md', architecture + '\nRevision for test.\n');
		await cmd('projectBuild.keep'); assert.equal(read(store), saved);
		await cmd('proposal.undo', stale.input.modified); await waitState('paused');
		write('.my_editor/specs/architecture.md', architecture); auto = true;
		// Stop an in-flight request; a late reply must never apply or start the next file.
		phase = 'slow'; await cmd('projectQA.file', uri('extra.py')); await until(() => release, 'No slow request');
		await cmd('projectBuild.pause'); release(); release = undefined; await waitState('paused');
		assert.equal(read('extra.py'), 'x = 1\n');
		// A concurrent edit invalidates the captured source even when auto-save was authorized.
		await cmd('projectBuild.resume'); await until(() => release, 'No slow retry');
		write('extra.py', 'x = 42\n'); release(); release = undefined;
		state = await waitState('error'); assert.match(state.message, /changed during generation/); assert.equal(read('extra.py'), 'x = 42\n');
		assert.equal(read('.my_editor/specs/requirements.md'), requirements);
		// An entry point listed before its unbuilt interface must defer within its own module.
		phase = 'dependencyOrder'; cadence = 'One module at a time'; auto = true;
		const dependencyPlan = { version: 1, entryPoint: main, steps: [
			{ id: 'service', title: 'Service', files: [main, store, test], dependsOn: [], tasks: ['Implement the service.'], checks: ['Run npm test.'] },
		] };
		write('.my_editor/specs/tree.json', JSON.stringify({ files, buildPlan: dependencyPlan }));
		for (const file of files) {
			const doc = await vscode.workspace.openTextDocument(uri(file.path));
			const reset = new vscode.WorkspaceEdit(); reset.replace(uri(file.path), new vscode.Range(0, 0, doc.lineCount, 0), stubContent(file));
			assert.ok(await vscode.workspace.applyEdit(reset)); assert.ok(await doc.save());
		}
		const previousCalls = calls.length;
		await cmd('projectBuild.start'); state = await waitState('checkpoint', s => !!s.lastTest);
		assert.deepEqual(calls.slice(previousCalls).map(call => call.name), [main, store, main, test]);
		assert.deepEqual(state.results.map(result => result.path), [store, main, test]);
		assert.equal(state.total, 3); assert.equal(state.remaining, 0); assert.match(state.lastTest, /code 0/);
		assert.deepEqual(state.dependencyRequests, [{ path: main, dependencies: [store] }]);
		assert.equal(read(main), code[main]); assert.equal(read(store), code[store]);
		assert.deepEqual(JSON.parse(read('.my_editor/specs/tree.json')).buildPlan.steps[0].files, [main, store, test], 'Queue ordering must not edit the saved plan');
		await cmd('projectBuild.resume'); await waitState('complete');
		// A user can authorize current and future files/tests while a Keep decision is pending.
		const automaticFiles = ['utils/one.js', 'utils/two.js'].map(name => ({ path: name, role: 'Own one value', section: 'store', requirements: ['FR-001'], estimatedLines: 10, status: 'stub' }));
		write('.my_editor/specs/tree.json', JSON.stringify({ files: automaticFiles, buildPlan: { version: 1, entryPoint: 'utils/one.js', steps: [
			{ id: 'values', title: 'Values', files: automaticFiles.map(file => file.path), dependsOn: [], tasks: ['Implement independent values'], checks: ['Run npm test'] },
		] } }));
		for (const file of automaticFiles) { write(file.path, stubContent(file)); }
		phase = 'autoCompanions'; cadence = 'One module at a time'; auto = false;
		const approvalsBefore = permissionRequests.length;
		await cmd('projectBuild.start'); await waitState('review');
		auto = true; allowTests = true;
		await cmd('projectBuild.saving'); state = await waitState('checkpoint', s => !!s.lastTest);
		assert.equal(state.options.automatic, true); assert.equal(state.options.companionTests, 'automatic');
		assert.equal(permissionRequests.length, approvalsBefore, 'Run permission must prevent repeated new-test prompts');
		for (const name of ['one', 'two']) { assert.equal(read(`test/auto-${name}.test.js`), code[test]); }
		await cmd('projectBuild.resume'); await waitState('complete');
		// The companion prompt can also grant the permission for subsequent files in this run.
		allowTests = false; allowTestPrompt = true; companionPrefix = 'modal';
		await cmd('projectBuild.start'); state = await waitState('checkpoint', s => !!s.lastTest);
		assert.equal(state.options.companionTests, 'automatic');
		assert.equal(permissionRequests.length, approvalsBefore + 1, 'One prompt must authorize both new tests');
		for (const name of ['one', 'two']) { assert.equal(read(`test/modal-${name}.test.js`), code[test]); }
		await cmd('projectBuild.resume'); await waitState('complete');
		// A separate run uses its own chosen permissions, not the preceding run's grant.
		allowTestPrompt = false; auto = false; phase = 'qaFix';
		await cmd('projectQA.file', uri('utils/one.js')); state = await waitState('review');
		assert.equal(state.options.automatic, false); assert.equal(state.options.companionTests, 'review');
		await cmd('proposal.undo', vscode.Uri.parse('my-editor-proposal:/' + state.pending[0].id + '/one.js'));
		await waitState('paused');
		// Whole Build preserves existing code without model review, then QA visits it after all implementations exist.
		phase = 'normal'; cadence = 'Build everything'; auto = true; allowTests = true;
		write('.my_editor/specs/tree.json', JSON.stringify({ files, buildPlan }));
		const pipelineDoc = await vscode.workspace.openTextDocument(uri(store));
		const pipelineReset = new vscode.WorkspaceEdit();
		pipelineReset.replace(uri(store), new vscode.Range(0, 0, pipelineDoc.lineCount, 0), stubContent(files[0]));
		assert.ok(await vscode.workspace.applyEdit(pipelineReset)); assert.ok(await pipelineDoc.save());
		const beforePipeline = calls.length, beforeTestChoices = pickTitles.filter(t => t?.startsWith('Run a test')).length;
		await cmd('projectBuild.start');
		state = await waitState('checkpoint', s => s.phase === 'qa' && !!s.lastTest);
		const pipelineCalls = calls.slice(beforePipeline);
		assert.deepEqual(pipelineCalls.filter(call => call.kind === 'Build').map(call => call.name), [store]);
		assert.equal(pipelineCalls[0].kind, 'Build');
		assert.ok(pipelineCalls.slice(1).every(call => call.kind === 'QA'), 'All implementation must precede QA');
		assert.ok(pipelineCalls.some(call => call.kind === 'QA' && call.name === main), 'Existing source must still get QA');
		assert.ok(pipelineCalls.some(call => call.kind === 'QA' && call.name === 'test/auto-one.test.js'), 'QA must cover extra companion tests');
		assert.deepEqual(state.buildResults.map(row => row.outcome), ['saved', 'existing', 'existing']);
		assert.equal(pickTitles.filter(t => t?.startsWith('Run a test')).length - beforeTestChoices, 2, 'Test only after build, then after QA');
		assert.equal(state.lastTestStatus, 'passed');
		await cmd('projectBuild.resume'); state = await waitState('complete');
		assert.match(state.message, /Build and QA/);
		assert.match(read(state.reportPath), /Implementation stage/);
		const stageChecks = checkpointSnapshots.slice(-2);
		assert.equal(stageChecks[0].phase, 'build'); assert.equal(stageChecks[0].remaining, 0);
		assert.equal(stageChecks[1].phase, 'qa'); assert.equal(stageChecks[1].remaining, 0);
		// Cancelling the build/test boundary must not start QA in the background.
		phase = 'holdBuildTest';
		const beforePausedBuild = calls.length;
		await cmd('projectBuild.start'); await until(() => releaseTest, 'No build test checkpoint');
		await cmd('projectBuild.pause'); releaseTest(); releaseTest = undefined;
		await waitState('paused'); assert.equal(calls.length, beforePausedBuild);
		// Starting again should offer Resume and preserve the stage, not reset the run.
		phase = 'normal'; resumeSaved = true;
		await cmd('projectBuild.start'); await cmd('projectBuild.test'); await cmd('projectBuild.resume');
		state = await waitState('checkpoint', s => s.phase === 'qa' && !!s.lastTest);
		assert.equal(state.buildResults.length, 3);
		assert.ok(calls.slice(beforePausedBuild).every(call => call.kind === 'QA'));
		assert.ok(pickTitles.includes('An unfinished run already exists'));
		await cmd('projectBuild.resume'); await waitState('complete'); resumeSaved = false;
		// A failing build checkpoint blocks broad QA; a passing retry allows the stage transition.
		write('package.json', JSON.stringify({ scripts: { test: 'node missing-test.cjs' } }));
		await cmd('projectBuild.start'); state = await waitState('checkpoint', s => s.phase === 'build' && !!s.lastTest);
		assert.match(state.lastTest, /code 1/); assert.equal(state.lastTestStatus, 'failed');
		await cmd('projectBuild.resume'); assert.equal((await status()).status, 'checkpoint');
		write('package.json', JSON.stringify({ scripts: { test: 'node --test test/store.test.js' } }));
		await cmd('projectBuild.test'); await cmd('projectBuild.resume'); await waitState('checkpoint', s => s.phase === 'qa' && s.lastTestStatus === 'passed');
		await cmd('projectBuild.resume'); await waitState('complete');

		// A premature design question is resolved from saved requirements before reaching the user.
		write('.my_editor/specs/requirements.md', requirements + '\nThe draftId must be an opaque string.\n');
		phase = 'planResolution'; auto = true; allowTests = false;
		const beforeResolution = calls.length;
		await cmd('projectBuild.file', uri(store)); state = await waitState('checkpoint', s => !!s.lastTest);
		assert.equal(calls.length - beforeResolution, 2, 'One bounded blocker investigation should resolve the saved decision');
		assert.match(read(store), /Followed the saved draftId contract/);
		assert.equal(state.needsAnswer, undefined);
		assert.ok(chatStates.some(m => m.type === 'filePass' && m.run?.activity === 'Checking saved requirements and architecture before asking you…'));
		await cmd('projectBuild.resume'); await waitState('complete');
		write('.my_editor/specs/requirements.md', requirements);
		// Upfront unattended permission covers newly generated companion tests and both test stages.
		write('.my_editor/specs/tree.json', JSON.stringify({ files: automaticFiles, buildPlan: { version: 1, entryPoint: 'utils/one.js', steps: [
			{ id: 'values', title: 'Values', files: automaticFiles.map(file => file.path), dependsOn: [], tasks: ['Implement independent values'], checks: ['Run npm test'] },
		] } }));
		for (const file of automaticFiles) {
			const doc = await vscode.workspace.openTextDocument(uri(file.path));
			const reset = new vscode.WorkspaceEdit(); reset.replace(uri(file.path), new vscode.Range(0, 0, doc.lineCount, 0), stubContent(file));
			assert.ok(await vscode.workspace.applyEdit(reset)); assert.ok(await doc.save());
		}
		write(test, code[test] + 'test("unattended uses CI mode", () => assert.equal(process.env.CI, "true"));\n');
		phase = 'overnight'; companionPrefix = 'overnight'; cadence = 'Build everything';
		auto = true; allowTests = true; unattended = true; approveUnattended = false;
		const callsBeforeConsent = calls.length;
		await cmd('projectBuild.start'); assert.equal(calls.length, callsBeforeConsent, 'Dismissed authorization must not start work');
		approveUnattended = true;
		const promptsBeforeOvernight = permissionRequests.length;
		const testPickersBeforeOvernight = pickTitles.filter(title => title?.startsWith('Run a test')).length;
		await cmd('projectBuild.start'); state = await waitState('complete', s => s.options.unattended);
		assert.equal(state.phase, 'qa'); assert.equal(state.lastTestStatus, 'passed');
		assert.equal(state.testHistory.length, 2);
		assert.equal(permissionRequests.length, promptsBeforeOvernight, 'No companion-test approvals after upfront authorization');
		assert.equal(pickTitles.filter(title => title?.startsWith('Run a test')).length, testPickersBeforeOvernight, 'No checkpoint task picker in unattended mode');
		assert.match(state.lastTest, /npm test · modules\/example exited with code 0/);
		for (const name of ['one', 'two']) { assert.equal(read(`test/overnight-${name}.test.js`), code[test]); }
		assert.match(state.message, /All required verification commands passed/);
		// Failed final checks never auto-complete; a successful approved retry needs no Finish click.
		phase = 'normal'; cadence = 'QA everything';
		write('package.json', JSON.stringify({ scripts: { test: 'node missing-test.cjs' } }));
		await cmd('projectQA.start'); state = await waitState('checkpoint', s => s.options.unattended && s.message.startsWith('Tests still fail.'));
		assert.equal(state.lastTestStatus, 'failed');
		await cmd('projectBuild.resume'); assert.equal((await status()).status, 'checkpoint');
		assert.match(state.lastTest, /Test output: \.my_editor\/test-runs\//);
		assert.match(state.lastTest, /missing-test\.cjs/, 'QA needs the actual failure, not only an exit code');
		write('package.json', JSON.stringify({ scripts: { test: 'node --test test/store.test.js' } }));
		await cmd('projectBuild.test'); await waitState('complete');
		// Permission revocation between commands prevents the next command from launching.
		const { runCheckpointTest } = require('../../out-test/src/project/filePassTests');
		const revoke = new vscode.CancellationTokenSource(); let automatic = true;
		const ended = vscode.tasks.onDidEndTaskProcess(() => { automatic = false; });
		const revoked = await runCheckpointTest(vscode.Uri.file(root), revoke.token, ['modules/example/helper.js'], () => automatic);
		ended.dispose(); revoke.dispose();
		assert.equal(revoked.status, 'unverified'); assert.match(revoked.message, /permission changed/);
		assert.equal((revoked.message.match(/exited with code/g) || []).length, 1);
		// A new run must choose its own saving and execution permissions.
		unattended = false; auto = false; allowTests = false; phase = 'qaFix';
		await cmd('projectQA.file', uri('utils/one.js')); state = await waitState('review');
		assert.equal(state.options.unattended, false); assert.equal(state.options.automatic, false);
		await cmd('proposal.undo', vscode.Uri.parse('my-editor-proposal:/' + state.pending[0].id + '/one.js')); await waitState('paused');
		phase = 'repairs'; cadence = 'Build everything'; auto = true; allowTests = true; unattended = true;
		await require('./coordinatedRepairs.cjs').run({ write, read, cmd, status, waitState, until, calls,
			setResponder: value => { repairResponder = value; }, setAnswer: value => { answerText = value; } });
		await require('./relatedBatch.cjs').run({ write, read, cmd, status, waitState, calls,
			setResponder: value => { repairResponder = value; }, setBatchSize: value => { batchSize = value; } });
		await require('./verificationStrategy.cjs').run({ write, read, cmd, status, waitState,
			setResponder: value => { repairResponder = value; }, setCadence: value => { cadence = value; } });
		await require('./testRepairLoop.cjs').run({ write, read, cmd, status, waitState,
			setResponder: value => { repairResponder = value; }, setCadence: value => { cadence = value; } });
		await require('./auditAcceptance.cjs').run({ write, read, cmd, status, waitState, calls,
			setResponder: value => { repairResponder = value; }, setReview: value => { auto = !value; unattended = !value; allowTests = !value; } });
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, moduleCount: 2, testFailureRepairLoop: true, dependencyFreshness: true,
			reviewTimeDependencyFreshness: true, testSourceFreshness: true, unavailableSelectedModelStops: true, decisionReferences: true, mixedCheckpointEvidence: true,
			coordinatedRepairs: true, repairPauseResume: true, savedDecisionRecovery: true, evidenceBackedQuestions: true, unattendedBuildQA: true, upfrontConsent: true, executionRevocation: true, buildThenQA: true, existingCodeDeferredToQA: true, sequentialBuild: true, dependencyOrder: true, completedPreviewClosed: true, perRunSavingPermission: true, automaticCompanionTests: true, finalTestCheckpoint: true, failedTestsBlockCompletion: true, unverifiedCompletionBlocked: true, automaticApply: true, actualNodeTests: true, moduleTestScope: true, runModelScope: true, plainFileReview: true, nativeToolRequests: true, qaAll: true, selectedFileReview: true,
			contextVerified: true, preSaveDataGuard: true, cancellation: true, staleEditRejected: true, planProtected: true }));
	} finally {
		release?.(); server.close(); vscode.window.registerWebviewViewProvider = originalProvider; vscode.window.createWebviewPanel = originalPanel; vscode.window.showQuickPick = originalPick; vscode.window.showInputBox = originalInput; vscode.window.showInformationMessage = originalInfo;
	}
};
