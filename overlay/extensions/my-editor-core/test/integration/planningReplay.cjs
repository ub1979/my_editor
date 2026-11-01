/* Replay a captured planning response in a disposable editor; never touch the source project. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

function proposalTab() {
	return vscode.window.tabGroups.all.flatMap(group => group.tabs)
		.find(tab => tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
}

async function until(check, message) {
	const end = Date.now() + 10000;
	while (Date.now() < end) {
		if (await check()) { return; }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw Error(message);
}

exports.run = async function () {
	assert.ok(process.env.MY_EDITOR_PLANNING_REPLAY, 'Supply a local captured response fixture');
	const fixture = JSON.parse(fs.readFileSync(process.env.MY_EDITOR_PLANNING_REPLAY, 'utf8'));
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const specs = path.join(root, '.my_editor/specs');
	const sections = [...new Set(JSON.parse(fixture.tree).map(file => file.section.replace(/^#/, '')))];
	let requests = 0, fixtureError;
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'planning-replay' }] })); return; }
		try {
			requests++;
			let body = ''; for await (const chunk of req) { body += chunk; }
			const payload = JSON.parse(body);
			const input = payload.messages.at(-1).content;
			assert.ok(input.includes('All saved tree section values (read directly by the editor): ' + sections.join(', ')));
			res.end(JSON.stringify({ message: { content: JSON.stringify({ action: 'final', message: fixture.reply }) }, done: true }) + '\n');
		} catch (error) { fixtureError = error; res.statusCode = 500; res.end('{}'); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		fs.mkdirSync(specs, { recursive: true });
		for (const name of ['requirements', 'architecture', 'tree']) {
			fs.writeFileSync(path.join(specs, name + (name === 'tree' ? '.json' : '.md')), fixture[name]);
		}
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:planning-replay', 'claudeCli.enabled': false, 'codexCli.enabled': false,
			'lmstudio.enabled': false, 'assistance.mode': 'manual', 'autoComments.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await vscode.commands.executeCommand('myEditor.chat.ask', '/architecture Prepare the complete saved architecture for review.');
		await until(() => proposalTab() || fixtureError, 'The captured architecture did not reach Keep');
		if (fixtureError) { throw fixtureError; }
		assert.equal(fs.readFileSync(path.join(specs, 'architecture.md'), 'utf8'), fixture.architecture);
		assert.equal(await vscode.commands.executeCommand('myEditor.proposal.keep', proposalTab().input.modified), true);
		const expected = fixture.expected.endsWith('\n') ? fixture.expected : fixture.expected + '\n';
		assert.equal(fs.readFileSync(path.join(specs, 'architecture.md'), 'utf8'), expected);
		const beforeRetry = requests;
		await vscode.commands.executeCommand('myEditor.reviewPlanningReply', 'architecture', fixture.reply);
		await until(proposalTab, 'The retained reply did not reopen for review');
		assert.equal(requests, beforeRetry, 'Review saved architecture must not call a model');
		assert.equal(await vscode.commands.executeCommand('myEditor.proposal.keep', proposalTab().input.modified), true);
		assert.equal(fs.readFileSync(path.join(specs, 'architecture.md'), 'utf8'), expected);
		assert.equal(fs.readFileSync(path.join(specs, 'requirements.md'), 'utf8'), fixture.requirements);
		assert.equal(fs.readFileSync(path.join(specs, 'tree.json'), 'utf8'), fixture.tree);
		assert.equal(vscode.workspace.getConfiguration('myEditor').get('models.default'), 'ollama:planning-replay');
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, sections: sections.length,
			capturedReplyKept: true, retainedReplyReopenedWithoutModel: true, requirementsAndTreeUnchanged: true, modelSelectionUnchanged: true }, null, 2));
	} finally { server.close(); }
};
