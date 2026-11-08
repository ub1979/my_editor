/* Same disposable repair and exact selected Codex model through both runtime choices. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async () => {
 const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
 const config = vscode.workspace.getConfiguration('myEditor');
 const command = (name, ...args) => vscode.commands.executeCommand('myEditor.' + name, ...args);
 const proposal = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
  tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'my-editor-proposal');
 const records = () => fs.existsSync(path.join(root, '.my_editor/investigations'))
  ? fs.readdirSync(path.join(root, '.my_editor/investigations'), { recursive: true }).filter(name => name.endsWith('.json'))
   .map(name => JSON.parse(fs.readFileSync(path.join(root, '.my_editor/investigations', name), 'utf8'))) : [];
 const source = 'exports.double = value => value + 2;\n';
 fs.writeFileSync(path.join(root, 'arithmetic.js'), source);
 fs.writeFileSync(path.join(root, 'arithmetic.test.js'), 'const {test}=require("node:test"); const assert=require("node:assert/strict");\n'
  + 'test("double",()=>{ for (const n of [-3,0,2,7]) assert.equal(require("./arithmetic").double(n), n*2); });\n');
 fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({scripts:{test:'node --test arithmetic.test.js'}}));
 const originalTests = fs.readFileSync(path.join(root, 'arithmetic.test.js'), 'utf8');
 const originalManifest = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
 for (const [key, value] of Object.entries({ 'models.default': 'codex-cli:gpt-5.6-sol', 'codexCli.models': ['gpt-5.6-sol'],
  'codexCli.enabled': true, 'claudeCli.enabled': false, 'ollama.enabled': false, 'lmstudio.enabled': false,
  'assistance.mode': 'manual', 'autoComments.enabled': false, 'navigator.enabled': false })) {
  await config.update(key, value, vscode.ConfigurationTarget.Global);
 }
 await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
 const originalInfo = vscode.window.showInformationMessage;
 let testPermissions = 0;
 vscode.window.showInformationMessage = (message, ...args) => {
  if (message === 'Pair wants to run: npm test') { testPermissions++; return Promise.resolve('Run tests'); }
  return originalInfo(message, ...args);
 };
 const results = [];
 try {
  for (const runtime of ['builtin', 'opencode']) {
   await config.update('projectAgents.runtime', runtime, vscode.ConfigurationTarget.Global);
   await command('chat.new');
   const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'arithmetic.js');
   const document = await vscode.workspace.openTextDocument(uri), edit = new vscode.WorkspaceEdit();
   edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), source);
   assert.ok(await vscode.workspace.applyEdit(edit)); assert.ok(await document.save());
   const start = Date.now(), before = new Set(records().map(record => record.id));
   await command('chat.ask', '/chat Run npm test once to reproduce the arithmetic failure. Leave the source as it is and stay in this chat. Report the actual result.');
   const failed = records().filter(record => !before.has(record.id));
   assert.ok(failed.some(record => record.evidence.some(item => item.tool === 'run_tests' && /fail 1|exit code 1|exited.*1/i.test(item.excerpt))), 'Real failing test evidence required');
   await command('chat.ask', '/chat Fix only arithmetic.js so double(value) returns value * 2 for every input. Read the current source and arithmetic.test.js for context. Retain arithmetic.test.js exactly. Do not change source-size policy or dependencies. Read-only inspection verified that the existing tests express the intended behavior. Propose the minimal repair for Keep; wait until I Keep before running tests.');
   let tab = proposal(); assert.ok(tab, 'Repair must produce a review diff');
   assert.ok(tab.input.modified.path.endsWith('/arithmetic.js'), 'Only the authorized source repair may be kept');
   assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), source, 'No write before Keep');
   await command('proposal.undo', tab.input.modified);
   assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), source, 'Undo must discard the proposed edit');
   await command('chat.ask', '/chat Fix arithmetic.js again with that same minimal repair. Prepare the proposal for Keep and wait for Keep before tests.');
   tab = proposal(); assert.ok(tab, 'Second repair must produce a review diff');
   assert.ok(tab.input.modified.path.endsWith('/arithmetic.js'));
   await command('proposal.keep', tab.input.modified);
   assert.notEqual(fs.readFileSync(uri.fsPath, 'utf8'), source);
   const beforePass = new Set(records().map(record => record.id));
   await command('chat.ask', '/chat The arithmetic.js repair was Kept. Run npm test once against the saved files and report the actual result. Leave the source as it is and stay in this chat.');
   const passed = records().filter(record => !beforePass.has(record.id));
   assert.ok(passed.some(record => record.evidence.some(item => item.tool === 'run_tests' && /pass 1/.test(item.excerpt) && /fail 0/.test(item.excerpt))), 'Real passing test evidence required');
   const runRecords = records().filter(record => !before.has(record.id));
   assert.ok(runRecords.every(record => /5\.6.?sol/i.test(record.model)), 'Exact selected model must be retained');
   assert.equal(vscode.workspace.getConfiguration('myEditor').get('models.default'), 'codex-cli:gpt-5.6-sol');
   assert.equal(fs.readFileSync(path.join(root, 'arithmetic.test.js'), 'utf8'), originalTests);
   assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), originalManifest);
   results.push({runtime, elapsedMs: Date.now()-start, turns: runRecords.length, reproducedFailure:true, keepUndo:true, testsPreserved:true, passingSavedTests:true});
  }
  assert.equal(testPermissions, 4, 'Both runs must request existing test permissions');
  fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ok:true, selectedModel:'codex-cli:gpt-5.6-sol', results, testPermissions}, null, 2));
 } finally { vscode.window.showInformationMessage = originalInfo; }
};
