/* Opt-in real-provider diagnosis in scripts/test-editor.sh's disposable project copy. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async function () {
	const source = process.env.MY_EDITOR_PROTOCOL_SOURCE;
	const model = process.env.MY_EDITOR_PROTOCOL_MODEL;
	assert.ok(source && model, 'Set the explicit source project and authorized provider model');
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	assert.notEqual(path.resolve(source), root, 'Diagnosis must use a disposable copy');
	for (const name of ['package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'vitest.shared.ts', 'README.md',
		'packages', 'services', 'launcher', 'scripts', '.my_editor/specs', '.my_editor/brain', '.my_editor/conventions.md']) {
		const input = path.join(source, name);
		if (fs.existsSync(input)) {
			fs.cpSync(input, path.join(root, name), { recursive: true,
				filter: input => !['node_modules', 'dist'].includes(path.basename(input)) });
		}
	}
	if (process.env.MY_EDITOR_PROTOCOL_NOTE) {
		fs.mkdirSync(path.join(root, '.my_editor'), { recursive: true });
		fs.appendFileSync(path.join(root, '.my_editor/conventions.md'), '\n\nAcceptance findings for this disposable run:\n' + process.env.MY_EDITOR_PROTOCOL_NOTE);
	}
	const config = vscode.workspace.getConfiguration('myEditor');
	for (const [key, value] of Object.entries({ 'models.default': model, 'claudeCli.enabled': false,
		'codexCli.enabled': false, 'lmstudio.enabled': false, 'assistance.mode': 'manual',
		'autoComments.enabled': false, 'navigator.enabled': false, 'fileChat.followEditor': false })) {
		await config.update(key, value, vscode.ConfigurationTarget.Global);
	}
	await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
	const originalPick = vscode.window.showQuickPick;
	vscode.window.showQuickPick = async (items, options) => options?.placeHolder?.includes('apply changes')
		? items.find(item => item.automatic === true) : undefined;
	const command = (name, ...args) => vscode.commands.executeCommand('myEditor.' + name, ...args);
	try {
		const file = process.env.MY_EDITOR_PROTOCOL_FILE || 'packages/contracts/src/events.ts';
		const before = fs.readFileSync(path.join(root, file), 'utf8');
		const kind = process.env.MY_EDITOR_PROTOCOL_KIND === 'QA' ? 'QA' : 'Build';
		await command(`project${kind}.file`, vscode.Uri.file(path.join(root, file)));
		const deadline = Date.now() + 240000;
		let state;
		while (Date.now() < deadline) {
			state = await command('projectBuild.status');
			if (state && ['error', 'checkpoint', 'complete'].includes(state.status)) { break; }
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		assert.ok(state && state.status !== 'running', 'Provider diagnosis timed out');
		const records = path.join(root, '.my_editor/investigations');
		const changed = fs.readFileSync(path.join(root, file), 'utf8') !== before;
		const requireChange = process.env.MY_EDITOR_PROTOCOL_REQUIRE_CHANGE === '1';
		const diagnostics = fs.existsSync(records) ? fs.readdirSync(records, { recursive: true })
			.filter(name => name.endsWith('.json')).flatMap(name => {
				const record = JSON.parse(fs.readFileSync(path.join(records, name), 'utf8'));
				return record.evidence.filter(item => ['model_protocol_error', 'native_tool_request'].includes(item.tool));
			}) : [];
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({
			ok: state.status !== 'error' && (!requireChange || changed), status: state.status, message: state.message, model, file, kind, changed, diagnostics,
		}));
		assert.notEqual(state.status, 'error', state.message);
		if (requireChange) {
			assert.ok(changed, 'The model did not save a changed file; a completion summary alone is insufficient');
		}
	} finally {
		await command('projectBuild.pause');
		vscode.window.showQuickPick = originalPick;
	}
};
