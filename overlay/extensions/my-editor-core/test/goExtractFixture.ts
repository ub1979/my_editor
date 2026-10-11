import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { goInstallDirs } from '../src/aiready/goAdapter';
import { buildGoTool } from '../src/aiready/goBuildTool';
import { probeExtract } from '../src/aiready/goExtract';
import { findTool } from '../src/aiready/projectCommands';

/** The Go helper's folder in the source tree. */
export const EXTRACT_DIR = path.resolve(__dirname, '../../resources/goextract');

let helper: Promise<string | undefined> | undefined;

/** Test helper: `resources/goextract` built once, or undefined when Go is not installed. */
export function extractHelper(): Promise<string | undefined> {
	const go = findTool('go', goInstallDirs());
	helper ??= go
		? buildGoTool(EXTRACT_DIR, 'goextract', path.join(os.tmpdir(), 'my-editor-goextract-cache'), 'test', go, probeExtract)
		: Promise.resolve(undefined);
	return helper;
}

/** A temp module folder (`module example.com/m`, `go 1.22`) with these files, by relative path. */
export function goModule(files: Record<string, string>): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'my-editor-gomod-'));
	writeFileSync(path.join(dir, 'go.mod'), 'module example.com/m\n\ngo 1.22\n');
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
		writeFileSync(path.join(dir, name), text);
	}
	return dir;
}
