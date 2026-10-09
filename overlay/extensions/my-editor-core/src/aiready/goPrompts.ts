import * as path from 'path';
import { redact } from '../records/redact';
import type { GoFileInfo } from './goRules';
import type { Prompt } from './language';

const MAX_SOURCE_CHARS = 60_000;

const SPLIT_SYSTEM = `You plan how to split one long Go file into focused files in the same package and folder.
The host moves whole declarations byte for byte and rebuilds imports; you only choose groups.
Rules:
- Refer to declarations only by their numeric "id". Never move one marked "movable": false.
- Every new file and the original must end up at 400 lines or fewer. Leave declarations that belong to the original's main job in it.
- Group by responsibility: a type with its methods and constructors, a query with its row scanning helpers, and so on.
- New file names: lower-case letters, digits and underscores, ending in .go, starting with the original's base name and an underscore (for example store_query.go). Never end a name in _test.go or in a GOOS or GOARCH name such as _linux.go or _amd64.go.
Reply with only a JSON array, for example: [{"file":"placements_query.go","declarations":[3,7]}]`;

const TEST_SYSTEM = `You write a Go test file that pins how one file behaves today, so later refactors can be checked.
Rules:
- Same package as the file under test (an internal test). Use only the standard library and packages that file already imports.
- Test what the code does now, even if it looks wrong. Prefer pure functions and simple types; skip anything that needs a database, the network, other programs, environment variables or real time.
- No network, no os/exec, no files outside t.TempDir(), no TestMain, no init, no global state changes that leak between tests.
- Name tests TestAi<Something> so they do not collide with existing tests.
Reply with the whole test file in one \`\`\`go code block and nothing else.`;

/** The model's input for a Go split plan: the file's declarations by ID, with unmovable ones marked. */
export function goSplitPrompt(info: GoFileInfo, totalLines: number): Prompt {
	const declarations = info.declarations.map(d => ({
		id: d.id, kind: d.kind, names: d.names, ...(d.receiver ? { receiver: d.receiver } : {}), lines: d.lines,
		...(d.doc ? { firstDocLine: d.doc } : {}), imports: d.uses,
		...(d.movable ? {} : { movable: false, reason: d.reason }),
	}));
	return {
		system: SPLIT_SYSTEM,
		text: `File: ${info.path} (package ${info.go.package}, ${totalLines} lines)\n`
			+ `Declarations:\n${declarations.map(d => JSON.stringify(d)).join('\n')}\n\n`
			+ `Plan new files so ${path.posix.basename(info.path)} and every new file are at most 400 lines.`,
	};
}

/** The model's input for an add-tests fix. */
export function goTestPrompt(file: string, source: string, info: GoFileInfo, testFile: string): Prompt {
	return {
		system: TEST_SYSTEM,
		text: `Write ${testFile} for ${file} (package ${info.go.package}).\n\n=== ${file} ===\n${redact(source).slice(0, MAX_SOURCE_CHARS)}`,
	};
}
