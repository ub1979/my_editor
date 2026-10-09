import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { configEntries, dependencyNames, PICKLING_LIBRARIES, pyToolConfig } from '../src/aiready/pyConfig';
import type { PyInterpreter } from '../src/aiready/pyInterpreter';
import { checkCommands, importRootProblem, moduleOf, modulePatches, projectSkip, pyProject, warningFilter } from '../src/aiready/pyProject';
import { HELPER, noPython, python, pyProjectFiles } from './pyFixture';

const FAKE: PyInterpreter = { path: '/env/bin/python3.12', version: [3, 12, 2], implementation: 'cpython', prefix: '/env', venv: true,
	stdlib: ['json', 'os', 're', 'sys'], installed: ['requests'], tools: { pytest: true, randomly: true, mypy: true, black: false, pytestDjango: false } };

function load(files: Record<string, string>, interpreter: PyInterpreter = FAKE) {
	const { root, tracked } = pyProjectFiles({ 'pkg/__init__.py': '', 'pkg/report.py': 'X = 1\n', ...files });
	return pyProject(root, interpreter, HELPER, mkdtempSync(path.join(os.tmpdir(), 'store-')), tracked);
}

const skipOf = (files: Record<string, string>, file = 'pkg/report.py', module = 'pkg.report') => projectSkip(load(files), file, module, 'pkg');

test('config: requires-python decides deferred annotations; line length, pytest settings and dependencies are read', () => {
	const config = pyToolConfig(new Map([
		['pyproject.toml', '[project]\nrequires-python = ">=3.14"\ndependencies = [\n  "Celery>=5",\n  "requests",\n]\n\n[tool.black]\nline-length = 100\n\n'
			+ '[tool.pytest.ini_options]\naddopts = "-p myplugin --strict-markers"\npython_files = ["check_*.py"]\npythonpath = ["lib"]\n'],
		['requirements-dev.txt', '# tools\ncloud_pickle==3\n-e .\n'],
	]));
	assert.deepEqual([config.deferredAnnotations, config.lineLength, config.formatter], [true, 100, 'black']);
	assert.deepEqual([config.pythonFiles, config.pythonPath, config.plugins], [['check_*.py'], ['lib'], ['myplugin']]);
	assert.deepEqual(config.dependencies, ['celery', 'requests', 'cloud-pickle']);
	assert.equal(pyToolConfig(new Map([['setup.cfg', '[options]\npython_requires = >=3.9\n']])).deferredAnnotations, false);
	assert.equal(pyToolConfig(new Map()).deferredAnnotations, false);
	assert.equal(pyToolConfig(new Map([['pyproject.toml', '[project]\nrequires-python = ">3.13"\n']])).deferredAnnotations, false, '3.13.1 is allowed');
	assert.deepEqual(configEntries('setup.cfg', '[options]\ninstall_requires =\n    dill\n    numpy\n').map(e => e.value), ['\n    dill\n    numpy']);
});

test('reviewer point 4: a declared dependency on a pickling library narrows the project to constants', () => {
	assert.ok(PICKLING_LIBRARIES.includes('cloudpickle') && PICKLING_LIBRARIES.includes('celery'));
	assert.deepEqual(dependencyNames(configEntries('setup.cfg', '[options]\ninstall_requires =\n    dill>=0.3\n    numpy\n'), []), ['dill', 'numpy']);
	assert.match(load({ 'pyproject.toml': '[project]\ndependencies = ["joblib"]\n' }).constantsOnly ?? '', /depends on joblib/);
	assert.match(load({ 'requirements.txt': 'Ray[default]==2\n' }).constantsOnly ?? '', /depends on ray/);
	assert.equal(load({ 'requirements.txt': 'requests\n' }).constantsOnly, undefined);
});

test('reviewer probe p5: multiprocessing, process pools, torch.save, PyYAML python tags and __module__ readers narrow to constants', () => {
	for (const [file, text] of [['run.py', 'import multiprocessing as mp\n'], ['jobs.py', 'from concurrent.futures import ProcessPoolExecutor\n'],
		['ml.py', 'import torch\ntorch.save(model, "m.pt")\n'], ['conf.yaml', 'x: !!python/object:pkg.report.Row {}\n'],
		['tasks2.py', 'from celery import Celery\n'], ['state.py', 'class C:\n    def __reduce__(self):\n        return (C, ())\n']]) {
		assert.match(load({ [file]: text }).constantsOnly ?? '', /may pickle by reference/, file);
	}
	assert.match(load({ 'reg.py': 'def owner(f):\n    return f.__module__\n' }).constantsOnly ?? '',
		/looks at where things are defined: reg\.py:2 reads __module__/);
});

test('review item 7: a pickler after another module on one import line, and vars() or __dict__ of a project module', () => {
	assert.match(load({ 'run.py': 'import os, pickle\n' }).constantsOnly ?? '', /run\.py:1 uses pickle/);
	assert.match(load({ 'run.py': 'import os as o, multiprocessing\n' }).constantsOnly ?? '', /uses multiprocessing/);
	assert.match(load({ 'reg.py': 'from pkg import report\nNAMES = list(vars(report))\n' }).constantsOnly ?? '', /reg\.py:2 reads vars\(report\)/);
	assert.match(load({ 'reg.py': 'import pkg.report as r\nNAMES = r.__dict__.keys()\n' }).constantsOnly ?? '', /reg\.py:2 reads r\.__dict__/);
	assert.match(load({ 'pkg/reg.py': 'from . import report\nNAMES = report.__dict__\n' }).constantsOnly ?? '', /reads report\.__dict__/);
	assert.equal(load({ 'reg.py': 'import json\nclass C:\n    def d(self):\n        return vars(self), self.__dict__, json.__dict__\n' }).constantsOnly,
		undefined);
});

test('module names: flat and src layouts, a namespace package and a top-level module', () => {
	const project = load({ 'src/lib/__init__.py': '', 'src/lib/core.py': '', 'ns/inner.py': '', 'top.py': '' });
	assert.deepEqual(moduleOf(project, 'pkg/report.py'), { module: 'pkg.report', package: 'pkg' });
	assert.deepEqual(moduleOf(project, 'pkg/__init__.py'), { module: 'pkg', package: 'pkg' });
	assert.deepEqual(moduleOf(project, 'src/lib/core.py'), { module: 'lib.core', package: 'lib' });
	assert.match((moduleOf(project, 'ns/inner.py') as { skip: string }).skip, /namespace package/);
	assert.match((moduleOf(project, 'top.py') as { skip: string }).skip, /top-level module/);
	assert.deepEqual([project.roots, project.packages], [['.', 'src'], ['lib', 'pkg']]);
});

test('reviewer probe p6: a package whose __init__.py defines __getattr__ skips its modules', () => {
	assert.match(skipOf({ 'pkg/__init__.py': 'def __getattr__(name):\n    return name\n' }) ?? '', /lazy package/);
});

test('tool config naming the file or module skips it', () => {
	const cases: Record<string, string>[] = [
		{ 'pyproject.toml': '[tool.ruff.lint.per-file-ignores]\n"pkg/report.py" = ["E501"]\n' },
		{ 'setup.cfg': '[mypy-pkg.report]\nignore_errors = True\n' },
		{ 'pyproject.toml': '[[tool.mypy.overrides]]\nmodule = "pkg.report"\nignore_errors = true\n' },
		{ 'pyrightconfig.json': '{ "strict": ["pkg/report.py"] }\n' },
		{ '.coveragerc': '[run]\nomit =\n    pkg/report.py\n' },
		{ 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "--cov=pkg.report"\n' },
		{ 'pyproject.toml': '[tool.setuptools]\npy-modules = ["pkg/report.py"]\n' },
	];
	for (const files of cases) { assert.match(skipOf(files) ?? '', /names|treatment/, JSON.stringify(files)); }
	assert.equal(skipOf({ 'pyproject.toml': '[project.scripts]\nreport = "pkg.report:main"\n' }), undefined);
	assert.equal(skipOf({ 'README.md': 'See pkg/report.py and pkg.report.parse_row.\n' }), undefined);
});

test('scripts, plugins, folder scans, reloads, sys.modules edits, star imports and stubs skip a module', () => {
	assert.match(skipOf({ Makefile: 'run:\n\tpython -m pkg.report --fast\n' }) ?? '', /runs it as a script \(python -m pkg\.report\)/);
	assert.match(skipOf({ '.github/workflows/ci.yml': 'run: python pkg/report.py\n' }) ?? '', /runs it as a script/);
	for (const [file, text] of [['Makefile', 'run:\n\t$(PYTHON) -m pkg.report\n'], ['ci.sh', 'python -W error -m pkg.report\n'],
		['tox.ini', '[testenv]\ncommands = {envpython} -m pkg.report\n'],
		['run.py', 'import subprocess, sys\nsubprocess.run([sys.executable, "-m", "pkg.report"])\n'],
		['go.py', 'import runpy\nrunpy.run_module("pkg.report")\n'], ['ci2.sh', 'python3.12 -X dev -m pkg.report\n']]) {
		assert.match(skipOf({ [file]: text }) ?? '', /runs it as a script \(python -m pkg\.report\)/, file);
	}
	assert.match(skipOf({ 'pyproject.toml': '[project.entry-points.pytest11]\nmine = "pkg.report"\n' }) ?? '', /pytest loads it as a plugin/);
	assert.match(skipOf({ 'pkg/__init__.py': 'import pkgutil\nfor m in pkgutil.iter_modules(__path__):\n    pass\n' }) ?? '', /lists the files of pkg\//);
	assert.match(skipOf({ 'pkg/loader.py': 'import os\nNAMES = os.listdir(os.path.dirname(__file__))\n' }) ?? '', /lists the files of pkg\//);
	assert.match(skipOf({ 'app.py': 'import importlib\ndef load(n):\n    return importlib.import_module(f"pkg.{n}")\n' }) ?? '', /by name/);
	assert.match(skipOf({ 'tests/test_r.py': 'import importlib\nfrom pkg import report\nimportlib.reload(report)\n' }) ?? '', /reloads report/);
	assert.match(skipOf({ 'tests/test_r.py': 'import sys\ndel sys.modules["pkg.report"]\n' }) ?? '', /changes sys\.modules/);
	assert.match(skipOf({ 'tests/test_r.py': 'import sys\nsys.modules[name] = None\n' }) ?? '', /changes sys\.modules/);
	assert.equal(skipOf({ 'tests/test_r.py': 'import sys\nfrom unittest.mock import patch\npatch.dict(sys.modules, {"yaml": None})\n' }), undefined);
	assert.match(skipOf({ 'use.py': 'from pkg import *\n' }) ?? '', /no __all__/);
	assert.equal(skipOf({ 'use.py': 'from pkg import *\n', 'pkg/__init__.py': '__all__ = ["x"]\n' }), undefined);
	assert.match(skipOf({ 'pkg/report.pyi': 'X: int\n' }) ?? '', /\.pyi or \.pxd/);
	assert.match(skipOf({ 'setup.py': 'from Cython.Build import cythonize\nsetup(ext_modules=cythonize("pkg/report.py"))\n' }) ?? '', /Cython/);
});

test('patches: strings, patch.object with and without a literal name, assignments and computed targets', () => {
	const project = load({
		'tests/test_a.py': 'from unittest.mock import patch\nfrom pkg import report\nimport pkg.report as r2\n'
			+ '@patch("pkg.report.helper")\ndef test_a(h):\n    pass\n'
			+ 'def test_b(monkeypatch):\n    monkeypatch.setattr(report, "json", None)\n    r2.CACHE = {}\n'
			+ 'def test_c():\n    patch.object(report, NAME)\n    target = f"pkg.report.{NAME}"\n',
	});
	const found = modulePatches(project, 'pkg.report');
	assert.deepEqual([...found.strings.keys()], ['helper']);
	assert.deepEqual([...found.named.keys()], ['json']);
	assert.deepEqual([...found.assigned.keys()], ['CACHE']);
	assert.equal(found.objectUse, 'tests/test_a.py:8');
	assert.equal(found.prefix, 'tests/test_a.py:12');
});

test('review item 7: patch strings built by format, % or rf, import_module bindings, tuple targets and del lists', () => {
	const found = (text: string) => modulePatches(load({ 'tests/test_a.py': text }), 'pkg.report');
	for (const text of ['t = "{}.helper".format("pkg.report")\n', 't = "%s.helper" % "pkg.report"\n', 't = rf"pkg.report.{name}"\n',
		't = Fr"pkg.report.{name}"\n', 't = "pkg.report.{}".format(n)\n', 't = "pkg.report.%s" % n\n']) {
		assert.equal(found(text).prefix, 'tests/test_a.py:1', text);
	}
	const bound = found('import importlib\nr = importlib.import_module("pkg.report")\nr.A, r.B = 1, 2\ndel r.C, r.D\n');
	assert.deepEqual([...bound.assigned.keys()], ['A', 'B', 'C', 'D']);
	assert.deepEqual([...found('from pkg import report\nprint(report.A, x=report.B)\nf(report.C)\n').assigned.keys()], []);
	assert.deepEqual([...found('from pkg import report\n(report.A, report.B) = 1, 2\nreport.E += 1\n').assigned.keys()], ['A', 'B', 'E']);
});

test('reviewer probe p4: a warnings filter naming the module is found in config and code', () => {
	const config = '[tool.pytest.ini_options]\nfilterwarnings = ["ignore::DeprecationWarning:pkg.report"]\n';
	assert.match(warningFilter(load({ 'pyproject.toml': config }), 'pkg.report') ?? '', /filters warnings by pkg\.report/);
	assert.ok(warningFilter(load({ 'conftest.py': 'import warnings\nwarnings.filterwarnings("ignore", module=r"pkg\\.report")\n' }), 'pkg.report'));
	assert.equal(warningFilter(load({}), 'pkg.report'), undefined);
});

test('review item 7: warnings filters across lines, and only package names reach mypy', () => {
	const multi = '[tool.pytest.ini_options]\nfilterwarnings = [\n    "error",\n    "ignore::DeprecationWarning:pkg.report",\n]\n';
	assert.match(warningFilter(load({ 'pyproject.toml': multi }), 'pkg.report') ?? '', /pyproject\.toml filters warnings by pkg\.report/);
	const ini = '[pytest]\nfilterwarnings =\n    error\n    ignore::UserWarning:pkg.report\n';
	assert.match(warningFilter(load({ 'pytest.ini': ini }), 'pkg.report') ?? '', /pytest\.ini filters warnings by pkg\.report/);
	const code = 'import warnings\nwarnings.filterwarnings(\n    "ignore",\n    category=DeprecationWarning,\n    module="pkg.report",\n)\n';
	assert.match(warningFilter(load({ 'conftest.py': code }), 'pkg.report') ?? '', /conftest\.py filters warnings by pkg\.report/);
	const odd = load({ '--install-types/__init__.py': '', 'tests/test_report.py': '', 'mypy.ini': '[mypy]\n' });
	assert.deepEqual(odd.packages, ['pkg']);
});

test('check commands: the import check by its path (a project file cannot shadow it), mypy, then pytest without plugins that reorder', () => {
	const project = load({ 'tests/test_report.py': 'def test_x():\n    pass\n', 'mypy.ini': '[mypy]\nstrict = True\n' });
	const checks = checkCommands(project, 'pkg.report');
	const pycheck = `python3.12 ${path.join(HELPER, 'my_editor_pycheck.py')} pkg.report`;
	assert.deepEqual(checks.map(c => c.command), [pycheck, 'python3.12 -m mypy --no-error-summary --no-color-output pkg',
		'python3.12 -m pytest -q -rA -p no:cacheprovider -p no:randomly']);
	assert.equal(checks[0].verifies, true);
	assert.equal(checks[0].env, undefined);
	const plain = load({ 'tests/test_report.py': '', 'manage.py': '' }, { ...FAKE, tools: { ...FAKE.tools, pytest: false } });
	assert.deepEqual(checkCommands(plain, 'pkg.report').map(c => c.command), [pycheck, 'python3.12 manage.py test --verbosity 2']);
	const unit = load({ 'tests/test_report.py': '' }, { ...FAKE, tools: { ...FAKE.tools, pytest: false, mypy: false } });
	assert.deepEqual(checkCommands(unit, 'pkg.report').map(c => c.command).slice(1), ['python3.12 -m unittest discover -v']);
});

test('a helper folder whose path the runner cannot pass stops Python splits with a plain reason', () => {
	const project = load({ 'pkg/__init__.py': '' });
	assert.match(importRootProblem({ ...project, helperDir: '/Applications/my editor/resources/pyast' }) ?? '',
		/The import check's folder \/Applications\/my editor\/resources\/pyast has a space or a character/);
});

test('reviewer probe p7: PYTHONPATH makes an editable install resolve to the worktree; a .pth that puts the user folder first stops the run',
	{ skip: noPython() }, () => {
		const env = mkdtempSync(path.join(os.tmpdir(), 'venv-'));
		execFileSync(python()!.path, ['-m', 'venv', '--without-pip', env]);
		const user = pyProjectFiles({ 'src/mylib/__init__.py': 'WHERE = "user"\n' }).root;
		const site = path.join(env, 'lib', readdirSync(path.join(env, 'lib'))[0], 'site-packages');
		const venvPython = { ...python()!, path: path.join(env, 'bin', 'python'), prefix: env, venv: true };
		const worktree = (files: Record<string, string>) => {
			const { root, tracked } = pyProjectFiles({ 'src/mylib/__init__.py': 'WHERE = "worktree"\n', ...files });
			return pyProject(root, venvPython, HELPER, mkdtempSync(path.join(os.tmpdir(), 'store-')), tracked);
		};
		writeFileSync(path.join(site, '__editable__.mylib.pth'), `${path.join(user, 'src')}\n`);
		assert.equal(importRootProblem(worktree({})), undefined);
		writeFileSync(path.join(site, 'zz_first.pth'), `import sys; sys.path.insert(0, ${JSON.stringify(path.join(user, 'src'))})\n`);
		assert.match(importRootProblem(worktree({})) ?? '', /The package mylib imports from .*, not from the working copy/);
	});
