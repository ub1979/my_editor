/* Editor-host smoke tests: deterministic Ollama fixture, real proposal diffs and persistent Python terminal. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

async function until(check, message, timeout = 20000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const value = await check();
		if (value) { return value; }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(message);
}

function proposalTab() {
	return vscode.window.tabGroups.all.flatMap(group => group.tabs)
		.find(tab => tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
}

exports.run = async function () {
	const requests = [];
	const report = process.env.MY_EDITOR_INTEGRATION_REPORT;
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'fixture' }] })); return; }
		let body = ''; for await (const chunk of req) { body += chunk; }
		const payload = JSON.parse(body);
		requests.push(payload);
		const system = payload.messages.find(message => message.role === 'system')?.content ?? '';
		const last = payload.messages.at(-1).content;
		let content;
		if (system.startsWith('Generate only')) { content = '```python\ndef doubled(value):\n    return value * 2\n```'; }
		else if (system.includes('You are the navigator')) { content = '[]'; }
		else if (last.includes('Host tool result for read_file(sample.py:1)')) {
			assert.ok(last.includes('def doubled'), 'The host must return current source to the model');
			assert.ok(last.includes('# unsaved editor context'), 'The host must read unsaved editor text');
			content = '{"action":"propose_file","arguments":{"path":"nested/hello.txt","content":"Hello world\\n"}}';
		}
		else if (last.includes('Host tool result')) { content = '{"action":"final","message":"The file proposal is ready for Keep."}'; }
		else if (last.includes('delete fixture')) { content = '{"action":"tool","name":"propose_delete","arguments":{"path":"nested/hello.txt"}}'; }
		else if (last.includes('create fixture')) {
			assert.ok(system.includes('Brain fixture: sample.py defines the demonstration function.'), 'The model must receive the project brain');
			content = '{"action":"tool","name":"read_file","arguments":{"path":"sample.py"}}';
		}
		else { content = '{"action":"final","message":"The declaration is ready for review."}'; }
		res.end(JSON.stringify({ message: { content }, done: true }) + '\n');
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:fixture', 'claudeCli.enabled': false, 'codexCli.enabled': false,
			'lmstudio.enabled': false, 'assistance.mode': 'manual', 'autoComments.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		fs.mkdirSync(path.join(root, '.my_editor/brain'), { recursive: true });
		fs.writeFileSync(path.join(root, '.my_editor/brain/index.md'), 'Brain fixture: sample.py defines the demonstration function.\n');
		const source = '#Ai <make a function that doubles a number>\n\nuntouched = 7\n';
		const file = vscode.Uri.file(path.join(root, 'sample.py'));
		fs.writeFileSync(file.fsPath, source);
		const document = await vscode.workspace.openTextDocument(file);
		await vscode.window.showTextDocument(document);
		const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', file);
		assert.ok(lenses.some(lens => lens.command?.command === 'myEditor.inlineAi.generate'));
		await vscode.commands.executeCommand('myEditor.inlineAi.generate', file, 0);
		const inline = await until(proposalTab, 'No inline proposal');
		assert.equal(fs.readFileSync(file.fsPath, 'utf8'), source, 'generation must not write before Keep');
		await vscode.commands.executeCommand('myEditor.proposal.keep', inline.input.modified);
		assert.equal(fs.readFileSync(file.fsPath, 'utf8'), '#Ai <make a function that doubles a number>\ndef doubled(value):\n    return value * 2\n\nuntouched = 7\n');

		const python = vscode.Uri.file(path.join(root, 'run.py'));
		fs.writeFileSync(python.fsPath, 'answer = 40\nwith open("python-state.txt", "w") as result:\n    result.write(str(answer + 2))\n');
		const pyDocument = await vscode.workspace.openTextDocument(python);
		const editor = await vscode.window.showTextDocument(pyDocument);
		editor.selection = new vscode.Selection(0, 0, 1, 0);
		await vscode.commands.executeCommand('myEditor.python.runSelection');
		editor.selection = new vscode.Selection(1, 0, 3, 0);
		await vscode.commands.executeCommand('myEditor.python.runSelection');
		await until(() => fs.existsSync(path.join(root, 'python-state.txt')), 'Python session did not execute');
		assert.equal(fs.readFileSync(path.join(root, 'python-state.txt'), 'utf8'), '42', 'Python must retain variables between selections');
		await vscode.commands.executeCommand('myEditor.python.restart');

		await vscode.commands.executeCommand('myEditor.assistance.review');
		assert.ok(requests.some(request => request.messages[0].content.includes('You are the navigator')));
		const automatic = () => requests.filter(request => request.messages[0].content.includes('You are the navigator')
			&& request.messages.at(-1).content.includes('File: run.py')).length;
		await config.update('assistance.mode', 'auto', vscode.ConfigurationTarget.Global);
		const autoFile = vscode.Uri.file(path.join(root, 'auto.py'));
		const autoSource = 'keep = 1\n#Ai <make a small function>';
		fs.writeFileSync(autoFile.fsPath, autoSource);
		const autoDoc = await vscode.workspace.openTextDocument(autoFile);
		const autoEditor = await vscode.window.showTextDocument(autoDoc);
		await autoEditor.edit(edit => edit.insert(autoDoc.lineAt(autoDoc.lineCount - 1).range.end, '\n'));
		const autoProposal = await until(proposalTab, 'Enter after an AI directive did not propose a snippet');
		assert.equal(fs.readFileSync(autoFile.fsPath, 'utf8'), autoSource);
		await vscode.commands.executeCommand('myEditor.proposal.keep', autoProposal.input.modified);
		assert.equal(fs.readFileSync(autoFile.fsPath, 'utf8'), autoSource + '\ndef doubled(value):\n    return value * 2\n');
		const symbolProvider = vscode.languages.registerDocumentSymbolProvider('python', { provideDocumentSymbols: () => [
			new vscode.DocumentSymbol('Example', '', vscode.SymbolKind.Class, new vscode.Range(0, 0, 0, 11), new vscode.Range(0, 0, 0, 11))] });
		const offers = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', python);
		assert.ok(offers.some(lens => lens.command?.title === 'AI: suggest tests'));
		assert.ok(offers.some(lens => lens.command?.title === 'AI: suggest accessors'));
		symbolProvider.dispose();
		const reviewEditor = await vscode.window.showTextDocument(pyDocument);
		const previous = automatic();
		await reviewEditor.edit(edit => edit.insert(new vscode.Position(0, 0), '# automatic review\n'));
		await until(() => automatic() > previous, 'Automatic review did not run while typing', 15000);
		await config.update('assistance.mode', 'manual', vscode.ConfigurationTarget.Global);
		const manualCount = automatic();
		await reviewEditor.edit(edit => edit.insert(new vscode.Position(0, 0), '# manual mode\n'));
		await new Promise(resolve => setTimeout(resolve, 9000));
		assert.equal(automatic(), manualCount, 'Manual mode must not start background reviews');
		const manualOffers = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', python);
		assert.ok(!manualOffers.some(lens => lens.command?.command === 'myEditor.assistance.symbol'));
		if (process.env.MY_EDITOR_ASSERT_SAVE_GATE) {
			const large = vscode.Uri.file(path.join(root, 'over-limit.ts'));
			fs.writeFileSync(large.fsPath, '// original\n');
			const largeDoc = await vscode.workspace.openTextDocument(large);
			const largeEditor = await vscode.window.showTextDocument(largeDoc);
			await largeEditor.edit(edit => edit.replace(new vscode.Range(0, 0, largeDoc.lineCount, 0), '// line\n'.repeat(301)));
			await largeDoc.save();
			assert.ok(largeDoc.isDirty, 'Saving 301 source lines must keep the buffer dirty');
			assert.equal(fs.readFileSync(large.fsPath, 'utf8'), '// original\n');
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}
		const sourceEditor = await vscode.window.showTextDocument(document);
		await sourceEditor.edit(edit => edit.insert(new vscode.Position(0, 0), '# unsaved editor context\n'));
		assert.ok(!fs.readFileSync(file.fsPath, 'utf8').includes('# unsaved editor context'));
		await vscode.commands.executeCommand('myEditor.chat.ask', 'Please create fixture in nested/hello.txt.');
		const created = await until(proposalTab, 'No new-file proposal');
		assert.equal(fs.existsSync(path.join(root, 'nested')), false);
		await vscode.commands.executeCommand('myEditor.proposal.keep', created.input.modified);
		assert.equal(fs.readFileSync(path.join(root, 'nested/hello.txt'), 'utf8'), 'Hello world\n');
		assert.ok(requests.some(request => request.messages.some(message => message.content.includes('Host tool result for read_file(sample.py:1)'))));
		await vscode.commands.executeCommand('myEditor.chat.ask', 'Please delete fixture nested/hello.txt.');
		const deleted = await until(proposalTab, 'No deletion proposal');
		await vscode.commands.executeCommand('myEditor.proposal.keep', deleted.input.modified);
		assert.equal(fs.existsSync(path.join(root, 'nested/hello.txt')), false);
		if (report) { fs.writeFileSync(report, JSON.stringify({ passed: true, checks: ['inline insertion and Keep', 'automatic AI directive on Enter', 'persistent Python selections', 'automatic and manual review', 'test/accessor offers', 'host file reads and brain context', 'nested file creation', 'reviewed deletion', ...(process.env.MY_EDITOR_ASSERT_SAVE_GATE ? ['300-line save gate'] : [])], requests: requests.length })); }
	} catch (error) {
		if (report) { fs.writeFileSync(report, JSON.stringify({ passed: false, error: String(error), stack: error.stack, requests: requests.map(item => item.messages.at(-1)) })); }
		throw error;
	} finally { server.close(); }
};
