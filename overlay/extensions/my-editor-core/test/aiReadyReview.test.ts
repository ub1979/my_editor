import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { excerpt, parseReview, reviewParts, ReviewPart } from '../src/aiready/healthReview';

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
