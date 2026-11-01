import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { pythonSelectionCommand } from '../src/coding/pythonCode';

test('block results capture prints, stderr, expressions and exceptions without losing session state', t => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-output-test-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const helper = path.resolve(__dirname, '../../resources/python/session.py');
	const file = path.join(dir, 'events.jsonl');
	const program = `import sys; sys.path.insert(0, ${JSON.stringify(path.dirname(helper))})\n`
		+ `exec(compile(open(${JSON.stringify(helper)}).read(), ${JSON.stringify(helper)}, "exec"))\n`
		+ pythonSelectionCommand('answer = 40\nprint("printed")\nprint("warning", file=sys.stderr)\nanswer + 2', 'sample.py', 1) + '\n'
		+ pythonSelectionCommand('raise ValueError("bad value")', 'sample.py', 2) + '\n'
		+ pythonSelectionCommand('answer + 3', 'sample.py', 3) + '\n'
		+ pythonSelectionCommand('def broken(', 'sample.py', 4);
	const terminal = execFileSync('python3', ['-c', program], { env: { ...process.env, MY_EDITOR_PYTHON_RESULTS: file }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	const events = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
	const text = (id: number, channel: string) => events.filter(event => event.id === id && event.channel === channel).map(event => event.text).join('');
	assert.equal(text(1, 'stdout'), 'printed\n42\n');
	assert.equal(text(1, 'stderr'), 'warning\n');
	assert.match(text(2, 'stderr'), /ValueError: bad value/);
	assert.equal(text(3, 'stdout'), '43\n');
	assert.match(text(4, 'stderr'), /SyntaxError/);
	assert.deepEqual(events.filter(event => event.done).map(event => [event.id, event.failed]), [[1, false], [2, true], [3, false], [4, true]]);
	assert.deepEqual(events.filter(event => event.started).map(event => event.id), [1, 2, 3, 4]);
	assert.equal(terminal, 'printed\n42\n43\n');
});
