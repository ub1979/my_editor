import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { goTestNames, goTestProblems, parseGoTest } from '../src/aiready/goTests';
import { goInfo } from './goFixture';

const json = (events: object[]) => events.map(event => JSON.stringify(event)).join('\n');

test('parseGoTest keeps per-test and per-package outcomes and ignores other actions', () => {
	const parsed = parseGoTest([json([
		{ Action: 'start', Package: 'm/a' }, { Action: 'run', Package: 'm/a', Test: 'TestX' },
		{ Action: 'output', Package: 'm/a', Test: 'TestX', Output: 'ok\n' }, { Action: 'pass', Package: 'm/a', Test: 'TestX' },
		{ Action: 'fail', Package: 'm/a', Test: 'TestY/sub' }, { Action: 'skip', Package: 'm/a', Test: 'TestZ' },
		{ Action: 'build-fail', Package: 'm/b' }, { Action: 'fail', Package: 'm/a' },
	]), 'not json', '{broken'].join('\n'));
	assert.deepEqual(parsed, { tests: { 'm/a TestX': 'pass', 'm/a TestY/sub': 'fail', 'm/a TestZ': 'skip' }, packages: { 'm/a': 'fail' } });
});

test('generated Go tests must stay in the package and off the network', async t => {
	const source = await goInfo('shop/a.go', 'package shop\n\nfunc A() int { return 1 }\n');
	if (!source) { t.skip('Go is not installed'); return; }
	const good = 'package shop\n\nimport "testing"\n\nfunc TestAiA(t *testing.T) { if A() != 1 { t.Fatal() } }\n\nfunc helper() {}\n';
	const goodInfo = (await goInfo('shop/a_ai_test.go', good))!;
	assert.deepEqual(goTestNames(goodInfo.info), ['TestAiA']);
	assert.deepEqual(goTestProblems(good, goodInfo.info, source.info), []);
	const bad = 'package shop_test\n\nimport (\n\t"net/http"\n\t"os/exec"\n\t"testing"\n)\n\nfunc TestMain(m *testing.M) {}\n\n'
		+ 'func TestAiGet(t *testing.T) { http.Get("https://api.example.io/x"); exec.Command("ls") }\n';
	const badInfo = (await goInfo('shop/b_ai_test.go', bad))!;
	const problems = goTestProblems(bad, badInfo.info, source.info).join('; ');
	for (const pattern of [/package shop, not shop_test/, /TestMain/, /os\/exec/, /net\/http without/, /remote URL/]) { assert.match(problems, pattern); }
	assert.doesNotMatch(goTestProblems('x := "http://localhost:8080/" // http://example.com', goodInfo.info, source.info).join(), /remote URL/);
});

const fix = (file: string, kind: 'split' | 'tests', lines: number) => ({ file, kind, lines });
