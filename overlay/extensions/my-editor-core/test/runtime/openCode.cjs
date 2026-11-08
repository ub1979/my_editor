/* Real pinned OpenCode process, native provider/MCP transport, deterministic host model. */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runOpenCodeLoop } = require('../../out-test/src/runtime/openCodeLoop');
const { OpenCodeBridge } = require('../../out-test/src/runtime/openCodeBridge');
const binary = process.env.MY_EDITOR_OPENCODE_BINARY || path.join(os.homedir(), '.opencode/bin/opencode');
const final = message => JSON.stringify({ action: 'final', message });
const tool = (name = 'read_file') => ({ action: 'tool', name, arguments: { path: 'fixture.js' } });
function cancellation() {
 const emitter = new EventEmitter(); let cancelled = false;
 return { stop() { cancelled = true; emitter.emit('cancel'); }, token: {
  get isCancellationRequested() { return cancelled; },
  onCancellationRequested(fn) { emitter.on('cancel', fn); return { dispose() { emitter.off('cancel', fn); } }; },
 } };
}
async function run(options, cancel = cancellation(), executable = binary) {
 const timer = setTimeout(() => cancel.stop(), 30000);
 try { return await runOpenCodeLoop({ initial: [{ role: 'user', text: 'Inspect this disposable fixture.' }], progress: () => {},
  cancelled: () => cancel.token.isCancellationRequested, execute: async () => 'actual fixture', ...options }, executable, cancel.token); }
 finally { clearTimeout(timer); }
}
async function main() {
 const ownedPrefix = `my-editor-opencode-${process.pid}-`;
 const before = new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith(ownedPrefix)));
 let calls = 0, executed = 0, evidence = [];
 assert.match(await run({ ask: async turns => {
  if (++calls === 1) return JSON.stringify(tool());
  assert.match(JSON.stringify(turns), /actual fixture/); return final('fixture.js was inspected. No changes or tests were made.');
 }, execute: async call => { assert.equal(call.name, 'read_file'); executed++; return 'actual fixture'; },
 onObservation: (c, r) => evidence.push([c, r]) }), /was inspected/);
 assert.equal(calls, 2); assert.equal(executed, 1);
 assert.ok(evidence.some(([call]) => call.name === 'runtime_session'));
 console.log('PASS native model → MCP → model and host evidence');
 // A malformed conclusion starts one corrected native prompt, preserving the host correction.
 calls = 0;
 assert.match(await run({ ask: async turns => {
  if (++calls === 1) return 'not a supported response';
  assert.match(JSON.stringify(turns), /last response was empty or not a supported tool request/);
  return final('Inspection was not completed; no files changed.');
 } }), /not completed/);
 assert.equal(calls, 2); console.log('PASS bounded malformed-response recovery');
 // The native runtime cannot increase the existing 60-action budget.
 calls = 0; executed = 0;
 await run({ ask: async (_turns, finalOnly, remaining) => {
  calls++; if (finalOnly) { assert.equal(remaining, 0); return final('Inspected the available items. No edits made.'); }
  return JSON.stringify({ action: 'tools', calls: Array.from({ length: 20 }, () => tool()) });
 }, execute: async () => { executed++; return 'fixture'; } });
 assert.equal(executed, 60); assert.equal(calls, 4); console.log('PASS unchanged host budget');
 await assert.rejects(run({ ask: async () => { throw Error('selected model unavailable fixture'); } }), /selected model unavailable fixture/);
 console.log('PASS unavailable selected model stops without fallback');
 const cancel = cancellation(); let late;
 const pending = run({ ask: () => new Promise(resolve => { late = resolve; cancel.stop(); }),
  execute: async () => { throw Error('cancelled action executed'); } }, cancel);
 assert.equal(await pending, ''); late(JSON.stringify(tool('propose_file')));
 console.log('PASS cancellation during model request and late reply ignored');
 // A fresh turn works after cancellation and does not inherit previous model or context.
 calls = 0;
 await run({ ask: async turns => { calls++; assert.ok(!JSON.stringify(turns).includes('actual fixture')); return final('Fresh turn acknowledged.'); } });
 assert.equal(calls, 1); console.log('PASS isolated restart');
 await assert.rejects(run({ ask: async () => { throw Error('must not call'); } }, undefined, '/bin/echo'), /1.19.3 is required/);
 console.log('PASS unsupported runtime fails before model execution');
 // Authenticated bridge refuses native tool injection before invoking the host model.
 let modelCalled = false;
 const bridge = new OpenCodeBridge({ initial: [], ask: async () => { modelCalled = true; return ''; }, execute: async () => '', progress: () => {}, cancelled: () => false });
 await bridge.listen();
 try {
  const request = (route, body, auth = bridge.secret) => fetch(bridge.url + route, { method: 'POST', headers: { Authorization: 'Bearer ' + auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'wrong')).status, 403);
  const list = await (await request('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  assert.deepEqual(list.result.tools.map(t => t.name), ['action']);
  assert.equal((await request('/v1/chat/completions', { model: 'selected', tools: [{ function: { name: 'bash' } }] })).status, 500);
  assert.equal(modelCalled, false);
 } finally { await bridge.close(); }
 console.log('PASS authenticated gateway and refused native tool exposure');
 let dispatched = 0;
 const tickets = new OpenCodeBridge({ initial: [], ask: async () => JSON.stringify(tool()),
  execute: async () => { dispatched++; return 'bounded evidence'; }, progress: () => {}, cancelled: () => false });
 await tickets.listen(); tickets.bind(() => {});
 try {
  const post = (route, body) => fetch(tickets.url + route, { method:'POST', headers:{ Authorization:'Bearer '+tickets.secret, 'content-type':'application/json' }, body:JSON.stringify(body) });
  const ask = tickets.ask([], false, 60);
  const model = await (await post('/v1/chat/completions', { model:'selected', tools:[{function:{name:'editor_action'}}] })).json();
  const args = JSON.parse(model.choices[0].message.tool_calls[0].function.arguments);
  const envelope = {jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'action',arguments:args}};
  const receipt = post('/mcp', envelope);
  assert.equal(JSON.parse(await ask).name, 'read_file');
  await assert.rejects(tickets.dispatch([{...tool(),arguments:{path:'outside.js'}}]), /did not match/);
  assert.equal(dispatched, 0);
  assert.deepEqual(await tickets.dispatch([tool()]), ['bounded evidence']);
  const result = await (await receipt).json();
  assert.equal(JSON.parse(result.result.content[0].text).completed, 1);
  assert.equal((await post('/mcp', envelope)).status, 500, 'Receipt cannot be replayed');
  assert.equal(dispatched, 1);
 } finally { await tickets.close(); }
 console.log('PASS exact action receipts and one-use enforcement');
 const after = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith(ownedPrefix) && !before.has(name));
 assert.deepEqual(after, [], 'Owned OpenCode state must be removed on success, failure and cancellation');
 console.log(JSON.stringify({ ok: true, runtime: '1.19.3', cases: 9, ownedStateCleaned: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
