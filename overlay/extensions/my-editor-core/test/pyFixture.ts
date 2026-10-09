import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findTool } from '../src/aiready/projectCommands';
import { probePython, PyInterpreter } from '../src/aiready/pyInterpreter';

/** The shipped helper folder, from `out-test/test`. */
export const HELPER = path.resolve(__dirname, '../../resources/pyast');

let probed: PyInterpreter | null | undefined;

/** The machine's python3, probed once; undefined when there is none (the Python tests then skip themselves). */
export function python(): PyInterpreter | undefined {
	if (probed === undefined) {
		const file = findTool('python3');
		const found = file ? probePython(file) : undefined;
		probed = typeof found === 'object' ? found : null;
	}
	return probed ?? undefined;
}

/** For `test(name, { skip: noPython() }, …)`. */
export function noPython(): string | false {
	return python() ? false : 'python3 is not installed';
}

/** A temporary project folder with these files; with `git`, a repository with one commit. */
export function pyProjectFiles(files: Record<string, string>, git = false): { root: string; tracked: string[] } {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-py-project-'));
	for (const [file, text] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		writeFileSync(path.join(root, file), text);
	}
	if (git) {
		const run = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
		run('init', '--quiet');
		run('config', 'user.email', 'test@example.com');
		run('config', 'user.name', 'Test');
		run('add', '.');
		run('commit', '--quiet', '-m', 'first');
	}
	return { root, tracked: Object.keys(files).sort() };
}

/** A fake interpreter: a script that prints the probe's JSON for this version and implementation. */
export function fakePython(dir: string, version: [number, number, number], implementation = 'cpython'): string {
	const file = path.join(dir, 'python');
	mkdirSync(dir, { recursive: true });
	const tools = { pytest: false, randomly: false, mypy: false, black: false, pytestDjango: false };
	const probe = { version, implementation, prefix: dir, venv: false, stdlib: ['json', 'os'], installed: [], tools };
	writeFileSync(file, `#!/bin/sh\necho '${JSON.stringify(probe)}'\n`, { mode: 0o755 });
	return file;
}
