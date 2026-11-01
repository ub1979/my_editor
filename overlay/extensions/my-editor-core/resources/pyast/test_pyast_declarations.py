"""Declarations regression tests for the Python helper."""
from pyast_test_support import *


class Declarations(unittest.TestCase):
    def test_module_names_and_file(self):
        self.assertTrue(decl('X = 1\ndef f():\n    global X\n    X = 2\n', 'f')['globalStmt'])
        self.assertEqual(decl('def f():\n    return __name__, __doc__\n', 'f')['dunders'], ['__doc__', '__name__'])
        self.assertEqual(decl('import os\ndef f():\n    return os.path.dirname(__file__)\n', 'f')['fileUse'], 'folder')

    def test_doctest_and_class_hooks(self):
        self.assertTrue(decl('def f():\n    """\n    >>> f()\n    """\n', 'f')['doctest'])
        src = 'class B:\n    def __init_subclass__(cls):\n        pass\nclass C(B):\n    pass\n'
        self.assertEqual((decl(src, 'C')['baseNames'], decl(src, 'B')['defines']), (['B'], ['__init_subclass__']))

    def test_reads_and_import_check_facts(self):
        found = decl('import lib\nfrom typing import Optional\nX = 1\ndef f(m=lib.heavy, x=X) -> Optional[int]:\n    return "Row"\n', 'f')
        self.assertEqual((found['sameFile'], found['attrReads'], found['annReads']), (['X'], [['lib', 'heavy']], ['Optional', 'int']))
        self.assertEqual(found['relies'], ['typing'])

    def test_bindings_count_every_statement_and_global_assignment(self):
        found = facts('import os\nX = 1\nX = 2\ndef f():\n    global X\n    X = 3\n')
        self.assertEqual((found['bindings']['X'], found['globalAssigned']), (3, ['X']))


if __name__ == "__main__":
    unittest.main()
