/* Shared live-model harness: requests are forwarded unchanged, never replaced with canned answers. */
const fs = require('node:fs');
const http = require('node:http');
const vscode = require('vscode');

function harness() {
	const report = { passed: false, model: process.env.MY_EDITOR_GLM_MODEL || 'glm-5.3-flash:cloud', checks: [], requests: [] };
	const save = () => fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify(report, null, 2));
	const server = http.createServer(async (req, res) => {
		let body = ''; for await (const chunk of req) { body += chunk; }
		const entry = req.method === 'POST' ? { request: JSON.parse(body), reply: '', started: new Date().toISOString() } : undefined;
		if (entry) { report.requests.push(entry); save(); console.log(`GLM request ${report.requests.length}`); }
		try {
			const upstream = await fetch(`http://127.0.0.1:11434${req.url}`, {
				method: req.method, ...(body ? { body, headers: { 'content-type': 'application/json' } } : {}), signal: AbortSignal.timeout(100000),
			});
			res.writeHead(upstream.status, { 'content-type': 'application/x-ndjson' });
			for await (const chunk of upstream.body) {
				if (entry) { entry.reply += Buffer.from(chunk).toString(); }
				res.write(Buffer.from(chunk));
			}
			res.end();
		} catch (error) { if (entry) { entry.error = String(error); } res.end(JSON.stringify({ error: String(error) }) + '\n'); }
		finally { if (entry) { entry.completed = new Date().toISOString(); save(); } }
	});
	return { report, save, server, async configure() {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': `ollama:${report.model}`, 'navigator.model': `ollama:${report.model}`,
			'ollama.requestTimeoutSeconds': 90, 'claudeCli.enabled': false, 'codexCli.enabled': false,
			'lmstudio.enabled': false, 'assistance.mode': 'manual', 'autoComments.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		return config;
	} };
}
async function until(check, message, timeout = 100000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const result = await check(); if (result) { return result; }
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	throw new Error(message);
}
function proposal() {
	return vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
		tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
}
function answer(entry) {
	return entry.reply.split('\n').filter(Boolean).map(line => JSON.parse(line).message?.content || '').join('');
}
module.exports = { harness, until, proposal, answer };
