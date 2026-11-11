/* Exercise a rejected whole-file proposal, specialist recovery, and a decision when blocked. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async () => {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const cssPath = 'src/renderer/styles.css';
	const extraPath = 'src/renderer/components.css';
	const original = 'body { margin: 0; }\n';
	const oversized = Array.from({ length: 605 }, (_, i) => '.row-' + i + ' { padding: 0; }').join('\n') + '\n';
	const split = oversized.split('\n').slice(0, 300).join('\n') + '\n';
	const replacement = '@import "./components.css";\n' + oversized.split('\n').slice(300).join('\n');
	fs.mkdirSync(path.join(root, 'src/renderer'), { recursive: true });
	fs.writeFileSync(path.join(root, cssPath), original);

	const originalPanel = vscode.window.createWebviewPanel;
	let latest, activeAgent, failure;
	vscode.window.createWebviewPanel = (...args) => {
		const panel = originalPanel(...args);
		if (args[0] === 'myEditor.chatLounge') {
			const post = panel.webview.postMessage.bind(panel.webview);
			panel.webview.postMessage = message => {
				if (['init', 'conversation'].includes(message.type)) { activeAgent = message.characterId; }
				if (message.type === 'message') { latest = message.message; }
				return post(message);
			};
		}
		return panel;
	};
	const final = message => ({ action: 'final', message });
	const propose = (path, content) => ({ action: 'tool', name: 'propose_file', arguments: { path, content } });
	let scenario = 'split', turns = 0, consults = 0;
	const server = http.createServer(async (req, res) => {
		try {
			res.setHeader('content-type', 'application/json');
			if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'repair' }] })); return; }
			let body = '';
			for await (const chunk of req) { body += chunk; }
			const { messages } = JSON.parse(body);
			const system = messages[0].content;
			const transcript = JSON.stringify(messages);
			let reply;
			if (system.includes('Give brief read-only advice to another agent')) {
				consults++;
				assert.equal(messages.length, 2, 'Guide receives only the rejection');
				assert.match(transcript, /would have 605 lines/);
				assert.doesNotMatch(transcript, /PRIVATE_BRIEF|\.row-500/);
				reply = 'Move the component rules into components.css and keep the import order.';
			} else {
				assert.match(system, /UI\/UX agent/);
				const step = ++turns;
				if (step === 1) { reply = propose(cssPath, oversized); }
				else if (step === 2) {
					assert.match(transcript, /Source policy rejected this proposal/);
					assert.match(transcript, /would have 605 lines/);
					assert.match(transcript, /preserve the cascade/);
					reply = final('The requested stylesheet exceeds the limit.');
				} else if (step === 3) {
					assert.match(transcript, /Project Guide advice/);
					assert.match(transcript, /Move the component rules into components.css/);
					reply = scenario === 'split' ? propose(extraPath, split) : final('Splitting requires a change to the requested file scope.');
				} else if (step === 4) { reply = propose(cssPath, replacement); }
				else {
					assert.equal(step, 5);
					reply = final('Two stylesheet proposals are ready for review.');
				}
			}
			res.end(JSON.stringify({ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) }, done: true }) + '\n');
		} catch (error) { failure = error; res.statusCode = 500; res.end('{}'); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const wait = async check => {
		const deadline = Date.now() + 15000;
		while (!failure && !check() && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 50)); }
		if (failure) { throw failure; }
		assert.ok(check(), JSON.stringify(latest));
	};
	const command = (name, ...args) => vscode.commands.executeCommand('myEditor.' + name, ...args);
	try {
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({
			'ollama.baseUrl': 'http://127.0.0.1:' + server.address().port, 'models.default': 'ollama:repair',
			'claudeCli.enabled': false, 'codexCli.enabled': false, 'lmstudio.enabled': false,
			'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false,
			'fileChat.followEditor': false, 'projectAgents.runtime': process.env.MY_EDITOR_UI_RUNTIME || 'builtin',
		})) { await config.update(key, value, vscode.ConfigurationTarget.Global); }
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await command('chat.agent', 'iris');
		await command('chat.ask', 'Implement the stylesheet design. Split related files as needed. PRIVATE_BRIEF');
		await wait(() => latest?.done && latest.proposals.length === 2);
		assert.equal(activeAgent, 'iris');
		assert.equal(consults, 1);
		assert.equal(latest.error, undefined);
		assert.equal(fs.readFileSync(path.join(root, cssPath), 'utf8'), original);
		assert.equal(fs.existsSync(path.join(root, extraPath)), false);
		const proposals = latest.proposals.slice();
		for (const proposal of proposals) {
			const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(item =>
				item.input instanceof vscode.TabInputTextDiff && item.input.modified.path.includes('/' + proposal.id + '/'));
			assert.ok(tab, 'Expected a review diff for ' + proposal.file);
			await command('proposal.keep', tab.input.modified);
		}
		assert.equal(fs.readFileSync(path.join(root, cssPath), 'utf8'), replacement);
		assert.equal(fs.readFileSync(path.join(root, extraPath), 'utf8'), split);

		scenario = 'blocked';
		turns = 0;
		await command('chat.ask', 'Revise only styles.css. Ask before adding another file.');
		await wait(() => latest?.done && latest.choices?.length === 2);
		assert.equal(consults, 2, 'At most one consultation per request');
		assert.equal(latest.error, undefined);
		assert.deepEqual(latest.choices.map(choice => choice.label), ['Split the files', 'Keep the current files']);
		assert.equal(latest.proposals.length, 0);
		assert.equal(fs.readFileSync(path.join(root, cssPath), 'utf8'), replacement);
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({
			ok: true, rejectedLines: 605, repairedWithGuide: true, keptBothStylesheets: true, askedWhenBlocked: true,
		}));
	} finally {
		vscode.window.createWebviewPanel = originalPanel;
		server.close();
	}
};
