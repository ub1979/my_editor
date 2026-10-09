import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

test('no fixer source line is longer than 160 characters', () => {
	const dir = path.join(__dirname, '../../src/aiready');
	const long = readdirSync(dir).filter(name => name.endsWith('.ts')).flatMap(name => readFileSync(path.join(dir, name), 'utf8')
		.split('\n').map((line, index) => ({ at: `${name}:${index + 1}`, length: [...line].length })).filter(line => line.length > 160));
	assert.deepEqual(long.map(line => line.at), []);
});
