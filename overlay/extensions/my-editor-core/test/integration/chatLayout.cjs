/* Measure the real webviews, including long lines and the narrow Project header. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const vscode = require('vscode');

exports.run = async () => {
	let chat, project;
	const originalPanel = vscode.window.createWebviewPanel;
	const originalProvider = vscode.window.registerWebviewViewProvider;
	const instrument = (webview, kind) => {
		webview.onDidReceiveMessage(message => {
			if (message.type === 'layoutMeasured') { if (kind === 'chat') { chat = message; } else { project = message; } }
		});
		const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(webview), 'html');
		Object.defineProperty(webview, 'html', { get: () => descriptor.get.call(webview), set: value => {
			const nonce = /nonce="([^"]+)"/.exec(value)[1];
			const code = kind === 'chat'
				? `const pre=document.querySelector('.markdown pre');const body=document.querySelector('.message.assistant .body');
if(!pre||!body)return;vscode.postMessage({type:'layoutMeasured',width:innerWidth,reply:body.clientWidth,
preWidth:pre.clientWidth,preScroll:pre.scrollWidth,wrap:getComputedStyle(pre).whiteSpace});`
				: `const buttons=[...document.querySelectorAll('.project-action')];const top=document.querySelector('.top');
if(buttons.length!==2||!top)return;vscode.postMessage({type:'layoutMeasured',width:top.clientWidth,scroll:top.scrollWidth,
buttons:buttons.map(b=>({title:b.title,label:b.getAttribute('aria-label'),width:b.clientWidth}))});`;
			descriptor.set.call(webview, value.replace('</body>', `<script nonce="${nonce}">setInterval(()=>{${code}},200);</script></body>`));
		} });
	};
	vscode.window.createWebviewPanel = (...args) => {
		const panel = originalPanel(...args);
		if (args[0] === 'myEditor.chatLounge') { instrument(panel.webview, 'chat'); }
		return panel;
	};
	vscode.window.registerWebviewViewProvider = (id, provider, options) => {
		if (id === 'myEditor.project') {
			const resolve = provider.resolveWebviewView.bind(provider);
			provider.resolveWebviewView = view => { instrument(view.webview, 'project'); return resolve(view); };
		}
		return originalProvider(id, provider, options);
	};
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'layout' }] })); return; }
		for await (const chunk of req) { /* Drain fixture request. */ }
		const message = 'Long source excerpt:\n```text\n' + 'readable content '.repeat(150) + '\n```';
		res.end(JSON.stringify({ message: { content: JSON.stringify({ action: 'final', message }) }, done: true }) + '\n');
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const until = async check => {
		const deadline = Date.now() + 15000;
		while (!check() && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 100)); }
		assert.ok(check(), 'Real webview did not report its layout');
	};
	try {
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'models.default': 'ollama:layout',
			'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`, 'claudeCli.enabled': false,
			'codexCli.enabled': false, 'lmstudio.enabled': false, 'navigator.enabled': false,
			'assistance.mode': 'manual', 'autoComments.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await vscode.commands.executeCommand('myEditor.project.focus');
		await until(() => project);
		assert.deepEqual(project.buttons.map(button => button.label), ['All projects', 'Close project']);
		assert.ok(project.buttons.every(button => button.title === button.label && button.width <= 32));
		assert.ok(project.scroll <= project.width + 1);
		await vscode.commands.executeCommand('myEditor.chat.ask', '/chat Explain this text excerpt.');
		await until(() => chat);
		assert.ok(chat.reply > chat.width * .75, JSON.stringify(chat));
		assert.ok(chat.preScroll <= chat.preWidth + 1, JSON.stringify(chat));
		assert.equal(chat.wrap, 'pre-wrap');
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, chat, project }));
	} finally {
		vscode.window.createWebviewPanel = originalPanel;
		vscode.window.registerWebviewViewProvider = originalProvider;
		server.close();
	}
};
