/* Build starts with visible file guidance; generation stays local, reviewed and snapshot-safe. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');
const { requirements, architecture } = require('../../out-test/test/planningFixture');
async function until(check, message) {
	const deadline = Date.now() + 15000;
	while (Date.now() < deadline) { const value = await check(); if (value) { return value; } await new Promise(resolve => setTimeout(resolve, 50)); }
	throw Error(message);
}
exports.run = async function () {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const states = [], calls = [];
	let provider, receive, release, phase = 'normal';
	const register = vscode.window.registerWebviewViewProvider;
	vscode.window.registerWebviewViewProvider = (id, value, options) => {
		if (id === 'myEditor.fileChat') {
			provider = value;
			const resolve = value.resolveWebviewView.bind(value);
			value.resolveWebviewView = view => {
				const post = view.webview.postMessage.bind(view.webview);
				view.webview.postMessage = message => { if (message.type === 'state') { states.push(structuredClone(message)); } return post(message); };
				const onMessage = view.webview.onDidReceiveMessage.bind(view.webview);
				view.webview.onDidReceiveMessage = handler => { receive = handler; return onMessage(handler); };
				return resolve(view);
			};
		}
		return register(id, value, options);
	};
	const files = ['package.json', 'tsconfig.json'].map((name, index) => ({ path: name,
		role: index ? 'Enable strict TypeScript checking.' : 'Configure workspace scripts and package metadata.',
		requirements: ['FR-001'], section: 'store', estimatedLines: 50, status: 'stub' }));
	const buildPlan = { version: 1, entryPoint: 'package.json', steps: [{ id: 'root', title: 'Set up the workspace root',
		files: files.map(file => file.path), dependsOn: [], tasks: ['Configure workspace scripts.', 'Enable strict compilation.'],
		checks: ['Parse both JSON files, then run the configured typecheck.'] }] };
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'build-start' }] })); return; }
		let body = ''; for await (const chunk of req) { body += chunk; }
		const payload = JSON.parse(body); calls.push(payload);
		if (phase === 'slow') { await new Promise(resolve => { release = resolve; }); }
		const writing = payload.messages[0].content.startsWith('Prepare the complete');
		const content = writing ? phase === 'invalid' ? '```json\n{"broken":}\n```'
			: '```json\n{"name":"workspace","private":true,"scripts":{"typecheck":"tsc --noEmit"}}\n```'
			: 'Start with package metadata and the typecheck script. This config comes before the source files. Check JSON syntax now; run typecheck once the companion config is ready.';
		res.end(JSON.stringify({ message: { content }, done: true }) + '\n');
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const cmd = (name, ...args) => vscode.commands.executeCommand(`myEditor.${name}`, ...args);
	const proposal = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
		tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
	const uri = name => vscode.Uri.file(path.join(root, name));
	try {
		fs.mkdirSync(path.join(root, '.my_editor/specs'), { recursive: true });
		for (const [name, content] of Object.entries({ 'requirements.md': requirements, 'architecture.md': architecture,
			'tree.json': JSON.stringify({ files, buildPlan }) })) { fs.writeFileSync(path.join(root, '.my_editor/specs', name), content); }
		files.forEach(file => fs.writeFileSync(path.join(root, file.path), '{}\n'));
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:build-start', 'claudeCli.enabled': false, 'codexCli.enabled': false, 'lmstudio.enabled': false,
			'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false, 'fileChat.followEditor': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await cmd('nextFile');
		await until(() => states.at(-1)?.build?.purpose.includes('workspace scripts'), 'No first-file build guidance');
		assert.equal(states.at(-1).path, 'package.json'); assert.equal(calls.length, 0);
		assert.match(states.at(-1).build.instruction, /configuration before/);
		assert.equal(states.at(-1).build.next, 'tsconfig.json');
		await cmd('fileChat.action', 'start');
		assert.ok(JSON.stringify(calls.at(-1)).includes('first concrete change'));
		assert.equal(proposal(), undefined);
		await cmd('fileChat.action', 'implement');
		assert.ok(proposal()); assert.equal(fs.readFileSync(uri('package.json').fsPath, 'utf8'), '{}\n');
		await cmd('proposal.keep', proposal().input.modified);
		assert.equal(JSON.parse(fs.readFileSync(uri('package.json').fsPath, 'utf8')).name, 'workspace');
		assert.equal(fs.existsSync(path.join(root, '.my_editor/build-progress.json')), false);
		await cmd('nextFile');
		await until(() => states.at(-1)?.path === 'tsconfig.json' && states.at(-1)?.build, 'Build did not advance to the remaining stub');
		assert.equal(states.at(-1).chat.messages.length, 0);
		const before = calls.length;
		receive({ type: 'action', key: uri('package.json').toString(), action: 'implement' });
		assert.equal(calls.length, before, 'Stale file action must be ignored');
		phase = 'slow';
		const switching = cmd('fileChat.action', 'implement');
		await until(() => release, 'Generation did not start');
		await cmd('fileChat.open', uri('package.json'));
		const packageMessages = states.at(-1).chat.messages.length;
		release(); await switching;
		assert.ok(proposal().input.modified.path.endsWith('/tsconfig.json'), 'Generation must stay with its original file');
		assert.equal(states.at(-1).path, 'package.json');
		assert.equal(states.at(-1).chat.messages.length, packageMessages, 'The other file must not receive the reply');
		await cmd('proposal.undo', proposal().input.modified);
		await cmd('fileChat.open', uri('tsconfig.json'));
		release = undefined;
		const pending = cmd('fileChat.action', 'implement');
		await until(() => release, 'Generation did not start');
		const editor = await vscode.window.showTextDocument(uri('tsconfig.json'));
		await editor.edit(edit => edit.insert(new vscode.Position(0, 0), ' '));
		release(); await pending;
		assert.equal(proposal(), undefined); assert.match(states.at(-1).error, /changed while/);
		await editor.document.save();
		phase = 'invalid';
		await cmd('fileChat.action', 'implement');
		assert.equal(proposal(), undefined); assert.match(states.at(-1).error, /invalid JSON/);
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/requirements.md'), 'utf8'), requirements);
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/architecture.md'), 'utf8'), architecture);
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.my_editor/specs/tree.json'), 'utf8')).buildPlan, buildPlan);
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, visibleFirstStep: true,
			noModelOnOpen: true, conciseHelp: true, proposalRequiresKeep: true, resumesRemainingStub: true,
			fileChatIsolated: true, staleActionBlocked: true, staleEditBlocked: true, invalidJsonBlocked: true }, null, 2));
	} finally { release?.(); server.close(); vscode.window.registerWebviewViewProvider = register; }
};
