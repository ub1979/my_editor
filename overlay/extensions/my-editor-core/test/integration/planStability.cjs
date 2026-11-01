/* Accepted plans survive opening, adversarial model checks and code analysis. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

const requirements = '# Requirements\n## Goal\nSave drafts.\n## Users\nWriters.\n'
	+ '## Functional requirements\nFR-001 MUST save drafts. Acceptance: reopen a saved draft.\n'
	+ '## Non-functional requirements\nNFR-001 SHOULD recover drafts. Acceptance: restore after restart.\n'
	+ '## Out of scope\nTeam accounts.\n';
const architecture = '# Architecture\n## Main system flow\nInput → Worker → Storage.\n'
	+ '## Components\n### Worker {#worker}\nServes FR-001. Interface: save(input).\n## Decisions\nUse local storage for one user.\n';
const tree = JSON.stringify([{ path: 'src/main.ts', role: 'Entry point', requirements: ['FR-001'], section: 'worker', status: 'planned' },
	{ path: 'src/worker.ts', role: 'Save a reviewed draft', requirements: ['FR-001'], section: 'worker', status: 'planned' }], null, 2) + '\n';
function proposalTab() {
	return vscode.window.tabGroups.all.flatMap(group => group.tabs)
		.find(tab => tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
}
exports.run = async function () {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const specs = path.join(root, '.my_editor/specs');
	let requests = 0, phase = 'check', fixtureError, blocked = 0;
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'plan-stability' }] })); return; }
		try {
			requests++;
			let body = ''; for await (const chunk of req) { body += chunk; }
			const payload = JSON.parse(body);
			const system = payload.messages.find(message => message.role === 'system').content;
			const last = payload.messages.at(-1).content;
			let response;
			if (phase === 'analyse') {
				const keys = /exactly these keys: (\[[\s\S]*\])/.exec(last);
				response = keys ? JSON.stringify(Object.fromEntries(JSON.parse(keys[1]).map(key => [key, 'Handles a draft.'])))
					: '# Observed code\nLocal source currently has an entry point.\n## Main flow\nEntry point runs.\n';
			} else if (phase === 'tool check' || phase === 'unrelated edit') {
				if (last.includes('Host tool result for propose_file')) {
					assert.ok(last.includes('read-only') || last.includes('does not authorize revising'));
					blocked++;
					response = JSON.stringify({ action: 'final', message: 'The saved plan remains the baseline.' });
				} else {
					response = JSON.stringify({ action: 'tool', name: 'propose_file', arguments: {
						path: '.my_editor/specs/architecture.md', content: architecture.replace('local storage', 'remote storage') } });
				}
			} else {
				if (phase === 'check') { assert.ok(system.includes('This request is a read-only check')); }
				response = JSON.stringify({ action: 'final', message: '```markdown\n' + architecture.replace('local storage', 'remote storage') + '```' });
			}
			res.end(JSON.stringify({ message: { content: response }, done: true }) + '\n');
		} catch (error) { fixtureError = error; res.statusCode = 500; res.end('{}'); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const command = (name, ...args) => vscode.commands.executeCommand(`myEditor.${name}`, ...args);
	const checkPlans = () => {
		for (const [file, text] of [['requirements.md', requirements], ['architecture.md', architecture], ['tree.json', tree]]) {
			assert.equal(fs.readFileSync(path.join(specs, file), 'utf8'), text, `${file} changed`);
		}
		assert.equal(proposalTab(), undefined, 'A check must not open a replacement proposal');
		if (fixtureError) { throw fixtureError; }
	};
	try {
		fs.mkdirSync(specs, { recursive: true }); fs.mkdirSync(path.join(root, 'src'));
		fs.writeFileSync(path.join(root, 'src/main.ts'), 'export const ready = true;\n');
		for (const [file, text] of [['requirements.md', requirements], ['architecture.md', architecture], ['tree.json', tree]]) {
			fs.writeFileSync(path.join(specs, file), text);
		}
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:plan-stability', 'claudeCli.enabled': false, 'codexCli.enabled': false,
			'lmstudio.enabled': false, 'assistance.mode': 'manual', 'autoComments.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		for (const stage of ['requirements', 'architecture', 'tree']) { await command('chat.start', stage); }
		assert.equal(requests, 0, 'Opening saved stages must not generate'); checkPlans();
		await command('chat.ask', '/architecture Check what the other agent made.'); checkPlans();
		phase = 'tool check';
		await command('chat.ask', '/chat Check this project for missing things.'); checkPlans();
		phase = 'unrelated edit';
		await command('chat.ask', '/chat Fix the parser code.'); checkPlans();
		assert.equal(blocked, 2, 'Host must reject both read-only and incidental planning writes');
		phase = 'analyse';
		await command('analyseProject'); checkPlans();
		assert.ok(fs.existsSync(path.join(root, '.my_editor/brain/code-architecture.md')));
		assert.ok(fs.existsSync(path.join(root, '.my_editor/brain/code-files.json')));
		const beforeScaffold = requests;
		await command('chat.ask', '/tree make the files');
		assert.equal(requests, beforeScaffold, 'Creating saved files must not regenerate their plan');
		assert.ok(fs.existsSync(path.join(root, 'src/worker.ts')));
		assert.equal(fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8'), 'export const ready = true;\n');
		const stripStatus = text => JSON.parse(text).map(({ status, ...rest }) => rest);
		assert.deepEqual(stripStatus(fs.readFileSync(path.join(specs, 'tree.json'), 'utf8')), stripStatus(tree));
		fs.writeFileSync(path.join(specs, 'tree.json'), tree);
		phase = 'explicit revision';
		await command('chat.ask', '/architecture Update the storage decision to remote storage.');
		if (fixtureError) { throw fixtureError; }
		assert.ok(proposalTab(), 'Explicit revisions must still be reviewable');
		assert.equal(fs.readFileSync(path.join(specs, 'architecture.md'), 'utf8'), architecture);
		assert.equal(await command('proposal.keep', proposalTab().input.modified), true);
		assert.equal(fs.readFileSync(path.join(specs, 'architecture.md'), 'utf8'), architecture.replace('local storage', 'remote storage'));
		fs.writeFileSync(path.join(specs, 'architecture.md'), 'Status: Draft\n' + architecture);
		await command('chat.new');
		const beforeDraftOpen = requests;
		await command('chat.start', 'architecture');
		assert.equal(requests, beforeDraftOpen, 'Opening an existing draft must not regenerate it');
		assert.equal(fs.readFileSync(path.join(specs, 'architecture.md'), 'utf8'), 'Status: Draft\n' + architecture);
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true, openingPreservesPlans: true,
			checkCannotPropose: true, incidentalPlanningWritesBlocked: true, analysisOnlyUpdatesBrain: true,
			scaffoldUsesSavedTree: true, explicitRevisionKeepWorks: true, openingDraftDoesNotGenerate: true }, null, 2));
	} finally { server.close(); }
};
