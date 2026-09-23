import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { elidesCode, fileFromReply } from '../src/pair/codeBlock';
import { isSensitiveFile } from '../src/records/sensitive';

test('isSensitiveFile blocks env files, keys and credential files', () => {
	for (const path of ['.env', 'app/.env.local', '.flaskenv', 'certs/server.pem', 'id_ed25519', '.npmrc', 'config/secrets.yaml', 'gcp/credentials.json']) {
		assert.ok(isSensitiveFile(path), path);
	}
	assert.ok(isSensitiveFile('settings/prod.cfg', 'dotenv'));
	for (const path of ['src/env.ts', 'src/keyboard.ts', 'docs/secrets-guide.md', 'README.md']) {
		assert.ok(!isSensitiveFile(path), path);
	}
});

test('fileFromReply takes the largest block, not a trailing example', () => {
	const reply = 'Done.\n```ts\nexport class Cart {\n\tclear() {}\n}\n```\nUse it like:\n```ts\ncart.clear();\n```';
	assert.equal(fileFromReply(reply), 'export class Cart {\n\tclear() {}\n}');
});

test('elidesCode catches placeholders that would delete code', () => {
	assert.ok(elidesCode('class A {\n\t// ... existing code ...\n\tclear() {}\n}'));
	assert.ok(elidesCode('def a():\n    pass\n# rest of the file unchanged\n'));
	assert.ok(elidesCode('a();\n// ...\nb();'));
	assert.ok(!elidesCode('// Existing carts are migrated on load.\nconst x = [1, 2, 3];\nconst y = x.map(v => v * 2);'));
	assert.ok(!elidesCode('const s = "...";\n// Total in cents, before tax.'));
});
