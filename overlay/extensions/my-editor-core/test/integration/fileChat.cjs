/* Real editor: file histories, selection, plan context, in-flight switching and inline Keep. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

async function until(check, message, timeout = 15000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const result = await check(); if (result) { return result; }
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	throw new Error(message);
}

exports.run = async function () {
	const calls = [], states = [];
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	let provider, releaseSlow, receive;
	const original = vscode.window.registerWebviewViewProvider;
	vscode.window.registerWebviewViewProvider = (id, value, options) => {
		if (id === 'myEditor.fileChat') {
			provider = value;
			const resolve = value.resolveWebviewView.bind(value);
			value.resolveWebviewView = view => {
				const post = view.webview.postMessage.bind(view.webview);
				view.webview.postMessage = message => { states.push(structuredClone(message)); return post(message); };
				const onMessage = view.webview.onDidReceiveMessage.bind(view.webview);
				view.webview.onDidReceiveMessage = handler => { receive = handler; return onMessage(handler); };
				return resolve(view);
			};
		}
		return original(id, value, options);
	};
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'file-chat' }] })); return; }
		let body = ''; for await (const chunk of req) { body += chunk; }
		const payload = JSON.parse(body); calls.push(payload);
		const last = payload.messages.at(-1).content;
		const system = payload.messages[0].content;
		if (last.includes('SLOW_A')) { await new Promise(resolve => { releaseSlow = resolve; }); }
		const content = system.startsWith('Generate only')
			? '```python\nclass Draft:\n    """Keep a draft locally until it is ready to publish."""\n    def __init__(self, text):\n        self.text = text\n```'
			: 'This file stores local drafts so reopening the editor restores your work. The saved plan links it to FR-001 and #storage.';
		res.end(JSON.stringify({ message: { content }, done: true }) + '\n');
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const command = (name, ...args) => vscode.commands.executeCommand(`myEditor.fileChat.${name}`, ...args);
	const contains = (call, text) => JSON.stringify(call.messages).includes(text);
	const write = (file, text) => {
		const uri = vscode.Uri.file(path.join(root, file)); fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
		fs.writeFileSync(uri.fsPath, text); return uri;
	};
	try {
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:file-chat', 'claudeCli.enabled': false, 'codexCli.enabled': false,
			'lmstudio.enabled': false, 'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		write('.my_editor/specs/tree.json', JSON.stringify({ files: [
			{ path: 'a/file.py', role: 'LOCAL_DRAFT_INTENT', section: 'storage', requirements: ['FR-001'] },
			{ path: 'b/file.py', role: 'UNRELATED_B_INTENT', section: 'other', requirements: ['FR-002'] }] }));
		const architecture = '# Architecture\n## Storage {#storage}\nPERSIST_ACROSS_RESTART. Interface saveDraft(). FR-001.\n## Other {#other}\nUNRELATED_OTHER_COMPONENT\n';
		write('.my_editor/specs/architecture.md', architecture);
		write('.my_editor/specs/requirements.md', '# Requirements\nFR-001 Save local drafts.\nAcceptance: reopen and find the draft.\n');
		const a = write('a/file.py', '#AI write a Draft class\n\nexisting = 42\n');
		const b = write('b/file.py', 'only_b = 12\n');
		const open = async uri => {
			const editor = await vscode.window.showTextDocument(uri, { preview: false });
			await until(() => provider?.editor?.document.uri.toString() === uri.toString(), 'File scope did not follow the editor');
			await until(() => states.at(-1)?.key === uri.toString(), 'File view did not follow the editor');
			return editor;
		};
		let editor = await open(a);
		assert.equal(calls.length, 0, 'Opening a file must offer help without a model request');
		const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', a);
		assert.ok(lenses.some(lens => lens.command?.title === 'Why did we plan this file?'));
		await command('ask', 'A_PRIVATE_11: why this file?');
		assert.ok(contains(calls.at(-1), 'LOCAL_DRAFT_INTENT'));
		assert.ok(contains(calls.at(-1), 'PERSIST_ACROSS_RESTART'));
		assert.ok(!contains(calls.at(-1), 'UNRELATED_OTHER_COMPONENT'));
		assert.ok(contains(calls.at(-1), 'normally under 80 words'));
		receive({ type: 'draft', key: a.toString(), text: 'A unsent draft' });
		await open(b);
		assert.equal(states.at(-1).chat.messages.length, 0);
		await command('ask', 'B_PRIVATE_22');
		assert.ok(!contains(calls.at(-1), 'A_PRIVATE_11'));
		assert.ok(!contains(calls.at(-1), 'LOCAL_DRAFT_INTENT'));
		const before = calls.length;
		editor = await open(a);
		assert.equal(calls.length, before);
		assert.equal(states.at(-1).chat.draft, 'A unsent draft');
		assert.ok(states.at(-1).chat.messages.some(message => message.text.includes('A_PRIVATE_11')));
		assert.ok(!JSON.stringify(states.at(-1).chat).includes('B_PRIVATE_22'));
		await editor.edit(edit => edit.insert(new vscode.Position(2, 0), '# DIRTY_BUFFER\n'));
		editor.selection = new vscode.Selection(3, 0, 3, 13);
		await command('review');
		assert.ok(contains(calls.at(-1), 'DIRTY_BUFFER'));
		assert.ok(contains(calls.at(-1), 'Selected lines 4–4'));
		assert.equal(states.at(-1).chat.draft, 'A unsent draft', 'A quick action must preserve an unsent question');
		assert.ok(!contains(calls.at(-1), 'B_PRIVATE_22'));
		assert.ok(!fs.readFileSync(a.fsPath, 'utf8').includes('DIRTY_BUFFER'));
		const pending = command('ask', 'SLOW_A');
		await until(() => releaseSlow, 'Slow request did not start');
		await open(b);
		receive({ type: 'send', key: a.toString(), text: 'STALE_CLICK' });
		releaseSlow(); await pending;
		assert.equal(states.at(-1).key, b.toString());
		assert.ok(!JSON.stringify(states.at(-1).chat).includes('SLOW_A'));
		assert.ok(!calls.some(call => contains(call, 'STALE_CLICK')));
		await command('new');
		assert.equal(states.at(-1).chat.messages.length, 0);
		editor = await open(a);
		assert.ok(states.at(-1).chat.messages.some(message => message.text === 'SLOW_A'));
		await provider.saving;
		const saved = provider.context.workspaceState.get('myEditor.fileChats.v1');
		assert.ok(saved[a.toString()].messages.some(message => message.text === 'SLOW_A'));
		assert.equal(saved[b.toString()].messages.length, 0);
		const base = editor.document.getText();
		await vscode.commands.executeCommand('myEditor.inlineAi.generate', a, 0);
		const diff = await until(() => vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
			tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal'), 'No inline proposal');
		assert.ok(contains(calls.at(-1), 'LOCAL_DRAFT_INTENT'));
		assert.ok(contains(calls.at(-1), 'Match its existing naming'));
		assert.equal(editor.document.getText(), base, 'Code must stay unchanged before Keep');
		await vscode.commands.executeCommand('myEditor.proposal.keep', diff.input.modified);
		assert.ok(fs.readFileSync(a.fsPath, 'utf8').includes('class Draft:'));
		assert.ok(fs.readFileSync(a.fsPath, 'utf8').endsWith('# DIRTY_BUFFER\nexisting = 42\n'));
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/architecture.md'), 'utf8'), architecture);
		if (process.env.MY_EDITOR_FILE_CHAT_VISUAL) {
			await open(a); await command('open');
			fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ phase: 'visual', root }));
			await until(() => fs.existsSync(path.join(root, 'visual-ok')), 'Visual check timed out', 180000);
		}
		const secret = write('.env', 'TOKEN=secret\n');
		await vscode.window.showTextDocument(secret);
		await until(() => !states.at(-1).key, 'Secret file retained another file context');
		const count = calls.length; await command('ask', 'read this'); assert.equal(calls.length, count);
		assert.equal(vscode.workspace.getConfiguration('myEditor').get('models.default'), 'ollama:file-chat');
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, calls: calls.length,
			isolatedHistories: true, linkedPlanContext: true, selectionAndUnsavedSource: true, switchDuringReply: true,
			draftsAndPersistence: true, inlineGenerationAndKeep: true, unchangedPlans: true, noGenerationOnOpen: true }, null, 2));
	} finally { server.close(); vscode.window.registerWebviewViewProvider = original; }
};
