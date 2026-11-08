/* Finite real-editor concurrent soak. Run separate profiles; never uses the social application. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vscode = require('vscode');
exports.run = async () => {
 const seconds = Number(process.env.LOAD_SECONDS || 600); assert.ok(seconds>=1 && seconds<=3600);
 const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
 const source = path.join(root,'value.js'), test = path.join(root,'value.test.js');
 const originalTest = 'const {test}=require("node:test");const assert=require("node:assert/strict");test("positive saved value",()=>assert.ok(require("./value").value>0));\n';
 fs.writeFileSync(source,'exports.value = 1;\n'); fs.writeFileSync(test,originalTest);
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node --test value.test.js'}}));
 let phase='inspect', calls=0, refused=0, permissions=0, fixtureError, value=1, turn=0;
 const observations=[];
 const command=(n,...args)=>vscode.commands.executeCommand('myEditor.'+n,...args);
 const proposal=()=>vscode.window.tabGroups.all.flatMap(g=>g.tabs).find(t=>t.input instanceof vscode.TabInputTextDiff && t.input.modified.scheme==='my-editor-proposal');
 const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/api/tags'){res.end(JSON.stringify({models:[{name:'load-fixture'}]}));return;}
  try {
   let body='';for await(const chunk of req)body+=chunk;
   const payload=JSON.parse(body), text=JSON.stringify(payload.messages);calls++;
   const first=!payload.messages.some(m=>m.role==='assistant');let answer;
   if(phase==='inspect') {
    if(first) answer={action:'tool',name:'propose_file',arguments:{path:'value.js',content:'unsafe\n'}};
    else {assert.match(text,/turn is read-only/);refused++;answer={action:'final',message:'Read-only request respected. No changes made.'};}
   } else if(phase==='test') {
    if(first) answer={action:'tool',name:'run_tests',arguments:{command:'npm test'}};
    else {assert.ok(/pass 1/.test(text)&&/fail 0/.test(text),text.slice(-1800));answer={action:'final',message:'Saved fixture test passed.'};}
   } else if(first) answer={action:'tool',name:'read_file',arguments:{path:'value.js'}};
   else if(!text.includes('Host tool result for propose_file(')) answer={action:'tool',name:'propose_file',arguments:{path:'value.js',content:`exports.value = ${value};\n`}};
   else answer={action:'final',message:'Proposal ready for Keep. No saved changes claimed.'};
   res.end(JSON.stringify({message:{content:JSON.stringify(answer)},done:true})+'\n');
  }catch(error){fixtureError=error;res.statusCode=500;res.end('{}');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const originalInfo=vscode.window.showInformationMessage;
 vscode.window.showInformationMessage=(message,...args)=>{
  if(message==='Pair wants to run: npm test'){permissions++;return Promise.resolve('Run tests');}
  return originalInfo(message,...args);
 };
 const started=Date.now();
 const report=(ok,error)=>fs.writeFileSync(process.env.MY_EDITOR_INTEGRATION_REPORT,JSON.stringify({ok,error,seconds,elapsedMs:Date.now()-started,cycles:turn,calls,refused,permissions,observations},null,2));
 try {
  const config=vscode.workspace.getConfiguration('myEditor');
  for(const [key,val]of Object.entries({'ollama.baseUrl':`http://127.0.0.1:${server.address().port}`,'models.default':'ollama:load-fixture',
   'claudeCli.enabled':false,'codexCli.enabled':false,'lmstudio.enabled':false,'assistance.mode':'manual','autoComments.enabled':false,'navigator.enabled':false}))
   await config.update(key,val,vscode.ConfigurationTarget.Global);
  await vscode.extensions.getExtension('my-editor.my-editor-core').activate();
  while(Date.now()-started<seconds*1000){
   const cycleStart=Date.now(), before=fs.readFileSync(source,'utf8');
   const ask=async(text)=>{await command('chat.new');await command('chat.ask',text);if(fixtureError)throw fixtureError;};
   phase='inspect';await ask('/chat Inspect value.js. Read-only; do not change files.');
   assert.equal(fs.readFileSync(source,'utf8'),before);assert.equal(proposal(),undefined);
   phase='repair';value=turn+2;
   await ask('/chat Patch value.js with the requested fixture value. Do not change existing permissions. Propose for Keep; wait for Keep.');
   let p=proposal();assert.ok(p,'Expected reviewable proposal');assert.equal(fs.readFileSync(source,'utf8'),before);
   await command('proposal.undo',p.input.modified);assert.equal(fs.readFileSync(source,'utf8'),before);
   await ask('/chat Patch value.js with the requested fixture value again. Propose for Keep; wait for Keep.');
   p=proposal();assert.ok(p);assert.equal(fs.readFileSync(source,'utf8'),before);
   await command('proposal.keep',p.input.modified);assert.equal(fs.readFileSync(source,'utf8'),`exports.value = ${value};\n`);
   phase='test';await ask('/chat Run npm test once on the kept source and report the result. Leave source unchanged.');
   assert.equal(fs.readFileSync(test,'utf8'),originalTest);assert.equal(permissions,turn+1);assert.equal(refused,turn+1);
   observations.push({cycle:turn,elapsedMs:Date.now()-cycleStart,readOnlyRefused:true,noWriteBeforeKeep:true,undo:true,keep:true,savedTestsPassed:true});
   turn++;report(true);
  }
  assert.ok(turn>0);report(true);
 }catch(error){report(false,String(error.stack||error));throw error;}
 finally{vscode.window.showInformationMessage=originalInfo;server.closeAllConnections();server.close();}
};
