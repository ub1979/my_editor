/* Reuse the same real-editor acceptance cases and selected model through the OpenCode backend. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const trace = process.env.LOAD_TRACE ? require('../runtime/openCodeLoadTrace.cjs').install(path.join(path.dirname(process.env.MY_EDITOR_INTEGRATION_REPORT), 'startup-trace.json')) : undefined;

exports.run = async () => {
	const suite = process.env.MY_EDITOR_OPENCODE_SUITE || 'projectBuild';
	assert.ok(['projectBuild', 'agentChats', 'standaloneSpecialists', 'planningApprovals', 'coding', 'openCodeCodex', 'openCodeLifecycle', 'openCodeLoad'].includes(suite));
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	// Enable journal storage in the fixture without creating any planning documents.
	fs.mkdirSync(path.join(root, '.my_editor'), { recursive: true });
	const config = vscode.workspace.getConfiguration('myEditor');
	// The launcher sets this before activation; asynchronous setup here would race suites that instrument UI registration.
	assert.equal(config.get('projectAgents.runtime'), 'opencode');
	await require(`./${suite}.cjs`).run();
	assert.equal(vscode.workspace.getConfiguration('myEditor').get('projectAgents.runtime'), 'opencode', 'Fixture must not fall back to the built-in runtime');
	const records = path.join(root, '.my_editor/investigations');
	const sessions = fs.readdirSync(records, { recursive: true }).filter(name => String(name).endsWith('.json')).flatMap(name => {
		const record = JSON.parse(fs.readFileSync(path.join(records, String(name)), 'utf8'));
		return (record.evidence || []).filter(item => item.tool === 'runtime_session');
	});
	assert.ok(sessions.length, 'No completed OpenCode session evidence was saved');
	assert.ok(sessions.every(item => item.subject.startsWith('opencode 1.19.3 ses_')));
	const report = JSON.parse(fs.readFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, 'utf8'));
	fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ...report, runtime: 'opencode', version: '1.19.3', runtimeSessions: sessions.length }, null, 2));
};
