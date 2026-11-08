/* Independent specialist inspection of existing code without generated planning documents. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async () => {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const source = 'exports.save = value => value;\n';
	fs.writeFileSync(path.join(root, 'store.js'), source);
	let error, reads = 0, writesRefused = 0;
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'specialist' }] })); return; }
		try {
			let body = ''; for await (const chunk of req) { body += chunk; }
			const { messages } = JSON.parse(body), text = JSON.stringify(messages);
			assert.match(messages[0].content, /Missing planning documents are an evidence limit/);
			let answer;
			if (!messages.some(message => message.role === 'assistant')) {
				answer = { action: 'tool', name: 'propose_file', arguments: { path: 'store.js', content: 'wrong\n' } };
			} else if (!text.includes('Host tool result for read_file(')) {
				writesRefused++;
				answer = { action: 'tool', name: 'read_file', arguments: { path: 'store.js' } };
			} else {
				reads++; assert.ok(text.includes('exports.save = value'));
				answer = { action: 'final', message: 'store.js owns save(value) and returns the value. No runtime checks were executed; persistence requirements remain unspecified.' };
			}
			res.end(JSON.stringify({ message: { content: JSON.stringify(answer) }, done: true }) + '\n');
		} catch (caught) { error = caught; res.statusCode = 500; res.end('{}'); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:specialist', 'claudeCli.enabled': false, 'codexCli.enabled': false,
			'lmstudio.enabled': false, 'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		for (const mode of ['architecture', 'requirements', 'tree']) {
			await vscode.commands.executeCommand('myEditor.chat.ask', `/${mode} Review this existing repository. Check only; do not change files.`);
			if (error) { throw error; }
			assert.equal(fs.readFileSync(path.join(root, 'store.js'), 'utf8'), source);
		}
		assert.equal(reads, 3); assert.equal(writesRefused, 3);
		assert.equal(fs.existsSync(path.join(root, '.my_editor/specs/tree.json')), false);
		assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab =>
			tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal'), false);
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, independentSpecialists: 3,
			currentSourceRead: true, writesRefused: true, noGeneratedPlanningPrerequisite: true }));
	} finally { server.close(); }
};
