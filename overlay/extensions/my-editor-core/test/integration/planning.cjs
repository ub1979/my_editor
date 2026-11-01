/* Real editor host: planning retrieves archived decisions and proposes complete documents for Keep. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

const sections = ['root', 'contracts', 'ai-contract', 'contract-tests', 'block-kit', 'launcher', 'interface',
	'x-connector', 'fake-platform', 'ai-provider', 'rss', 'approval-queue', 'composer', 'notifications'];
const requirements = '# Requirements\n## Goal\nWrite reviewed drafts.\n## Users\nIndividual writers.\n'
	+ '## Functional requirements\nFR-001 MUST save drafts. Acceptance: reopen a saved draft.\n'
	+ '## Non-functional requirements\nNFR-001 SHOULD preserve drafts. Acceptance: recover after restart.\n'
	+ '## Out of scope\nTeam accounts.\n';
const architecture = '# Architecture\n## Main system flow\nThe interface sends a reviewed draft to the composer.\n'
	+ '```mermaid\ngraph LR\nInterface --> Composer\n```\n## Components\n'
	+ sections.map(section => `<a id="${section}"></a>\n### ${section}\nServes FR-001. Routes: typed request and response.\n`).join('')
	+ '## Decisions\nUse local storage for one user; defer remote storage.\n';

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
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const calls = [];
	let fixtureError;
	let phase = 'planning';
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'planning-fixture' }] })); return; }
		try {
			let body = ''; for await (const chunk of req) { body += chunk; }
			const payload = JSON.parse(body);
			const system = payload.messages.find(message => message.role === 'system').content;
			const last = payload.messages.at(-1).content;
			let response;
			if (phase === 'wrong document') {
				assert.ok(system.includes('Help the user work out what to build'));
				response = { action: 'final', message: '````markdown\n' + architecture + '````' };
			} else if (phase === 'recover generated document') {
				if (last.includes('Host tool result for read_chat')) {
					assert.ok(last.includes('<a id="notifications"></a>'), 'The full document must survive display shortening');
					assert.ok(last.includes('Check deployment settings before building.'));
					calls.push('read full generated document');
					response = { action: 'final', message: 'I recovered the full architecture and its trailing warning.' };
				} else if (last.includes('Host tool result for search_chat')) {
					const match = /(\d+) turns ago \(assistant\)/.exec(last);
					assert.ok(match, 'Generated document contents must be searchable');
					response = { action: 'tool', name: 'read_chat', arguments: { turnsAgo: Number(match[1]) } };
				} else {
					response = { action: 'tool', name: 'search_chat', arguments: { query: 'typed request and response' } };
				}
			} else if (system.includes('Help the user work out what to build')) {
				if (last.includes('Host tool result for read_file')) {
					assert.ok(last.includes('section-agreement'));
					response = { action: 'final', message: 'The requirements are ready for Keep.\n```markdown\n' + requirements + '```' };
				} else if (last.includes('Host tool result for search_records')) {
					assert.ok(last.includes('.my_editor/chats/2026-10-01.md'));
					calls.push('read saved chat');
					response = { action: 'tool', name: 'read_file', arguments: { path: '.my_editor/chats/2026-10-01.md' } };
				} else {
					assert.ok(last.includes('requirements.md is a draft'));
					assert.ok(system.includes('read_chat'));
					calls.push('search saved chats');
					response = { action: 'tool', name: 'search_records', arguments: { query: 'section-agreement' } };
				}
			} else if (system.includes('Design the system with the user')) {
				if (last.includes('Host tool result for read_chat')) {
					assert.ok(last.includes('notifications'));
					response = { action: 'final', message: 'The architecture follows our agreed sections.\n````markdown\n'
						+ architecture + '````\nCheck deployment settings before building.' };
				} else if (last.includes('Host tool result for search_chat')) {
					const match = /(\d+) turns ago \(assistant\)/.exec(last);
					assert.ok(match, 'Assistant decisions must be searchable');
					calls.push('read earlier assistant');
					response = { action: 'tool', name: 'read_chat', arguments: { turnsAgo: Number(match[1]) } };
				} else {
					calls.push('search earlier assistant');
					response = { action: 'tool', name: 'search_chat', arguments: { query: 'section-agreement' } };
				}
			} else { response = { action: 'final', message: `Our section-agreement: ${sections.join(', ')}.` }; }
			res.end(JSON.stringify({ message: { content: JSON.stringify(response) }, done: true }) + '\n');
		} catch (error) { fixtureError = error; res.statusCode = 500; res.end('{}'); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		fs.mkdirSync(path.join(root, '.my_editor/specs'), { recursive: true });
		fs.mkdirSync(path.join(root, '.my_editor/chats'), { recursive: true });
		fs.writeFileSync(path.join(root, '.my_editor/specs/requirements.md'), 'Status: Draft\n' + requirements);
		fs.writeFileSync(path.join(root, '.my_editor/chats/2026-10-01.md'), '**Pair:** section-agreement: ' + sections.join(', '));
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:planning-fixture', 'claudeCli.enabled': false, 'codexCli.enabled': false,
			'lmstudio.enabled': false, 'assistance.mode': 'manual', 'autoComments.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await vscode.commands.executeCommand('myEditor.chat.ask', '/chat Recall the section-agreement.');
		await until(() => calls.length || fs.readdirSync(path.join(root, '.my_editor/chats')).length > 1, 'Initial chat did not finish');
		await vscode.commands.executeCommand('myEditor.chat.ask', '/requirements Finalize using the saved section-agreement.');
		if (fixtureError) { throw fixtureError; }
		await until(proposalTab, 'No requirements proposal after saved chat retrieval');
		assert.equal((await vscode.workspace.openTextDocument(proposalTab().input.original)).getText(), 'Status: Draft\n' + requirements);
		assert.match(fs.readFileSync(path.join(root, '.my_editor/specs/requirements.md'), 'utf8'), /Status: Draft/);
		await vscode.commands.executeCommand('myEditor.proposal.keep', proposalTab().input.modified);
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/requirements.md'), 'utf8'), requirements);
		await vscode.commands.executeCommand('myEditor.chat.ask', 'Regenerate architecture.md using the section-agreement.');
		if (fixtureError) { throw fixtureError; }
		await until(proposalTab, 'No architecture proposal after assistant history retrieval');
		assert.equal(fs.existsSync(path.join(root, '.my_editor/specs/architecture.md')), false);
		await vscode.commands.executeCommand('myEditor.proposal.keep', proposalTab().input.modified);
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/architecture.md'), 'utf8'), architecture);
		await until(() => fs.readdirSync(path.join(root, '.my_editor/chats')).some(file =>
			fs.readFileSync(path.join(root, '.my_editor/chats', file), 'utf8').includes('<a id="notifications"></a>')),
		'Full planning response was not saved to the chat archive');
		phase = 'recover generated document';
		await vscode.commands.executeCommand('myEditor.chat.ask', '/chat Recover the full generated document from our earlier messages.');
		if (fixtureError) { throw fixtureError; }
		phase = 'wrong document';
		if (proposalTab()) { await vscode.window.tabGroups.close(proposalTab()); }
		await vscode.commands.executeCommand('myEditor.chat.ask', '/requirements Test a reply with the wrong document title.');
		if (fixtureError) { throw fixtureError; }
		assert.equal(proposalTab(), undefined, 'An architecture must not become a requirements proposal');
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/requirements.md'), 'utf8'), requirements);
		assert.equal(fs.readFileSync(path.join(root, '.my_editor/specs/architecture.md'), 'utf8'), architecture);
		calls.push('reject wrong document without modifying saved files');
		assert.deepEqual(calls, ['search saved chats', 'read saved chat', 'search earlier assistant', 'read earlier assistant',
			'read full generated document', 'reject wrong document without modifying saved files']);
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, checks: calls,
			sections: sections.length, reviewedDocuments: 2, fullChatSaved: true }, null, 2));
	} finally { server.close(); }
};
