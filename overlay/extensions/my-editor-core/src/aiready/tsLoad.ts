import { createRequire } from 'module';
import * as path from 'path';
import type * as TS from 'typescript';

/** The TypeScript compiler module; only its types are imported, the code is loaded at run time. */
export type Ts = typeof TS;

const NEEDS = 'TypeScript splitting needs the editor\'s TypeScript 5 or 6.';
const loaded = new Map<string, Ts | string>();

/** Where the editor ships its TypeScript: `<appRoot>/extensions/node_modules/typescript`. */
export function bundledTypeScript(appRoot: string): string {
	return path.join(appRoot, 'extensions', 'node_modules', 'typescript');
}

/**
 * Loads TypeScript from a folder once, with a run-time `require` so esbuild leaves it out of the bundle. A plain
 * message when it is missing or not major 5 or 6 (TS 7, the native compiler, has a different API).
 */
export function loadTypeScript(dir: string): Ts | string {
	const cached = loaded.get(dir);
	if (cached) { return cached; }
	let result: Ts | string;
	try {
		const ts = createRequire(__filename)(dir) as Ts;
		const major = Number(String(ts.version ?? '').split('.')[0]);
		result = (major === 5 || major === 6) && typeof ts.createProgram === 'function' ? ts : `${NEEDS} Found ${ts.version ?? 'an unknown version'}.`;
	} catch {
		result = `${NEEDS} It was not found in ${dir}.`;
	}
	loaded.set(dir, result);
	return result;
}
