import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { pyFileFacts } from '../src/aiready/pyAst';
import {
	interpreterProblem, probePython, pythonApprovalNote, pythonCandidates, pythonEnv, pythonFor, PyInterpreter, rememberPython,
} from '../src/aiready/pyInterpreter';
import { fakePython, HELPER, noPython, python } from './pyFixture';

const temp = () => mkdtempSync(path.join(os.tmpdir(), 'my-editor-python-'));

function venv(root: string, dir = '.venv'): string {
	mkdirSync(path.join(root, dir, 'bin'), { recursive: true });
	writeFileSync(path.join(root, dir, 'pyvenv.cfg'), 'home = /usr/bin\n');
	symlinkSync(python()!.path, path.join(root, dir, 'bin', 'python'));
	return path.join(root, dir, 'bin', 'python');
}

test('a .venv in the project is a candidate, and its symlinked python is not resolved', { skip: noPython() }, () => {
	const root = temp();
	const file = venv(root);
	assert.deepEqual(pythonCandidates(root), [file]);
	const probed = probePython(file);
	assert.ok(typeof probed === 'object');
	assert.equal(probed.path, file);
	assert.equal(interpreterProblem(probed), undefined);
});

test('a Poetry project asks `poetry env info --executable`, and two candidates both reach the chooser', { skip: noPython() }, async () => {
	const root = temp();
	const bin = temp();
	writeFileSync(path.join(root, 'pyproject.toml'), '[tool.poetry]\nname = "x"\n');
	const poetryPython = venv(bin, 'poetry-env');
	writeFileSync(path.join(bin, 'poetry'), `#!/bin/sh\n[ "$1 $2 $3" = "env info --executable" ] && echo ${poetryPython}\n`, { mode: 0o755 });
	const own = venv(root);
	const saved = process.env.PATH;
	process.env.PATH = `${bin}${path.delimiter}${saved}`;
	try {
		assert.deepEqual(pythonCandidates(root), [own, poetryPython]);
		const seen: (readonly string[])[] = [];
		const storage = temp();
		const chosen = await pythonFor(root, storage, async candidates => { seen.push(candidates); return candidates[1]; });
		assert.equal(typeof chosen === 'object' && chosen.path, poetryPython);
		assert.deepEqual(seen, [[own, poetryPython]]);
		const again = await pythonFor(root, storage, async () => assert.fail('the pick is remembered'));
		assert.equal(typeof again === 'object' && again.path, poetryPython);
	} finally {
		process.env.PATH = saved;
	}
});

test('the version gate: 3.15 and 3.8 stop, PyPy stops, a pyenv shim is rejected', async () => {
	const dir = temp();
	const check = (version: [number, number, number], implementation = 'cpython') => {
		const probed = probePython(fakePython(path.join(dir, `${version.join('-')}-${implementation}`), version, implementation)) as PyInterpreter;
		return interpreterProblem(probed);
	};
	assert.equal(check([3, 15, 0]), 'Python splitting needs Python 3.9 to 3.14 for now.');
	assert.match(check([3, 8, 18]) ?? '', /needs Python 3\.9 to 3\.14; .* is 3\.8\.18/);
	assert.match(check([3, 11, 0], 'pypy') ?? '', /needs CPython/);
	assert.equal(check([3, 14, 0]), undefined);
	const shim = fakePython(path.join(dir, '.pyenv', 'shims'), [3, 12, 0]);
	assert.match(interpreterProblem(probePython(shim) as PyInterpreter) ?? '', /version-manager shim/);
	assert.match(await pythonFor(temp(), temp(), async () => fakePython(path.join(dir, 'new'), [3, 15, 1])) as string, /3\.9 to 3\.14 for now/);
	assert.match(await pythonFor(temp(), temp(), async () => undefined) as string, /No Python interpreter was chosen/);
});

test('a .python-version names a concrete pyenv interpreter, never the shim, a path outside the versions or a script', { skip: noPython() }, () => {
	const root = temp();
	const home = temp();
	const outside = temp();
	const saved = process.env.HOME;
	process.env.HOME = home;
	try {
		const versions = path.join(home, '.pyenv', 'versions');
		mkdirSync(path.join(versions, '3.12.4', 'bin'), { recursive: true });
		const file = path.join(versions, '3.12.4', 'bin', 'python');
		symlinkSync(python()!.path, file);
		mkdirSync(path.join(outside, 'bin'));
		symlinkSync(python()!.path, path.join(outside, 'bin', 'python'));
		symlinkSync(outside, path.join(versions, 'linked'));
		fakePython(path.join(versions, '3.11.0', 'bin'), [3, 11, 0]);
		writeFileSync(path.join(root, '.python-version'), `3.12.4\n../../../${path.relative(home, outside)}\nlinked\n3.11.0\n`);
		assert.deepEqual(pythonCandidates(root), [file]);
	} finally {
		process.env.HOME = saved;
	}
});

test('review items 8 and 9: a script or a tracked venv is no candidate; a launcher or a tracked pick is refused', { skip: noPython() }, async () => {
	const root = temp();
	mkdirSync(path.join(root, '.venv'));
	writeFileSync(path.join(root, '.venv', 'pyvenv.cfg'), 'home = /usr/bin\n');
	fakePython(path.join(root, '.venv', 'bin'), [3, 12, 0]);
	assert.deepEqual(pythonCandidates(root), [], 'a #! script is a shim or a wrapper, not an interpreter');
	const repo = temp();
	const tracked = venv(repo);
	execFileSync('git', ['init', '-q'], { cwd: repo });
	execFileSync('git', ['add', '-f', '.venv'], { cwd: repo });
	assert.deepEqual(pythonCandidates(repo), []);
	assert.match(await pythonFor(repo, temp(), async () => tracked) as string, /\.venv is tracked by git/);
	const ran = path.join(repo, 'ran');
	writeFileSync(path.join(repo, 'tool.sh'), `#!/bin/sh\ntouch ${ran}\n`, { mode: 0o755 });
	execFileSync('git', ['add', 'tool.sh'], { cwd: repo });
	assert.match(await pythonFor(repo, temp(), async () => path.join(repo, 'tool.sh')) as string, /tracked by git/);
	assert.ok(!existsSync(ran), 'a tracked pick is refused before it runs');
	const launcher = fakePython(temp(), [3, 12, 0], 'cpython', '/somewhere/else/python3.12');
	assert.match(await pythonFor(temp(), temp(), async () => launcher) as string, /runs \/somewhere\/else\/python3\.12; choose that interpreter instead/);
});

test('a remembered interpreter that fails says how to choose another', async () => {
	const root = temp();
	const storage = temp();
	rememberPython(storage, root, fakePython(temp(), [3, 15, 0]));
	assert.match(await pythonFor(root, storage, async () => assert.fail('the pick is remembered')) as string,
		/3\.9 to 3\.14 for now\. Run \*\*AI-Ready: Choose Python Interpreter\*\* to pick another\./);
});

test('the command env puts the interpreter first, sets the venv and import roots, and keeps caches out of the worktree', () => {
	const probed: PyInterpreter = { path: '/p/my project/.venv/bin/python', version: [3, 12, 2], implementation: 'cpython', prefix: '/p/my project/.venv',
		venv: true, stdlib: [], installed: [], tools: { pytest: true, randomly: false, mypy: false, black: false, pytestDjango: false } };
	const env = pythonEnv(probed, ['/w', '/w/src'], '/store', '/w');
	assert.ok(env.PATH.startsWith(`/p/my project/.venv/bin${path.delimiter}`));
	assert.equal(env.VIRTUAL_ENV, '/p/my project/.venv');
	assert.equal(env.PYTHONPATH, ['/w', '/w/src'].join(path.delimiter));
	assert.deepEqual([env.PYTHONDONTWRITEBYTECODE, env.PYTHONHASHSEED, env.NO_COLOR, env.PY_COLORS], ['1', '0', '1', '0']);
	assert.ok(env.MYPY_CACHE_DIR.startsWith('/store/mypy-cache/'));
	const note = pythonApprovalNote(probed, '>=3.9', env);
	assert.match(note, /Python: \/p\/my project\/\.venv\/bin\/python \(3\.12\.2, sys\.prefix \/p\/my project\/\.venv\); the project asks for Python >=3\.9/);
	assert.doesNotMatch(note, /does not satisfy/);
	for (const spec of ['>=3.13', '>=3.10,<3.12', '==3.11.*', '~=3.12.3', '!=3.12.*']) {
		assert.match(pythonApprovalNote(probed, spec, env), new RegExp(`3\\.12\\.2 does not satisfy requires-python ${spec.replace(/[.*+]/g, '\\$&')}`), spec);
	}
	for (const spec of ['>3.11', '~=3.10', '==3.12.*', '>=3.9,<4', '<=3.12.2']) {
		assert.doesNotMatch(pythonApprovalNote(probed, spec, env), /does not satisfy/, spec);
	}
});

test('pyFileFacts runs the helper isolated and reports a parse error as facts', { skip: noPython() }, async () => {
	const dir = temp();
	writeFileSync(path.join(dir, 'ok.py'), 'import os\nX = 1\n');
	writeFileSync(path.join(dir, 'bad.py'), 'def (:\n');
	const ok = await pyFileFacts(python()!.path, HELPER, path.join(dir, 'ok.py'), dir);
	assert.deepEqual(ok.decls.map(d => d.names), [['X']]);
	assert.equal(ok.lead[0].kind, 'import');
	const bad = await pyFileFacts(python()!.path, HELPER, path.join(dir, 'bad.py'), dir);
	assert.match(bad.error ?? '', /^SyntaxError/);
	assert.deepEqual(bad.decls, []);
});
