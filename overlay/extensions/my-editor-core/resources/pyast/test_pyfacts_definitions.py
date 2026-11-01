"""Definitions regression tests for the Python helper."""
from pyfacts_test_support import *


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


if __name__ == "__main__":
    unittest.main()
