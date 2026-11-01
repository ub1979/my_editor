/* Real GLM editor-host checks. The proxy records traffic and forwards it unchanged to Ollama. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');

const report = { passed: false, model: process.env.MY_EDITOR_GLM_MODEL || 'glm-5.3-flash:cloud', checks: [], requests: [] };
function save() { fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify(report, null, 2)); }
async function until(check, message, timeout = 240000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const result = await check();
		if (result) { return result; }
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	throw new Error(message);
}
function proposal() {
	return vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
		tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
}
async function forward(req, res) {
	let body = ''; for await (const chunk of req) { body += chunk; }
	const entry = req.method === 'POST' ? { request: JSON.parse(body), reply: '', started: new Date().toISOString() } : undefined;
	if (entry) { report.requests.push(entry); save(); console.log(`GLM request ${report.requests.length}`); }
	try {
		const upstream = await fetch(`http://127.0.0.1:11434${req.url}`, {
			method: req.method, ...(body ? { body, headers: { 'content-type': 'application/json' } } : {}),
			signal: AbortSignal.timeout(100000),
		});
		res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
		for await (const chunk of upstream.body) {
			if (entry) { entry.reply += Buffer.from(chunk).toString(); }
			res.write(Buffer.from(chunk));
		}
		res.end();
	} catch (error) {
		if (entry) { entry.error = String(error); }
		res.end(JSON.stringify({ error: String(error) }) + '\n');
	} finally { if (entry) { entry.completed = new Date().toISOString(); save(); } }
}
async function keepProposal() {
	const tab = await until(proposal, 'GLM did not produce a file proposal');
	const document = await vscode.workspace.openTextDocument(tab.input.modified);
	const text = document.getText();
	await vscode.commands.executeCommand('myEditor.proposal.keep', tab.input.modified);
	await until(() => !proposal(), 'Kept proposal did not close', 10000);
	return text;
}
function python(root, code) { return execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8' }); }

exports.run = async function () {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const server = http.createServer(forward);
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': `ollama:${report.model}`, 'ollama.requestTimeoutSeconds': 90,
			'claudeCli.enabled': false, 'codexCli.enabled': false, 'lmstudio.enabled': false,
			'assistance.mode': 'manual', 'autoComments.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		fs.mkdirSync(path.join(root, '.my_editor/brain'), { recursive: true });
		const brain = '# Project brain\nProject mascot: lavender otter\npricing.py contains subtotal(values). Its body must be exactly return sum(values), including zero for empty input.\n';
		fs.writeFileSync(path.join(root, '.my_editor/brain/index.md'), brain);
		const original = '"""Small pricing example."""\n\nUNCHANGED = "preserve-me"\n\ndef subtotal(values):\n    return sum(values) + 1\n';
		const file = vscode.Uri.file(path.join(root, 'pricing.py'));
		fs.writeFileSync(file.fsPath, original);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
		await vscode.commands.executeCommand('myEditor.chat.ask',
			'Read .my_editor/brain/index.md using read_file, then read pricing.py. Fix only subtotal to match the brain. '
			+ 'Propose the complete pricing.py, preserving all other content. This small change is authorized. '
			+ 'Use exactly return sum(values) as the function body. In your final response mention the project mascot from the brain.');
		const edited = await keepProposal();
		assert.equal(edited, original.replace('sum(values) + 1', 'sum(values)'), 'Only the requested function body should change');
		assert.equal(fs.readFileSync(file.fsPath, 'utf8'), edited);
		python(root, 'from pricing import subtotal, UNCHANGED\nassert subtotal([]) == 0\nassert subtotal([2, 3]) == 5\nassert subtotal([-2, 1]) == -1\nassert UNCHANGED == "preserve-me"');
		const traffic = JSON.stringify(report.requests);
		assert.ok(traffic.includes('Host tool result for read_file(.my_editor/brain/index.md:1)'), 'GLM must request and receive the brain through host tools');
		assert.ok(traffic.includes('Host tool result for read_file(pricing.py:1)'), 'GLM must read the source through host tools');
		assert.ok(traffic.includes('lavender otter'));
		report.checks.push('GLM read brain and current source using host tools', 'GLM changed only subtotal; Python behavior checks passed'); save();

		const source = '"""Inline generation example."""\n\nBEFORE = "untouched"\n\n'
			+ '#Ai <Write exactly one function named clamp(value, lower, upper) returning value limited to the inclusive bounds. Raise ValueError when lower exceeds upper. No imports, helpers, tests, examples, or other changes.>\n'
			+ '\nAFTER = "also-untouched"\n';
		const inlineFile = vscode.Uri.file(path.join(root, 'inline.py'));
		fs.writeFileSync(inlineFile.fsPath, source);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(inlineFile));
		await vscode.commands.executeCommand('myEditor.inlineAi.generate', inlineFile, 4);
		assert.equal(fs.readFileSync(inlineFile.fsPath, 'utf8'), source, 'Generation requires Keep');
		const generated = await keepProposal();
		const offset = source.indexOf('\n', source.indexOf('#Ai'));
		assert.ok(generated.startsWith(source.slice(0, offset)), 'Prefix must stay byte-identical');
		assert.ok(generated.endsWith(source.slice(offset)), 'Suffix must stay byte-identical');
		const inserted = generated.slice(offset + 1, generated.length - source.slice(offset).length);
		fs.writeFileSync(path.join(root, 'snippet.txt'), inserted);
		python(root, 'import ast\nfrom inline import clamp, BEFORE, AFTER\nnodes = ast.parse(open("snippet.txt").read()).body\nassert len(nodes) == 1 and isinstance(nodes[0], ast.FunctionDef) and nodes[0].name == "clamp"\nassert clamp(5, 1, 9) == 5\nassert clamp(-1, 1, 9) == 1\nassert clamp(12, 1, 9) == 9\nassert clamp(1, 1, 1) == 1\ntry:\n    clamp(3, 9, 1)\nexcept ValueError:\n    pass\nelse:\n    raise AssertionError("invalid bounds accepted")\nassert BEFORE == "untouched" and AFTER == "also-untouched"');
		assert.equal(fs.readFileSync(file.fsPath, 'utf8'), edited, 'Inline generation must not touch another file');
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/brain/index.md'), 'utf8'), brain);
		report.checks.push('#Ai generated exactly one requested function; AST and Python behavior checks passed', 'Surrounding code, other source and brain preserved');
		report.passed = true; save();
	} catch (error) { report.error = String(error); report.stack = error.stack; save(); throw error; }
	finally { server.close(); }
};
