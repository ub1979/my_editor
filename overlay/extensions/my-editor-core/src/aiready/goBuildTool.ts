import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'fs';
import * as path from 'path';
import { GO_ENV, GO_READ_ENV } from './goAst';
import { runTool } from './projectCommands';

/** The files a Go helper is built from: its non-test `.go` files and `go.mod`, sorted. */
function sources(dir: string): string[] {
	return readdirSync(dir).filter(name => name === 'go.mod' || (name.endsWith('.go') && !name.endsWith('_test.go'))).sort();
}

/** Builds that failed in this session, by their folder (version, sources and `go version`): the Project card asks often. */
const failed = new Map<string, Error>();

/**
 * Builds the Go program in `dir` once per extension version, sources and `go version`, in an empty folder, for this
 * machine, with no cgo and no network. `probe` runs the new binary before it is kept. Returns the binary's path. A
 * failure removes the folder and is rethrown, without building again, for the rest of the session.
 */
export async function buildGoTool(dir: string, name: string, storageDir: string, version: string, go: string,
	probe: (binary: string) => Promise<boolean>): Promise<string> {
	mkdirSync(storageDir, { recursive: true });
	const goVersion = await runTool(go, ['version'], storageDir, GO_ENV);
	if (goVersion.code !== 0) { throw new Error(`\`go version\` failed: ${goVersion.stderr.trim().slice(0, 300)}`); }
	const files = sources(dir);
	const hash = createHash('sha1');
	for (const file of files) { hash.update(`${file}\0`).update(readFileSync(path.join(dir, file))).update('\0'); }
	const folder = path.join(storageDir, name, `${version}-${hash.update(goVersion.stdout.trim()).digest('hex').slice(0, 8)}`);
	const binary = path.join(folder, name);
	if (existsSync(binary)) { return binary; }
	const known = failed.get(folder);
	if (known) { throw known; }
	mkdirSync(folder, { recursive: true });
	const work = mkdtempSync(path.join(folder, 'build-'));
	try {
		for (const file of files) { copyFileSync(path.join(dir, file), path.join(work, file)); }
		const built = await runTool(go, ['build', '-o', path.join(work, name), '.'], work,
			{ ...GO_READ_ENV, GOOS: '', GOARCH: '', GOENV: 'off', GOWORK: 'off', CGO_ENABLED: '0' });
		if (built.code !== 0) { throw new Error(`Could not build the Go helper \`${name}\`: ${built.stderr.trim().slice(0, 500)}`); }
		if (!await probe(path.join(work, name)).catch(() => false)) { throw new Error(`The Go helper \`${name}\` was built but does not run.`); }
		renameSync(path.join(work, name), binary);
	} catch (error) {
		const failure = error instanceof Error ? error : new Error(String(error));
		failed.set(folder, failure);
		rmSync(folder, { recursive: true, force: true });
		throw failure;
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
	return binary;
}
