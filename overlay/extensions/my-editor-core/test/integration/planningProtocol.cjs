/* Saved-plan discovery and Markdown conclusions in the actual editor host. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async () => {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const specs = path.join(root, '.my_editor/specs');
	fs.mkdirSync(specs, { recursive: true });
	fs.mkdirSync(path.join(root, '.my_editor/brain'), { recursive: true });
	fs.writeFileSync(path.join(root, '.my_editor/brain/index.md'), 'UNRELATED_BRAIN_CONTENT\n'.repeat(500));
	const requirements = '# Requirements\n## Goal\nBudgetTransferFixture.\n## Users\nOne person.\n'
		+ '## Functional requirements\nFR-001 MUST save transfers. Acceptance: reopen a transfer.\n'
		+ '## Non-functional requirements\nNFR-001 SHOULD preserve data. Acceptance: recover after restart.\n'
		+ '## Out of scope\nTeam accounts.\n';
	fs.writeFileSync(path.join(specs, 'requirements.md'), requirements);
	const architecture = '# Architecture\n## Main system flow\nThe interface saves transfers through the store.\n'
		+ '```mermaid\ngraph LR\nInterface --> Store\n```\n## Components\n'
		+ '<a id="store"></a>\n### Store\nServes FR-001 and NFR-001. Owns persisted transfers. Interface: save(transfer) returns a stored transfer.\n'
		+ '## Decisions\nUse local storage for one user; defer remote storage.\n';
	let error, requests = 0, phase = 'review';
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'planning-protocol' }] })); return; }
		try {
			let body = ''; for await (const chunk of req) { body += chunk; }
			const { messages } = JSON.parse(body);
			requests++;
			assert.ok(JSON.stringify(messages).includes('BudgetTransferFixture'), 'Saved requirements must reach both review and generation');
			assert.ok(!JSON.stringify(messages).includes('UNRELATED_BRAIN_CONTENT'), 'Planning must not receive the entire source brain');
			assert.doesNotMatch(messages[0].content, /"name":"(?:propose_file|propose_edit|propose_delete|run_tests|observe)"/);
			assert.ok(!messages[0].content.includes('my_editor has a fixer'));
			let answer;
			if (phase === 'review' && requests === 1) {
				answer = JSON.stringify({ action: 'tools', calls: [
					{ name: 'list_files', arguments: { glob: '.my_editor/specs/**' } },
					{ name: 'search', arguments: { query: 'BudgetTransferFixture' } },
					{ name: 'read_file', arguments: { path: '.my_editor/specs/requirements.md' } },
				] });
			} else if (phase === 'review') {
				const evidence = messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
				assert.match(evidence, /Matching files \(1\):\n.my_editor\/specs\/requirements.md/);
				assert.match(evidence, /\.my_editor\/specs\/requirements.md:3:.*BudgetTransferFixture/);
				answer = "I've reviewed the saved requirements. FR-001 covers transfers. No code has been built.";
			} else if (phase === 'supplied review') {
				answer = 'The saved requirements cover FR-001. No code has been verified.';
			} else {
				assert.ok(!messages[0].content.includes('This request is a read-only check'));
				answer = 'Architecture ready for review.\n````markdown\n' + architecture + '````';
			}
			res.end(JSON.stringify({ message: { content: answer }, done: true }) + '\n');
		} catch (caught) { error = caught; res.statusCode = 500; res.end('{}'); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:planning-protocol', 'claudeCli.enabled': false, 'codexCli.enabled': false,
			'lmstudio.enabled': false, 'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false, 'projectAgents.runtime': process.env.MY_EDITOR_PLANNING_RUNTIME || 'builtin' })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		await vscode.commands.executeCommand('myEditor.chat.ask', '/architecture Review the saved requirements.');
		if (error) { throw error; }
		assert.equal(requests, 2, 'Plain review must not trigger a protocol retry');
		phase = 'generate';
		await vscode.commands.executeCommand('myEditor.chat.ask', '/architecture Check the requirements then build the architecture');
		if (error) { throw error; }
		assert.equal(requests, 3, 'Plain document must reach proposal without a retry');
		let tab;
		const deadline = Date.now() + 10000;
		while (!tab && Date.now() < deadline) {
			tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
				tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
			if (!tab) { await new Promise(resolve => setTimeout(resolve, 100)); }
		}
		assert.ok(tab, 'Architecture must be prepared for Keep');
		assert.equal(fs.existsSync(path.join(specs, 'architecture.md')), false, 'Proposal must wait for Keep');
		assert.equal(fs.readFileSync(path.join(specs, 'requirements.md'), 'utf8'), requirements);
		phase = 'supplied review';
		await vscode.commands.executeCommand('myEditor.chat.ask', '/requirements Review the saved requirements.');
		if (error) { throw error; }
		assert.equal(requests, 4, 'A complete host-read document must not trigger a redundant source-check model call');
		const records = fs.readdirSync(path.join(root, '.my_editor/investigations'), { recursive: true })
			.filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(root, '.my_editor/investigations', name), 'utf8')));
		const reviewed = records.find(record => record.question === '/requirements Review the saved requirements.');
		assert.equal(reviewed.performance.calls.length, 1);
		assert.ok(reviewed.performance.calls[0].inputChars > reviewed.performance.calls[0].systemChars);
		assert.ok(reviewed.performance.modelMs >= 0);
		await vscode.commands.executeCommand('myEditor.chat.ask', '/architecture check now');
		if (error) { throw error; }
		assert.equal(requests, 5, 'Architecture can review supplied requirements without an open source editor');
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true,
			savedRequirementsDiscoverable: true, plainReviewAccepted: true, architectureProposalReady: true, keepRequired: true,
			irrelevantBrainOmitted: true, scopedTools: true, noForcedDocumentReread: true, performance: reviewed.performance }));
	} finally { server.close(); }
};
