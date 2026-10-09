import * as path from 'path';
import type { Prompt } from './language';
import type { TsFileInfo } from './tsRules';

const SPLIT_SYSTEM = `You plan how to split one long TypeScript or JavaScript file into focused files in the same folder.
The host moves whole top-level declarations byte for byte, writes every import itself and leaves re-exports in the original, so no caller changes; you only choose groups.
Rules:
- Refer to declarations only by their numeric "id". Never move one marked "movable": false.
- "needs" lists the ids a declaration uses as values, "typeNeeds" the ids it uses only as types. Put a declaration in the same new file as every non-exported id it needs, and as every id it reads when defined ("readsWhenDefined", which must also come first).
- A declaration may use an exported id that moves to another new file, but two new files must not use each other's values. It may not use an id that stays in the original, except an exported type through "typeNeeds".
- Code that stays may only use moved declarations that are exported.
- Every new file and the original must end up at 400 lines or fewer. Leave the declarations that belong to the original's main job in it.
- New file names: the original's extension; letters, digits, dots, dashes and underscores; not index, not a test, story or config name, and not the name (ignoring the extension) of a file or folder already in the folder. Follow the folder's naming style.
Reply with only a JSON array, for example: [{"file":"rows.ts","declarations":[3,7]}]`;

/** The model's input for a TS/JS split plan: declarations by ID with what they need, and the folder's file names. */
export function tsSplitPrompt(info: TsFileInfo, totalLines: number, folder: readonly string[]): Prompt {
	const owner = new Map<string, number>();
	for (const d of info.declarations.filter(d => d.ts.kind !== 'export list' && d.ts.kind !== 'statement')) { d.names.forEach(name => owner.set(name, d.id)); }
	const ids = (names: readonly string[], self: number) => [...new Set(names.flatMap(name => (owner.has(name) && owner.get(name) !== self ? [owner.get(name)!] : [])))];
	const declarations = info.declarations.map(d => {
		const needs = ids(d.ts.valueUses, d.id);
		const typeNeeds = ids(d.ts.typeUses, d.id).filter(id => !needs.includes(id));
		const reads = ids(d.ts.defReads, d.id);
		return {
			id: d.id, kind: d.kind, names: d.names, lines: d.lines, ...(d.doc ? { firstDocLine: d.doc } : {}),
			...(needs.length ? { needs } : {}), ...(typeNeeds.length ? { typeNeeds } : {}), ...(reads.length ? { readsWhenDefined: reads } : {}),
			...(d.movable ? {} : { movable: false, reason: d.reason }),
		};
	});
	return {
		system: SPLIT_SYSTEM,
		text: `File: ${info.path} (${totalLines} lines)\nFiles already in its folder: ${folder.join(', ')}\n`
			+ `Declarations:\n${declarations.map(d => JSON.stringify(d)).join('\n')}\n\n`
			+ `Plan new files so ${path.posix.basename(info.path)} and every new file are at most 400 lines.`,
	};
}

/** Adding tests for TS/JS is a later plan; the adapter offers splits only, so this prompt is never sent. */
export function tsTestPrompt(file: string): Prompt {
	return { system: 'Adding TypeScript and JavaScript tests is not available yet.', text: file };
}
