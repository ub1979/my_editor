/* Real editor host: verify requests contain only the selected agent's live conversation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async function () {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const calls = [];
	let fixtureError;
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'agent-chats' }] })); return; }
		try {
			let body = ''; for await (const chunk of req) { body += chunk; }
			const payload = JSON.parse(body);
			calls.push(payload);
			res.end(JSON.stringify({ message: { content: JSON.stringify({ action: 'final', message: `Acknowledged exchange ${calls.length}.` }) }, done: true }) + '\n');
		} catch (error) { fixtureError = error; res.statusCode = 500; res.end('{}'); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const invoke = (command, ...args) => vscode.commands.executeCommand(`myEditor.chat.${command}`, ...args);
	const ask = async text => {
		const before = calls.length;
		await invoke('ask', text);
		if (fixtureError) { throw fixtureError; }
		assert.equal(calls.length, before + 1, `Expected one response to ${text}`);
		return calls.at(-1);
	};
	const includes = (payload, marker) => JSON.stringify(payload.messages).includes(marker);
	try {
		fs.mkdirSync(path.join(root, '.my_editor/specs'), { recursive: true });
		const requirements = '# Requirements\n## Goal\nSave drafts.\n## Users\nWriters.\n'
			+ '## Functional requirements\nFR-001 MUST save drafts. Acceptance: reopen a saved draft.\n'
			+ '## Non-functional requirements\nNFR-001 SHOULD recover drafts. Acceptance: restore after restart.\n'
			+ '## Out of scope\nTeam accounts.\n';
		fs.writeFileSync(path.join(root, '.my_editor/specs/requirements.md'), requirements);
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:agent-chats', 'claudeCli.enabled': false, 'codexCli.enabled': false,
			'lmstudio.enabled': false, 'assistance.mode': 'manual', 'autoComments.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		// Open the UI before running requests so its initial ready handshake has finished.
		await invoke('start', 'requirements');
		await new Promise(resolve => setTimeout(resolve, 500));
		const req = await ask('/requirements Discuss REQ_ONLY_17');
		assert.ok(includes(req, 'Requirements agent'));
		const arch = await ask('/architecture Discuss ARCH_ONLY_42');
		assert.ok(includes(arch, 'Architecture agent'));
		assert.ok(!includes(arch, 'REQ_ONLY_17'), 'Requirements conversation leaked into Architecture');
		assert.ok(includes(arch, 'FR-001 MUST save drafts'), 'Saved requirements must remain shared project context');
		const beforeResume = calls.length;
		await invoke('start', 'requirements');
		assert.equal(calls.length, beforeResume, 'Returning to Requirements must resume without a new request');
		const resumed = await ask('Continue REQ_ONLY_88');
		assert.ok(includes(resumed, 'REQ_ONLY_17'));
		assert.ok(!includes(resumed, 'ARCH_ONLY_42'));
		await invoke('agent', 'lisko');
		const returned = await ask('Continue ARCH_ONLY_99');
		assert.ok(includes(returned, 'ARCH_ONLY_42'));
		assert.ok(!includes(returned, 'REQ_ONLY_17'));
		await invoke('layout', 'shared');
		const shared = await ask('/requirements Discuss SHARED_ONLY_55');
		assert.ok(!includes(shared, 'REQ_ONLY_17') && !includes(shared, 'ARCH_ONLY_42'));
		const sharedArch = await ask('/architecture Continue SHARED_ONLY_66');
		assert.ok(includes(sharedArch, 'SHARED_ONLY_55'), 'Explicit shared chat must retain cross-agent history');
		await invoke('layout', 'agents');
		await invoke('new');
		const fresh = await ask('/architecture Discuss NEW_ARCH_11');
		assert.ok(!includes(fresh, 'ARCH_ONLY_42') && !includes(fresh, 'SHARED_ONLY_55'));
		const preserved = await ask('/requirements Continue REQ_ONLY_77');
		assert.ok(includes(preserved, 'REQ_ONLY_17'), 'New chat must not clear another agent');
		assert.ok(!includes(preserved, 'NEW_ARCH_11'));
		assert.equal(vscode.workspace.getConfiguration('myEditor').get('models.default'), 'ollama:agent-chats');
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/requirements.md'), 'utf8'), requirements);
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, modelRequests: calls.length,
			isolatedHistories: true, resumedWithoutGeneration: true, explicitSharedChat: true,
			newChatOnlyClearsActive: true, savedRequirementsAvailable: true, modelSelectionUnchanged: true }, null, 2));
	} finally { server.close(); }
};
