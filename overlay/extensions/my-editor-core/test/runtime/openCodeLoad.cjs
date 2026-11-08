/* Finite, disposable concurrent native-runtime load; no application workspace or real provider. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const binary = process.env.MY_EDITOR_OPENCODE_BINARY || path.join(os.homedir(), '.opencode/bin/opencode');
const output = process.env.LOAD_REPORT || '/tmp/my-editor-opencode-load.json';
const seconds = Number(process.env.LOAD_SECONDS || 120);
const workers = Number(process.env.LOAD_WORKERS || 4);
assert.ok(seconds >= 1 && seconds <= 3600 && workers >= 1 && workers <= 8);
const originalSpawn = cp.spawn;
cp.spawn = function(executable, args, options) {
 if (process.env.LOAD_PRIVATE_HOME === '1' && args?.[0] === 'serve') options.env.HOME = path.join(path.dirname(options.cwd), 'home');
 const child = originalSpawn.apply(this, arguments), sample = context.getStore();
 if (sample && args?.[0] === 'serve') {
  sample.pid = child.pid; sample.spawnAt = Date.now(); sample.stdout = ''; sample.stderr = '';
  sample.root = path.dirname(options.cwd);
  child.stdout.on('data', chunk => {
   sample.stdout = (sample.stdout + String(chunk)).slice(-4096);
   const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(sample.stdout);
   if (!sample.listenAt && match) { sample.listenAt = Date.now(); sample.listenPort = Number(match[1]); }
  });
  child.stderr.on('data', chunk => { sample.stderr = (sample.stderr + String(chunk)).slice(-8192); });
  child.on('exit', (code, signal) => {
   sample.exit = { code, signal, at: Date.now() };
   if (!sample.listenAt) {
    const logdir = path.join(sample.root,'data/opencode/log');
    if (fs.existsSync(logdir)) sample.startupLogs = fs.readdirSync(logdir).filter(n=>n.endsWith('.log'))
     .map(n=>fs.readFileSync(path.join(logdir,n),'utf8').slice(-12000));
   }
  });
  const timer = setTimeout(() => {
   if (!sample.listenAt) cp.execFile('/bin/ps', ['-p', String(child.pid), '-o', 'pid,ppid,state,etime,%cpu,rss,command'],
    { timeout: 2000 }, (_error, stdout) => { sample.stalledProcess = stdout; });
  }, 10000); timer.unref(); child.once('exit', () => clearTimeout(timer));
 }
 return child;
};
const { runOpenCodeLoop } = require('../../out-test/src/runtime/openCodeLoop');
function cancelSource() {
 const emitter = new EventEmitter(); let cancelled = false;
 return { stop() { cancelled = true; emitter.emit('cancel'); }, token: {
  get isCancellationRequested() { return cancelled; },
  onCancellationRequested(fn) { emitter.on('cancel', fn); return { dispose() { emitter.off('cancel', fn); } }; }
 }};
}
async function worker() {
 const samples = [], start = Date.now(), until = start + seconds * 1000;
 const owned = `my-editor-opencode-${process.pid}-`;
 const before = new Set(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith(owned)));
 let peakRss = process.memoryUsage().rss;
 while (Date.now() < until) {
  const sample = { index: samples.length, startAt: Date.now(), asks: 0, tools: 0 };
  const cancel = cancelSource(), deadline = setTimeout(() => cancel.stop(), 45000);
  try {
   await context.run(sample, async () => {
    const result = await runOpenCodeLoop({ initial: [{ role:'user', text:`Inspect disposable fixture ${process.pid}:${sample.index}.` }],
     progress: () => {}, cancelled: () => cancel.token.isCancellationRequested,
     ask: async turns => {
      sample.asks++;
      if (sample.asks === 1) return JSON.stringify({ action:'tool', name:'read_file', arguments:{path:'fixture.js'} });
      assert.match(JSON.stringify(turns), /fixture value 42/);
      return JSON.stringify({action:'final', message:'Disposable fixture value 42 verified. No application changes.'});
     },
     execute: async call => { assert.equal(call.name,'read_file'); sample.tools++; return 'fixture value 42'; },
     onObservation: call => { if (call.name === 'runtime_session') sample.session = call.arguments.id; }
    }, binary, cancel.token);
    assert.match(result, /value 42 verified/); assert.equal(sample.asks,2); assert.equal(sample.tools,1);
    assert.ok(sample.session); sample.ok = true;
   });
  } catch (error) { sample.ok = false; sample.error = String(error.stack || error); }
  finally { clearTimeout(deadline); }
  sample.elapsedMs = Date.now() - sample.startAt;
  sample.startupMs = sample.listenAt ? sample.listenAt - sample.spawnAt : null;
  sample.stateRemoved = !sample.root || !fs.existsSync(sample.root);
  try { process.kill(sample.pid,0); sample.processGone = false; } catch (e) { sample.processGone = e.code === 'ESRCH'; }
  if (sample.ok) { delete sample.stdout; delete sample.stderr; }
  samples.push(sample); peakRss = Math.max(peakRss, process.memoryUsage().rss);
  fs.writeFileSync(output, JSON.stringify({pid:process.pid,seconds,elapsedMs:Date.now()-start,peakRss,samples},null,2));
  if (!sample.stateRemoved || !sample.processGone) break;
 }
 const leftovers = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith(owned) && !before.has(n));
 fs.writeFileSync(output, JSON.stringify({pid:process.pid,seconds,elapsedMs:Date.now()-start,peakRss,leftovers,samples},null,2));
 process.exitCode = samples.every(s=>s.ok && s.stateRemoved && s.processGone) && !leftovers.length ? 0 : 1;
}
async function main() {
 if (process.argv.includes('--worker')) return worker();
 const start = Date.now();
 let blocker;
 if (process.env.LOAD_OCCUPY_DEFAULT === '1') {
  blocker = net.createServer(socket=>socket.destroy());
  await new Promise((resolve,reject)=>{blocker.once('error',reject);blocker.listen(4096,'127.0.0.1',resolve);});
 }
 const results = await Promise.all(Array.from({length:workers}, (_,i) => new Promise(resolve => {
  const report = output.replace(/\.json$/, `-worker-${i}.json`);
  const child = originalSpawn(process.execPath,[__filename,'--worker'], {env:{...process.env,LOAD_REPORT:report},stdio:['ignore','pipe','pipe']});
  let errors=''; child.stderr.on('data',b=>errors=(errors+String(b)).slice(-2000)); child.stdout.resume();
  child.once('exit',(code,signal)=>resolve({code,signal,report,errors}));
 })));
 if (blocker) await new Promise(resolve=>blocker.close(resolve));
 const details = results.map(r=>({...r,...JSON.parse(fs.readFileSync(r.report,'utf8'))}));
 const samples = details.flatMap(r=>r.samples), timings=samples.map(s=>s.startupMs).filter(Number.isFinite).sort((a,b)=>a-b);
 const summary = {ok:results.every(r=>r.code===0),workers,seconds,elapsedMs:Date.now()-start,attempts:samples.length,
  passed:samples.filter(s=>s.ok).length,failed:samples.filter(s=>!s.ok).length,
  startupMs:{p50:timings[Math.floor(timings.length*.5)],p95:timings[Math.floor(timings.length*.95)],max:timings.at(-1)},
  clean:samples.every(s=>s.stateRemoved && s.processGone) && details.every(d=>!d.leftovers.length),details};
 fs.writeFileSync(output,JSON.stringify(summary,null,2)); console.log(JSON.stringify({...summary,details:results}));
 process.exitCode = summary.ok ? 0 : 1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
