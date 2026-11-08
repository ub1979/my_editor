/* Run one host-approved test command, retaining bounded diagnostics for the QA agent. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [logFile, timeout, bin, ...args] = process.argv.slice(2);
const LIMIT = 32000;
let head = '', tail = '', size = 0, stopped = false, finished = false;
let timer, force;
function retain(chunk) {
	const text = chunk.toString(); size += text.length;
	if (head.length < LIMIT) { head = (head + text).slice(0, LIMIT); }
	tail = (tail + text).slice(-LIMIT);
}
function finish(code) {
	if (finished) { return; } finished = true;
	clearTimeout(timer); clearTimeout(force);
	const output = size <= LIMIT ? head : size <= LIMIT * 2
		? head + tail.slice(-(size - LIMIT)) : head + '\n[Middle of test output omitted]\n' + tail;
	try {
		fs.mkdirSync(path.dirname(logFile), { recursive: true });
		fs.writeFileSync(logFile, output, { flag: 'wx', mode: 0o600 });
	} catch (error) { process.stderr.write(`Could not retain test diagnostics: ${error.message}\n`); }
	process.exitCode = stopped ? 124 : code ?? 1;
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(bin, args, { cwd: process.cwd(), env,
	detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
function signal(name) {
	try { process.platform === 'win32' ? child.kill(name) : process.kill(-child.pid, name); }
	catch { /* The process already exited. */ }
}
function stop(reason) {
	if (stopped || finished) { return; } stopped = true;
	retain(Buffer.from(`\n${reason}\n`)); process.stderr.write(`${reason}\n`);
	signal('SIGTERM'); force = setTimeout(() => { signal('SIGKILL'); finish(124); }, 5000);
}
for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
	stream.on('data', chunk => { retain(chunk); destination.write(chunk); });
}
child.on('error', error => { retain(Buffer.from(error.message)); process.stderr.write(`${error.message}\n`); finish(1); });
child.on('close', finish);
// Descendants can inherit pipes after their parent exits. Do not leave the test checkpoint hanging.
child.on('exit', code => setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(code); }, 1000).unref());
timer = setTimeout(() => stop('Test command timed out.'), Number(timeout));
process.on('SIGTERM', () => stop('Test command stopped.'));
process.on('SIGINT', () => stop('Test command stopped.'));
