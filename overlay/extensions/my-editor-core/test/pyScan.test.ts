import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { folderScanned, moduleAliases, patchFacts, pyScan, replacedModule, resolveRelative } from '../src/aiready/pyScan';

const files = (entries: Record<string, string>) => new Map(Object.entries(entries));
const packageOf = (file: string) => file.split('/').slice(0, -1).join('.');

test('pickling: the first pickler import or use is named with its file and line', () => {
	assert.equal(pyScan(files({ 'a.py': '"""Doc."""\n\nimport pickle\n' })).pickles, 'a.py:3 uses pickle');
	assert.equal(pyScan(files({ 'a.py': 'import os, dill as d\n' })).pickles, 'a.py:1 uses dill');
	assert.equal(pyScan(files({ 'a.py': 'from multiprocessing import Pool\n' })).pickles, 'a.py:1 uses multiprocessing');
	assert.equal(pyScan(files({ 'a.py': 'x = 1\npool = ProcessPoolExecutor()\n' })).pickles, 'a.py:2 uses ProcessPoolExecutor');
	assert.equal(pyScan(files({ 'a.py': 'class A:\n    def __reduce__(self):\n        pass\n' })).pickles, 'a.py:2 uses def __reduce__');
	assert.equal(pyScan(files({ 'a.py': 'import pickle\n', 'b.py': 'import dill\n' })).pickles, 'a.py:1 uses pickle', 'the first file wins');
});

test('pickling: a PyYAML !!python/ tag counts in any text file, but code words only in Python files', () => {
	assert.equal(pyScan(files({ 'conf.yaml': 'a: !!python/object:pkg.Row {}\n' })).pickles, 'conf.yaml uses a PyYAML !!python/ tag');
	assert.equal(pyScan(files({ 'notes.txt': 'import pickle\n' })).pickles, undefined);
	assert.equal(pyScan(files({ 'a.py': 'import pickles_helper\nimport json\n' })).pickles, undefined, 'a longer name is not pickle');
});

test('module readers: __module__, inspect, and vars() or __dict__ of a project module', () => {
	assert.equal(pyScan(files({ 'a.py': 'x = 1\nname = cls.__module__\n' })).moduleReaders, 'a.py:2 reads __module__');
	assert.equal(pyScan(files({ 'a.py': 'inspect.getmodule(f)\n' })).moduleReaders, 'a.py:1 reads inspect.getmodule');
	const view = files({ 'a.py': 'import pkg.report as r\n\nnames = vars(r)\n' });
	assert.equal(pyScan(view, ['pkg']).moduleReaders, 'a.py:3 reads vars(r)');
	assert.equal(pyScan(view).moduleReaders, undefined, 'vars() of a module outside the project');
	assert.equal(pyScan(files({ 'a.py': 'from pkg import report\nreport.__dict__\n' }), ['pkg']).moduleReaders, 'a.py:2 reads report.__dict__');
	assert.equal(pyScan(files({ 'a.py': 'from other import report\nreport.__dict__\n' }), ['pkg']).moduleReaders, undefined);
});

test('script references: interpreters with -m or a .py file, argument lists and runpy', () => {
	const scan = pyScan(files({
		Makefile: 'run:\n\tpython -m pkg.cli serve\n\tpython3.12 -W error ./tools/gen.py\n\t$(PYTHON) -X dev -m pkg.tool\n',
		'tox.ini': 'commands = {envpython} scripts/check.py\n',
		'pkg/spawn.py': 'subprocess.run([sys.executable, "-m", "pkg.worker"])\nrunpy.run_module("pkg.job")\nrunpy.run_path("scripts/once.py")\n',
	}));
	assert.deepEqual([...scan.scriptModules].sort(), ['pkg.cli', 'pkg.job', 'pkg.tool', 'pkg.worker']);
	assert.deepEqual([...scan.scriptPaths].sort(), ['scripts/check.py', 'scripts/once.py', 'tools/gen.py']);
});

test('warning lines: every text line that configures warnings, and a whole multi-line filter call in code', () => {
	const scan = pyScan(files({
		'pytest.ini': '[pytest]\nfilterwarnings =\n    error\n',
		'pkg/a.py': 'import warnings\nwarnings.filterwarnings(\n    "ignore",\n    module="pkg.report",\n)\n',
	}));
	assert.deepEqual(scan.warningLines.map(w => w.file), ['pytest.ini', 'pkg/a.py', 'pkg/a.py']);
	assert.equal(scan.warningLines[0].text, 'filterwarnings =');
	assert.match(scan.warningLines[2].text, /^warnings\.filterwarnings\(\n {4}"ignore",\n {4}module="pkg\.report",\n$/);
});

test('folder scans: own folder, a computed folder, a literal, and import_module prefixes', () => {
	const scan = pyScan(files({
		'pkg/own.py': 'os.listdir(os.path.dirname(__file__))\n',
		'pkg/walk.py': 'pkgutil.iter_modules(plugins.__path__)\n',
		'pkg/glob.py': 'glob.glob("plugins/*.py")\n',
		'pkg/named.py': 'os.listdir("plugins")\n',
		'pkg/dyn.py': 'import_module(f"pkg.handlers.{name}")\nimport_module("pkg.jobs." + name)\n',
		'README.md': 'os.listdir("docs")\n',
	}));
	assert.deepEqual(scan.folderScans, [
		{ file: 'pkg/own.py', own: true },
		{ file: 'pkg/walk.py', below: true },
		{ file: 'pkg/glob.py', below: true },
		{ file: 'pkg/named.py', literal: 'plugins' },
		{ file: 'pkg/dyn.py', literal: 'pkg.handlers' },
		{ file: 'pkg/dyn.py', literal: 'pkg.jobs' },
	]);
});

test('migration words, pytest plugins and star imports', () => {
	const scan = pyScan(files({
		'app/migrations/0001_initial.py': 'from django.db import migrations\nops = [RunPython(app.rows.fill)]\n',
		'conftest.py': 'pytest_plugins = [\n    "pkg.fixtures",\n    \'pkg.more\',\n]\n',
		'pkg/__init__.py': 'from .rows import *\nfrom pkg.cols import *\n',
	}));
	assert.ok(scan.migrationWords.has('RunPython') && scan.migrationWords.has('fill'));
	assert.ok(!scan.migrationWords.has('pytest_plugins'), 'only files under migrations/');
	assert.deepEqual([...scan.pytestPlugins].sort(), ['pkg.fixtures', 'pkg.more']);
	assert.deepEqual(scan.starImports, [{ file: 'pkg/__init__.py', module: '.rows' }, { file: 'pkg/__init__.py', module: 'pkg.cols' }]);
});

test('an empty project scans to nothing', () => {
	const scan = pyScan(new Map());
	assert.equal(scan.pickles, undefined);
	assert.equal(scan.moduleReaders, undefined);
	assert.equal(scan.scriptPaths.size + scan.scriptModules.size + scan.folderScans.length + scan.warningLines.length, 0);
});

test('folderScanned: a file listing its own folder finds only that folder', () => {
	const scan = pyScan(files({ 'pkg/plugins/__init__.py': 'os.listdir(os.path.dirname(__file__))\n' }));
	assert.equal(folderScanned(scan, 'pkg/plugins', []), 'pkg/plugins/__init__.py lists the files of pkg/plugins/');
	assert.equal(folderScanned(scan, 'pkg', []), undefined);
});

test('folderScanned: a computed folder may be anywhere below the scanning file', () => {
	const scan = pyScan(files({ 'pkg/loader.py': 'os.listdir(base)\n' }));
	assert.match(folderScanned(scan, 'pkg/plugins', []) ?? '', /^pkg\/loader\.py lists files in a folder it computes, which may be pkg\/plugins\/$/);
	assert.equal(folderScanned(scan, 'pkg', [])?.startsWith('pkg/loader.py'), true);
	assert.equal(folderScanned(scan, 'other', []), undefined);
	assert.ok(folderScanned(pyScan(files({ 'loader.py': 'os.listdir(base)\n' })), 'any/where', []), 'from the top, every folder');
});

test('folderScanned: a literal names a folder from the top, beside the file, or as a dotted name under a source root', () => {
	const scan = pyScan(files({ 'pkg/loader.py': 'os.listdir("plugins/")\nimport_module(f"app.handlers.{n}")\n' }));
	assert.equal(folderScanned(scan, 'plugins', []), 'pkg/loader.py lists the files of plugins/ by name');
	assert.equal(folderScanned(scan, 'pkg/plugins', []), 'pkg/loader.py lists the files of pkg/plugins/ by name');
	assert.equal(folderScanned(scan, 'src/app/handlers', ['src']), 'pkg/loader.py lists the files of src/app/handlers/ by name');
	assert.equal(folderScanned(scan, 'src/app/handlers', []), undefined, 'not without the root');
	assert.equal(folderScanned(scan, 'pkg/other', []), undefined);
});

test('resolveRelative climbs one package per dot past the first', () => {
	assert.equal(resolveRelative('pkg.sub', 1, 'x'), 'pkg.sub.x');
	assert.equal(resolveRelative('pkg.sub', 2, 'x'), 'pkg.x');
	assert.equal(resolveRelative('pkg.sub', 3, 'x'), 'x');
	assert.equal(resolveRelative('pkg.sub', 2, ''), 'pkg');
	assert.equal(resolveRelative('', 1, ''), '');
});

test('moduleAliases: the names import lines bind to a module', () => {
	const text = [
		'import pkg.report as r, os', 'import pkg.report', 'from pkg import report as rep', 'from pkg import (\n    report,  # the module\n    other,\n)',
		'm = importlib.import_module("pkg.report")', 'from pkg import reports', 'from other import report as wrong',
	].join('\n');
	assert.deepEqual(moduleAliases(text, 'pkg.report', 'app').sort(), ['m', 'pkg.report', 'r', 'rep', 'report']);
});

test('moduleAliases: relative imports resolve against the importing file\'s package', () => {
	assert.deepEqual(moduleAliases('from .. import report as up\n', 'pkg.report', 'pkg.sub'), ['up']);
	assert.deepEqual(moduleAliases('from . import report\n', 'pkg.report', 'pkg'), ['report']);
	assert.deepEqual(moduleAliases('from . import report\n', 'pkg.report', 'pkg.sub'), [], 'that is pkg.sub.report');
	assert.deepEqual(moduleAliases('import report\nfrom . import report as r\n', 'report', '').sort(), ['r', 'report']);
});

test('patchFacts: patch target strings, named patches and assignments, each at its first place', () => {
	const tests = 'from pkg import report\n\n'
		+ 'patch("pkg.report.load")\npatch("pkg.report.load")\n'
		+ 'monkeypatch.setattr(report, "save", fake)\n'
		+ 'report.CACHE = {}\ndel report.OLD\npkg.report.A, b = 1, 2\nreport.load(1)\nok = report.FLAG == 1\n';
	const facts = patchFacts(files({ 'tests/test_report.py': tests, 'notes.md': 'patch("pkg.report.doc")' }), 'pkg.report', packageOf);
	assert.deepEqual([...facts.strings], [['load', 'tests/test_report.py:3']]);
	assert.deepEqual([...facts.named], [['save', 'tests/test_report.py:5']]);
	assert.deepEqual([...facts.assigned].sort(), [['A', 'tests/test_report.py:8'], ['CACHE', 'tests/test_report.py:6'], ['OLD', 'tests/test_report.py:7']]);
	assert.equal(facts.objectUse, 'tests/test_report.py:5');
	assert.equal(facts.prefix, undefined);
});

test('patchFacts: a non-literal attribute name is object use without a name; built strings are a prefix', () => {
	const facts = patchFacts(files({ 'a.py': 'import pkg.report\nsetattr(pkg.report, name, 1)\n', 'b.py': 'x = 1\nt = f"pkg.report.{name}"\n' }),
		'pkg.report', packageOf);
	assert.equal(facts.named.size, 0);
	assert.equal(facts.objectUse, 'a.py:2');
	assert.equal(facts.prefix, 'b.py:2');
	assert.equal(patchFacts(files({ 'c.py': 't = "pkg.report." + name\n' }), 'pkg.report', packageOf).prefix, 'c.py:1');
	assert.equal(patchFacts(files({ 'c.py': 't = "pkg.reports.x"\n' }), 'pkg.report', packageOf).strings.size, 0, 'a longer module name is not it');
});

test('replacedModule: reloading the module, or a name the file cannot resolve', () => {
	assert.equal(replacedModule(files({ 'a.py': 'from pkg import report\nimportlib.reload(report)\n' }), 'pkg.report', packageOf),
		'a.py:2 reloads report');
	assert.equal(replacedModule(files({ 'a.py': 'reload(mystery)\n' }), 'pkg.report', packageOf), 'a.py:1 reloads mystery');
	assert.equal(replacedModule(files({ 'a.py': 'import json\nimportlib.reload(json)\n' }), 'pkg.report', packageOf), undefined);
	assert.equal(replacedModule(files({ 'a.pyi': 'reload(mystery)\n' }), 'pkg.report', packageOf), undefined, 'stubs never run');
});

test('replacedModule: sys.modules edits for the module, its package or a computed key', () => {
	const check = (text: string) => replacedModule(files({ 'a.py': text }), 'pkg.report', packageOf);
	assert.equal(check('sys.modules["pkg.report"] = fake\n'), 'a.py:1 changes sys.modules["pkg.report"]');
	assert.equal(check('sys.modules.pop("pkg")\n'), 'a.py:1 changes sys.modules["pkg"]');
	assert.equal(check('x = 1\ndel sys.modules[key]\n'), 'a.py:2 changes sys.modules[key]');
	assert.equal(check('sys.modules.clear()\n'), 'a.py:1 changes sys.modules[…]');
	assert.equal(check('sys.modules["other"] = fake\n'), undefined);
	assert.equal(check('if sys.modules["pkg.report"] == x: pass\n'), undefined, 'a comparison is not an edit');
});

test('replacedModule: patch.dict on sys.modules with the module\'s keys, or with a mapping it cannot read', () => {
	const check = (text: string) => replacedModule(files({ 'a.py': text }), 'pkg.report', packageOf);
	assert.equal(check('patch.dict(sys.modules, {"pkg.report": fake})\n'), 'a.py:1 patches sys.modules');
	assert.equal(check('patch.dict("sys.modules", fakes)\n'), 'a.py:1 patches sys.modules');
	assert.equal(check('patch.dict(sys.modules, {"numpy": fake})\n'), undefined);
});
