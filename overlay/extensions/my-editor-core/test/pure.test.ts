import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { lastCodeBlock } from '../src/pair/codeBlock';
import { collapseCode, redact } from '../src/records/redact';
import { parseSkill } from '../src/skills/frontmatter';

test('lastCodeBlock takes the last fenced block', () => {
	const reply = 'Added a guard.\n\n```ts\nconst a = 1;\n```\n\nThen:\n```ts\nconst b = 2;\nconst c = 3;\n```\n';
	assert.equal(lastCodeBlock(reply), 'const b = 2;\nconst c = 3;');
});

test('lastCodeBlock tolerates a missing closing fence', () => {
	assert.equal(lastCodeBlock('Here:\n```python\nprint("hi")\n'), 'print("hi")\n');
});

test('lastCodeBlock keeps blank lines and indentation', () => {
	assert.equal(lastCodeBlock('```\n\tif (x) {\n\n\t}\n```'), '\tif (x) {\n\n\t}');
});

test('lastCodeBlock returns undefined without a block', () => {
	assert.equal(lastCodeBlock('No code here.'), undefined);
});

test('redact removes API keys and keeps the label', () => {
	const out = redact('key sk-ant-api03-abcdefghijklmnopqrstuv and api_key = "hunter2hunter2" ok');
	assert.ok(!out.includes('abcdefghijklmnop'));
	assert.ok(!out.includes('hunter2hunter2'));
	assert.ok(out.includes('api_key = [REDACTED]'));
	assert.ok(out.endsWith(' ok'));
});

test('redact removes private keys', () => {
	const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----';
	assert.equal(redact(`x ${pem} y`), 'x [REDACTED] y');
});

test('collapseCode replaces code blocks with a line count', () => {
	assert.equal(collapseCode('Did it.\n\n```ts\na();\nb();\n```\nDone.'), 'Did it.\n\n_[code: 2 lines]_\nDone.');
});

test('parseSkill reads flat frontmatter and the body', () => {
	const skill = parseSkill('---\nname: debug\ndescription: "Find the cause"\nwrites: file\n---\n\nStep one.\n');
	assert.deepEqual(skill.meta, { name: 'debug', description: 'Find the cause', writes: 'file' });
	assert.equal(skill.body, 'Step one.');
});

test('parseSkill treats a file without frontmatter as all body', () => {
	assert.deepEqual(parseSkill('Just do it.'), { meta: {}, body: 'Just do it.' });
});
