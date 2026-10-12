import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

/** Lines over 160 characters in the folder's files that `pick` keeps, as `name:line`. */
function longLines(dir: string, pick: (name: string) => boolean): string[] {
	return readdirSync(dir).filter(pick).flatMap(name => readFileSync(path.join(dir, name), 'utf8')
		.split('\n').map((line, index) => ({ at: `${name}:${index + 1}`, length: [...line].length })).filter(line => line.length > 160))
		.map(line => line.at);
}

test('no fixer source line is longer than 160 characters', () => {
	assert.deepEqual(longLines(path.join(__dirname, '../../src/aiready'), name => name.endsWith('.ts')), []);
});

test('no fixer test line is longer than 160 characters', () => {
	assert.deepEqual(longLines(path.join(__dirname, '../../test'), name => name.startsWith('aiReady') && name.endsWith('.ts')), []);
});
