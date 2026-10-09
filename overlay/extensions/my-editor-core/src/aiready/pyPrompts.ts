import * as path from 'path';
import { redact } from '../records/redact';
import type { Prompt } from './language';
import type { PyFileInfo } from './pyRules';

const MAX_SOURCE_CHARS = 60_000;

const SPLIT_SYSTEM = `You plan how to split one long Python module into focused modules in the same package folder.
The host moves whole top-level definitions byte for byte, writes every import itself and leaves a re-export line in the original,
so no caller changes; you only choose groups.
Rules:
- Refer to declarations only by their numeric "id". Never move one marked "movable": false.
- "needs" lists the ids a declaration uses. Put a declaration in the same new module as every id it needs that would otherwise stay
  in the original; it may use an id that moves to another new module, but two new modules must not need each other.
- "readsWhenDefined" lists ids it reads while it is being defined (defaults, decorators, base classes, values): those must move to
  the same new module and come before it.
- Names starting with _ are private but may move; the original re-imports every moved name.
- Every new module and the original must end up at 400 lines or fewer. Leave the definitions that belong to the original's main job in it.
- New module names: lowercase letters, digits and underscores ending in .py; not the name of a file, folder or name already in the
  package, not a standard or installed module, not test_*, *_test, conftest, setup, models, views, urls, tasks or settings.
Reply with only a JSON array, for example: [{"file":"rows.py","declarations":[3,7]}]`;

const TEST_SYSTEM = `You write a Python test file that pins how one module behaves today, so later refactors can be checked.
Rules:
- Import only the module under test (by its dotted name), pytest or unittest and unittest.mock, and the standard library.
  No network, sockets, http, urllib, subprocess, multiprocessing or ctypes; no remote URLs.
- Test what the code does now, even if it looks wrong. Prefer pure functions and simple classes; skip anything that needs a database,
  the network, other programs, environment variables or real time.
- Write unittest.TestCase classes named TestAi<Something> (pytest runs them too) so they do not collide with existing tests.
  No files outside a temporary folder, no global state that leaks between tests.
Reply with the whole test file in one \`\`\`python code block and nothing else.`;

/** The model's input for a Python split plan: declarations by id with what they need, and the folder's names. */
export function pySplitPrompt(info: PyFileInfo, totalLines: number, folder: readonly string[]): Prompt {
	const owner = new Map<string, number>();
	for (const d of info.declarations) { d.names.forEach(name => { if (!owner.has(name)) { owner.set(name, d.id); } }); }
	const ids = (names: readonly string[], self: number) => [...new Set(names.flatMap(n => (owner.has(n) && owner.get(n) !== self ? [owner.get(n)!] : [])))];
	const declarations = info.declarations.map(d => {
		const needs = ids(d.py.reads, d.id);
		const early = ids([...d.py.sameFile, ...(info.context.deferred || info.facts.future ? [] : d.py.annSameFile), ...d.py.baseNames], d.id);
		return {
			id: d.id, kind: d.kind, names: d.names, lines: d.lines, ...(d.doc ? { firstDocLine: d.doc } : {}),
			...(needs.length ? { needs } : {}), ...(early.length ? { readsWhenDefined: early } : {}),
			...(d.movable ? {} : { movable: false, reason: d.reason }),
		};
	});
	return {
		system: SPLIT_SYSTEM,
		text: `Module: ${info.context.module} (${info.path}, ${totalLines} lines)\nFiles and folders already in its folder: ${folder.join(', ')}\n`
			+ `Declarations:\n${declarations.map(d => JSON.stringify(d)).join('\n')}\n\n`
			+ `Plan new modules so ${path.posix.basename(info.path)} and every new module are at most 400 lines.`,
	};
}

/** The model's input for an add-tests fix. */
export function pyTestPrompt(file: string, source: string, module: string, testFile: string, runner: string): Prompt {
	return {
		system: TEST_SYSTEM,
		text: `Write ${testFile} for ${file} (import it as ${module}); the project runs tests with ${runner}.\n\n`
			+ `=== ${file} ===\n${redact(source).slice(0, MAX_SOURCE_CHARS)}`,
	};
}
