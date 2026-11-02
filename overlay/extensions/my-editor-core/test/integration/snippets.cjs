/* Exercise the reported TypeScript directive through a real editor, fixture model and Keep diff. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async function () {
	const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const calls = [], warnings = [];
	const warning = vscode.window.showWarningMessage;
	vscode.window.showWarningMessage = (text, ...args) => { warnings.push(text); return warning(text, ...args); };
	let response = 'valid', hold;
	const source = '/**\n * createAiClient(baseUrl) with generate, providers, getSettings and putSettings; returns typed errors\n'
		+ ' * Requirements: FR-005.\n * Architecture: #ai-contract.\n */\n//AI make the class \n\nexport {};\n';
	const code = [
		'type ClientResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } };',
		'export class AiClient {',
		'  constructor(private readonly baseUrl: string) {}',
		...['generate', 'providers', 'getSettings', 'putSettings'].flatMap(name => [
			`  async ${name}(): Promise<ClientResult<unknown>> {`,
			`    const url = new URL("${name}", this.baseUrl);`,
			'    try {',
			'      const response = await fetch(url);',
			'      if (!response.ok) {',
			'        return {',
			'          ok: false,',
			'          error: {',
			'            message: `HTTP ${response.status}`,',
			'          },',
			'        };',
			'      }',
			'      const value: unknown = await response.json();',
			'      return {',
			'        ok: true,',
			'        value,',
			'      };',
			'    } catch (error) {',
			'      return {',
			'        ok: false,',
			'        error: {',
			'          message: String(error),',
			'        },',
			'      };',
			'    }',
			'  }',
		]),
		'}',
		'export function createAiClient(baseUrl: string): AiClient {',
		'  return new AiClient(baseUrl);',
		'}',
	].join('\n');
	assert.ok(code.split('\n').length > 100);
	const fenced = text => '```typescript\n' + text + '\n```';
	const server = http.createServer(async (req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'snippets' }] })); return; }
		let body = ''; for await (const chunk of req) { body += chunk; }
		const payload = JSON.parse(body); calls.push(payload);
		if (response === 'slow') { await new Promise(resolve => { hold = resolve; }); }
		const correcting = payload.messages.at(-1).content.includes('The insertion check rejected');
		const content = response === 'invalid' || (response === 'repair' && !correcting)
			? fenced('// ... existing code ...') : fenced(code);
		res.end(JSON.stringify({ message: { content }, done: true }) + '\n');
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const proposal = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
		tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
	try {
		const config = vscode.workspace.getConfiguration('myEditor');
		for (const [key, value] of Object.entries({ 'ollama.baseUrl': `http://127.0.0.1:${server.address().port}`,
			'models.default': 'ollama:snippets', 'claudeCli.enabled': false, 'codexCli.enabled': false,
			'lmstudio.enabled': false, 'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false })) {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
		}
		await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
		const makeFile = async name => {
			const uri = vscode.Uri.file(path.join(root, name)); fs.writeFileSync(uri.fsPath, source);
			return vscode.window.showTextDocument(uri, { preview: false });
		};
		let editor = await makeFile('client.ts');
		await vscode.commands.executeCommand('myEditor.inlineAi.generate', editor.document.uri, 5);
		assert.ok(proposal(), 'A class over 100 lines should reach a proposal');
		assert.equal(fs.readFileSync(editor.document.uri.fsPath, 'utf8'), source);
		await vscode.commands.executeCommand('myEditor.proposal.keep', proposal().input.modified);
		assert.equal(fs.readFileSync(editor.document.uri.fsPath, 'utf8'), source.replace('//AI make the class \n', '//AI make the class \n' + code + '\n'));
		assert.equal(calls.length, 1);
		response = 'repair'; editor = await makeFile('repair.ts');
		await vscode.commands.executeCommand('myEditor.inlineAi.generate', editor.document.uri, 5);
		assert.equal(calls.length, 3);
		assert.ok(calls[2].messages.at(-1).content.includes('omitted-code placeholder'));
		assert.ok(proposal());
		await vscode.commands.executeCommand('myEditor.proposal.undo', proposal().input.modified);
		assert.equal(fs.readFileSync(editor.document.uri.fsPath, 'utf8'), source);
		response = 'invalid'; editor = await makeFile('invalid.ts');
		await vscode.commands.executeCommand('myEditor.inlineAi.generate', editor.document.uri, 5);
		assert.equal(calls.length, 5); assert.ok(!proposal());
		assert.ok(warnings.at(-1).includes('omitted-code placeholder'));
		assert.equal(fs.readFileSync(editor.document.uri.fsPath, 'utf8'), source);
		response = 'slow'; editor = await makeFile('changed.ts');
		const running = vscode.commands.executeCommand('myEditor.inlineAi.generate', editor.document.uri, 5);
		while (!hold) { await new Promise(resolve => setTimeout(resolve, 25)); }
		await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '// new unsaved edit\n'));
		hold(); await running;
		assert.equal(calls.length, 6); assert.ok(!proposal());
		assert.ok(warnings.at(-1).includes('file changed'));
		assert.ok(editor.document.getText().startsWith('// new unsaved edit\n'));
		fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ ok: true,
			classLines: code.split('\n').length, calls: calls.length, reportedStubKept: true,
			correctionSucceeded: true, invalidReplyPreservesSource: true, sourceEditStopsGeneration: true }, null, 2));
	} finally { server.close(); vscode.window.showWarningMessage = warning; }
};
