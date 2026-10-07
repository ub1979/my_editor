import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileStats } from '../src/aiready/health';
import { excerpt, parseReview, reviewParts, ReviewPart } from '../src/aiready/healthReview';
import { renderReport } from '../src/aiready/report';

const numbered = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');
const LIMITS = { maxCalls: 40, fileChars: 6_000, callChars: 40_000 };

test('excerpt shows the flagged lines first, then the top, numbered and within budget', () => {
	const cut = excerpt(numbered(300), [200], 1_000);
	assert.equal(cut.ranges[0][0], 1);
	assert.ok(cut.ranges.some(([from, to]) => from <= 200 && to >= 200));
	assert.ok(cut.text.length <= 1_010);
	assert.match(cut.text, /^1: line 1$/m);
	assert.match(cut.text, /^200: line 200$/m);
	assert.match(cut.text, /\n…\n/);
	assert.deepEqual(excerpt('a\nb', [], 1_000), { text: '1: a\n2: b', ranges: [[1, 2]] });
});

test('parseReview keeps only findings at lines the model was shown', () => {
	const shown = new Map([['src/a.ts', [[1, 20], [100, 120]] as [number, number][]]]);
	const reply = 'Here you go:\n[{"file":"src/a.ts","line":105,"kind":"bug","text":"Off by one."},'
		+ '{"file":"src/a.ts","line":50,"kind":"bug","text":"Not shown."},'
		+ '{"file":"src/b.ts","line":2,"kind":"design","text":"Unknown file."},'
		+ '{"file":"src/a.ts","line":3,"kind":"style","text":"Unknown kind."},'
		+ '{"file":"src/a.ts","line":4,"kind":"mixed-job","text":"Two jobs.","grouping":"io: read, write; math: sum"}]';
	assert.deepEqual(parseReview(reply, shown), [
		{ kind: 'bug', file: 'src/a.ts', line: 105, text: 'Off by one.' },
		{ kind: 'mixed-job', file: 'src/a.ts', line: 4, text: 'Two jobs.', grouping: 'io: read, write; math: sum' },
	]);
	assert.equal(parseReview('no json here', shown), undefined);
	assert.deepEqual(parseReview('[]', shown), []);
});

const part = (name: string, priority: number): ReviewPart =>
	({ name, priority, files: [{ path: `${name}/a.ts`, text: numbered(30), focusLines: [] }] });

test('reviewParts reviews high-priority parts first, retries once, and stops at the call limit', async () => {
	const asked: string[] = [];
	const replies = ['not json', '[{"file":"hot/a.ts","line":2,"kind":"design","text":"Split it."}]', '[]'];
	const result = await reviewParts([part('cold', 1), part('hot', 9), part('warm', 5)],
		async (_system, text) => { asked.push(text.split('\n')[0]); return replies.shift() ?? '[]'; },
		{ ...LIMITS, maxCalls: 3 }, () => false);
	assert.deepEqual(asked, ['Part: hot', 'Part: hot', 'Part: warm']);
	assert.deepEqual(result.reviewed, ['hot', 'warm']);
	assert.deepEqual(result.notReviewed, ['cold']);
	assert.equal(result.findings.length, 1);
	assert.equal(result.partial, false);
});

test('reviewParts treats a failed model call like an unreadable reply', async () => {
	const result = await reviewParts([part('a', 1)], async () => { throw new Error('timeout'); }, LIMITS, () => false);
	assert.deepEqual(result.notReviewed, ['a']);
});

test('reviewParts marks the result partial when stopped', async () => {
	const result = await reviewParts([part('a', 1)], async () => '[]', LIMITS, () => true);
	assert.deepEqual(result.notReviewed, ['a']);
	assert.equal(result.partial, true);
});

test('renderReport lists files, suggestions, unreviewed parts and the next step', () => {
	const report = renderReport({
		project: 'shop', date: '2026-10-07', model: 'Claude Sonnet',
		stats: [fileStats('src/big.ts', 'x\n'.repeat(450))],
		findings: [
			{ kind: 'too-long', file: 'src/big.ts', text: '450 lines; the limit is 400.' },
			{ kind: 'mixed-job', file: 'src/big.ts', line: 12, text: 'Parses and renders.', grouping: 'parse: a, b; render: c' },
			{ kind: 'bug', file: 'src/big.ts', line: 40, text: 'Total ignores discounts.' },
			{ kind: 'no-test-runner', text: 'No test command was found, so changes cannot be checked by tests yet.' },
		],
		commands: { languages: ['JavaScript/TypeScript'], checks: [], tests: [] },
		review: { reviewed: ['src'], notReviewed: ['lib'], partial: true },
	});
	assert.match(report, /^# AI-ready health report: shop/);
	assert.match(report, /stopped early/);
	assert.match(report, /\| Over 400 lines \| 1 \|/);
	assert.match(report, /### \[src\/big\.ts\]\(\.\.\/\.\.\/src\/big\.ts\)/);
	assert.match(report, /\[src\/big\.ts:12\]\(\.\.\/\.\.\/src\/big\.ts#L12\)/);
	assert.match(report, /Grouping: parse: a, b; render: c/);
	assert.match(report, /Possible bug\*\* \[src\/big\.ts:40\]/);
	assert.match(report, /## Not reviewed by the model\n\nlib\. They hit/);
	assert.match(report, /No test command was found/);
	assert.doesNotMatch(report, /\n\n\n/);
});

test('excerpt cuts very long lines and keeps the lines around them', () => {
	const cut = excerpt('a\nb\n' + 'x'.repeat(10_000) + '\nc', [3], 500);
	assert.match(cut.text, /^3: x{300}…$/m);
	for (const n of [1, 2, 4]) { assert.match(cut.text, new RegExp(`^${n}: `, 'm'), String(n)); }
	assert.ok(cut.text.length <= 510);
});

test('parseReview finds the array among prose, brackets and code fences', () => {
	const shown = new Map([['src/a.ts', [[1, 200]] as [number, number][]]]);
	const item = '[{"file":"src/a.ts","line":105,"kind":"bug","text":"x"}]';
	for (const reply of [`See [1] below:\n${item}`, `${item} (see [note])`, '```json\n' + item + '\n```']) {
		assert.equal(parseReview(reply, shown)?.length, 1, reply);
	}
});

test('reviewParts gives up after three failed calls in a row and reports why', async () => {
	let calls = 0;
	const result = await reviewParts(['a', 'b', 'c', 'd', 'e'].map(name => part(name, 1)),
		async () => { calls++; throw new Error('offline'); }, LIMITS, () => false);
	assert.equal(calls, 3);
	assert.equal(result.error, 'offline');
	assert.equal(result.notReviewed.length, 5);
});

test('renderReport neutralises model text and encodes links', () => {
	const base = { project: 'p', date: 'd', model: 'm', stats: [], commands: { languages: [], checks: [], tests: [] },
		review: { reviewed: [], notReviewed: ['lib'], partial: false } };
	const report = renderReport({ ...base, findings: [
		{ kind: 'design', file: 'src/my file#2.ts', line: 3, text: 'x\n## Summary\n![p](https://evil.example/a) <img src=y>' }] });
	assert.doesNotMatch(report, /^## Summary$\n(?=[\s\S]*^## Summary$)/m);
	assert.equal(report.split('\n').filter(l => l.startsWith('## Summary')).length, 1);
	assert.doesNotMatch(report, /(^|[^\\])!\[/);
	assert.doesNotMatch(report, /(^|[^\\])<img/);
	assert.ok(report.includes('../../src/my%20file%232.ts'));
	const failed = renderReport({ ...base, findings: [], review: { ...base.review, error: 'offline' } });
	assert.match(failed, /The model could not be reached: offline/);
	assert.match(failed, /call limit/);
});
