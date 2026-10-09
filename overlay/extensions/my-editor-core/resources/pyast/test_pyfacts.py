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
    return tree, groups, pf.names_of(tree.body[:count], groups, pr.module_table(textwrap.dedent(source), 'm.py'))


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

    def test_operators_and_iteration_over_imported_objects_run_code(self):
        lead = 'import collections\nfrom .things import A, B\nfrom typing import Optional\n'
        for value, pure in [('A | B', False), ('frozenset(B)', False), ("collections.namedtuple('P', B)", False), ('Optional[int] | None', True),
                            ("collections.namedtuple('P', 'a b')", True), ("collections.namedtuple('P', ['a', 'b'])", True),
                            ("frozenset(('a', 'b'))", True), ('int | None', True)]:
            p, _ = purity(lead + 'Z = %s\n' % value, 'Z')
            self.assertEqual(p.reason is None, pure, '%s: %s' % (value, p.reason))

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

    def test_class_creation_hooks_run_code(self):
        """Reviewer fixtures c1 and c4: a base's __init_subclass__, Enum member hooks and an imported __set_name__ run when E is defined."""
        hook = 'class B:\n    def __init_subclass__(cls):\n        pass\n'
        cases = [(hook + 'class E(B):\n    pass\n', '__init_subclass__'),
                 (hook + 'class M(B):\n    pass\nclass E(M):\n    pass\n', '__init_subclass__'),
                 ('import enum\nclass E(enum.Enum):\n    A = 1\n    def __init__(self, v):\n        pass\n', '__init__'),
                 ('import enum\nclass E(enum.Enum):\n    def _generate_next_value_(name, *a):\n        return name\n', '_generate_next_value_'),
                 ('import enum\nclass B(enum.Enum):\n    def __new__(cls, v):\n        return object.__new__(cls)\nclass E(B):\n    pass\n', '__new__'),
                 ('from .fields import shared\nclass E:\n    name = shared\n', 'shared'),
                 ('import dataclasses\nfrom .fields import shared\nclass E:\n    name: int = dataclasses.field(default=shared)\n', 'shared')]
        for src, why in cases:
            self.assertIn(why, purity(src, 'E')[0].reason or '', src)
        for src in ['def helper():\n    pass\nclass E:\n    run = helper\n    size = 3\n    names = ("a", "b")\n',
                    'import enum\nclass E(enum.Enum):\n    A = enum.auto()\n    def label(self):\n        return 1\n']:
            self.assertIsNone(purity(src, 'E')[0].reason, src)

    @unittest.skipUnless(sys.version_info >= (3, 12), 'type parameters need Python 3.12')
    def test_type_parameters_are_not_module_names(self):
        """Reviewer fixture d1: PEP 695 parameters are local to the definition; their bounds are lazy."""
        p, ann = purity('import os\ndef g[T: Later](x: T) -> T:\n    return x\nLater = int\n', 'g')
        self.assertEqual((p.reason, ann.reason), (None, None))
        p, ann = purity('import os\nclass Box[T]:\n    item: T\n    def get(self) -> T:\n        return self.item\n', 'Box')
        self.assertEqual((p.reason, ann.reason), (None, None))
        tree = ast.parse('def g[T](x: T, y: int = 1) -> T:\n    return x\n')
        self.assertEqual(pr.definition_reads(tree.body[0]), ([], ['int']))

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
        src = 'import os\nX = 1\nX = 2\nY = 1\ndel Y\nZ = 1\ndef f():\n    global Z\n    Z = 3\nfor i in range(2):\n    pass\n'
        tree, groups, names = parsed(src)
        self.assertEqual((names.counts['X'], names.counts['Y'], names.counts['Z'], names.counts['i']), (2, 2, 2, 1))
        self.assertEqual(pr.global_assignments(pr.module_table(src, 'm.py')), ['Z'])

    def test_global_names_rebound_by_def_class_import_or_except(self):
        """Reviewer fixtures a2/a3: `global X` then `def X`, `class X`, `import X` or `except E as X` rebinds the module's X."""
        src = ('import os\ndef A():\n    pass\ndef B():\n    pass\nclass C:\n    pass\nD = 1\nE = 1\n'
               'def r():\n    global A, B, C, D\n    def A():\n        pass\n    import B\n    class C:\n        pass\n'
               '    try:\n        pass\n    except Exception as D:\n        pass\n'
               'class K:\n    global E\n    E = 2\n')
        _, _, names = parsed(src)
        self.assertEqual([names.counts[n] for n in 'ABCDE'], [2, 2, 2, 2, 2])
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
