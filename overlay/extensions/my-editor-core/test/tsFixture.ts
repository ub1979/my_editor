import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadTypeScript, Ts } from '../src/aiready/tsLoad';

/** The TypeScript the tests use: `MY_EDITOR_TS` (the editor's shipped copy) or the dev dependency. */
export const TS_DIR = process.env.MY_EDITOR_TS ?? path.dirname(require.resolve('typescript/package.json'));
const loaded = loadTypeScript(TS_DIR);
if (typeof loaded === 'string') { throw new Error(loaded); }
export const ts: Ts = loaded;

/** Writes the files into a new temp folder; `tracked` lists them, as `git ls-files` would. */
export function project(files: Record<string, string | undefined>): { root: string; tracked: string[] } {
	const root = mkdtempSync(path.join(os.tmpdir(), 'my-editor-ts-'));
	const tracked: string[] = [];
	for (const [file, text] of Object.entries(files)) {
		if (text === undefined) { continue; }
		tracked.push(file);
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		writeFileSync(path.join(root, file), text);
	}
	return { root, tracked: tracked.sort() };
}

/** An ES module package checked by `tsc` with `node --test`, locked by npm. */
export const ESM: Record<string, string> = {
	'package.json': '{"name":"shop","type":"module","scripts":{"test":"node --test"}}',
	'package-lock.json': '{}',
	'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', strict: true }, include: ['src'] }),
};
