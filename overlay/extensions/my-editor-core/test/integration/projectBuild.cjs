/* Whole-project requests survive partial model batches and keep coding separate from verification. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');
const { stubContent } = require('../../out-test/src/project/stubs');
const { requirements, architecture } = require('../../out-test/test/planningFixture');
async function until(check, message) {
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) { const value = await check(); if (value) { return value; } await new Promise(resolve => setTimeout(resolve, 50)); }
	throw Error(message);
}
exports.run = async function () {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const cmd = (name, ...args) => vscode.commands.executeCommand(`myEditor.${name}`, ...args);
	const sourcePaths = ['lib/package.json', ...Array.from({ length: 5 }, (_, index) => `lib/store${index}.js`)];
	const files = ['package.json', ...sourcePaths, 'src/main.js'].map(name => ({ path: name, role: `Implement ${name} for local draft storage.`,
		requirements: ['FR-001'], section: 'store', estimatedLines: 60, status: 'stub' }));
	const buildPlan = { version: 1, entryPoint: 'src/main.js', steps: [
		{ id: 'root', title: 'Setup', files: ['package.json'], dependsOn: [], tasks: ['Configure scripts.'], checks: ['Validate JSON.'] },
		{ id: 'store', title: 'Storage', files: sourcePaths, dependsOn: ['root'], tasks: ['Implement storage.'], checks: ['Test save and load.'] },
		{ id: 'app', title: 'Application', files: ['src/main.js'], dependsOn: ['store'], tasks: ['Connect storage.'], checks: ['Run the app.'] },
	] };
	const write = (name, text) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
	const calls = [], batches = [], rejections = [];
	let actions = [], phase = 'normal', release, provider, projectView;
	const create = vscode.window.createTreeView;
	const register = vscode.window.registerWebviewViewProvider;
	vscode.window.registerWebviewViewProvider = (id, value, options) => {
		if (id === 'myEditor.project') { projectView = value; }
		return register(id, value, options);
	};
	vscode.window.createTreeView = (id, options) => { if (id === 'myEditor.buildGuide') { provider = options.treeDataProvider; } return create(id, options); };
	const tool = (name, content) => ({ action: 'tool', name: 'propose_file', arguments: { path: name, content } });
	const code = name => name.endsWith('.json') ? '{"name":"storage","private":true}\n'
		: name === 'src/main.js' ? 'const store = require("../lib/store0");\nstore.save("hello");\nconsole.log(store.load());\n'
			: 'let draft;\nexports.save = value => { draft = value; };\nexports.load = () => draft;\n';
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'queue' }] })); return; }
		let body = ''; for await (const chunk of req) { body += chunk; }
		const payload = JSON.parse(body); calls.push(payload);
		const prior = payload.messages.filter(message => message.role === 'assistant');
		if (!prior.length) {
			const request = payload.messages.find(message => message.role === 'user').content;
			const match = /Implement these remaining files completely from the saved plan: (\[[^\n]+?\])\./.exec(request);
			assert.ok(match, 'Whole-project request must route into the host worker');
			const targets = JSON.parse(match[1]); batches.push(targets);
			assert.ok(request.includes(requirements.trim()), 'Full requirements must stay in context');
			assert.ok(request.includes(architecture.trim()), 'Full architecture must stay in context');
			actions = targets.slice(0, 2).map(name => tool(name, code(name)));
			if (batches.length === 1) {
				actions.unshift(tool('.my_editor/specs/requirements.md', 'Unauthorized rewrite'),
					tool(targets[0], stubContent(files.find(file => file.path === targets[0]))), tool(targets[0], '{"broken":}'));
			}
		} else { rejections.push(payload.messages.at(-1).content); }
		if (phase === 'slow') { await new Promise(resolve => { release = resolve; }); }
		const action = phase === 'empty' ? { action: 'final', message: 'No files prepared.' }
			: actions.shift() ?? { action: 'final', message: 'Review these files.' };
		res.end(JSON.stringify({ message: { content: JSON.stringify(action) }, done: true }) + '\n');
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const status = () => cmd('projectBuild.status');
	const review = () => until(async () => { const state = await status(); return state?.status === 'review' && state; }, 'Build did not reach review');
	try {
		write('.my_editor/specs/requirements.md', requirements); write('.my_editor/specs/architecture.md', architecture);
		write('.my_editor/specs/tree.json', JSON.stringify({ files, buildPlan }));
		for (const file of files) { write(file.path, stubContent(file)); }
		write('package.json', '{"name":"already-kept","private":true}\n');
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:queue', 'claudeCli.enabled': false, 'codexCli.enabled': false, 'lmstudio.enabled': false,
			'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false, 'fileChat.followEditor': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await projectView.openOrStart('build', 'package.json');
		assert.ok(vscode.window.visibleTextEditors.some(editor => editor.document.uri.fsPath === path.join(root, 'lib/store0.js')),
			'Build must advance past saved setup to source, ahead of the library manifest');
		assert.equal(calls.length, 0);
		await cmd('chat.ask', '/chat ok code everything for me');
		let state = await review();
		assert.equal(state.remaining, 7); assert.equal(state.pending.length, 2);
		assert.ok(rejections.some(text => text.includes('only its requested file paths')));
		assert.ok(rejections.some(text => text.includes('proposed file is unchanged')));
		assert.ok(rejections.some(text => text.includes('Cannot prepare this build file')));
		for (const item of state.pending) { assert.equal(fs.readFileSync(path.join(root, item.path), 'utf8'), stubContent(files.find(file => file.path === item.path))); }
		let rows = await provider.getChildren();
		assert.equal(rows.filter(row => String(row.label).startsWith('Review pending:')).length, 2);
		assert.ok(rows.find(row => row.command?.command === 'myEditor.projectBuild.keep'));
		await cmd('projectBuild.pause'); assert.equal((await status()).status, 'paused');
		await cmd('projectBuild.resume'); assert.equal((await status()).status, 'review');
		for (let index = 0; index < 4; index++) {
			await cmd('projectBuild.keep');
			if (index < 3) { state = await review(); }
		}
		await until(async () => (await status())?.status === 'complete', 'Whole project stopped after a partial batch');
		assert.deepEqual(batches.map(batch => batch.length), [6, 4, 2, 1]);
		assert.equal((await status()).remaining, 0);
		for (const name of [...sourcePaths, 'src/main.js']) { assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), code(name)); }
		assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name, 'already-kept');
		assert.equal(fs.existsSync(path.join(root, '.my_editor/build-progress.json')), false);
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/requirements.md'), 'utf8'), requirements);
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/architecture.md'), 'utf8'), architecture);
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.my_editor/specs/tree.json'), 'utf8')).buildPlan, buildPlan);
		rows = await provider.getChildren();
		assert.deepEqual(rows.filter(row => row.kind === 'step').map(row => row.state.status), ['ready', 'blocked', 'blocked']);
		// A model that produces no work stops visibly instead of looping or claiming success.
		const resetEditor = await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, 'src/main.js')));
		await resetEditor.edit(edit => edit.replace(new vscode.Range(0, 0, resetEditor.document.lineCount, 0), stubContent(files.at(-1))));
		await resetEditor.document.save(); phase = 'empty';
		await cmd('projectBuild.start');
		await until(async () => (await status())?.status === 'error', 'Empty generation did not stop');
		assert.match((await status()).message, /did not finish this batch/);
		// Cancellation keeps the paused state, even when an in-flight stream is aborted.
		phase = 'slow'; await cmd('projectBuild.resume');
		await until(() => release, 'Slow request did not start');
		await cmd('projectBuild.pause'); phase = 'normal'; release();
		await new Promise(resolve => setTimeout(resolve, 200));
		assert.equal((await status()).status, 'paused');
		await cmd('projectBuild.resume'); state = await review();
		const pending = state.pending[0];
		const diff = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input instanceof vscode.TabInputTextDiff
			&& tab.input.modified.scheme === 'my-editor-proposal' && tab.input.modified.path.endsWith('/main.js'));
		assert.ok(diff); await cmd('proposal.undo', diff.input.modified);
		await until(async () => (await status()).status === 'paused', 'Undo did not pause the queue');
		assert.equal((await status()).pending.some(item => item.id === pending.id), false);
		// Concurrent developer edits must not be overwritten by the background generator.
		release = undefined; phase = 'slow'; await cmd('projectBuild.resume');
		await until(() => release, 'Concurrent-edit request did not start');
		const editor = await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, 'src/main.js')));
		await editor.edit(edit => edit.replace(new vscode.Range(0, 0, editor.document.lineCount, 0), '// My current implementation\nconsole.log("mine");\n'));
		await editor.document.save(); phase = 'normal'; release();
		await until(async () => (await status())?.status === 'complete', 'Concurrent edit was not preserved');
		assert.ok(rejections.some(text => text.includes('file changed during the batch')));
		assert.match(fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'), /My current implementation/);
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, sourceFirst: true,
			wholeRequestRouted: true, generatedFiles: 7, partialBatches: 4, keepContinuesAutomatically: true,
			planPreserved: true, noFalseVerification: true, scopedWrites: true, unchangedStubRejected: true,
			invalidJsonRejected: true, pauseResume: true, cancellation: true, undoPauses: true, emptyReplyStops: true }, null, 2));
	} finally { release?.(); server.close(); vscode.window.createTreeView = create; vscode.window.registerWebviewViewProvider = register; }
};
