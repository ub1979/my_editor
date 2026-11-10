import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Script } from 'node:vm';

test('every opt-in editor fixture parses before launching an editor process', () => {
	const directory = join(process.cwd(), 'test/integration');
	for (const file of readdirSync(directory).filter(name => name.endsWith('.cjs'))) {
		assert.doesNotThrow(() => new Script(readFileSync(join(directory, file), 'utf8'), { filename: file }));
	}
});
