"""Tests for name resolution, purity and reads in my_editor's Python helper. Run: python3 -m unittest -v (in this folder)."""
import ast
import sys
import textwrap
import unittest

import my_editor_pyfacts as pf
import my_editor_pyreads as pr


def parsed(source):
    """The tree, its leading imports, and one group per later statement, with the file's names."""
    tree = ast.parse(textwrap.dedent(source))
    count = next((i for i, s in enumerate(tree.body) if not isinstance(s, (ast.Import, ast.ImportFrom))), len(tree.body))
    groups = [[s] for s in tree.body[count:]]
    return tree, groups, pf.names_of(tree.body[:count], groups, tree)


def purity(source, name):
    """(definition-time Purity, annotation Purity) of the statement that defines `name`."""
    tree, groups, names = parsed(source)
    index, stmt = next((i, g[0]) for i, g in enumerate(groups) if name in pr.binds(g[0]))
    p, ann = pf.Purity(names, index), pf.Purity(names, index)
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
        pf.function_pure(p, ann, stmt, pf.TOP_FUNC)
    elif isinstance(stmt, ast.ClassDef):
        pf.class_pure(p, ann, stmt)
    else:
        p.expr(stmt.value)
    return p, ann


LEAD = 'import os\nimport re\nfrom pathlib import Path\nfrom typing import TypeVar\na = 1\nb = 2\nk = 3\nx = 4\n'


class Values(unittest.TestCase):
    def check(self, value, pure):
        p, _ = purity(LEAD + 'Z = %s\n' % value, 'Z')
        self.assertEqual(p.reason is None, pure, '%s: %s' % (value, p.reason))

    def test_pure_values(self):
        for value in ['1', '-1', "'x'", "(1, 'a')", "{'a': 1}", 'object()', "re.compile(r'x', re.I)", "TypeVar('T')", 'list[int]',
                      'int | None', 'a', 'lambda q=1: q * 2', 'frozenset({1, 2})']:
            self.check(value, True)

    def test_impure_values(self):
        for value in ["f'{x}'", 'a + b', 'a.b', '{k: 1}', '[*a]', 'frozenset(x())', "os.environ.get('X')", "Path('x')",
                      '[i for i in range(3)]', 'later', 'a < b', 'a[0]']:
            self.check(value, False)

    def test_reads_of_earlier_definitions_need_the_same_file_and_module_attributes_need_the_import_check(self):
        p, _ = purity('import lib\nX = 1\ndef f(m=lib.heavy, x=X):\n    return m\n', 'f')
        self.assertIsNone(p.reason)
        self.assertEqual((p.same_file, p.attr_reads), ({'X'}, {('lib', 'heavy')}))

    def test_a_name_bound_twice_is_not_a_stable_read(self):
        p, _ = purity('import os\nX = 1\nX = 2\ndef f(x=X):\n    return x\n', 'f')
        self.assertIn('binds more than once', p.reason)


class Definitions(unittest.TestCase):
    def test_decorators_resolve_by_binding(self):
        cases = [('from flask import Flask\napp = Flask(__name__)\n@app.route("/")\ndef f(): pass\n', False),
                 ('import pytest\n@pytest.fixture\ndef f(): pass\n', False),
                 ('import attr\n@attr.s\nclass f: pass\n', False),
                 ('from dataclasses import dataclass\n@dataclass\nclass f:\n    x: int = 0\n', True),
                 ('from dataclasses import dataclass\n@dataclass(frozen=True)\nclass f:\n    x: int = 0\n', True),
                 ('from functools import lru_cache\n@lru_cache(maxsize=32)\ndef f(): pass\n', True),
                 ('from .util import dataclass\n@dataclass\nclass f: pass\n', False),
                 ('from .util import lru_cache\n@lru_cache(maxsize=32)\ndef f(): pass\n', False)]
        for src, pure in cases:
            self.assertEqual(purity(src, 'f')[0].reason is None, pure, src)

    def test_classes(self):
        cases = [('class E(Exception):\n    pass\n', True),
                 ('from pydantic import BaseModel\nclass E(BaseModel):\n    x: int = 1\n', False),
                 ('from .meta import Meta\nclass E(metaclass=Meta):\n    pass\n', False),
                 ('import abc\nclass E(metaclass=abc.ABCMeta):\n    pass\n', True),
                 ('def compute(): return 1\nclass E:\n    x = compute()\n', False),
                 ('class E:\n    @property\n    def a(self): return 1\n    @a.setter\n    def a(self, v): pass\n', True),
                 ('import enum\nclass E(enum.Enum):\n    A = enum.auto()\n', True),
                 ('class B:\n    pass\nclass E(B):\n    pass\n', True)]
        for src, pure in cases:
            self.assertEqual(purity(src, 'E')[0].reason is None, pure, src)

    def test_annotations_are_judged_apart(self):
        p, ann = purity('from .types import Row\ndef f(x: Row.Cell) -> int:\n    return x\n', 'f')
        self.assertIsNone(p.reason)
        self.assertIn('Row.Cell', ann.reason)


class Reads(unittest.TestCase):
    def test_definition_reads_and_annotation_reads(self):
        tree, _, _ = parsed('from typing import Optional\nX = 1\ndef f(a=X, *, b: Optional[int] = None) -> "Row":\n    return Y\n')
        self.assertEqual(pr.definition_reads(tree.body[2]), (['X'], ['Optional', 'int']))

    def test_nested_scopes_read_globals_through_symtable(self):
        source = ('import json\ndef f(a=1):\n    def g():\n        return json.dumps(a) + str(Y)\n    return g\n'
                  'class C:\n    z = 1\n    def m(self):\n        return z\n')
        found = {line: sorted(names) for line, names, _ in pr.table_reads(pr.module_table(source, 'm.py')) if names}
        self.assertEqual(found[3], ['Y', 'json', 'str'])
        self.assertEqual(found[8], ['z'])

    def test_forward_reference_strings(self):
        tree, _, _ = parsed('from typing import TypeVar, cast\nT = TypeVar("T", bound="Row")\ndef f(x):\n    return cast("Cell", x)\n')
        self.assertEqual(pr.forward_refs(tree.body[1]), ['Row'])
        self.assertEqual(pr.forward_refs(tree.body[2]), ['Cell'])

    def test_bindings(self):
        tree, groups, names = parsed('import os\nX = 1\nX = 2\nY = 1\ndel Y\nZ = 1\ndef f():\n    global Z\n    Z = 3\nfor i in range(2):\n    pass\n')
        self.assertEqual((names.counts['X'], names.counts['Y'], names.counts['Z'], names.counts['i']), (2, 2, 2, 1))
        self.assertEqual(pr.global_assignments(tree), ['Z'])
        self.assertEqual(names.canon(ast.parse('os.path', mode='eval').body), 'os.path')

    def test_file_forms_and_namespace_access(self):
        def use(src):
            return pr.file_use(ast.parse(src).body)
        self.assertEqual(use('import os\nD = os.path.dirname(__file__)\n'), 'folder')
        self.assertEqual(use('from pathlib import Path\nD = Path(__file__).resolve().parent\n'), 'folder')
        self.assertEqual(use('D = open(__file__)\n'), 'other')
        for src, why in [('exec("x = 1")\n', 'exec()'), ('def f():\n    return globals()\n', 'globals()'), ('vars()\n', 'vars() without arguments'),
                         ('import sys\nsys._getframe(1)\n', 'sys._getframe'), ('import sys\nsys.modules[__name__]\n', 'sys.modules[__name__]'),
                         ('import inspect\ninspect.stack()\n', 'inspect.stack')]:
            tree, _, names = parsed(src)
            self.assertEqual(pr.namespace_use(tree, names), why, src)
        self.assertIsNone(pr.namespace_use(*parsed('vars(os)\n')[::2]))

    def test_main_guard_and_late_imports(self):
        self.assertTrue(pr.main_guard(ast.parse('if __name__ == "__main__":\n    pass\n')))
        tree = ast.parse('X = 1\ntry:\n    import yaml\nexcept ImportError:\n    yaml = None\n')
        self.assertEqual(pr.late_import(tree.body), 3)
        self.assertIsNone(pr.late_import(ast.parse('def f():\n    import json\n').body))

    @unittest.skipUnless(sys.version_info >= (3, 12), 'type statements need Python 3.12')
    def test_type_alias_values_are_lazy(self):
        tree = ast.parse('type Rows = list[Row]\n')
        self.assertEqual(pr.definition_reads(tree.body[0]), ([], []))


if __name__ == '__main__':
    unittest.main()
