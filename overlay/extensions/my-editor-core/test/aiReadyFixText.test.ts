import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { pickFixes } from '../src/aiready/fixPicker';
import { alreadyFailingText, approvalDetail, closingText, timeoutMinutes } from '../src/aiready/fixText';

test('the approval modal says the commands run project code and tests written by the AI model', () => {
	const detail = approvalDetail('/p/shop.ai-ready', ['go build ./...', 'go test -count=1 -json ./a'], 'Go');
	assert.match(detail, /\/p\/shop\.ai-ready/);
	assert.match(detail, /go build \.\/\.\.\.\ngo test -count=1 -json \.\/a/);
	assert.match(detail, /runs project code and tests written by the AI model/);
	assert.doesNotMatch(detail, /not touched/);
});

test('the closing message claims only that the health report was updated in the user folder', () => {
	const text = closingText({ committed: 2, branch: 'my_editor/ai-ready', base: 'abcdef1234567890', note: '.my_editor/changes/x.md', removed: true, worktree: '/p/w', reportUpdated: true });
	assert.doesNotMatch(text, /not touched|wasn.t touched/);
	assert.match(text, /2 fixes committed on `my_editor\/ai-ready`/);
	assert.match(text, /only the health report in `\.my_editor\/ai-ready\/` was updated/);
	assert.match(text, /git diff abcdef123456\.\.my_editor\/ai-ready/);
	const kept = closingText({ committed: 1, branch: 'b', base: 'c', note: 'n', removed: false, worktree: '/p/w', reportUpdated: false });
	assert.doesNotMatch(kept, /health report/);
	assert.match(kept, /Remove the working copy `\/p\/w`/);
});

test('the command timeout is clamped to 1–240 minutes and is a machine setting', () => {
	assert.equal(timeoutMinutes(undefined), 10);
	assert.equal(timeoutMinutes('5'), 10);
	assert.equal(timeoutMinutes(Number.NaN), 10);
	assert.equal(timeoutMinutes(0), 1);
	assert.equal(timeoutMinutes(30), 30);
	assert.equal(timeoutMinutes(10_000), 240);
	const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as { contributes: { configuration: { properties: Record<string, Record<string, unknown>> } } };
	const setting = pkg.contributes.configuration.properties['myEditor.aiReady.commandTimeoutMinutes'];
	assert.equal(setting.scope, 'machine');
	assert.equal(setting.minimum, 1);
	assert.equal(setting.maximum, 240);
});

test('the approval modal is plain text without backticks', () => {
	assert.doesNotMatch(approvalDetail('/p/w', ['go build ./...'], 'Go'), /`/);
});

test('the closing message names discarded fixes', () => {
	const text = closingText({ committed: 1, discarded: 3, branch: 'b', base: 'c', note: 'n', removed: true, worktree: '/p/w', reportUpdated: false });
	assert.match(text, /3 fixes discarded/);
	assert.doesNotMatch(closingText({ committed: 1, branch: 'b', base: 'c', note: 'n', removed: true, worktree: '/p/w', reportUpdated: false }), /discarded/);
});

test('already-failing checks are one short line and a bullet list', () => {
	assert.equal(alreadyFailingText(['go build ./...', 'go vet ./a']), 'Some checks already fail before any change:\n\n- `go build ./...`\n- `go vet ./a`\n');
	assert.equal(alreadyFailingText([]), '');
});

test('the approval modal says when more fixes are chosen than one run does', () => {
	assert.match(approvalDetail('/p/w', ['go build ./...'], 'Go', 40), /^40 fixes chosen: 25 now; Continue does the rest\./);
	assert.doesNotMatch(approvalDetail('/p/w', ['go build ./...'], 'Go', 25), /Continue does the rest/);
});

test('a types-only split row says so', async () => {
	let rows: string[] = [];
	await pickFixes([{ file: 'a.ts', kind: 'split', lines: 500, narrowed: 'only types may move (Vite compiles each file with esbuild)' }, { file: 'b.ts', kind: 'split', lines: 450 }],
		async items => { rows = items.map(item => item.description); return undefined; });
	assert.equal(rows[0], '500 lines · split: only types may move (Vite compiles each file with esbuild)');
	assert.equal(rows[1], '450 lines · split into focused files');
});
