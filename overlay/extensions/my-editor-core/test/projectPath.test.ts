import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { checkedProjectPath } from '../src/chat/projectPath';

test('new nested files are allowed but symlinks cannot lead a write outside the workspace', () => {
	const parent = mkdtempSync(path.join(os.tmpdir(), 'editor-path-'));
	const root = path.join(parent, 'root'); mkdirSync(root);
	try {
		assert.equal(checkedProjectPath(root, 'new/nested/a.py', true), path.join(root, 'new/nested/a.py'));
		assert.throws(() => checkedProjectPath(root, '../outside.py', true), /outside/);
		symlinkSync(parent, path.join(root, 'escape'));
		assert.throws(() => checkedProjectPath(root, 'escape/new.py', true), /outside/);
		symlinkSync(path.join(parent, 'missing.py'), path.join(root, 'dangling.py'));
		assert.throws(() => checkedProjectPath(root, 'dangling.py', true), /dangling/);
	} finally { rmSync(parent, { recursive: true, force: true }); }
});
