/* Real editor: a long saved tree stays complete and one Generate request reaches a reviewed proposal. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');
const { requirements, architecture } = require('../../out-test/test/planningFixture');
const { finalizeChoice } = require('../../out-test/src/chat/replyChoices');

exports.run = async function () {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const files = Array.from({ length: 150 }, (_, i) => ({ path: `src/part-${i}.ts`,
		role: `Complete responsibility ${i}, including input validation and typed errors.`, requirements: ['FR-001'],
		section: 'store', status: i === 149 ? 'in-progress' : 'stub' }));
	const saved = JSON.stringify(files, null, '  ');
	assert.ok(saved.length > 30_000);
	const updated = { files: files.map(file => ({ ...file, estimatedLines: 180 })), buildPlan: {
		version: 1, entryPoint: 'src/part-0.ts', steps: [{ id: 'store', title: 'Build the storage library',
			files: files.map(file => file.path), dependsOn: [], tasks: ['Implement the saved responsibilities.'],
			checks: ['Verify all validation and error cases in the project test runner.'] }] } };
	let requests = 0, fixtureError;
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'completion' }] })); return; }
		try {
			let body = ''; for await (const chunk of req) { body += chunk; }
			const messages = JSON.parse(body).messages;
			const userContext = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n');
			assert.ok(userContext.includes(JSON.stringify(files)), 'Every saved entry must survive on every model request');
			assert.ok(userContext.includes('Write the complete file tree JSON now'));
			requests++;
			let response;
			if (requests <= 6) {
				response = { action: 'tool', name: 'read_file', arguments: { path: 'note.txt', start: requests, lines: 1 } };
			} else if (requests === 7) {
				response = { action: 'final', message: 'Say **continue** and I’ll read one range, then write the complete document for Keep.' };
			} else if (requests === 8) {
				assert.ok(userContext.includes('already authorized'));
				response = { action: 'tool', name: 'read_file', arguments: { path: 'note.txt', start: 7, lines: 1 } };
			} else {
				assert.equal(requests, 9);
				assert.ok(userContext.includes('already authorized'), 'Correction must survive further retrieval');
				response = { action: 'final', message: 'The complete tree is ready for review.\n```json\n' + JSON.stringify(updated) + '\n```' };
			}
			res.end(JSON.stringify({ message: { content: JSON.stringify(response) }, done: true }) + '\n');
		} catch (error) { fixtureError = error; res.statusCode = 500; res.end('{}'); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const write = (relative, content) => {
			const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
		};
		write('.my_editor/specs/requirements.md', requirements); write('.my_editor/specs/architecture.md', architecture);
		write('.my_editor/specs/tree.json', saved); write('note.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n');
		write('src/part-149.ts', 'export const existingWork = true;\n');
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:completion', 'claudeCli.enabled': false, 'codexCli.enabled': false, 'lmstudio.enabled': false,
			'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false, 'fileChat.followEditor': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await vscode.commands.executeCommand('myEditor.chat.ask', '/tree ' + finalizeChoice('tree').text);
		if (fixtureError) { throw fixtureError; }
		const proposal = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
			tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
		assert.ok(proposal, 'One Generate request must reach a full Keep proposal');
		assert.equal(requests, 9);
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/tree.json'), 'utf8'), saved, 'Nothing saved before Keep');
		assert.deepEqual(JSON.parse((await vscode.workspace.openTextDocument(proposal.input.modified)).getText()), updated);
		await vscode.commands.executeCommand('myEditor.proposal.keep', proposal.input.modified);
		const kept = JSON.parse(fs.readFileSync(path.join(root, '.my_editor/specs/tree.json'), 'utf8'));
		assert.deepEqual(kept.files.map(({ estimatedLines, ...file }) => file), files);
		assert.deepEqual(kept.buildPlan, updated.buildPlan);
		assert.equal(fs.readFileSync(path.join(root, 'src/part-149.ts'), 'utf8'), 'export const existingWork = true;\n');
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/requirements.md'), 'utf8'), requirements);
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/architecture.md'), 'utf8'), architecture);
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, savedTreeCharacters: saved.length,
			entriesPreserved: files.length, modelRequests: requests, generateRequests: 1, fullProposalKept: true,
			existingSourcePreserved: true, prerequisiteDocumentsPreserved: true }, null, 2));
	} finally { server.close(); }
};
