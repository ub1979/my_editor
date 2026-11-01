"""Reads regression tests for the Python helper."""
from pyfacts_test_support import *


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


if __name__ == "__main__":
    unittest.main()
