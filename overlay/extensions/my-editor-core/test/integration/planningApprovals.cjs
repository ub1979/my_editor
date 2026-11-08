/* Saved planning accepts ordinary replies to a concrete offer; read-only turns remain protected. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');
const { requirements, architecture, tree } = require('../../out-test/test/planningFixture');

exports.run = async function () {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const specs = path.join(root, '.my_editor/specs');
	const files = JSON.parse(tree);
	const added = { path: 'test/connector-service.test.ts', role: 'Checks repeat posts.', requirements: ['FR-001'], section: 'store' };
	const updated = JSON.stringify([...files, added]);
	let phase = 'choices', requests = 0, fixtureError;
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'approvals' }] })); return; }
		try {
			let body = ''; for await (const chunk of req) { body += chunk; }
			const messages = JSON.parse(body).messages;
			const system = messages.find(message => message.role === 'system').content;
			requests++;
			if (system.includes('Missing planning documents are an evidence limit') && !JSON.stringify(messages).includes('Host tool result for read_file(')) {
				res.end(JSON.stringify({ message: { content: JSON.stringify({ action: 'tool', name: 'read_file',
					arguments: { path: '.my_editor/specs/tree.json' } }) }, done: true }) + '\n');
				return;
			}
			let message;
			if (phase === 'choices') {
				assert.ok(system.includes('This request is a read-only check'));
				message = 'Which tests do you want to add to the plan?\n- **Keep the plan as is:** no additions.\n'
					+ "- **Decide for me:** I'd add the X publish tests plus home-dirs for its chmod 700 rule.";
			} else if (phase === 'offer') {
				message = 'To get the update, send this message:\n\n'
					+ '`/tree Update only tree.json to add the two test files to their build steps. Preserve everything else.`';
			} else {
				assert.equal(system.includes('This request is a read-only check'), phase === 'restricted');
				message = '```json\n' + updated + '\n```';
			}
			res.end(JSON.stringify({ message: { content: JSON.stringify({ action: 'final', message }) }, done: true }) + '\n');
		} catch (error) { fixtureError = error; res.statusCode = 500; res.end('{}'); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const command = (name, ...args) => vscode.commands.executeCommand(`myEditor.${name}`, ...args);
	const proposal = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
		tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
	try {
		fs.mkdirSync(specs, { recursive: true });
		for (const [name, source] of Object.entries({ 'requirements.md': requirements, 'architecture.md': architecture, 'tree.json': tree })) {
			fs.writeFileSync(path.join(specs, name), source);
		}
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:approvals', 'claudeCli.enabled': false, 'codexCli.enabled': false, 'lmstudio.enabled': false,
			'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false, 'fileChat.followEditor': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await command('chat.ask', '/tree Check the planned tests.');
		assert.equal(proposal(), undefined);
		phase = 'accepted choice';
		await command('chat.ask', "Decide for me: I'd add the X publish tests plus home-dirs for its chmod 700 rule.");
		if (fixtureError) { throw fixtureError; }
		assert.ok(proposal(), 'The concrete Decide for me choice must produce a proposal');
		assert.equal(fs.readFileSync(path.join(specs, 'tree.json'), 'utf8'), tree);
		await command('proposal.undo', proposal().input.modified);
		phase = 'offer';
		await command('chat.ask', '/tree Explain the two additions.');
		phase = 'accepted follow-up';
		await command('chat.ask', 'ok do it');
		if (fixtureError) { throw fixtureError; }
		assert.ok(proposal(), 'A natural approval must produce a proposal without a rewritten slash command');
		await command('proposal.keep', proposal().input.modified);
		assert.ok(fs.existsSync(path.join(root, added.path)));
		const kept = fs.readFileSync(path.join(specs, 'tree.json'), 'utf8');
		phase = 'restricted';
		await command('chat.ask', '/tree Check only; do not change files.');
		if (fixtureError) { throw fixtureError; }
		assert.equal(proposal(), undefined);
		assert.equal(fs.readFileSync(path.join(specs, 'tree.json'), 'utf8'), kept);
		assert.equal(fs.readFileSync(path.join(specs, 'requirements.md'), 'utf8'), requirements);
		assert.equal(fs.readFileSync(path.join(specs, 'architecture.md'), 'utf8'), architecture);
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, requests,
			delegatedChoiceProposes: true, naturalApprovalProposes: true, keepRequired: true, readOnlyProtected: true }, null, 2));
	} finally { server.close(); }
};
