/* Real installed editor, Python process and native inline view zones. The observer forwards every API call. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const report = { passed: false, checks: [] };
const save = () => fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify(report, null, 2));
async function until(check, message, timeout = 20000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const result = await check(); if (result) { return result; }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(message);
}

exports.run = async function () {
	const views = [], disposed = new Set();
	const original = vscode.window.createWebviewTextEditorInset;
	vscode.window.createWebviewTextEditorInset = (...args) => {
		const view = original(...args); views.push(view); view.onDidDispose(() => disposed.add(view)); return view;
	};
	const live = () => views.filter(view => !disposed.has(view));
	try {
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'assistance.mode': 'manual', 'autoComments.enabled': false, 'ollama.enabled': false,
			'lmstudio.enabled': false, 'claudeCli.enabled': false, 'codexCli.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
		const file = vscode.Uri.file(path.join(root, 'inline_demo.py'));
		const source = '# %% first\nvalue = 40\nprint("hello <b>literal</b>")\nvalue + 2\n# %% second\nraise ValueError("example error")\n# %% third\nprint(value)\n';
		fs.writeFileSync(file.fsPath, source);
		const document = await vscode.workspace.openTextDocument(file);
		let editor = await vscode.window.showTextDocument(document);
		const run = async (line, cell = false) => {
			editor = await vscode.window.showTextDocument(document);
			editor.selection = new vscode.Selection(line, 0, line, 0);
			await vscode.commands.executeCommand(cell ? 'myEditor.python.runCell' : 'myEditor.python.runSelection');
		};
		await run(0, true);
		await until(() => live().some(view => view.line === 3 && view.webview.html.includes('42') && view.webview.html.includes('Finished')), 'No finished inline cell output');
		assert.ok(live()[0].webview.html.includes('hello &lt;b&gt;literal&lt;/b&gt;'));
		assert.ok(!vscode.workspace.textDocuments.some(doc => doc.uri.scheme === 'output'), 'Running a block must not open the separate Results panel');
		report.checks.push('Real cell stdout and expression value appear in a native inset immediately below source'); save();
		await run(5);
		await until(() => live().some(view => view.line === 5 && view.webview.html.includes('ValueError: example error') && view.webview.html.includes('Error')), 'No inline Python error');
		await run(7);
		await until(() => live().some(view => view.line === 7 && view.webview.html.includes('40') && view.webview.html.includes('Finished')), 'No persistent-state result after an error');
		assert.equal(live().length, 3);
		await run(0, true);
		await until(() => live().length === 3 && live().some(view => view.line === 3 && view.webview.html.includes('42') && view.webview.html.includes('Finished')), 'Rerun duplicated output or did not finish');
		assert.equal(document.getText(), source);
		assert.equal(fs.readFileSync(file.fsPath, 'utf8'), source);
		report.checks.push('Separate blocks keep separate results; reruns replace output; errors preserve session state', 'Inline output never becomes source text'); save();
		await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '# added above\n'));
		await until(() => live().length === 3 && live().some(view => view.line === 4) && live().some(view => view.line === 6) && live().some(view => view.line === 8), 'Outputs did not follow an edit above their blocks');
		await editor.edit(edit => edit.replace(document.lineAt(4).range, 'value + 4'));
		await until(() => live().length === 2 && live().every(view => view.line !== 4), 'Editing executed code must remove its stale result');
		await run(1, true);
		await until(() => live().some(view => view.line === 4 && view.webview.html.includes('44') && view.webview.html.includes('Finished')), 'Changed cell did not produce updated inline output');
		report.checks.push('Outputs move after edits above and clear when their executed code changes'); save();
		const other = vscode.Uri.file(path.join(root, 'other.py')); fs.writeFileSync(other.fsPath, '# other\n');
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(other));
		await until(() => live().length === 0, 'Hidden editor retained native views');
		editor = await vscode.window.showTextDocument(document);
		await until(() => live().length === 3 && live().some(view => view.webview.html.includes('44')), 'Returning to the file lost its output');
		await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
		await until(() => live().length === 6, 'Split editors did not each display block output');
		await vscode.commands.executeCommand('workbench.action.closeEditorsInOtherGroups');
		editor = await vscode.window.showTextDocument(document);
		await until(() => live().length === 3, 'Output did not survive closing the split');
		report.checks.push('Output returns when reopening a tab and appears in both split editor views'); save();
		if (process.env.MY_EDITOR_INLINE_VISUAL) {
			editor.revealRange(new vscode.Range(0, 0, 9, 0), vscode.TextEditorRevealType.AtTop);
			report.phase = 'ready for visual check'; save();
			await until(() => fs.existsSync(path.join(root, 'visual-ok')), 'Visual check was not acknowledged', 180000);
		}
		const editedSource = document.getText(); await document.save();
		await vscode.commands.executeCommand('myEditor.python.clearInlineResults');
		await until(() => live().length === 0, 'Clear Inline Output did not dismiss outputs');
		assert.equal(document.getText(), editedSource);
		assert.equal(fs.readFileSync(file.fsPath, 'utf8'), editedSource);
		report.checks.push('Clear Inline Output removes the output areas without changing source');
		report.passed = true; report.phase = 'complete'; save();
	} catch (error) {
		report.error = String(error); report.stack = error.stack;
		report.views = views.map(view => ({ line: view.line, disposed: disposed.has(view), html: view.webview.html }));
		report.terminals = vscode.window.terminals.map(terminal => {
			const file = terminal.creationOptions.env?.MY_EDITOR_PYTHON_RESULTS;
			return { name: terminal.name, file, events: file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' };
		});
		save(); throw error;
	}
	finally { vscode.window.createWebviewTextEditorInset = original; await vscode.commands.executeCommand('myEditor.python.restart'); }
};
