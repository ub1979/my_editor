/* Real editor host: Keep, visible handoffs, agent routing and the Build chooser. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');
const { requirements, architecture, tree } = require('../../out-test/test/planningFixture');

exports.run = async () => {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const originalPanel = vscode.window.createWebviewPanel;
	const originalPick = vscode.window.showQuickPick;
	let receive, webview, transcript = [], conversation, mode, error, requests = 0, buildChooser = false, usedButton;
	vscode.window.createWebviewPanel = (...args) => {
		const panel = originalPanel(...args);
		if (args[0] === 'myEditor.chatLounge') {
			webview = panel.webview;
			const html = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(webview), 'html');
			Object.defineProperty(webview, 'html', { get: () => html.get.call(webview), set: value => {
				const nonce = /nonce="([^"]+)"/.exec(value)[1];
				const script = `window.addEventListener('message', event => {
 const {type, label} = event.data;
 const button = document.querySelector('.agent-start:not([hidden]) button');
 if (type === 'testAgentStartState') {
   vscode.postMessage({type, text: button?.textContent, background: button && getComputedStyle(button).backgroundColor});
   return;
 }
 if (type !== 'testClickAgentStart') return;
 if (button?.textContent === label && !button.disabled) button.click();
 else vscode.postMessage({type: 'testAgentStartMissing', text: button?.textContent});
});`;
				html.set.call(webview, value.replace('</body>', `<script nonce="${nonce}">${script}</script></body>`));
			} });
			const post = panel.webview.postMessage.bind(panel.webview);
			panel.webview.postMessage = message => {
				if (message.type === 'init' || message.type === 'conversation') {
					conversation = message.conversationId; mode = message.mode; transcript = message.messages;
				} else if (message.type === 'messages') { transcript = message.messages; }
				else if (message.type === 'message') {
					const index = transcript.findIndex(item => item.id === message.message.id);
					if (index < 0) { transcript.push(message.message); } else { transcript[index] = message.message; }
				}
				return post(message);
			};
			const onMessage = panel.webview.onDidReceiveMessage;
			panel.webview.onDidReceiveMessage = (listener, ...rest) => {
				receive = listener;
				return onMessage(message => {
					if (message.type === 'testAgentStartMissing') { error = Error(`Agent start button missing or disabled: ${message.text}`); }
					if (message.type === 'testAgentStartState') { usedButton = message; }
					return listener(message);
				}, ...rest);
			};
		}
		return panel;
	};
	const until = async (check, why) => {
		const deadline = Date.now() + 15000;
		while (Date.now() < deadline) {
			if (error) { throw error; }
			if (check()) { return; }
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		throw Error(why + '\n' + JSON.stringify({ conversation, mode, transcript }));
	};
	const proposal = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
		tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
	const latest = () => transcript.at(-1);
	const command = (name, ...args) => vscode.commands.executeCommand('myEditor.' + name, ...args);
	const start = label => webview.postMessage({ type: 'testClickAgentStart', label });
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'handoff' }] })); return; }
		try {
			let body = ''; for await (const chunk of req) { body += chunk; }
			const { messages } = JSON.parse(body), system = messages[0].content;
			requests++;
			let document, language;
			if (system.includes('Mode: requirements.')) { document = requirements; language = 'markdown'; }
			else if (system.includes('Mode: architecture.')) {
				assert.ok(JSON.stringify(messages).includes('FR-001 MUST save a draft'));
				assert.ok(!JSON.stringify(messages).includes('REQ_CHAT_ONLY_123'), 'Source interview must stay in Requirements');
				document = architecture; language = 'markdown';
			} else { assert.ok(system.includes('Mode: tree.')); document = tree; language = 'json'; }
			res.end(JSON.stringify({ message: { content: JSON.stringify({ action: 'final',
				message: 'Document ready for Keep.\n```' + language + '\n' + document + '\n```' }) }, done: true }) + '\n');
		} catch (caught) { error = caught; res.statusCode = 500; res.end('{}'); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:handoff', 'claudeCli.enabled': false, 'codexCli.enabled': false,
			'lmstudio.enabled': false, 'assistance.mode': 'manual', 'autoComments.enabled': false,
			'navigator.enabled': false, 'fileChat.followEditor': false,
			'projectAgents.runtime': process.env.MY_EDITOR_UI_RUNTIME || 'builtin' })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await command('chat.ask', '/requirements Write the complete requirements now. REQ_CHAT_ONLY_123');
		await until(() => proposal() && latest()?.done, 'Requirements proposal missing');
		assert.match(latest().nextStep, /Keep.*Architecture/);
		assert.deepEqual(latest().choices, []);
		assert.equal(fs.existsSync(path.join(root, '.my_editor/specs/requirements.md')), false);
		await command('proposal.keep', proposal().input.modified);
		await until(() => latest()?.choices?.[0]?.label === 'Continue to Architecture', 'Keep did not suggest Architecture');
		assert.equal(requests, 1, 'Keep must not ask a model for a suggestion');
		await command('chat.agent', 'flow');
		await webview.postMessage({ type: 'testAgentStartState' });
		await until(() => usedButton?.text === 'Check prerequisites', 'Fresh check button missing');
		const freshColor = usedButton.background;
		await start('Check prerequisites');
		await until(() => latest()?.done && latest().html.includes('finish and Keep Architecture'), 'Flow did not explain its missing prerequisite');
		assert.equal(requests, 1, 'Checking prerequisites must not call the model');
		await command('chat.agent', 'lisko');
		await command('chat.agent', 'flow');
		await webview.postMessage({ type: 'testAgentStartState' });
		await until(() => usedButton?.text === 'Check prerequisitesUsed', 'Used check button did not survive agent switching');
		assert.notEqual(usedButton.background, freshColor, 'Used button needs a different color');
		await command('chat.agent', 'lisko');
		assert.equal(requests, 1, 'Opening Architecture must not start a model request');
		await start('Design architecture');
		await until(() => conversation === 'lisko' && proposal() && latest()?.done, 'Architecture button did not produce a proposal');
		assert.equal(requests, 2);
		const architectureProposal = proposal().input.modified;
		await command('chat.agent', 'soki');
		assert.equal(mode, 'requirements', 'Handoff must preserve the source agent mode');
		await command('proposal.keep', architectureProposal);
		await command('chat.agent', 'lisko');
		await until(() => latest()?.choices?.[0]?.label === 'Continue to Flow & tree', 'Hidden Architecture chat missed its Keep update');
		await command('chat.agent', 'flow');
		await start('Generate file tree');
		await until(() => conversation === 'flow' && proposal() && latest()?.done, 'Flow button did not produce a proposal');
		assert.equal(requests, 3);
		await command('proposal.keep', proposal().input.modified);
		await until(() => latest()?.choices?.[0]?.label === 'Continue to Build', 'Tree Keep did not suggest Build');
		vscode.window.showQuickPick = async () => { buildChooser = true; return undefined; };
		receive({ type: 'answer', id: latest().id, index: 0 });
		await until(() => conversation === 'ada' && buildChooser, 'Build handoff did not open the run chooser');
		assert.equal(requests, 3, 'Build must wait for run options instead of generating more plans');
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true,
			handoffs: ['Requirements → Architecture', 'Architecture → Flow & tree', 'Flow & tree → Build'],
			keepFirst: true, agentButtonsClicked: true, usedButtonColor: true, prerequisitesCheckedWithoutModel: true,
			sourceChatPreserved: true, hiddenChatRefreshed: true, buildChooserOpened: true }));
	} finally {
		vscode.window.createWebviewPanel = originalPanel;
		vscode.window.showQuickPick = originalPick;
		server.close();
	}
};
