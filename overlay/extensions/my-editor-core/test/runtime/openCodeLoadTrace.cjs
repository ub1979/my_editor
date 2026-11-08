/* Test-only native process telemetry. All targets belong to a disposable fixture host. */
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
exports.install = output => {
 const original = cp.spawn, samples = [];
 const save = () => fs.writeFileSync(output,JSON.stringify({pid:process.pid,samples},null,2));
 cp.spawn = function(executable,args,options) {
  const child = original.apply(this,arguments);
  if(args?.[0]!=='serve' || !args.includes('--pure')) return child;
  const sample={pid:child.pid,start:Date.now(),root:path.dirname(options.cwd),stdout:'',stderr:''};samples.push(sample);
  child.stdout.on('data',b=>{
   sample.stdout=(sample.stdout+String(b)).slice(-4096);
   const m=/http:\/\/127\.0\.0\.1:(\d+)/.exec(sample.stdout);
   if(m && !sample.startupMs){sample.startupMs=Date.now()-sample.start;sample.port=Number(m[1]);save();}
  });
  child.stderr.on('data',b=>sample.stderr=(sample.stderr+String(b)).slice(-8192));
  const timer=setTimeout(()=>{
   if(!sample.startupMs)cp.execFile('/bin/ps',['-p',String(child.pid),'-o','pid,ppid,state,etime,%cpu,rss,command'],{timeout:2000},(_err,out)=>{sample.stall=out;save();});
  },10000);timer.unref();
  child.once('exit',(code,signal)=>{
   clearTimeout(timer);sample.exit={code,signal,elapsedMs:Date.now()-sample.start};
   if(!sample.startupMs){
    const logs=path.join(sample.root,'data/opencode/log');
    if(fs.existsSync(logs))sample.logs=fs.readdirSync(logs).filter(n=>n.endsWith('.log')).map(n=>fs.readFileSync(path.join(logs,n),'utf8').slice(-12000));
   }else{delete sample.stdout;delete sample.stderr;}
   save();
  });
  save();return child;
 };
 return {samples,dispose(){cp.spawn=original;save();}};
};
