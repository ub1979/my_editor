import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import * as path from 'path';

/** Writes `value` as JSON to `dir/name` through a temp file renamed over it, so a crash leaves the old or the new record. */
export function saveJson(dir: string, name: string, value: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, `${name}.tmp`), JSON.stringify(value));
	renameSync(path.join(dir, `${name}.tmp`), path.join(dir, name));
}

/** The record in `dir/name` when `valid` accepts it; undefined when it is missing, unreadable or of another shape. */
export function loadJson<T>(dir: string, name: string, valid: (value: unknown) => value is T): T | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
		return valid(value) ? value : undefined;
	} catch {
		return undefined;
	}
}
