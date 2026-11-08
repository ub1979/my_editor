/* Kill only this fixture host's owned runtime while a model request is pending; verify abort and restart. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const vscode = require('vscode');
exports.run = async () => {
 const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
 fs.writeFileSync(path.join(root, 'safe.js'), 'exports.value = 1;\n');
 let phase = 'crash', closed = false, requested = 0, failure;
 const server = http.createServer(async (req, res) => {
  if (req.url === '/api/tags') { res.end(JSON.stringify({models:[{name:'lifecycle'}]})); return; }
  try {
   for await (const _ of req) { /* Consume the complete model request. */ }
   requested++;
   if (phase === 'cancel') { res.on('close', () => { closed = true; }); return; }
   if (phase === 'crash') {
    res.on('close', () => { closed = true; });
    const children = execFileSync('/usr/bin/pgrep', ['-P', String(process.pid), '-f', 'opencode'], {encoding:'utf8'}).trim().split(/\s+/).map(Number);
    assert.equal(children.length, 1, 'Only this extension host owns the target OpenCode child');
    process.kill(children[0], 'SIGKILL');
    return;
   }
   res.setHeader('content-type','application/json');
   res.end(JSON.stringify({message:{content:JSON.stringify({action:'final',message:'Fresh runtime turn acknowledged. No changes made.'})},done:true})+'\n');
  } catch (error) { failure = error; res.statusCode = 500; res.end('{}'); }
 });
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
 const config = vscode.workspace.getConfiguration('myEditor');
 try {
  for (const [key,value] of Object.entries({'ollama.baseUrl':`http://127.0.0.1:${server.address().port}`,
   'models.default':'ollama:lifecycle','claudeCli.enabled':false,'codexCli.enabled':false,'lmstudio.enabled':false,
   'assistance.mode':'manual','autoComments.enabled':false,'navigator.enabled':false})) {
   await config.update(key,value,vscode.ConfigurationTarget.Global);
  }
  await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
  const command = (name,...args) => vscode.commands.executeCommand('myEditor.'+name,...args);
  const deadline = new Promise((_,reject) => { const timer=setTimeout(()=>reject(Error('Runtime crash did not end the host turn')),15000); timer.unref(); });
  await Promise.race([command('chat.ask','/chat Read safe.js and report its current value.'),deadline]);
  if (failure) throw failure;
  const end = Date.now()+3000;
  while (!closed && Date.now()<end) await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(closed,true,'Runtime failure must abort the selected-model connection');
  assert.equal(requested,1,'No automatic provider or runtime fallback');
  assert.equal(fs.readFileSync(path.join(root,'safe.js'),'utf8'),'exports.value = 1;\n');
  assert.equal(vscode.window.tabGroups.all.flatMap(group=>group.tabs).some(tab=>tab.input instanceof vscode.TabInputTextDiff),false);
  phase='cancel'; closed=false;
  const active = command('chat.ask','/chat Read safe.js and report its current value.');
  const waiting = Date.now()+15000;
  while (requested < 2 && Date.now()<waiting) await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(requested,2); await command('chat.new'); await active;
  assert.equal(closed,true,'Resetting the conversation must cancel the model and native session');
  phase='restart'; await command('chat.ask','/chat Acknowledge this fresh turn.');
  assert.equal(requested,3);
  fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT, JSON.stringify({ok:true, runtimeCrashAbortsModel:true, parentCancellation:true, noFallback:true, sourcePreserved:true, restartWorks:true}));
 } finally { server.closeAllConnections(); server.close(); }
};
