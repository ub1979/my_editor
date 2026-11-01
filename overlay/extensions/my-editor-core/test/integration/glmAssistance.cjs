/* Installed-editor tests with actual Python terminals and real GLM reviews/test proposals. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vscode = require('vscode');
const { harness, until, proposal, answer } = require('./glmHarness.cjs');

const good = '"""Arithmetic helpers."""\n\ndef average(values):\n    """Return the arithmetic mean of a nonempty sequence."""\n    return sum(values) / len(values)\n\nUNCHANGED = "keep this"\n';
const tests = 'import unittest\nfrom review import average\n\nclass AverageTests(unittest.TestCase):\n    def test_positive(self):\n        self.assertEqual(average([2, 4]), 3)\n';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function show(root, name, source) {
	const uri = vscode.Uri.file(path.join(root, name));
	fs.writeFileSync(uri.fsPath, source);
	return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
}
async function runRange(editor, start, end = start) {
	await vscode.window.showTextDocument(editor.document);
	editor.selection = end === start ? new vscode.Selection(start, 0, start, 0) : new vscode.Selection(start, 0, end, 0);
	await vscode.commands.executeCommand('myEditor.python.runSelection');
}
function diagnostics(uri) { return vscode.languages.getDiagnostics(uri).filter(item => item.source === 'navigator'); }
function navigatorRequests(report) { return report.requests.filter(item => item.request.messages[0].content.includes('You are the navigator')); }
async function fixActions(uri, finding) {
	const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, finding.range);
	assert.ok(actions.some(item => item.title === 'Ask Pair for a reviewed fix'));
	assert.ok(actions.some(item => item.title === 'Guide me to fix this'));
	assert.ok(actions.filter(item => item.command?.command === 'myEditor.chat.ask').every(item => !item.edit),
		'Fix suggestions should offer a choice, not directly edit source');
}
function unchanged(root, saved, editor, expected) {
	for (const [name, text] of Object.entries(saved)) { assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), text, `Unexpected disk change: ${name}`); }
	assert.equal(editor.document.getText(), expected, 'AI must not edit the current buffer');
}

async function selectedPython(root, report) {
	const source = 'raise RuntimeError("outside selection must not run")\n'
		+ 'counter = 40\ncounter += 2\n'
		+ 'with open("selected-state.txt", "w") as output:\n    output.write(str(counter))\n'
		+ 'raise ValueError("deliberate selected error")\n'
		+ 'with open("after-error.txt", "w") as output:\n    output.write(str(counter + 1))\n'
		+ 'if False:\n    nested = counter + 3\n'
		+ 'with open("dedented.txt", "w") as output:\n    output.write(str(nested))\n'
		+ 'with open("must-not-exist.txt", "w") as output:\n    output.write("whole file ran")\n'
		+ 'print("captured stdout")\nimport sys\nprint("captured stderr", file=sys.stderr)\ncounter + 8\n';
	const editor = await show(root, 'selection.py', source);
	await runRange(editor, 1, 3);
	await runRange(editor, 3, 5);
	await until(() => fs.existsSync(path.join(root, 'selected-state.txt')), 'Selected Python did not execute');
	assert.equal(fs.readFileSync(path.join(root, 'selected-state.txt'), 'utf8'), '42');
	await runRange(editor, 5);
	assert.equal(editor.selection.active.line, 6, 'Running the current line should advance the cursor');
	await runRange(editor, 6, 8);
	await until(() => fs.existsSync(path.join(root, 'after-error.txt')), 'Session did not recover from a Python exception');
	assert.equal(fs.readFileSync(path.join(root, 'after-error.txt'), 'utf8'), '43');
	await runRange(editor, 9, 10);
	await runRange(editor, 10, 12);
	await until(() => fs.existsSync(path.join(root, 'dedented.txt')), 'Indented selection did not execute');
	assert.equal(fs.readFileSync(path.join(root, 'dedented.txt'), 'utf8'), '45');
	assert.equal(fs.existsSync(path.join(root, 'must-not-exist.txt')), false);
	await runRange(editor, 14, 18);
	const terminal = vscode.window.terminals.find(item => item.name === 'Python · my_editor');
	const resultsFile = terminal.creationOptions.env.MY_EDITOR_PYTHON_RESULTS;
	const events = await until(() => {
		const items = fs.readFileSync(resultsFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
		return items.some(item => item.text?.includes('50')) && items.at(-1).done && items;
	}, 'Block stdout/stderr/expression results were not captured');
	assert.ok(events.some(item => item.channel === 'stdout' && item.text.includes('captured stdout')));
	assert.ok(events.some(item => item.channel === 'stderr' && item.text.includes('captured stderr')));
	assert.ok(events.some(item => item.failed), 'Python errors must be reported against their block');
	await vscode.commands.executeCommand('myEditor.python.showResults');
	await until(() => vscode.workspace.textDocuments.some(doc => doc.uri.scheme === 'output' && doc.getText().includes('captured stdout')
		&& doc.getText().includes('captured stderr') && doc.getText().includes('50') && doc.getText().includes('failed')),
		'Python Results panel did not display block output', 15000);
	assert.equal(fs.readFileSync(path.join(root, 'selection.py'), 'utf8'), source);
	assert.equal(editor.document.getText(), source);
	await vscode.commands.executeCommand('myEditor.python.restart');
	report.checks.push('Selected lines retain variables, skip surrounding code, recover after errors and dedent correctly', 'Current-line execution advances the cursor; Python source stays unchanged');
	report.checks.push('Python Results visibly shows block stdout, stderr, final expression values and errors');
	return source;
}

async function reviewModes(root, config, live, saved) {
	let editor = await show(root, 'review.py', good);
	await config.update('assistance.mode', 'auto', vscode.ConfigurationTarget.Global);
	const bad = good.replace('/ len(values)', '/ (len(values) - 1)');
	await editor.edit(edit => edit.replace(new vscode.Range(0, 0, editor.document.lineCount, 0), bad));
	await editor.document.save(); saved['review.py'] = bad;
	const automatic = await until(() => diagnostics(editor.document.uri).length && diagnostics(editor.document.uri), 'GLM Auto did not report the deliberate average bug');
	assert.match(automatic.map(item => item.message).join(' '), /zero|single|len|divis|average|denominator/i);
	assert.ok(navigatorRequests(live.report).length);
	await fixActions(editor.document.uri, automatic[0]);
	assert.equal(proposal(), undefined, 'Automatic review must not create code proposals');
	unchanged(root, saved, editor, bad);
	live.report.autoFindings = automatic.map(item => item.message);
	live.report.checks.push('Auto GLM notices a deliberate Python bug without editing or proposing code'); live.save();
	const lenses = await until(async () => {
		const items = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', editor.document.uri);
		return items?.find(item => item.command?.title === 'AI: suggest tests');
	}, 'Automatic mode did not offer tests at the function');
	assert.equal(lenses.command.command, 'myEditor.assistance.symbol');
	await testSuggestion(root, editor, bad, saved, live, 'auto', lenses.command);
	await config.update('assistance.mode', 'manual', vscode.ConfigurationTarget.Global);
	await vscode.commands.executeCommand('myEditor.navigator.clear');
	const count = live.report.requests.length;
	const manual = good.replace('/ len(values)', '/ (len(values) + 1)');
	editor = await vscode.window.showTextDocument(editor.document);
	await editor.edit(edit => edit.replace(new vscode.Range(0, 0, editor.document.lineCount, 0), manual));
	await editor.document.save(); saved['review.py'] = manual;
	await pause(10500);
	assert.equal(live.report.requests.length, count, 'Manual mode must not contact GLM when typing');
	assert.equal(diagnostics(editor.document.uri).length, 0);
	const manualLenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', editor.document.uri);
	assert.ok(!manualLenses.some(item => item.command?.command === 'myEditor.assistance.symbol'));
	editor.selection = new vscode.Selection(2, 0, 5, 0);
	await vscode.commands.executeCommand('myEditor.assistance.review');
	const manualFindings = diagnostics(editor.document.uri);
	assert.ok(manualFindings.length, 'Explicit manual GLM review did not suggest a fix');
	await fixActions(editor.document.uri, manualFindings[0]);
	assert.equal(proposal(), undefined);
	unchanged(root, saved, editor, manual);
	live.report.manualFindings = manualFindings.map(item => item.message);
	live.report.checks.push('Manual mode stays quiet while typing and reports the bug only when asked'); live.save();
	await testSuggestion(root, editor, manual, saved, live, 'manual', {
		command: 'myEditor.assistance.symbol', arguments: [editor.document.uri, 'average', 2, 'tests'],
	});
}

function validateTests(content) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-editor-generated-tests.'));
	fs.writeFileSync(path.join(dir, 'review.py'), good);
	fs.writeFileSync(path.join(dir, 'test_review.py'), content);
	const passed = spawnSync('python3', ['-m', 'unittest', 'discover', '-v'], { cwd: dir, encoding: 'utf8' });
	assert.equal(passed.status, 0, `Suggested tests fail on correct code: ${passed.stderr}`);
	assert.match(passed.stderr, /Ran [1-9]\d* tests?/);
	fs.writeFileSync(path.join(dir, 'review.py'), good.replace('/ len(values)', '/ (len(values) + 1)'));
	const failed = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-v'], { cwd: dir, encoding: 'utf8' });
	assert.notEqual(failed.status, 0, 'Suggested tests should catch the deliberate bug');
}
async function testSuggestion(root, editor, expected, saved, live, mode, command) {
	live.report.phase = `${mode}: requesting tests`; live.save();
	await vscode.window.showTextDocument(editor.document);
	const first = live.report.requests.length;
	await vscode.commands.executeCommand(command.command, ...command.arguments);
	const tab = await until(proposal, `${mode} test request did not produce a reviewed test suggestion`);
	await until(() => fs.existsSync(path.join(root, '.my_editor/investigations')) && fs.readdirSync(path.join(root, '.my_editor/investigations'), { recursive: true }).some(name => {
		if (!name.endsWith('.json')) { return false; }
		const record = fs.readFileSync(path.join(root, '.my_editor/investigations', name), 'utf8');
		return record.includes('average') && fs.statSync(path.join(root, '.my_editor/investigations', name)).mtimeMs >= Date.parse(live.report.requests[first].started);
	}), 'Test suggestion did not finish its model conversation');
	live.report.phase = `${mode}: checking proposed tests`; live.save();
	assert.equal(path.basename(tab.input.modified.path), 'test_review.py', 'Only the requested test file may be proposed');
	const content = (await vscode.workspace.openTextDocument(tab.input.modified)).getText();
	validateTests(content);
	const responses = live.report.requests.slice(first).map(answer).join('\n');
	assert.ok(responses.includes('test_review.py'));
	assert.ok(!/"path"\s*:\s*"review\.py"\s*,\s*"content"/.test(responses), 'Test suggestions must not propose production changes');
	unchanged(root, saved, editor, expected);
	live.report.phase = `${mode}: rejecting test proposal`; live.save();
	await vscode.commands.executeCommand('myEditor.proposal.undo', tab.input.modified);
	await until(() => !proposal(), 'Rejected test proposal did not close');
	unchanged(root, saved, editor, expected);
	live.report.checks.push(`${mode}: tests offered on request only, catch the bug, pass on correct code; no file changed`); live.save();
}

exports.run = async function () {
	const live = harness();
	try {
		const config = await live.configure();
		const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
		fs.mkdirSync(path.join(root, '.my_editor/brain'), { recursive: true });
		const brain = '# Python arithmetic project\nreview.py defines average(values), the arithmetic mean of nonempty sequences. Tests use unittest in test_review.py.\n';
		fs.writeFileSync(path.join(root, '.my_editor/brain/index.md'), brain);
		fs.writeFileSync(path.join(root, 'test_review.py'), tests);
		const selection = await selectedPython(root, live.report); live.save();
		const saved = { 'selection.py': selection, 'review.py': good, 'test_review.py': tests, '.my_editor/brain/index.md': brain };
		await reviewModes(root, config, live, saved);
		const changeDir = path.join(root, '.my_editor/changes');
		const changes = fs.readdirSync(changeDir, { recursive: true }).filter(name => name.endsWith('.json'))
			.map(name => JSON.parse(fs.readFileSync(path.join(changeDir, name), 'utf8')));
		assert.ok(changes.length && changes.every(item => item.file === 'test_review.py' && item.event !== 'kept'),
			'Only reviewed test-file suggestions may be recorded; no AI edit may be applied');
		assert.ok(live.report.requests.every(item => item.request.model === live.report.model), 'Every AI call must use real GLM');
		live.report.passed = true; live.save();
	} catch (error) { live.report.error = String(error); live.report.stack = error.stack; live.save(); throw error; }
	finally { await vscode.commands.executeCommand('myEditor.python.restart'); live.server.close(); }
};
