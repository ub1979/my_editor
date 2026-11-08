const assert = require('node:assert/strict');
const vscode = require('vscode');
const { stubContent } = require('../../out-test/src/project/stubs');

exports.run = async ({ write, read, cmd, waitState, calls, setResponder, setBatchSize }) => {
	const paths = ['batch/value.js', 'batch/api.js', 'batch/api.test.js'];
	const files = paths.map(path => ({ path, role: 'Expose and test a shared value', section: 'store', requirements: ['FR-001'], estimatedLines: 20, status: 'stub' }));
	write('.my_editor/specs/tree.json', JSON.stringify({ files, buildPlan: { version: 1, entryPoint: paths[1], steps: [
		{ id: 'batch', title: 'Related module', files: paths, dependsOn: [], tasks: ['Expose and test the value'], checks: ['Run npm test'] },
	] } }));
	files.forEach(file => write(file.path, stubContent(file)));
	write('package.json', JSON.stringify({ scripts: { test: 'node --test batch/api.test.js' } }));
	const code = ['exports.value = 42;\n', 'exports.value = require("./value").value;\n',
		'const {test} = require("node:test"); const assert = require("node:assert/strict");\ntest("API", () => assert.equal(require("./api").value, 42));\n'];
	setBatchSize(3);
	let rejectBatch = false;
	setResponder(async (kind, name, request) => {
		if (kind === 'QA') { return []; }
		if (!request.includes('related-file batch')) {
			assert.ok(rejectBatch, 'A valid batch must not require another generation request');
			return [{ action: 'tool', name: 'propose_file', arguments: { path: name, content: code[paths.indexOf(name)] } }];
		}
		assert.equal(name, paths[0]); assert.match(request, /related-file batch/);
		for (const path of paths) { assert.ok(request.includes(path)); }
		// Real providers can return literal newlines inside JSON source strings. Exercise
		// parsing, staging, saving and the subsequent tests/QA with that wire format.
		return [...paths.map((path, index) => JSON.stringify({ action: 'tool', name: 'propose_file',
			arguments: { path, content: code[index] } }).replace(/\\n/g, '\n')),
			...(rejectBatch ? [{ action: 'tool', name: 'propose_file', arguments: { path: 'outside-batch.js', content: 'exports.bad = true;\n' } }] : []),
			{ action: 'final', message: 'FILE_REVIEWED\n' + JSON.stringify({ files: paths.map(path => ({ path, summary: `Built ${path}. Tests follow.` })) }) }];
	});
	try {
		const before = calls.length;
		await cmd('projectBuild.start'); const state = await waitState('complete');
		assert.equal(calls.slice(before).filter(call => call.kind === 'Build').length, 1, 'Three files should share one generation request');
		assert.deepEqual(state.buildResults.map(file => file.path), paths);
		assert.ok(state.buildResults.every(file => file.outcome === 'saved' && file.note.includes(file.path)));
		paths.forEach((path, index) => assert.equal(read(path), code[index]));
		assert.equal(state.lastTestStatus, 'passed'); assert.equal(state.phase, 'qa');
		assert.ok(paths.every(path => state.results.some(result => result.path === path)), 'QA still covers each file');
		rejectBatch = true;
		// Reset through the editor: a direct disk rewrite races its still-open documents' save versions.
		for (const file of files) {
			const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, file.path);
			const doc = await vscode.workspace.openTextDocument(uri), edit = new vscode.WorkspaceEdit();
			edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), stubContent(file));
			assert.ok(await vscode.workspace.applyEdit(edit)); assert.ok(await doc.save());
		}
		const retryStart = calls.length;
		await cmd('projectBuild.start'); const recovered = await waitState('complete');
		assert.throws(() => read('outside-batch.js'), /ENOENT/, 'A batch cannot create an unlisted file');
		assert.deepEqual(calls.slice(retryStart).filter(call => call.kind === 'Build').map(call => call.name), [paths[0], ...paths],
			'An invalid batch falls back once to individual files instead of repeating the batch failure');
		assert.equal(recovered.lastTestStatus, 'passed');
	} finally { setResponder(undefined); setBatchSize(1); }
};
