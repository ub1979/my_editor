const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.run = async ({ write, read, cmd, status, waitState, setResponder, setReview, calls }) => {
	const source = 'repair-loop/service.js', dependency = 'repair-loop/dependency.js';
	const original = 'exports.reason = value => value + require("./dependency").value;\n';
	const large = 'repair-loop/context.lock', largeText = '# Generated dependency evidence\n' + 'entry: fixture\n'.repeat(6500);
	write(large, largeText);
	const { passSource, evidenceSource } = require('../../out-test/src/project/filePassSource');
	const root = vscode.workspace.workspaceFolders[0].uri;
	await assert.rejects(passSource(root, large), /too large/, 'A large evidence file is still not eligible for whole-file editing');
	assert.ok((await evidenceSource(root, large)).hash);
	write('repair-loop/oversized.lock', 'x'.repeat(400001));
	await assert.rejects(evidenceSource(root, 'repair-loop/oversized.lock'), /too large/);
	write(source, original); write(dependency, 'exports.value = 1;\n');
	setReview(true);
	setResponder(async (kind, name, request) => [{ action: 'tool', name: 'read_file', arguments: { path: large, start: 1, lines: 3 } },
		{ action: 'tool', name: 'propose_file',
		arguments: { path: name, content: 'exports.reason = value => value;\n' } }]);
	try {
		await cmd('projectQA.file', vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, source));
		let state = await waitState('review');
		assert.equal(state.options.automatic, false); assert.equal(state.options.unattended, false);
		write(large, largeText + '# Dependency evidence changed during review\n');
		await cmd('projectBuild.keep');
		assert.equal(read(source), original, 'Keep must revalidate full tool-read evidence larger than the edit budget');
		state = await status(); assert.equal(state.pending.length, 1);
		await cmd('proposal.undo', vscode.Uri.parse('my-editor-proposal:/' + state.pending[0].id + '/service.js'));
		await waitState('paused');
		const before = calls.length;
		await cmd('projectQA.start', 'ollama:missing-audit-model');
		state = await waitState('error');
		assert.match(state.message, /selected model.*unavailable/i);
		assert.equal(state.modelKey, 'ollama:missing-audit-model');
		assert.equal(calls.length, before, 'An unavailable explicit model cannot fall back to a different provider');
		// A passing process cannot verify a source snapshot that changed during its execution.
		setReview(false); setResponder(async () => []);
		write(source, 'exports.reason = value => value;\n');
		let changed = false;
		const started = vscode.tasks.onDidStartTaskProcess(() => {
			if (!changed) { changed = true; write(source, 'exports.reason = value => value;\n// Concurrent edit during verification.\n'); }
		});
		try {
			await cmd('projectQA.file', vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, source));
			state = await waitState('checkpoint', state => state.lastTestStatus === 'unverified');
			assert.ok(changed); assert.match(state.lastTest, /exited with code 0/);
			assert.match(state.lastTest, /Source changed while checks ran/);
			await cmd('projectBuild.pause');
		} finally { started.dispose(); }
	} finally { setReview(false); setResponder(undefined); }
};
