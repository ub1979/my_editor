import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assertEditSnapshot, sourceFingerprint } from '../src/pair/editSnapshot';

test('an edit uses only the source whose selection offsets and content the model read', () => {
	const original = 'const first = 1;\nconst selected = 2;\n';
	const fingerprint = sourceFingerprint(original);
	assert.doesNotThrow(() => assertEditSnapshot(fingerprint, original));
	assert.throws(() => assertEditSnapshot(fingerprint, '// inserted while waiting\n' + original), /file changed/);
	const long = 'x'.repeat(70_000);
	assert.throws(() => assertEditSnapshot(sourceFingerprint(long), long + 'edited beyond visible context'), /no proposal/);
});
