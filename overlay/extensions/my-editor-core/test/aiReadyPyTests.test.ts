import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { compareWithBaseline, unverified } from '../src/aiready/baseline';
import { parsePyTests, pyTestFileName, pyTestNames, pyTestProblems } from '../src/aiready/pyTests';
import { noPython, pyInfo } from './pyFixture';

const PYTEST = `F..sx.
=========================== short test summary info ============================
PASSED tests/test_x.py::test_pass
PASSED tests/test_x.py::test_param[1]
PASSED tests/test_x.py::test_param[b c]
PASSED tests/test_x.py::TestRows::test_parse
SKIPPED [1] tests/test_x.py:4: r
XFAIL tests/test_x.py::test_xfail
FAILED tests/test_x.py::test_fail - assert 0
ERROR tests/test_broken.py - ImportError: cannot import name 'x'
1 failed, 4 passed, 1 skipped, 1 xfailed, 1 error in 0.02s
`;

test('pytest -rA: keys are file and Class/test/[param], with parent keys like Go subtests and collection errors', () => {
	const run = parsePyTests(PYTEST)!;
	assert.deepEqual(run.tests, {
		'tests/test_x.py test_pass': 'pass', 'tests/test_x.py test_param': 'pass', 'tests/test_x.py test_param/[1]': 'pass',
		'tests/test_x.py test_param/[b c]': 'pass', 'tests/test_x.py TestRows': 'pass', 'tests/test_x.py TestRows/test_parse': 'pass',
		'tests/test_x.py test_xfail': 'skip', 'tests/test_x.py test_fail': 'fail', 'tests/test_broken.py (collection)': 'fail',
	});
	assert.deepEqual(run.packages, { 'tests/test_x.py': 'fail', 'tests/test_broken.py': 'fail' });
	assert.deepEqual(parsePyTests('no tests ran in 0.01s\n'), { tests: {}, packages: {} });
	assert.equal(parsePyTests('Traceback (most recent call last):\nboom\n'), undefined);
});

test('unittest -v: both the 3.11+ and the older form, with a docstring line between', () => {
	const now = 'test_a (pkg.tests.test_a.TestA.test_a)\nChecks a. ... ok\ntest_b (pkg.tests.test_a.TestA.test_b) ... FAIL\n'
		+ "test_c (pkg.tests.test_a.TestA.test_c) ... skipped 'r'\ntest_d (pkg.tests.test_a.TestA.test_d) ... expected failure\n\nRan 4 tests in 0.001s\n";
	const old = now.replace(/\.(test_[a-d])\)/g, ')');
	const expected = { 'pkg.tests.test_a TestA': 'fail', 'pkg.tests.test_a TestA/test_a': 'pass', 'pkg.tests.test_a TestA/test_b': 'fail',
		'pkg.tests.test_a TestA/test_c': 'skip', 'pkg.tests.test_a TestA/test_d': 'skip' };
	assert.deepEqual(parsePyTests(now)?.tests, expected);
	assert.deepEqual(parsePyTests(old)?.tests, expected);
});

test('parent keys let the core verify new test classes and parametrized tests by their top-level name', () => {
	const run = parsePyTests('PASSED tests/test_r_ai.py::TestAiRows::test_a\nPASSED tests/test_r_ai.py::test_ai_param[1]\n'
		+ 'FAILED tests/test_r_ai.py::TestAiBad::test_b - assert 0\n')!;
	assert.deepEqual(unverified(['TestAiRows', 'test_ai_param', 'TestAiBad'], run), ['TestAiBad']);
	const base = { command: 'pytest', code: 0, failures: [], tail: '', log: '', tests: { tests: {}, packages: {} } };
	const now = { ...base, code: 1, tests: run };
	assert.deepEqual(compareWithBaseline([base, base], now, ['TestAiRows', 'test_ai_param', 'TestAiBad']).newFailing.sort(),
		['tests/test_r_ai.py TestAiBad', 'tests/test_r_ai.py TestAiBad/test_b']);
});

test('test names, problems and the test file name', { skip: noPython() }, async () => {
	const text = 'import json\nimport unittest\nfrom pkg.report import parse\n\n\ndef test_ai_parse():\n    assert parse("1")\n\n\n'
		+ 'class TestAiRows(unittest.TestCase):\n    def test_a(self):\n        pass\n\n\ndef helper():\n    return 1\n';
	const info = await pyInfo('tests/test_report_ai.py', text);
	assert.deepEqual(pyTestNames(info), ['test_ai_parse', 'TestAiRows']);
	assert.deepEqual(pyTestProblems(text, info, 'pkg.report', ['json', 'unittest']), []);
	const bad = 'import socket\nimport requests\nfrom pkg import other\nimport asyncio\nURL = "https://api.example.net/x"\n'
		+ 'def test_x():\n    asyncio.create_subprocess_exec("ls")\n';
	assert.deepEqual(pyTestProblems(bad, await pyInfo('tests/test_report_ai.py', bad), 'pkg.report', ['asyncio', 'socket']), [
		'it imports socket', 'it imports requests, which is not in the standard library', 'it imports pkg.other; only pkg.report is under test',
		'it starts a subprocess', 'it names a remote URL']);
	assert.equal(pyTestFileName('pkg/report.py', ['tests/test_x.py'], '.'), 'tests/test_report_ai.py');
	assert.equal(pyTestFileName('src/pkg/report.py', ['tests/pkg/test_x.py'], 'src'), 'tests/pkg/test_report_ai.py');
	assert.equal(pyTestFileName('pkg/__init__.py', ['pkg/test_util.py'], '.'), 'pkg/test_pkg_ai.py');
});
