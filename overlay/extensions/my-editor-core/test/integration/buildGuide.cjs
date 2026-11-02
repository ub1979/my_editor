/* Real editor roadmap: dependency order, manual evidence, task execution and compatible plan upgrades. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');
const { stubContent } = require('../../out-test/src/project/stubs');
const { requirements, architecture } = require('../../out-test/test/planningFixture');

async function until(check, message) {
	const deadline = Date.now() + 15000;
	while (Date.now() < deadline) { const result = await check(); if (result) { return result; } await new Promise(resolve => setTimeout(resolve, 50)); }
	throw new Error(message);
}

exports.run = async function () {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	let provider;
	const create = vscode.window.createTreeView, pick = vscode.window.showQuickPick;
	const calls = [];
	vscode.window.createTreeView = (id, options) => { if (id === 'myEditor.buildGuide') { provider = options.treeDataProvider; } return create(id, options); };
	const files = [
		{ path: 'src/main.js', role: 'Start the application.', section: 'composer', requirements: ['FR-001'], estimatedLines: 100, status: 'planned' },
		{ path: 'src/store.js', role: 'Store drafts.', section: 'store', requirements: ['FR-001'], estimatedLines: 180, status: 'planned' },
		{ path: 'test/store.test.js', role: 'Verify draft storage.', section: 'store', requirements: ['FR-001'], estimatedLines: 140, status: 'planned' },
	];
	const buildPlan = { version: 1, entryPoint: 'src/main.js', steps: [
		{ id: 'app', title: 'Connect the application', files: ['src/main.js'], dependsOn: ['store'],
			tasks: ['Connect the store and startup.'], checks: ['Run node src/main.js and verify the saved draft appears.'] },
		{ id: 'store', title: 'Build the shared storage library', files: ['src/store.js', 'test/store.test.js'], dependsOn: [],
			tasks: ['Implement save/load with a test.'], checks: ['Run node --test test/store.test.js; the stored text must be returned.'] },
	] };
	const tree = JSON.stringify({ files, buildPlan });
	const write = (relative, text) => {
		const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); return vscode.Uri.file(target);
	};
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'guide' }] })); return; }
		let body = ''; for await (const chunk of req) { body += chunk; }
		calls.push(JSON.parse(body));
		res.end(JSON.stringify({ message: { content: JSON.stringify({ action: 'final', message: '```json\n' + tree + '\n```' }) }, done: true }) + '\n');
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	let taskProvider, taskEnd;
	try {
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:guide', 'claudeCli.enabled': false, 'codexCli.enabled': false, 'lmstudio.enabled': false,
			'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false, 'fileChat.followEditor': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		write('.my_editor/specs/requirements.md', requirements); write('.my_editor/specs/architecture.md', architecture);
		const treeUri = write('.my_editor/specs/tree.json', tree);
		for (const file of files) { write(file.path, stubContent(file)); }
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await vscode.commands.executeCommand('myEditor.buildGuide.open');
		const rows = () => provider.getChildren();
		let items = await rows();
		assert.equal(calls.length, 0);
		assert.equal(items.find(item => String(item.label).startsWith('Start here')).path, 'src/store.js');
		assert.equal(items.find(item => String(item.label).startsWith('Application / library entry')).path, 'src/main.js');
		const steps = () => items.filter(item => item.kind === 'step');
		assert.deepEqual(steps().map(item => item.state.step.id), ['store', 'app']);
		assert.deepEqual(steps().map(item => item.state.status), ['ready', 'blocked']);
		assert.ok((await provider.getChildren(steps()[0])).some(item => String(item.label).startsWith('Check: Run node --test')));
		await vscode.commands.executeCommand('myEditor.nextFile');
		assert.ok(vscode.window.visibleTextEditors.some(editor => editor.document.uri.fsPath === path.join(root, 'src/store.js')));
		await vscode.commands.executeCommand('myEditor.buildGuide.confirm', steps()[0]);
		assert.ok(!fs.existsSync(path.join(root, '.my_editor/build-progress.json')), 'Stubs must not be verified');
		const edit = async (relative, content) => {
			const editor = await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, relative)));
			await editor.edit(builder => builder.replace(new vscode.Range(0, 0, editor.document.lineCount, 0), content));
			await editor.document.save(); return editor;
		};
		await edit('src/store.js', 'let draft;\nexports.save = text => { draft = text; };\nexports.load = () => draft;\n');
		await edit('test/store.test.js', 'const { test } = require("node:test");\nconst assert = require("node:assert/strict");\n'
			+ 'const store = require("../src/store");\ntest("stores text", () => { store.save("hello"); assert.equal(store.load(), "hello"); });\n');
		const task = new vscode.Task({ type: 'guide-fixture' }, vscode.workspace.workspaceFolders[0], 'Verify storage fixture', 'guide-test',
			new vscode.ProcessExecution('node', ['--test', 'test/store.test.js'], { cwd: root }));
		task.group = vscode.TaskGroup.Test;
		taskProvider = vscode.tasks.registerTaskProvider('guide-fixture', { provideTasks: () => [task], resolveTask: value => value });
		const finished = new Promise(resolve => { taskEnd = vscode.tasks.onDidEndTaskProcess(event => {
			if (event.execution.task.name === task.name) { resolve(event.exitCode); }
		}); });
		vscode.window.showQuickPick = async (choices, options) => options?.title === 'Run a configured test task'
			? (await choices).find(choice => choice.label === task.name) : pick(choices, options);
		await vscode.commands.executeCommand('myEditor.buildGuide.test');
		assert.equal(await Promise.race([finished, new Promise(resolve => setTimeout(() => resolve('timeout'), 10000))]), 0);
		items = await rows(); assert.equal(steps()[0].state.status, 'ready', 'Task success alone must not invent step verification');
		await vscode.commands.executeCommand('myEditor.buildGuide.confirm', steps()[0]);
		items = await rows(); assert.deepEqual(steps().map(item => item.state.status), ['verified', 'ready']);
		await edit('src/main.js', 'const store = require("./store");\nstore.save("hello");\nconsole.log(store.load());\n');
		items = await rows(); await vscode.commands.executeCommand('myEditor.buildGuide.confirm', steps()[1]);
		items = await rows(); assert.deepEqual(steps().map(item => item.state.status), ['verified', 'verified']);
		assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.my_editor/build-progress.json'), 'utf8')).steps.store.evidence, 'user-confirmed');
		const old = steps()[0];
		const editor = await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, 'src/store.js')));
		await editor.edit(builder => builder.insert(new vscode.Position(0, 0), '// changed\n'));
		items = await rows(); assert.deepEqual(steps().map(item => item.state.status), ['changed', 'blocked']);
		await vscode.commands.executeCommand('myEditor.buildGuide.confirm', old);
		items = await rows(); assert.equal(steps()[0].state.status, 'changed');
		await editor.document.save();
		await until(() => JSON.parse(fs.readFileSync(treeUri.fsPath, 'utf8')).files.some(file => file.status === 'in-progress'), 'Save progress was not recorded');
		assert.deepEqual(JSON.parse(fs.readFileSync(treeUri.fsPath, 'utf8')).buildPlan, buildPlan);
		write('.my_editor/specs/tree.json', JSON.stringify(files));
		items = await rows(); assert.ok(items.some(item => item.label === 'Add build order and test checks'));
		assert.equal(calls.length, 0, 'Opening legacy guidance must not call a model or rewrite plans');
		await vscode.commands.executeCommand('myEditor.buildGuide.plan');
		const proposal = await until(() => vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
			tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal'), 'No build guidance proposal');
		assert.ok(JSON.stringify(calls[0].messages).includes('Estimate each source file'));
		assert.ok(JSON.stringify(calls[0].messages).includes('Preserve saved paths'));
		await vscode.commands.executeCommand('myEditor.proposal.keep', proposal.input.modified);
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/requirements.md'), 'utf8'), requirements);
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/architecture.md'), 'utf8'), architecture);
		assert.ok(JSON.parse(fs.readFileSync(treeUri.fsPath, 'utf8')).buildPlan);
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, dependencyFirst: true,
			realEntryPoint: true, testTaskExit: 0, explicitVerification: true, dirtyEditsInvalidateDependants: true,
			legacyUpgradePreservesSpecs: true, modelRequests: calls.length }, null, 2));
	} finally { server.close(); taskProvider?.dispose(); taskEnd?.dispose(); vscode.window.createTreeView = create; vscode.window.showQuickPick = pick; }
};
