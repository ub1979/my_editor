/* Real child lifecycle faults plus an occupied-default-port native startup. Disposable only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {startOpenCode} = require('../../out-test/src/runtime/openCodeServer');
const {OpenCodeBridge} = require('../../out-test/src/runtime/openCodeBridge');
const {privateOpenCodePort} = require('../../out-test/src/runtime/openCodeStartup');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'editor-startup-faults-'));
 const binary=path.join(root,'runtime'), capture=path.join(root,'capture.jsonl');
 const observations=[];
 try {
  // The executable records only fixture paths/IDs, never the environment's secrets.
  for(const mode of ['cancel','silent','wrong-listener','bind-failure']){
   fs.writeFileSync(capture,'');
   fs.writeFileSync(binary,`#!${process.execPath}\nconst fs=require('node:fs');\nfs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),pid:process.pid,cwd:process.cwd(),home:process.env.HOME,userProfile:process.env.USERPROFILE})+'\\n');\nif(process.argv[2]==='--version'){console.log('1.19.3');process.exit(0);}\n${mode==='wrong-listener' ? "console.log('opencode server listening on http://127.0.0.1:1');" : mode==='bind-failure' ? "console.error('private-secret EADDRINUSE');process.exit(1);" : ''}\nsetInterval(()=>{},1000);\n`,{mode:0o700});
   const abort=new AbortController(), started=Date.now();
   const pending=startOpenCode(binary,'http://127.0.0.1:1','fixture-secret',abort.signal);
   // Attach rejection immediately; drive cancellation only after the server child exists.
   const rejected=assert.rejects(pending,error=>{
    assert.match(String(error),mode==='cancel'?/startup stopped/:mode==='silent'?/startup timed out.*readiness/:mode==='wrong-listener'?/unexpected listener/:/exited during startup.*EADDRINUSE/);
    assert.doesNotMatch(String(error),/private-secret|fixture-secret/);return true;
   });
   if(mode==='cancel'){
    for(let i=0;i<100 && fs.readFileSync(capture,'utf8').trim().split('\n').length<2;i++)await delay(20);
    abort.abort();
   }
   await rejected;
   const lines=fs.readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse);
   assert.equal(lines.length,2);const owned=path.dirname(lines[0].cwd);
   for(const line of lines){
    assert.equal(line.home.replace(/^\/private\/var\//,'/var/'),path.join(owned,'home').replace(/^\/private\/var\//,'/var/'));assert.equal(line.userProfile,line.home);
    assert.equal(line.cwd,path.join(owned,'work'));
    assert.throws(()=>process.kill(line.pid,0),/ESRCH/);
   }
   assert.equal(fs.existsSync(owned),false,'Failure must remove the owned private profile');
   const port=Number(lines[1].args.at(-1));assert.ok(port>0 && port!==4096);
   if(mode==='silent')assert.ok(Date.now()-started>=15000,'Do not shorten/skip the production timeout');
   observations.push({mode,elapsedMs:Date.now()-started,childrenGone:true,ownedRootRemoved:true,privateHome:true,explicitPort:port});
  }
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(privateOpenCodePort(cancelled.signal),/startup stopped/);
  for(let i=0;i<50;i++){
   const racing=new AbortController(), reservation=privateOpenCodePort(racing.signal);racing.abort();
   await assert.rejects(reservation,/startup stopped/);
  }
  observations.push({mode:'cancel-port-reservation',attempts:50,rejected:true});
  const blocker=net.createServer();await new Promise((resolve,reject)=>{blocker.once('error',reject);blocker.listen(4096,'127.0.0.1',resolve);});
  const bridge=new OpenCodeBridge({initial:[],ask:async()=>'',execute:async()=>'',progress:()=>{},cancelled:()=>false});
  let server;
  try {
   await bridge.listen();
   server=await startOpenCode(process.env.MY_EDITOR_OPENCODE_BINARY||path.join(os.homedir(),'.opencode/bin/opencode'),bridge.url,bridge.secret,new AbortController().signal);
   assert.equal((await server.request('/global/health')).healthy,true);
   const owned=server.root;await server.close();assert.equal(fs.existsSync(owned),false);
   observations.push({mode:'native-default-port-occupied',healthy:true,ownedRootRemoved:true});
  }finally{await server?.close();await bridge.close();await new Promise(resolve=>blocker.close(resolve));}
  console.log(JSON.stringify({ok:true,cases:observations},null,2));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
