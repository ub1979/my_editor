import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { loadJson, saveJson } from '../src/aiready/jsonStore';

const isCount = (value: unknown): value is { count: number } =>
	!!value && typeof value === 'object' && typeof (value as { count?: unknown }).count === 'number';

test('a record is written whole through a temp file, into a folder made on demand, and read back', () => {
	const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'json-store-')), 'a', 'b');
	assert.equal(loadJson(dir, 'x.json', isCount), undefined, 'missing');
	saveJson(dir, 'x.json', { count: 2 });
	assert.deepEqual(loadJson(dir, 'x.json', isCount), { count: 2 });
	assert.deepEqual(readdirSync(dir), ['x.json'], 'no temp file is left');
	saveJson(dir, 'x.json', { count: 3 });
	assert.deepEqual(loadJson(dir, 'x.json', isCount), { count: 3 });
	assert.equal(existsSync(path.join(dir, 'x.json.tmp')), false);
});

test('unreadable or unexpected content reads as unknown', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'json-store-'));
	writeFileSync(path.join(dir, 'bad.json'), '{ not json');
	assert.equal(loadJson(dir, 'bad.json', isCount), undefined);
	writeFileSync(path.join(dir, 'shape.json'), '{"count":"two"}');
	assert.equal(loadJson(dir, 'shape.json', isCount), undefined);
	writeFileSync(path.join(dir, 'null.json'), 'null');
	assert.equal(loadJson(dir, 'null.json', isCount), undefined);
});
